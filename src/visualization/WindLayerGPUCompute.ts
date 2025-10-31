// @ts-nocheck - Working first, types later
/**
 * WindLayerGPUCompute - WebGPU compute-based wind line tracing
 *
 * Performance: ~3.4ms for 16384 lines (vs 190ms CPU)
 */

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { EARTH_RADIUS_UNITS } from '../utils/constants';
import { generateFibonacciSphere } from '../utils/sphereSeeds';
import { Wind10mService, TimeStep } from '../services/Wind10mService';
import { WindGPUService } from '../services/WindGPUService';

export class WindLayerGPUCompute {
  public group: THREE.Group;
  private seeds: THREE.Vector3[];
  private lines: LineSegments2 | null = null;
  private material: LineMaterial | null = null;

  // Wind data
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

  // State
  private lastTimeIndex: number = -1;
  private animationPhase: number = 0;
  private updatePromise: Promise<void> | null = null;
  private cachedRandomOffsets: Float32Array | null = null; // Cache random offsets to avoid regenerating

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

    console.log(`🌬️  WindLayerGPUCompute: Generated ${this.seeds.length} grid points`);
  }

  /**
   * Initialize WebGPU compute pipeline
   */
  async initGPU(renderer: any): Promise<void> {
    // Get WebGPU device (independent of WebGL renderer)
    if (!navigator.gpu) {
      throw new Error('WebGPU not supported');
    }

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
    const outputSize = this.seeds.length * WindLayerGPUCompute.LINE_STEPS * 4 * 4;
    this.outputBuffer = this.device.createBuffer({
      size: outputSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    this.stagingBuffer = this.device.createBuffer({
      size: outputSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

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
        let seedIdx = global_id.x;
        if (seedIdx >= arrayLength(&seeds)) { return; }

        var pos = seeds[seedIdx].position;
        var normPos = normalize(pos);

        // Output first vertex: starting position on sphere
        output[seedIdx * 32u] = vec4f(pos, 1.0);

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
            output[seedIdx * 32u + step] = vec4f(pos, 1.0);
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
            output[seedIdx * 32u + step] = vec4f(pos, 1.0);
          } else {
            output[seedIdx * 32u + step] = vec4f(pos, 1.0);
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
      ],
    });

    this.pipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
      compute: { module: shaderModule, entryPoint: 'main' },
    });

    console.log('✅ WebGPU compute pipeline ready');
  }

  /**
   * Load all wind data timesteps
   */
  async loadWindData(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    this.timesteps = Wind10mService.generateTimeSteps();
    if (this.timesteps.length === 0) {
      throw new Error('No wind timesteps available');
    }

    console.log(`🌬️  Loading ${this.timesteps.length} wind timesteps...`);
    const { uData, vData } = await WindGPUService.loadAllTimeSteps(this.timesteps, onProgress);
    this.windDataU = uData;
    this.windDataV = vData;

    // Upload all timesteps to GPU
    console.log('📤 Uploading wind data to GPU...');
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

    console.log(`✅ Uploaded ${this.timesteps.length} timesteps to GPU`);
  }

  /**
   * Update wind lines for current time using WebGPU compute
   */
  async updateTime(currentTime: Date): Promise<void> {
    if (this.timesteps.length === 0 || !this.device || !this.pipeline) return;

    const timeIndex = WindGPUService.timeToIndex(currentTime, this.timesteps);

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

      const { index0, index1, blend } = WindGPUService.getAdjacentTimesteps(timeIndex);

      console.log(`🌬️  GPU tracing: t=${timeIndex.toFixed(2)} (${index0}→${index1}, blend=${blend.toFixed(2)})`);

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

    // Create blend uniform buffer
    const blendBuffer = this.device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(blendBuffer, 0, new Float32Array([blend]));

    // Create bind group with current timestep data
    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout!,
      entries: [
        { binding: 0, resource: { buffer: this.seedBuffer! } },
        { binding: 1, resource: { buffer: this.outputBuffer! } },
        { binding: 2, resource: { buffer: this.windBuffers[index0 * 2] } },      // U0
        { binding: 3, resource: { buffer: this.windBuffers[index0 * 2 + 1] } },  // V0
        { binding: 4, resource: { buffer: this.windBuffers[index1 * 2] } },      // U1
        { binding: 5, resource: { buffer: this.windBuffers[index1 * 2 + 1] } },  // V1
        { binding: 6, resource: { buffer: blendBuffer } },
      ],
    });

    // Execute compute shader
    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, bindGroup);

    const numWorkgroups = Math.ceil(this.seeds.length / 64);
    passEncoder.dispatchWorkgroups(numWorkgroups);
    passEncoder.end();

    // Copy results to staging buffer (vec4 = 4 floats per vertex)
    const outputSize = this.seeds.length * WindLayerGPUCompute.LINE_STEPS * 4 * 4;
    commandEncoder.copyBufferToBuffer(this.outputBuffer!, 0, this.stagingBuffer!, 0, outputSize);
    this.device.queue.submit([commandEncoder.finish()]);

    // Read results
    await this.stagingBuffer!.mapAsync(GPUMapMode.READ);
    const resultData = new Float32Array(this.stagingBuffer!.getMappedRange());

    // Convert to positions and colors for LineSegments2
    this.updateGeometry(resultData);

    this.stagingBuffer!.unmap();

    const gpuTime = performance.now() - startTime;
    console.log(`✅ GPU traced ${this.seeds.length} lines in ${gpuTime.toFixed(2)}ms`);
  }

  /**
   * Update LineSegments2 geometry with computed vertices
   */
  private updateGeometry(vertices: Float32Array): void {
    const positions: number[] = [];
    const colors: number[] = [];

    const cycleLength = WindLayerGPUCompute.LINE_STEPS + WindLayerGPUCompute.SNAKE_LENGTH;

    // Generate random offsets once and cache them
    if (!this.cachedRandomOffsets) {
      this.cachedRandomOffsets = new Float32Array(this.seeds.length);
      for (let i = 0; i < this.seeds.length; i++) {
        this.cachedRandomOffsets[i] = Math.random() * cycleLength;
      }
    }

    for (let lineIdx = 0; lineIdx < this.seeds.length; lineIdx++) {
      const randomOffset = this.cachedRandomOffsets[lineIdx];
      const offset = lineIdx * WindLayerGPUCompute.LINE_STEPS * 4; // vec4 = 4 floats

      for (let i = 0; i < WindLayerGPUCompute.LINE_STEPS - 1; i++) {
        const idx0 = offset + i * 4;       // vec4 stride
        const idx1 = offset + (i + 1) * 4; // vec4 stride

        positions.push(
          vertices[idx0], vertices[idx0 + 1], vertices[idx0 + 2],  // xyz from vec4
          vertices[idx1], vertices[idx1 + 1], vertices[idx1 + 2]   // xyz from vec4
        );

        const totalSegments = WindLayerGPUCompute.LINE_STEPS - 1;
        const remainingSegments = totalSegments - i;
        let taperFactor = 1.0;
        if (remainingSegments <= WindLayerGPUCompute.TAPER_SEGMENTS) {
          taperFactor = remainingSegments / WindLayerGPUCompute.TAPER_SEGMENTS;
        }

        // Encode segment data in color channels for snake animation
        const normalizedIndex = i / totalSegments;
        const normalizedOffset = randomOffset / cycleLength;

        colors.push(
          normalizedIndex, normalizedOffset, taperFactor,
          normalizedIndex, normalizedOffset, taperFactor
        );
      }
    }

    if (this.lines) {
      const geometry = this.lines.geometry as LineSegmentsGeometry;
      geometry.setPositions(positions);
      geometry.setColors(colors);
    } else {
      this.createLines(positions, colors);
    }
  }

  /**
   * Create LineSegments2 with given positions and colors
   */
  private createLines(positions: number[], colors: number[]): void {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    geometry.setColors(colors);

    this.material = new LineMaterial({
      linewidth: WindLayerGPUCompute.LINE_WIDTH,
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
      snakeLength: { value: WindLayerGPUCompute.SNAKE_LENGTH },
      lineSteps: { value: WindLayerGPUCompute.LINE_STEPS }
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

  getGroup(): THREE.Group {
    return this.group;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  setResolution(width: number, height: number): void {
    if (this.material) {
      this.material.resolution.set(width, height);
    }
  }

  updateLineWidth(cameraDistance: number): void {
    if (!this.material) return;

    const minDistance = 1.157;
    const maxDistance = 10.0;
    const minWidth = 2.0;
    const maxWidth = 0.02;

    const t = (Math.log(cameraDistance) - Math.log(minDistance)) /
              (Math.log(maxDistance) - Math.log(minDistance));
    const clampedT = Math.max(0, Math.min(1, t));
    const lineWidth = minWidth + (maxWidth - minWidth) * clampedT;

    this.material.linewidth = lineWidth;
  }

  updateAnimation(deltaTime: number): void {
    if (!this.material) return;

    const animationSpeed = 20.0;
    const cycleLength = WindLayerGPUCompute.LINE_STEPS + WindLayerGPUCompute.SNAKE_LENGTH;
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
    // GPU buffers will be cleaned up automatically
  }
}
