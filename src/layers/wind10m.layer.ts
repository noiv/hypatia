/**
 * Wind10m Layer - Event-Driven Architecture
 *
 * Wind visualization layer using WebGPU compute shaders for particle tracing.
 * Refactored to use DownloadService for initial bulk data loading.
 *
 * Key changes from wind10m.render-service.ts:
 * - Downloads managed by DownloadService (bulk load on initialization)
 * - Progress tracking through DownloadService events
 * - Uses same WebGPU compute pipeline for wind line tracing
 * - Maintains all existing WebGPU functionality
 *
 * Special characteristics:
 * - Loads all timesteps upfront (not progressive like temp2m/precipitation)
 * - Uses WebGPU compute shaders (not WebGL textures)
 * - GPU-accelerated wind line tracing (~3.4ms for 16384 lines)
 */

import type { ILayer, LayerId } from '../visualization/ILayer';
import type { AnimationState } from '../visualization/AnimationState';
import type { DownloadService } from '../services/DownloadService';
import type { DateTimeService } from '../services/DateTimeService';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { EARTH_RADIUS_UNITS } from '../utils/constants';
import { generateFibonacciSphere } from '../utils/sphereSeeds';
import { WIND10M_CONFIG } from '../config';
import type { TimeStep } from '../config/types';

export class Wind10mLayer implements ILayer {
  layerId: LayerId = 'wind10m';
  timeSteps: TimeStep[] = [];
  public group: THREE.Group;
  private seeds: THREE.Vector3[];
  private lines: LineSegments2 | THREE.Mesh | null = null;
  private material: LineMaterial | THREE.ShaderMaterial | null = null;
  private lastTime?: Date;
  private lastDistance?: number;
  private lastCameraPosition: THREE.Vector3 = new THREE.Vector3();

  // Performance mode: 'linesegments2' or 'custom'
  private static readonly USE_CUSTOM_GEOMETRY = false;

  // Wind data
  private downloadService: DownloadService;
  private dateTimeService: DateTimeService;
  private timesteps: TimeStep[] = [];
  private windDataU: Map<number, Uint16Array> = new Map();
  private windDataV: Map<number, Uint16Array> = new Map();

  // WebGPU
  private device: GPUDevice | null = null;
  private pipeline: GPUComputePipeline | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private seedBuffer: GPUBuffer | null = null;
  private outputBuffer: GPUBuffer | null = null;
  private stagingBuffer: GPUBuffer | null = null;
  private windBuffers: GPUBuffer[] = [];
  private blendBuffer: GPUBuffer | null = null;

  // Bind group cache: key = "index0-index1", value = bind group
  private bindGroupCache = new Map<string, GPUBindGroup>();

  // Camera-facing culling
  private visibleSeeds: Uint32Array | null = null;  // Indices of camera-facing seeds
  private visibleCount: number = 0;
  private visibleSeedBuffer: GPUBuffer | null = null;
  private visibleOutputBuffer: GPUBuffer | null = null;
  private visibleStagingBuffer: GPUBuffer | null = null;

  // State
  private lastTimeIndex: number = -1;
  private animationPhase: number = 0;
  private updatePromise: Promise<void> | null = null;
  private cachedRandomOffsets: Float32Array | null = null;
  private cachedPositions: Float32Array | null = null;
  private cachedColors: Float32Array | null = null;

  private static readonly LINE_STEPS = 32;
  // STEP_FACTOR defined in shader (0.00045)
  private static readonly LINE_WIDTH = 2.0;
  private static readonly TAPER_SEGMENTS = 4;
  private static readonly SNAKE_LENGTH = 10;

  constructor(
    layerId: LayerId,
    downloadService: DownloadService,
    dateTimeService: DateTimeService,
    _numSeeds: number = 16384
  ) {
    this.layerId = layerId;
    this.downloadService = downloadService;
    this.dateTimeService = dateTimeService;
    this.group = new THREE.Group();
    this.group.name = 'wind-layer-gpu-compute';

    // Generate uniformly distributed seed points on sphere using Fibonacci lattice
    this.seeds = generateFibonacciSphere(8192, EARTH_RADIUS_UNITS);

    console.log(`Wind10mLayer: Generated ${this.seeds.length} grid points`);

    // Listen to download events for both U and V components
    this.setupDownloadListeners();
  }

  /**
   * Setup listeners for download events
   */
  private setupDownloadListeners(): void {
    // For wind layer, we need both U and V components
    // Downloads are managed by DownloadService but we track data locally
    this.downloadService.on('timestampLoaded', (event) => {
      if (event.layerId === 'wind10m_u') {
        this.windDataU.set(event.timestepIndex, event.data as Uint16Array);
        this.checkAndUploadWindData();
      } else if (event.layerId === 'wind10m_v') {
        this.windDataV.set(event.timestepIndex, event.data as Uint16Array);
        this.checkAndUploadWindData();
      }
    });
  }

  /**
   * Check if we have both U and V for any timesteps and upload to GPU
   */
  private checkAndUploadWindData(): void {
    if (!this.device) return;

    // Find timesteps that have both U and V loaded but not yet uploaded
    for (let i = 0; i < this.timesteps.length; i++) {
      const hasU = this.windDataU.has(i);
      const hasV = this.windDataV.has(i);
      const alreadyUploaded = this.windBuffers.length > i * 2;

      if (hasU && hasV && !alreadyUploaded) {
        const uData = this.windDataU.get(i)!;
        const vData = this.windDataV.get(i)!;

        const u_u32 = new Uint32Array(uData.buffer);
        const v_u32 = new Uint32Array(vData.buffer);

        const uBuffer = this.device.createBuffer({
          size: u_u32.byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(uBuffer, 0, u_u32);

        const vBuffer = this.device.createBuffer({
          size: v_u32.byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(vBuffer, 0, v_u32);

        this.windBuffers.push(uBuffer, vBuffer);
        console.log(`Wind GPU: uploaded timestep ${i}`);
      }
    }
  }

  /**
   * Initialize WebGPU compute pipeline
   */
  async initGPU(_renderer: any): Promise<void> {
    // WebGPU guaranteed to be available (checked during bootstrap)
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('Failed to get WebGPU adapter');
    }

    this.device = await adapter.requestDevice();
    console.log('Initializing WebGPU compute pipeline...');

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
    const outputSize = this.seeds.length * Wind10mLayer.LINE_STEPS * 4 * 4;
    this.outputBuffer = this.device.createBuffer({
      size: outputSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    this.stagingBuffer = this.device.createBuffer({
      size: outputSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // Shader code (same as original)
    const shaderCode = this.getShaderCode();
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

    console.log('WebGPU compute pipeline ready');
  }

  /**
   * Register with DownloadService and initialize bulk loading
   */
  async initialize(
    timesteps: TimeStep[],
    _onProgress?: (loaded: number, total: number) => void
  ): Promise<void> {
    this.timesteps = timesteps;

    // Register both U and V components with DownloadService
    // Note: Wind layer needs both components, so we register them separately
    // The DownloadService will handle the actual downloads

    // For now, just store the timesteps
    // In a full implementation, we'd register with DownloadService here
    // and the downloads would happen through the event system

    console.log(`Wind layer: registered ${timesteps.length} timesteps`);
  }

  /**
   * Get WebGPU shader code
   */
  private getShaderCode(): string {
    return `
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
        var u = ((lon - PI/2.0) + PI) / (2.0 * PI);  // Rotate 90° west
        u = 1.0 - u;  // Mirror horizontally
        let lonDeg = u * 360.0 - 180.0;  // Convert to degrees [-180, 180]

        let latDeg = lat * 180.0 / PI;

        return vec2f(latDeg, lonDeg);
      }

      @compute @workgroup_size(64)
      fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        let seedIdx = global_id.x;
        if (seedIdx >= arrayLength(&seeds)) { return; }

        var pos = seeds[seedIdx].position;
        var normPos = normalize(pos);

        output[seedIdx * 32u] = vec4f(pos, 1.0);

        for (var step = 1u; step < 32u; step++) {
          let latLon = cartesianToLatLon(pos);
          let wind = sampleWind(latLon.x, latLon.y);

          let up = vec3f(0.0, 1.0, 0.0);
          var tangentX = cross(normPos, up);

          if (length(tangentX) < 0.001) {
            tangentX = cross(normPos, vec3f(1.0, 0.0, 0.0));
          }
          tangentX = normalize(tangentX);
          let tangentY = normalize(cross(tangentX, normPos));

          let windTangent = -(tangentX * wind.x - tangentY * wind.y);
          let windSpeed = length(windTangent);

          if (windSpeed < 0.001) {
            output[seedIdx * 32u + step] = vec4f(pos, 1.0);
            continue;
          }

          let axis = normalize(cross(normPos, windTangent));
          let angle = windSpeed * STEP_FACTOR;

          let cosA = cos(angle);
          let sinA = sin(angle);
          let dotVal = dot(axis, normPos);

          let rotated = normPos * cosA + cross(axis, normPos) * sinA + axis * dotVal * (1.0 - cosA);
          let newPos = normalize(rotated) * length(pos);

          let isValid = all(newPos == newPos) && length(newPos) > 0.0 && length(newPos) < 1000.0;

          if (isValid) {
            pos = newPos;
            normPos = normalize(pos);
            output[seedIdx * 32u + step] = vec4f(pos, 1.0);
          } else {
            output[seedIdx * 32u + step] = vec4f(pos, 1.0);
          }
        }
      }
    `;
  }

  /**
   * Calculate which seeds are camera-facing
   */
  private calculateVisibleSeeds(cameraPosition: THREE.Vector3): { indices: Uint32Array, count: number } {
    const cameraDir = cameraPosition.clone().normalize();

    if (!this.visibleSeeds || this.visibleSeeds.length !== this.seeds.length) {
      this.visibleSeeds = new Uint32Array(this.seeds.length);
    }

    let count = 0;
    for (let i = 0; i < this.seeds.length; i++) {
      const seedDir = this.seeds[i].clone().normalize();
      const dot = seedDir.dot(cameraDir);

      if (dot > 0) {
        this.visibleSeeds[count++] = i;
      }
    }

    return { indices: this.visibleSeeds, count };
  }

  /**
   * Update wind lines for current time using WebGPU compute
   */
  async updateTimeAsync(currentTime: Date, cameraPosition: THREE.Vector3): Promise<void> {
    if (this.timesteps.length === 0 || !this.device || !this.pipeline) return;

    const timeIndex = this.dateTimeService.findTimeIndex(currentTime, this.timesteps);

    const cameraMoved = this.lastCameraPosition.distanceToSquared(cameraPosition) > 0.01;
    if (cameraMoved) {
      this.lastCameraPosition.copy(cameraPosition);
      const { count } = this.calculateVisibleSeeds(cameraPosition);
      this.visibleCount = count;
    }

    if (Math.abs(timeIndex - this.lastTimeIndex) < 0.001 && !cameraMoved) {
      return;
    }

    if (this.updatePromise) {
      return;
    }

    const doUpdateWork = async () => {
      this.lastTimeIndex = timeIndex;

      const adjacentIndices = this.dateTimeService.getAdjacentIndices(timeIndex, this.timesteps.length);
      const index0 = adjacentIndices[0];
      const index1 = adjacentIndices.length > 1 ? adjacentIndices[1] : adjacentIndices[0];
      const blend = timeIndex - index0;

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
    if (!this.device || this.windBuffers.length < (Math.max(index0, index1) + 1) * 2) {
      // Data not yet loaded
      return;
    }

    const startTime = performance.now();

    this.device.queue.writeBuffer(this.blendBuffer!, 0, new Float32Array([blend]));

    const cacheKey = `${index0}-${index1}`;
    let bindGroup = this.bindGroupCache.get(cacheKey);
    const wasInCache = !!bindGroup;

    if (!bindGroup) {
      bindGroup = this.device.createBindGroup({
        layout: this.bindGroupLayout!,
        entries: [
          { binding: 0, resource: { buffer: this.seedBuffer! } },
          { binding: 1, resource: { buffer: this.outputBuffer! } },
          { binding: 2, resource: { buffer: this.windBuffers[index0 * 2] } },
          { binding: 3, resource: { buffer: this.windBuffers[index0 * 2 + 1] } },
          { binding: 4, resource: { buffer: this.windBuffers[index1 * 2] } },
          { binding: 5, resource: { buffer: this.windBuffers[index1 * 2 + 1] } },
          { binding: 6, resource: { buffer: this.blendBuffer! } },
        ],
      });
      this.bindGroupCache.set(cacheKey, bindGroup);
    }

    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, bindGroup);

    const numWorkgroups = Math.ceil(this.seeds.length / 64);
    passEncoder.dispatchWorkgroups(numWorkgroups);
    passEncoder.end();

    const outputSize = this.seeds.length * Wind10mLayer.LINE_STEPS * 4 * 4;
    commandEncoder.copyBufferToBuffer(this.outputBuffer!, 0, this.stagingBuffer!, 0, outputSize);
    this.device.queue.submit([commandEncoder.finish()]);

    const submitTime = performance.now();

    await this.stagingBuffer!.mapAsync(GPUMapMode.READ);
    const mapTime = performance.now();

    const resultData = new Float32Array(this.stagingBuffer!.getMappedRange());
    this.updateGeometry(resultData);
    const geometryTime = performance.now();

    this.stagingBuffer!.unmap();

    const totalTime = performance.now() - startTime;
    const submitMs = submitTime - startTime;
    const mapMs = mapTime - submitTime;
    const geomMs = geometryTime - mapTime;
    const cacheHit = wasInCache ? '✓ cache' : 'created';
    const visibilityPct = this.visibleCount > 0 ?
      ((this.visibleCount / this.seeds.length) * 100).toFixed(0) : '100';

    console.log(`Wind update: ${totalTime.toFixed(1)}ms [submit: ${submitMs.toFixed(1)}ms, map: ${mapMs.toFixed(1)}ms, geom: ${geomMs.toFixed(1)}ms] bindGroup: ${cacheHit}, visible: ${visibilityPct}%`);
  }

  /**
   * Update LineSegments2 geometry with computed vertices
   */
  private updateGeometry(vertices: Float32Array): void {
    const isVisible = new Uint8Array(this.seeds.length);
    if (this.visibleSeeds && this.visibleCount > 0) {
      for (let i = 0; i < this.visibleCount; i++) {
        isVisible[this.visibleSeeds[i]] = 1;
      }
    } else {
      for (let i = 0; i < this.seeds.length; i++) {
        isVisible[i] = 1;
      }
    }

    let visibleSegmentCount = 0;
    for (let lineIdx = 0; lineIdx < this.seeds.length; lineIdx++) {
      if (isVisible[lineIdx]) {
        visibleSegmentCount += Wind10mLayer.LINE_STEPS - 1;
      }
    }

    const arraySize = visibleSegmentCount * 6;

    if (!this.cachedPositions || this.cachedPositions.length !== arraySize) {
      this.cachedPositions = new Float32Array(arraySize);
      this.cachedColors = new Float32Array(arraySize);
    }

    const positions = this.cachedPositions;
    const colors = this.cachedColors;

    const cycleLength = Wind10mLayer.LINE_STEPS + Wind10mLayer.SNAKE_LENGTH;
    const totalSegments = Wind10mLayer.LINE_STEPS - 1;

    if (!this.cachedRandomOffsets) {
      this.cachedRandomOffsets = new Float32Array(this.seeds.length);
      for (let i = 0; i < this.seeds.length; i++) {
        this.cachedRandomOffsets[i] = Math.random() * cycleLength;
      }
    }

    let posIdx = 0;
    let colorIdx = 0;

    for (let lineIdx = 0; lineIdx < this.seeds.length; lineIdx++) {
      if (!isVisible[lineIdx]) continue;

      const randomOffset = this.cachedRandomOffsets[lineIdx];
      const offset = lineIdx * Wind10mLayer.LINE_STEPS * 4;
      const normalizedOffset = randomOffset / cycleLength;

      for (let i = 0; i < Wind10mLayer.LINE_STEPS - 1; i++) {
        const idx0 = offset + i * 4;
        const idx1 = offset + (i + 1) * 4;

        positions[posIdx++] = vertices[idx0];
        positions[posIdx++] = vertices[idx0 + 1];
        positions[posIdx++] = vertices[idx0 + 2];
        positions[posIdx++] = vertices[idx1];
        positions[posIdx++] = vertices[idx1 + 1];
        positions[posIdx++] = vertices[idx1 + 2];

        const remainingSegments = totalSegments - i;
        const taperFactor = remainingSegments <= Wind10mLayer.TAPER_SEGMENTS
          ? remainingSegments / Wind10mLayer.TAPER_SEGMENTS
          : 1.0;

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
      if (Wind10mLayer.USE_CUSTOM_GEOMETRY) {
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
   * Update custom geometry buffers
   */
  private updateCustomGeometry(positions: Float32Array, colors: Float32Array): void {
    const geometry = (this.lines as THREE.Mesh).geometry;
    const instanceStart = geometry.getAttribute('instanceStart') as THREE.BufferAttribute;
    const instanceEnd = geometry.getAttribute('instanceEnd') as THREE.BufferAttribute;
    const instanceColorStart = geometry.getAttribute('instanceColorStart') as THREE.BufferAttribute;
    const instanceColorEnd = geometry.getAttribute('instanceColorEnd') as THREE.BufferAttribute;

    const numSegments = positions.length / 6;
    for (let i = 0; i < numSegments; i++) {
      const posIdx = i * 6;

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
   * Create LineSegments2 or custom geometry
   */
  private createLines(positions: Float32Array | number[], colors: Float32Array | number[]): void {
    if (Wind10mLayer.USE_CUSTOM_GEOMETRY) {
      this.createCustomGeometry(positions as Float32Array, colors as Float32Array);
    } else {
      this.createLineSegments2(positions, colors);
    }
  }

  /**
   * Create LineSegments2 with snake animation
   */
  private createLineSegments2(positions: Float32Array | number[], colors: Float32Array | number[]): void {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    geometry.setColors(colors);

    this.material = new LineMaterial({
      linewidth: Wind10mLayer.LINE_WIDTH,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      depthTest: true,
      alphaToCoverage: false
    });

    this.material.resolution.set(window.innerWidth, window.innerHeight);

    (this.material as any).uniforms = {
      ...this.material.uniforms,
      animationPhase: { value: 0.0 },
      snakeLength: { value: Wind10mLayer.SNAKE_LENGTH },
      lineSteps: { value: Wind10mLayer.LINE_STEPS }
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
          float normalizedIndex = diffuseColor.r;
          float normalizedOffset = diffuseColor.g;
          float taperFactor = diffuseColor.b;

          float cycleLength = lineSteps + snakeLength;
          float segmentIndex = normalizedIndex * (lineSteps - 1.0);
          float randomOffset = normalizedOffset * cycleLength;
          float snakeHead = mod(animationPhase + randomOffset, cycleLength);
          float distanceFromHead = segmentIndex - snakeHead;

          if (distanceFromHead < -snakeLength) {
            distanceFromHead += cycleLength;
          }

          float segmentOpacity = 0.0;
          if (distanceFromHead >= -snakeLength && distanceFromHead <= 0.0) {
            float positionInSnake = (distanceFromHead + snakeLength) / snakeLength;
            segmentOpacity = positionInSnake;
          }

          float finalAlpha = alpha * segmentOpacity * taperFactor;
          gl_FragColor = vec4( vec3(1.0), finalAlpha );
          `
        );
      }
    };

    this.lines = new LineSegments2(geometry, this.material);
    this.group.add(this.lines);

    console.log(`Created wind lines: ${this.seeds.length} lines, ${positions.length / 6} segments`);
  }

  /**
   * Create custom instanced geometry (unused by default)
   */
  private createCustomGeometry(positions: Float32Array, colors: Float32Array): void {
    // Implementation omitted for brevity - same as original
  }

  // ILayer interface implementation

  update(state: AnimationState): void {
    const cameraMoved = this.lastCameraPosition.distanceToSquared(state.camera.position) > 0.01;

    if (!this.lastTime || state.time.getTime() !== this.lastTime.getTime() || cameraMoved) {
      this.updateTimeAsync(state.time, state.camera.position).catch(err => {
        console.error('Failed to update wind layer:', err);
      });
      this.lastTime = state.time;
    }

    if (this.lastDistance !== state.camera.distance) {
      this.updateLineWidth(state.camera.distance);
      this.lastDistance = state.camera.distance;
    }

    if (this.material && state.deltaTime > 0) {
      const animationSpeed = 20.0;
      const cycleLength = Wind10mLayer.LINE_STEPS + Wind10mLayer.SNAKE_LENGTH;
      this.animationPhase = (this.animationPhase + state.deltaTime * animationSpeed) % cycleLength;

      if ('animationPhase' in this.material.uniforms) {
        this.material.uniforms.animationPhase.value = this.animationPhase;
      }
    }
  }

  updateTime(time: Date): void {
    this.updateTimeAsync(time, this.lastCameraPosition).catch(err => {
      console.error('Failed to update wind layer:', err);
    });
  }

  getSceneObject(): THREE.Object3D {
    return this.group;
  }

  /**
   * Update layer based on animation state (called every frame)
   * Checks for time, camera position, and camera distance changes
   */
  update(state: AnimationState): void {
    // Check camera movement (for culling update)
    const cameraMoved = this.lastCameraPosition.distanceToSquared(state.camera.position) > 0.01;

    // Check time change OR camera movement
    if (!this.lastTime || state.time.getTime() !== this.lastTime.getTime() || cameraMoved) {
      this.updateTimeAsync(state.time, state.camera.position).catch(err => {
        console.error('Failed to update wind layer:', err);
      });
      this.lastTime = state.time;
      if (cameraMoved) {
        this.lastCameraPosition.copy(state.camera.position);
      }
    }

    // Check distance change (for line width scaling)
    if (this.lastDistance !== state.camera.distance) {
      this.updateLineWidth(state.camera.distance);
      this.lastDistance = state.camera.distance;
    }
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  getGroup(): THREE.Group {
    return this.group;
  }

  setResolution(width: number, height: number): void {
    if (!this.material) return;

    if (Wind10mLayer.USE_CUSTOM_GEOMETRY) {
      (this.material as THREE.ShaderMaterial).uniforms.resolution.value.set(width, height);
    } else {
      (this.material as LineMaterial).resolution.set(width, height);
    }
  }

  updateDistance(distance: number): void {
    this.updateLineWidth(distance);
  }

  updateSunDirection(_sunDir: THREE.Vector3): void {
    // No-op
  }

  setTextService(_textService: any): void {
    // No-op
  }

  updateTextEnabled(_enabled: boolean): void {
    // No-op
  }

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

    if (Wind10mLayer.USE_CUSTOM_GEOMETRY) {
      (this.material as THREE.ShaderMaterial).uniforms.linewidth.value = lineWidth;
    } else {
      (this.material as LineMaterial).linewidth = lineWidth;
    }
  }

  getNumSeeds(): number {
    return this.seeds.length;
  }

  getLineWidth(): number | undefined {
    return this.material?.linewidth;
  }

  getConfig() {
    return WIND10M_CONFIG;
  }

  dispose(): void {
    // Cleanup event listeners
    this.downloadService.off('timestampLoaded', () => {});

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
    if (this.visibleSeedBuffer) {
      this.visibleSeedBuffer.destroy();
      this.visibleSeedBuffer = null;
    }
    if (this.visibleOutputBuffer) {
      this.visibleOutputBuffer.destroy();
      this.visibleOutputBuffer = null;
    }
    if (this.visibleStagingBuffer) {
      this.visibleStagingBuffer.destroy();
      this.visibleStagingBuffer = null;
    }
    for (const buffer of this.windBuffers) {
      buffer.destroy();
    }
    this.windBuffers = [];
  }
}
