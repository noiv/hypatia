// @ts-nocheck - Working first, types later
/**
 * Wind10mRenderService - WebGPU compute-based wind line tracing
 *
 * Performance: ~3.4ms for 16384 lines (vs 190ms CPU)
 * Implements ILayer interface for polymorphic layer management
 */

import type { ILayer } from './ILayer';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { EARTH_RADIUS_UNITS } from '../utils/constants';
import { generateFibonacciSphere } from '../utils/sphereSeeds';
import { Wind10mDataService, TimeStep } from '../layers/wind10m.data-service';
import { configLoader } from '../config';
import type { TextRenderService } from './text.render-service';

export class Wind10mRenderService implements ILayer {
  public group: THREE.Group;
  private seeds: THREE.Vector3[];
  private lines: LineSegments2 | THREE.Mesh | null = null;
  private material: LineMaterial | THREE.ShaderMaterial | null = null;

  // Performance mode: 'linesegments2' or 'custom'
  private static readonly USE_CUSTOM_GEOMETRY = false;

  // Wind data
  private dataService: Wind10mDataService | null = null;
  private timesteps: TimeStep[] = [];
  private windDataU: Uint16Array[] = [];
  private windDataV: Uint16Array[] = [];

  // WebGPU
  private device: GPUDevice | null = null;
  private pipeline: GPUComputePipeline | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private seedBuffer: GPUBuffer | null = null;
  private outputBuffer: GPUBuffer | null = null;
  private stagingBuffer: GPUBuffer | null = null;
  private windBuffers: GPUBuffer[] = [];
  private blendBuffer: GPUBuffer | null = null;
  private visibleIndicesBuffer: GPUBuffer | null = null;
  private numVisibleBuffer: GPUBuffer | null = null;

  // Bind group cache: key = "index0-index1", value = bind group
  private bindGroupCache = new Map<string, GPUBindGroup>();

  // Camera culling
  private cameraDirection: THREE.Vector3 = new THREE.Vector3(0, 0, 1);
  private visibleSeeds: Uint32Array | null = null;
  private numVisibleSeeds: number = 0;

  // State
  private lastTimeIndex: number = -1;
  private animationPhase: number = 0;
  private updatePromise: Promise<void> | null = null;
  private cachedRandomOffsets: Float32Array | null = null;
  private cachedPositions: Float32Array | null = null;
  private cachedColors: Float32Array | null = null;

  private static readonly LINE_STEPS = 32;
  private static readonly STEP_FACTOR = 0.00045;
  private static readonly LINE_WIDTH = 2.0;
  private static readonly TAPER_SEGMENTS = 4;
  private static readonly SNAKE_LENGTH = 10;

  constructor(numSeeds: number = 16384) {
    this.group = new THREE.Group();
    this.group.name = 'wind-layer-gpu-compute';

    // Generate uniformly distributed seed points on sphere using Fibonacci lattice
    this.seeds = generateFibonacciSphere(8192, EARTH_RADIUS_UNITS);

    console.log(`🌬️  Wind10mRenderService: Generated ${this.seeds.length} grid points`);
  }

  /**
   * Initialize WebGPU compute pipeline
   */
  async initGPU(renderer: any): Promise<void> {
    // WebGPU guaranteed to be available (checked during bootstrap)
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('Failed to get WebGPU adapter');
    }

    this.device = await adapter.requestDevice();
    console.log('🌬️  Initializing WebGPU compute pipeline...');

    // Create seed buffer
    const seedData = new Float32Array(this.seeds.length * 4);
    for (let i = 0; i < this.seeds.length; i++) {
      seedData[i * 4 + 0] = this.seeds[i].x;
      seedData[i * 4 + 1] = this.seeds[i].y;
      seedData[i * 4 + 2] = this.seeds[i].z;
      seedData[i * 4 + 3] = 0;  // padding
    }

    this.seedBuffer = this.device.createBuffer({
      size: seedData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.seedBuffer, 0, seedData);

    // Create output buffer (vec4f = 4 floats = 16 bytes per vertex)
    const outputSize = this.seeds.length * Wind10mRenderService.LINE_STEPS * 4 * 4;
    this.outputBuffer = this.device.createBuffer({
      size: outputSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    this.stagingBuffer = this.device.createBuffer({
      size: outputSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // Create visible indices buffer (max size = all seeds)
    const indicesSize = this.seeds.length * 4; // uint32 per index
    this.visibleIndicesBuffer = this.device.createBuffer({
      size: indicesSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Initialize with all indices (no culling initially)
    const allIndices = new Uint32Array(this.seeds.length);
    for (let i = 0; i < this.seeds.length; i++) {
      allIndices[i] = i;
    }
    this.device.queue.writeBuffer(this.visibleIndicesBuffer, 0, allIndices);
    this.visibleSeeds = allIndices;
    this.numVisibleSeeds = this.seeds.length;

    // Shader code
    const shaderCode = `
      struct Seed {
        position: vec3f,
        padding: f32,
      }

      @group(0) @binding(0) var<storage, read> seeds: array<Seed>;
      @group(0) @binding(1) var<storage, read_write> output: array<vec4f>;
      @group(0) @binding(2) var<storage, read> windU0: array<u32>;
      @group(0) @binding(3) var<storage, read> windV0: array<u32>;
      @group(0) @binding(4) var<storage, read> windU1: array<u32>;
      @group(0) @binding(5) var<storage, read> windV1: array<u32>;
      @group(0) @binding(6) var<uniform> blend: f32;
      @group(0) @binding(7) var<storage, read> visibleIndices: array<u32>;

      const WIDTH: u32 = 1441u;
      const HEIGHT: u32 = 721u;
      const STEP_FACTOR: f32 = 0.00045;
      const PI: f32 = 3.14159265359;

      fn fp16ToFloat(fp16: u32) -> f32 {
        let sign = (fp16 >> 15u) & 1u;
        let exponent = (fp16 >> 10u) & 31u;
        let fraction = fp16 & 1023u;
        if (exponent == 0u) { return 0.0; }
        let signF = select(1.0, -1.0, sign == 1u);
        let expF = f32(i32(exponent) - 15);
        let fracF = f32(fraction) / 1024.0;
        return signF * pow(2.0, expF) * (1.0 + fracF);
      }

      fn sampleWind0(lat: f32, lon: f32) -> vec2f {
        let x = (lon + 180.0) / 0.25;
        let y = (90.0 - lat) / 0.25;
        let x0 = u32(floor(x)) % WIDTH;
        let x1 = (x0 + 1u) % WIDTH;
        let y0 = clamp(u32(floor(y)), 0u, HEIGHT - 1u);
        let y1 = clamp(y0 + 1u, 0u, HEIGHT - 1u);
        let fx = fract(x);
        let fy = fract(y);

        let idx00 = y0 * WIDTH + x0;
        let idx10 = y0 * WIDTH + x1;
        let idx01 = y1 * WIDTH + x0;
        let idx11 = y1 * WIDTH + x1;

        let u00 = fp16ToFloat(windU0[idx00]);
        let u10 = fp16ToFloat(windU0[idx10]);
        let u01 = fp16ToFloat(windU0[idx01]);
        let u11 = fp16ToFloat(windU0[idx11]);
        let v00 = fp16ToFloat(windV0[idx00]);
        let v10 = fp16ToFloat(windV0[idx10]);
        let v01 = fp16ToFloat(windV0[idx01]);
        let v11 = fp16ToFloat(windV0[idx11]);

        let u_top = mix(u00, u10, fx);
        let u_bot = mix(u01, u11, fx);
        let u = mix(u_top, u_bot, fy);
        let v_top = mix(v00, v10, fx);
        let v_bot = mix(v01, v11, fx);
        let v = mix(v_top, v_bot, fy);

        return vec2f(u, v);
      }

      fn sampleWind1(lat: f32, lon: f32) -> vec2f {
        let x = (lon + 180.0) / 0.25;
        let y = (90.0 - lat) / 0.25;
        let x0 = u32(floor(x)) % WIDTH;
        let x1 = (x0 + 1u) % WIDTH;
        let y0 = clamp(u32(floor(y)), 0u, HEIGHT - 1u);
        let y1 = clamp(y0 + 1u, 0u, HEIGHT - 1u);
        let fx = fract(x);
        let fy = fract(y);

        let idx00 = y0 * WIDTH + x0;
        let idx10 = y0 * WIDTH + x1;
        let idx01 = y1 * WIDTH + x0;
        let idx11 = y1 * WIDTH + x1;

        let u00 = fp16ToFloat(windU1[idx00]);
        let u10 = fp16ToFloat(windU1[idx10]);
        let u01 = fp16ToFloat(windU1[idx01]);
        let u11 = fp16ToFloat(windU1[idx11]);
        let v00 = fp16ToFloat(windV1[idx00]);
        let v10 = fp16ToFloat(windV1[idx10]);
        let v01 = fp16ToFloat(windV1[idx01]);
        let v11 = fp16ToFloat(windV1[idx11]);

        let u_top = mix(u00, u10, fx);
        let u_bot = mix(u01, u11, fx);
        let u = mix(u_top, u_bot, fy);
        let v_top = mix(v00, v10, fx);
        let v_bot = mix(v01, v11, fx);
        let v = mix(v_top, v_bot, fy);

        return vec2f(u, v);
      }

      fn sampleWind(lat: f32, lon: f32) -> vec2f {
        let wind0 = sampleWind0(lat, lon);
        let wind1 = sampleWind1(lat, lon);
        return mix(wind0, wind1, blend);
      }

      fn cartesianToLatLon(pos: vec3f) -> vec2f {
        let normalized = normalize(pos);
        let lat = asin(clamp(normalized.y, -1.0, 1.0));

        // Handle poles: at poles (|y| ≈ 1), longitude is undefined, use 0
        var lon: f32;
        if (abs(normalized.y) > 0.9999) {
          lon = 0.0; // Arbitrary longitude at poles
        } else {
          lon = atan2(normalized.z, normalized.x);
        }

        // Apply rain layer transformation (90° west rotation + horizontal mirror)
        // This matches the coordinate system used by the rain texture
        var u = ((lon - PI/2.0) + PI) / (2.0 * PI);  // Rotate 90° west
        u = 1.0 - u;  // Mirror horizontally
        let lonDeg = u * 360.0 - 180.0;  // Convert to degrees [-180, 180]

        // Convert latitude to degrees
        let latDeg = lat * 180.0 / PI;

        return vec2f(latDeg, lonDeg);
      }

      @compute @workgroup_size(64)
      fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        let visibleIdx = global_id.x;
        if (visibleIdx >= arrayLength(&visibleIndices)) { return; }

        // Read actual seed index from visible indices buffer
        let seedIdx = visibleIndices[visibleIdx];
        var pos = seeds[seedIdx].position;
        var normPos = normalize(pos);

        // Output first vertex: starting position on sphere
        // Write to compact output array (based on visibleIdx, not seedIdx)
        output[visibleIdx * 32u] = vec4f(pos, 1.0);

        // Trace wind flow using Rodrigues rotation to stay on sphere
        for (var step = 1u; step < 32u; step++) {
          // Convert to lat/lon for wind sampling
          let latLon = cartesianToLatLon(pos);
          let wind = sampleWind(latLon.x, latLon.y);

          // Build tangent frame at current position
          let up = vec3f(0.0, 1.0, 0.0);
          var tangentX = cross(normPos, up);

          // Handle poles: if cross product is near-zero, use alternative up vector
          if (length(tangentX) < 0.001) {
            tangentX = cross(normPos, vec3f(1.0, 0.0, 0.0));
          }
          tangentX = normalize(tangentX);
          let tangentY = normalize(cross(tangentX, normPos));

          // Wind velocity in tangent space (u = east-west, v = north-south)
          // Negate entire vector to fix flow direction, negate V again to fix north-south
          let windTangent = -(tangentX * wind.x - tangentY * wind.y);
          let windSpeed = length(windTangent);

          // Skip if wind is too weak to avoid numerical issues
          if (windSpeed < 0.001) {
            output[visibleIdx * 32u + step] = vec4f(pos, 1.0);
            continue;
          }

          // Rodrigues rotation: rotate pos around axis perpendicular to movement
          let axis = normalize(cross(normPos, windTangent));
          let angle = windSpeed * STEP_FACTOR;

          let cosA = cos(angle);
          let sinA = sin(angle);
          let dotVal = dot(axis, normPos);

          // Rodrigues formula: v_rot = v*cos(θ) + (k×v)*sin(θ) + k*(k·v)*(1-cos(θ))
          let rotated = normPos * cosA + cross(axis, normPos) * sinA + axis * dotVal * (1.0 - cosA);

          // Normalize to keep on sphere surface and scale to Earth radius
          let newPos = normalize(rotated) * length(pos);

          // Safety: check for NaN and fall back to previous position
          // WGSL doesn't have isnan/isinf, so check if value equals itself (NaN != NaN)
          let isValid = all(newPos == newPos) && length(newPos) > 0.0 && length(newPos) < 1000.0;

          if (isValid) {
            pos = newPos;
            normPos = normalize(pos);
            output[visibleIdx * 32u + step] = vec4f(pos, 1.0);
          } else {
            output[visibleIdx * 32u + step] = vec4f(pos, 1.0);
          }
        }
      }
    `;

    const shaderModule = this.device.createShaderModule({ code: shaderCode });

    // Create bind group layout
    this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    });

    this.pipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
      compute: { module: shaderModule, entryPoint: 'main' },
    });

    // Create reusable blend uniform buffer
    this.blendBuffer = this.device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    console.log('✅ WebGPU compute pipeline ready');
  }

  /**
   * Load all wind data timesteps
   */
  async loadWindData(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    // Get dataset info for U and V components
    const uDatasetInfo = configLoader.getDatasetInfo('wind10m_u');
    const vDatasetInfo = configLoader.getDatasetInfo('wind10m_v');

    if (!uDatasetInfo || !vDatasetInfo) {
      throw new Error('Wind datasets (wind10m_u, wind10m_v) not found in manifest');
    }

    // Create Wind10mDataService instance
    this.dataService = new Wind10mDataService(
      uDatasetInfo,
      vDatasetInfo,
      configLoader.getDataBaseUrl(),
      'wind10m_u',
      'wind10m_v'
    );

    this.timesteps = this.dataService.generateTimeSteps();
    if (this.timesteps.length === 0) {
      throw new Error('No wind timesteps available');
    }

    const { uData, vData } = await this.dataService.loadAllTimeSteps(this.timesteps, onProgress);
    this.windDataU = uData;
    this.windDataV = vData;

    // Upload all timesteps to GPU
    for (let i = 0; i < this.timesteps.length; i++) {
      const u_u32 = new Uint32Array(uData[i]);
      const v_u32 = new Uint32Array(vData[i]);

      const uBuffer = this.device!.createBuffer({
        size: u_u32.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.device!.queue.writeBuffer(uBuffer, 0, u_u32);

      const vBuffer = this.device!.createBuffer({
        size: v_u32.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.device!.queue.writeBuffer(vBuffer, 0, v_u32);

      this.windBuffers.push(uBuffer, vBuffer);
    }

    console.log(`Wind GPU: uploaded ${this.timesteps.length} timesteps`);
  }

  /**
   * Update camera direction for visibility culling
   */
  updateCameraDirection(cameraPosition: THREE.Vector3): void {
    // Camera direction is from origin (center of sphere) to camera
    this.cameraDirection.copy(cameraPosition).normalize();

    // Calculate which seeds are camera-facing (dot product > 0)
    const visibleIndices: number[] = [];
    for (let i = 0; i < this.seeds.length; i++) {
      const seed = this.seeds[i];
      const seedNormal = new THREE.Vector3(seed.x, seed.y, seed.z).normalize();

      // Seed is visible if its normal points towards camera (dot > 0)
      if (seedNormal.dot(this.cameraDirection) > 0) {
        visibleIndices.push(i);
      }
    }

    // Update visible seeds buffer if count changed
    if (visibleIndices.length !== this.numVisibleSeeds) {
      this.numVisibleSeeds = visibleIndices.length;
      this.visibleSeeds = new Uint32Array(visibleIndices);

      if (this.device && this.visibleIndicesBuffer) {
        this.device.queue.writeBuffer(this.visibleIndicesBuffer, 0, this.visibleSeeds);
      }

      // Clear bind group cache since visible set changed
      this.bindGroupCache.clear();
    }
  }

  /**
   * Update wind lines for current time using WebGPU compute (async version)
   */
  async updateTimeAsync(currentTime: Date): Promise<void> {
    if (this.timesteps.length === 0 || !this.device || !this.pipeline || !this.dataService) return;

    const timeIndex = this.dataService.timeToIndex(currentTime, this.timesteps);

    // Only recompute if time changed significantly
    if (Math.abs(timeIndex - this.lastTimeIndex) < 0.001) {
      return;
    }

    // If already updating, ignore this call completely (don't wait)
    if (this.updatePromise) {
      return;
    }

    // Set promise IMMEDIATELY before any async work - this is the critical section
    const doUpdateWork = async () => {
      // Update lastTimeIndex inside the critical section
      this.lastTimeIndex = timeIndex;

      const { index0, index1, blend } = this.dataService!.getAdjacentTimesteps(timeIndex);

      await this.doUpdate(index0, index1, blend);
    };

    this.updatePromise = doUpdateWork();
    await this.updatePromise;
    this.updatePromise = null;
  }

  /**
   * Internal update implementation
   */
  private async doUpdate(index0: number, index1: number, blend: number): Promise<void> {
    const startTime = performance.now();

    // Update blend uniform buffer (reuse instead of creating new)
    this.device.queue.writeBuffer(this.blendBuffer!, 0, new Float32Array([blend]));

    // Check bind group cache for this timestep pair
    const cacheKey = `${index0}-${index1}`;
    let bindGroup = this.bindGroupCache.get(cacheKey);
    const wasInCache = !!bindGroup;

    if (!bindGroup) {
      // Create and cache bind group for this timestep pair
      bindGroup = this.device.createBindGroup({
        layout: this.bindGroupLayout!,
        entries: [
          { binding: 0, resource: { buffer: this.seedBuffer! } },
          { binding: 1, resource: { buffer: this.outputBuffer! } },
          { binding: 2, resource: { buffer: this.windBuffers[index0 * 2] } },      // U0
          { binding: 3, resource: { buffer: this.windBuffers[index0 * 2 + 1] } },  // V0
          { binding: 4, resource: { buffer: this.windBuffers[index1 * 2] } },      // U1
          { binding: 5, resource: { buffer: this.windBuffers[index1 * 2 + 1] } },  // V1
          { binding: 6, resource: { buffer: this.blendBuffer! } },
          { binding: 7, resource: { buffer: this.visibleIndicesBuffer! } },
        ],
      });
      this.bindGroupCache.set(cacheKey, bindGroup);
    }

    // Execute compute shader
    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, bindGroup);

    // Dispatch only for visible seeds (culling optimization)
    const numWorkgroups = Math.ceil(this.numVisibleSeeds / 64);
    passEncoder.dispatchWorkgroups(numWorkgroups);
    passEncoder.end();

    // Copy results to staging buffer (vec4 = 4 floats per vertex)
    // Only copy visible lines to reduce GPU->CPU transfer
    const outputSize = this.numVisibleSeeds * Wind10mRenderService.LINE_STEPS * 4 * 4;
    commandEncoder.copyBufferToBuffer(this.outputBuffer!, 0, this.stagingBuffer!, 0, outputSize);
    this.device.queue.submit([commandEncoder.finish()]);

    const submitTime = performance.now();

    // Read results
    await this.stagingBuffer!.mapAsync(GPUMapMode.READ);
    const mapTime = performance.now();

    const resultData = new Float32Array(this.stagingBuffer!.getMappedRange());

    // Convert to positions and colors for LineSegments2
    this.updateGeometry(resultData);
    const geometryTime = performance.now();

    this.stagingBuffer!.unmap();

    const totalTime = performance.now() - startTime;
    const submitMs = submitTime - startTime;
    const mapMs = mapTime - submitTime;
    const geomMs = geometryTime - mapTime;
    const cacheHit = wasInCache ? '✓ cache' : 'created';
    const cullPct = ((1 - this.numVisibleSeeds / this.seeds.length) * 100).toFixed(0);
    console.log(`🌬️  Wind update: ${totalTime.toFixed(1)}ms [submit: ${submitMs.toFixed(1)}ms, map: ${mapMs.toFixed(1)}ms, geom: ${geomMs.toFixed(1)}ms] bindGroup: ${cacheHit}, culled: ${cullPct}% (${this.numVisibleSeeds}/${this.seeds.length})`);
  }

  /**
   * Update LineSegments2 geometry with computed vertices
   */
  private updateGeometry(vertices: Float32Array): void {
    // Allocate arrays based on visible seeds count
    const numSegments = this.numVisibleSeeds * (Wind10mRenderService.LINE_STEPS - 1);
    const arraySize = numSegments * 6;

    if (!this.cachedPositions || this.cachedPositions.length !== arraySize) {
      this.cachedPositions = new Float32Array(arraySize);
      this.cachedColors = new Float32Array(arraySize);
    }

    const positions = this.cachedPositions;
    const colors = this.cachedColors;

    const cycleLength = Wind10mRenderService.LINE_STEPS + Wind10mRenderService.SNAKE_LENGTH;
    const totalSegments = Wind10mRenderService.LINE_STEPS - 1;

    // Generate random offsets once and cache them (for all seeds, indexed by actual seed ID)
    if (!this.cachedRandomOffsets) {
      this.cachedRandomOffsets = new Float32Array(this.seeds.length);
      for (let i = 0; i < this.seeds.length; i++) {
        this.cachedRandomOffsets[i] = Math.random() * cycleLength;
      }
    }

    let posIdx = 0;
    let colorIdx = 0;

    // Process only visible lines
    for (let lineIdx = 0; lineIdx < this.numVisibleSeeds; lineIdx++) {
      // Get actual seed index from visible seeds array to use consistent random offset
      const actualSeedIdx = this.visibleSeeds ? this.visibleSeeds[lineIdx] : lineIdx;
      const randomOffset = this.cachedRandomOffsets[actualSeedIdx];
      const offset = lineIdx * Wind10mRenderService.LINE_STEPS * 4; // vec4 = 4 floats
      const normalizedOffset = randomOffset / cycleLength;

      for (let i = 0; i < Wind10mRenderService.LINE_STEPS - 1; i++) {
        const idx0 = offset + i * 4;       // vec4 stride
        const idx1 = offset + (i + 1) * 4; // vec4 stride

        // Write positions directly to typed array
        positions[posIdx++] = vertices[idx0];
        positions[posIdx++] = vertices[idx0 + 1];
        positions[posIdx++] = vertices[idx0 + 2];
        positions[posIdx++] = vertices[idx1];
        positions[posIdx++] = vertices[idx1 + 1];
        positions[posIdx++] = vertices[idx1 + 2];

        const remainingSegments = totalSegments - i;
        const taperFactor = remainingSegments <= Wind10mRenderService.TAPER_SEGMENTS
          ? remainingSegments / Wind10mRenderService.TAPER_SEGMENTS
          : 1.0;

        // Encode segment data in color channels for snake animation
        const normalizedIndex = i / totalSegments;

        colors[colorIdx++] = normalizedIndex;
        colors[colorIdx++] = normalizedOffset;
        colors[colorIdx++] = taperFactor;
        colors[colorIdx++] = normalizedIndex;
        colors[colorIdx++] = normalizedOffset;
        colors[colorIdx++] = taperFactor;
      }
    }

    if (this.lines) {
      if (Wind10mRenderService.USE_CUSTOM_GEOMETRY) {
        this.updateCustomGeometry(positions, colors);
      } else {
        const geometry = this.lines.geometry as LineSegmentsGeometry;
        geometry.setPositions(positions as any);
        geometry.setColors(colors as any);
      }
    } else {
      this.createLines(positions, colors);
    }
  }

  /**
   * Update custom geometry buffers directly (zero-copy)
   */
  private updateCustomGeometry(positions: Float32Array, colors: Float32Array): void {
    const geometry = (this.lines as THREE.Mesh).geometry;
    const instanceStart = geometry.getAttribute('instanceStart') as THREE.BufferAttribute;
    const instanceEnd = geometry.getAttribute('instanceEnd') as THREE.BufferAttribute;
    const instanceColorStart = geometry.getAttribute('instanceColorStart') as THREE.BufferAttribute;
    const instanceColorEnd = geometry.getAttribute('instanceColorEnd') as THREE.BufferAttribute;

    // Update buffer arrays directly - just copy references since we control the data
    const numSegments = positions.length / 6;
    for (let i = 0; i < numSegments; i++) {
      const posIdx = i * 6;
      const attrIdx = i * 3;

      instanceStart.setXYZ(i, positions[posIdx], positions[posIdx + 1], positions[posIdx + 2]);
      instanceEnd.setXYZ(i, positions[posIdx + 3], positions[posIdx + 4], positions[posIdx + 5]);
      instanceColorStart.setXYZ(i, colors[posIdx], colors[posIdx + 1], colors[posIdx + 2]);
      instanceColorEnd.setXYZ(i, colors[posIdx + 3], colors[posIdx + 4], colors[posIdx + 5]);
    }

    instanceStart.needsUpdate = true;
    instanceEnd.needsUpdate = true;
    instanceColorStart.needsUpdate = true;
    instanceColorEnd.needsUpdate = true;
  }

  /**
   * Create LineSegments2 or custom geometry based on USE_CUSTOM_GEOMETRY flag
   */
  private createLines(positions: Float32Array | number[], colors: Float32Array | number[]): void {
    if (Wind10mRenderService.USE_CUSTOM_GEOMETRY) {
      this.createCustomGeometry(positions as Float32Array, colors as Float32Array);
    } else {
      this.createLineSegments2(positions, colors);
    }
  }

  /**
   * Create LineSegments2 with given positions and colors
   */
  private createLineSegments2(positions: Float32Array | number[], colors: Float32Array | number[]): void {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    geometry.setColors(colors);

    this.material = new LineMaterial({
      linewidth: Wind10mRenderService.LINE_WIDTH,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      depthTest: true,
      alphaToCoverage: false
    });

    this.material.resolution.set(window.innerWidth, window.innerHeight);

    // Add snake animation uniforms and shader
    (this.material as any).uniforms = {
      ...this.material.uniforms,
      animationPhase: { value: 0.0 },
      snakeLength: { value: Wind10mRenderService.SNAKE_LENGTH },
      lineSteps: { value: Wind10mRenderService.LINE_STEPS }
    };

    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.animationPhase = (this.material as any).uniforms.animationPhase;
      shader.uniforms.snakeLength = (this.material as any).uniforms.snakeLength;
      shader.uniforms.lineSteps = (this.material as any).uniforms.lineSteps;

      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        `
        uniform float animationPhase;
        uniform float snakeLength;
        uniform float lineSteps;
        void main() {
        `
      );

      if (shader.fragmentShader.includes('gl_FragColor =')) {
        shader.fragmentShader = shader.fragmentShader.replace(
          /gl_FragColor = vec4\( diffuseColor\.rgb, alpha \);/,
          `
          // Extract segment data from diffuseColor (RGB channels)
          float normalizedIndex = diffuseColor.r;
          float normalizedOffset = diffuseColor.g;
          float taperFactor = diffuseColor.b;

          // Calculate cycle length (lineSteps + snakeLength)
          float cycleLength = lineSteps + snakeLength;

          // Denormalize values
          float segmentIndex = normalizedIndex * (lineSteps - 1.0);
          float randomOffset = normalizedOffset * cycleLength;

          // Calculate position of snake head (wraps around) with random offset
          float snakeHead = mod(animationPhase + randomOffset, cycleLength);

          // Calculate distance from segment to snake head
          float distanceFromHead = segmentIndex - snakeHead;

          // Handle wrapping (snake can wrap around the end)
          if (distanceFromHead < -snakeLength) {
            distanceFromHead += cycleLength;
          }

          // Calculate opacity based on distance from head
          float segmentOpacity = 0.0;
          if (distanceFromHead >= -snakeLength && distanceFromHead <= 0.0) {
            // Inside snake: fade from 0 at tail to 1 at head
            float positionInSnake = (distanceFromHead + snakeLength) / snakeLength;
            segmentOpacity = positionInSnake;
          }

          // Apply opacity and taper factor, reset color to white
          float finalAlpha = alpha * segmentOpacity * taperFactor;
          gl_FragColor = vec4( vec3(1.0), finalAlpha );
          `
        );
      }
    };

    this.lines = new LineSegments2(geometry, this.material);
    this.group.add(this.lines);

    console.log(`✅ Created wind lines: ${this.seeds.length} lines, ${positions.length / 6} segments`);
  }

  /**
   * Create custom instanced geometry for zero-copy performance
   */
  private createCustomGeometry(positions: Float32Array, colors: Float32Array): void {
    const numSegments = positions.length / 6;

    // Create instanced geometry for line segments
    const geometry = new THREE.InstancedBufferGeometry();

    // Base quad geometry (will be instanced for each segment)
    const quadPositions = new Float32Array([
      -0.5, -1, 0,
      -0.5,  1, 0,
       0.5,  1, 0,
       0.5, -1, 0,
    ]);
    const quadIndices = new Uint16Array([0, 1, 2, 0, 2, 3]);

    geometry.setAttribute('position', new THREE.BufferAttribute(quadPositions, 3));
    geometry.setIndex(new THREE.BufferAttribute(quadIndices, 1));

    // Create instance attributes from our data
    const instanceStarts = new Float32Array(numSegments * 3);
    const instanceEnds = new Float32Array(numSegments * 3);
    const instanceColorStarts = new Float32Array(numSegments * 3);
    const instanceColorEnds = new Float32Array(numSegments * 3);

    for (let i = 0; i < numSegments; i++) {
      const posIdx = i * 6;
      const attrIdx = i * 3;

      instanceStarts[attrIdx] = positions[posIdx];
      instanceStarts[attrIdx + 1] = positions[posIdx + 1];
      instanceStarts[attrIdx + 2] = positions[posIdx + 2];

      instanceEnds[attrIdx] = positions[posIdx + 3];
      instanceEnds[attrIdx + 1] = positions[posIdx + 4];
      instanceEnds[attrIdx + 2] = positions[posIdx + 5];

      instanceColorStarts[attrIdx] = colors[posIdx];
      instanceColorStarts[attrIdx + 1] = colors[posIdx + 1];
      instanceColorStarts[attrIdx + 2] = colors[posIdx + 2];

      instanceColorEnds[attrIdx] = colors[posIdx + 3];
      instanceColorEnds[attrIdx + 1] = colors[posIdx + 4];
      instanceColorEnds[attrIdx + 2] = colors[posIdx + 5];
    }

    geometry.setAttribute('instanceStart', new THREE.InstancedBufferAttribute(instanceStarts, 3));
    geometry.setAttribute('instanceEnd', new THREE.InstancedBufferAttribute(instanceEnds, 3));
    geometry.setAttribute('instanceColorStart', new THREE.InstancedBufferAttribute(instanceColorStarts, 3));
    geometry.setAttribute('instanceColorEnd', new THREE.InstancedBufferAttribute(instanceColorEnds, 3));

    // Custom shader material (similar to LineMaterial but optimized)
    this.material = new THREE.ShaderMaterial({
      vertexShader: `
        attribute vec3 instanceStart;
        attribute vec3 instanceEnd;
        attribute vec3 instanceColorStart;
        attribute vec3 instanceColorEnd;

        varying vec3 vColor;

        uniform vec2 resolution;
        uniform float linewidth;

        void main() {
          // Interpolate color along segment
          vColor = mix(instanceColorStart, instanceColorEnd, position.y * 0.5 + 0.5);

          // Interpolate position along segment
          vec3 start = instanceStart;
          vec3 end = instanceEnd;
          vec3 pointPos = mix(start, end, position.y * 0.5 + 0.5);

          // Calculate line direction in screen space
          vec4 startClip = projectionMatrix * modelViewMatrix * vec4(start, 1.0);
          vec4 endClip = projectionMatrix * modelViewMatrix * vec4(end, 1.0);

          vec2 startScreen = startClip.xy / startClip.w;
          vec2 endScreen = endClip.xy / endClip.w;

          vec2 dir = normalize(endScreen - startScreen);
          vec2 normal = vec2(-dir.y, dir.x);

          // Apply line width in screen space
          vec4 clip = projectionMatrix * modelViewMatrix * vec4(pointPos, 1.0);
          vec2 offset = normal * linewidth / resolution.y * clip.w;
          clip.xy += offset * position.x;

          gl_Position = clip;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;

        uniform float animationPhase;
        uniform float snakeLength;
        uniform float lineSteps;
        uniform float opacity;

        void main() {
          // Extract segment data from color
          float normalizedIndex = vColor.r;
          float normalizedOffset = vColor.g;
          float taperFactor = vColor.b;

          // Calculate snake animation
          float cycleLength = lineSteps + snakeLength;
          float segmentIndex = normalizedIndex * (lineSteps - 1.0);
          float randomOffset = normalizedOffset * cycleLength;
          float snakeHead = mod(animationPhase + randomOffset, cycleLength);
          float distanceFromHead = segmentIndex - snakeHead;

          if (distanceFromHead < -snakeLength) {
            distanceFromHead += cycleLength;
          }

          float segmentOpacity = 0.0;
          if (distanceFromHead >= 0.0 && distanceFromHead <= snakeLength) {
            float normalizedDistance = distanceFromHead / snakeLength;
            segmentOpacity = 1.0 - normalizedDistance;
          }

          float finalAlpha = opacity * segmentOpacity * taperFactor;
          gl_FragColor = vec4(vec3(1.0), finalAlpha);
        }
      `,
      uniforms: {
        resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        linewidth: { value: Wind10mRenderService.LINE_WIDTH },
        opacity: { value: 0.6 },
        animationPhase: { value: 0.0 },
        snakeLength: { value: Wind10mRenderService.SNAKE_LENGTH },
        lineSteps: { value: Wind10mRenderService.LINE_STEPS }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });

    this.lines = new THREE.Mesh(geometry, this.material);
    this.group.add(this.lines);

    console.log(`✅ Created custom wind lines: ${this.seeds.length} lines, ${numSegments} segments`);
  }

  // ILayer interface implementation

  /**
   * Update layer based on current time
   * Delegates to async updateTimeAsync for GPU compute
   */
  updateTime(time: Date): void {
    // Call async version without blocking (fire and forget)
    this.updateTimeAsync(time).catch(err => {
      console.error('Failed to update wind layer:', err);
    });
  }

  /**
   * Get the THREE.js object to add to scene
   */
  getSceneObject(): THREE.Object3D {
    return this.group;
  }

  /**
   * Set layer visibility
   */
  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  // Legacy method for backward compatibility
  getGroup(): THREE.Group {
    return this.group;
  }

  setResolution(width: number, height: number): void {
    if (!this.material) return;

    if (Wind10mRenderService.USE_CUSTOM_GEOMETRY) {
      (this.material as THREE.ShaderMaterial).uniforms.resolution.value.set(width, height);
    } else {
      (this.material as LineMaterial).resolution.set(width, height);
    }
  }

  /**
   * Update layer based on camera distance (ILayer interface)
   * Updates line width based on camera distance from origin
   */
  updateDistance(distance: number): void {
    this.updateLineWidth(distance);
  }

  /**
   * Update sun direction (ILayer interface)
   * Wind layer doesn't use sun direction
   */
  updateSunDirection(_sunDir: THREE.Vector3): void {
    // No-op - wind layer doesn't use lighting
  }

  /**
   * Set text service (no-op - this layer doesn't produce text)
   */
  setTextService(_textService: TextRenderService): void {
    // No-op
  }

  /**
   * Update text enabled state (no-op - this layer doesn't produce text)
   */
  updateTextEnabled(_enabled: boolean): void {
    // No-op
  }

  /**
   * Update line width based on camera distance
   * Uses logarithmic interpolation for smooth scaling
   */
  private updateLineWidth(cameraDistance: number): void {
    if (!this.material) return;

    const minDistance = 1.157;
    const maxDistance = 10.0;
    const minWidth = 2.0;
    const maxWidth = 0.02;

    const t = (Math.log(cameraDistance) - Math.log(minDistance)) /
              (Math.log(maxDistance) - Math.log(minDistance));
    const clampedT = Math.max(0, Math.min(1, t));
    const lineWidth = minWidth + (maxWidth - minWidth) * clampedT;

    if (Wind10mRenderService.USE_CUSTOM_GEOMETRY) {
      (this.material as THREE.ShaderMaterial).uniforms.linewidth.value = lineWidth;
    } else {
      (this.material as LineMaterial).linewidth = lineWidth;
    }
  }

  updateAnimation(deltaTime: number): void {
    if (!this.material) return;

    const animationSpeed = 20.0;
    const cycleLength = Wind10mRenderService.LINE_STEPS + Wind10mRenderService.SNAKE_LENGTH;
    this.animationPhase = (this.animationPhase + deltaTime * animationSpeed) % cycleLength;

    const uniforms = (this.material as any).uniforms;
    if (uniforms?.animationPhase) {
      uniforms.animationPhase.value = this.animationPhase;
    }
  }

  getNumSeeds(): number {
    return this.seeds.length;
  }

  getLineWidth(): number | undefined {
    return this.material?.linewidth;
  }

  dispose(): void {
    if (this.lines) {
      this.lines.geometry.dispose();
    }
    if (this.material) {
      this.material.dispose();
    }

    // Clean up WebGPU resources
    this.bindGroupCache.clear();
    if (this.blendBuffer) {
      this.blendBuffer.destroy();
      this.blendBuffer = null;
    }
    if (this.visibleIndicesBuffer) {
      this.visibleIndicesBuffer.destroy();
      this.visibleIndicesBuffer = null;
    }
    if (this.seedBuffer) {
      this.seedBuffer.destroy();
      this.seedBuffer = null;
    }
    if (this.outputBuffer) {
      this.outputBuffer.destroy();
      this.outputBuffer = null;
    }
    if (this.stagingBuffer) {
      this.stagingBuffer.destroy();
      this.stagingBuffer = null;
    }
    for (const buffer of this.windBuffers) {
      buffer.destroy();
    }
    this.windBuffers = [];
  }
}
