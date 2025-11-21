/**
 * Wind Layer - Event-Driven Architecture
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

import type { ILayer, LayerId } from '../ILayer';
import type { AnimationState } from '../../visualization/IAnimationState';
import type { DownloadService } from '../../services/DownloadService';
import type { DateTimeService } from '../../services/DateTimeService';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { EARTH_RADIUS_UNITS } from '../../utils/constants';
import { generateFibonacciSphere } from '../../utils/sphereSeeds';
import { WIND_CONFIG } from '../../config';
import type { TimeStep } from '../../config/types';
import windComputeShader from './wind-compute.wgsl?raw';
import { WindGeometry, type WindGeometryConfig } from './wind-geometry';

export class WindLayer implements ILayer {
  layerId: LayerId = 'wind';
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

  // Geometry helper
  private geometry: WindGeometry;

  // Wind data
  private downloadService: DownloadService;
  private dateTimeService: DateTimeService;
  private timesteps: TimeStep[] = [];

  // Event-driven state
  private timestepAvailable: boolean[] = [];

  // Geometry cache for precomputed wind lines
  private geometryCache: Map<number, {
    positions: Float32Array;
    colors: Float32Array;
    visibleCount: number;
  }> = new Map();

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
  private precomputePromise: Promise<void> | null = null;

  // Event cleanup
  private eventCleanup: Array<() => void> = [];

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

    // Debug: expose seeds to window
    (window as any).__windSeeds = this.seeds;

    // Test cartesianToLatLon transformation for debug
    (window as any).__testWindCoords = (seed: {x: number, y: number, z: number}) => {
      const len = Math.sqrt(seed.x**2 + seed.y**2 + seed.z**2);
      const norm = {x: seed.x/len, y: seed.y/len, z: seed.z/len};
      const lat = Math.asin(norm.y);
      let lon = Math.atan2(norm.z, norm.x);

      // Apply rain layer transformation
      const PI = Math.PI;
      let u = ((lon - PI/2.0) + PI) / (2.0 * PI);
      u = 1.0 - u;
      const lonDeg = u * 360.0 - 180.0;
      const latDeg = lat * 180.0 / PI;

      // Calculate data indices
      const dataX = (lonDeg + 180.0) / 0.25;
      const dataY = (90.0 - latDeg) / 0.25;

      return {latDeg, lonDeg, dataX: Math.floor(dataX), dataY: Math.floor(dataY)};
    };

    // Initialize geometry helper
    const geometryConfig: WindGeometryConfig = {
      lineSteps: WindLayer.LINE_STEPS,
      lineWidth: WindLayer.LINE_WIDTH,
      taperSegments: WindLayer.TAPER_SEGMENTS,
      snakeLength: WindLayer.SNAKE_LENGTH,
      useCustomGeometry: WindLayer.USE_CUSTOM_GEOMETRY
    };
    this.geometry = new WindGeometry(this.seeds, geometryConfig);

    console.log(`WindLayer: Generated ${this.seeds.length} grid points`);

    // Listen to download events for both U and V components
    this.setupDownloadListeners();
  }

  /**
   * Setup listeners for download events
   */
  private setupDownloadListeners(): void {
    const onTimestampLoaded = (event: any) => {
      if (event.layerId !== 'wind') return;

      const { index, data, priority } = event;
      console.log(`[wind] Timestamp ${index} loaded, uploading to GPU`);

      // Wind data has { u: Uint16Array, v: Uint16Array } format
      if (!data || !data.u || !data.v) {
        console.error(`[wind] Invalid data format for index ${index}`, data);
        return;
      }

      // Upload to GPU and precompute geometry
      this.uploadAndPrecomputeTimestep(index, data.u, data.v, priority).catch(err => {
        console.error(`[wind] Failed to upload/precompute timestep ${index}:`, err);
      });
    };

    // Register listener
    this.downloadService.on('timestampLoaded', onTimestampLoaded);

    // Store cleanup function
    this.eventCleanup.push(() => {
      this.downloadService.off('timestampLoaded', onTimestampLoaded);
    });
  }

  /**
   * Upload timestep data to GPU and precompute geometry
   */
  private async uploadAndPrecomputeTimestep(
    index: number,
    uData: Uint16Array,
    vData: Uint16Array,
    priority: string
  ): Promise<void> {
    if (!this.device) {
      console.warn(`[wind] Cannot upload timestep ${index}: GPU device not initialized`);
      return;
    }

    // Upload U and V buffers to GPU
    // CRITICAL: Shader declares buffers as array<u32> (4 bytes per element)
    // but data is Uint16Array (2 bytes per element). We must convert to match
    // the shader's expectations, otherwise indices will be off by 2x!
    const u_u32 = new Uint32Array(uData);
    const v_u32 = new Uint32Array(vData);

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

    // Store buffers at correct index (expand array if needed)
    while (this.windBuffers.length < (index + 1) * 2) {
      this.windBuffers.push(null as any, null as any);
    }
    this.windBuffers[index * 2] = uBuffer;
    this.windBuffers[index * 2 + 1] = vBuffer;

    // Mark as available
    this.timestepAvailable[index] = true;

    // Debug: expose data to window for inspection
    if (!(window as any).__windDebug) {
      (window as any).__windDebug = {};
    }
    (window as any).__windDebug[`u${index}`] = uData;
    (window as any).__windDebug[`v${index}`] = vData;

    // Log only for critical priority (bootstrap loads)
    if (priority === 'critical') {
      const totalBytes = uData.byteLength + vData.byteLength;
      console.log(`[wind] Uploaded timestep ${index} (${(totalBytes / 1024).toFixed(1)}KB)`);
      console.log(`[wind] Debug: window.__windDebug.u${index} and .v${index} available for inspection`);
    }

    // TODO: Precompute geometry for adjacent timesteps
    // Temporarily disabled due to staging buffer conflicts with doUpdate
    // The geometry will be computed on-demand during time changes instead
    //
    // if (this.lastTimeIndex >= 0 && !this.updatePromise && !this.precomputePromise) {
    //   const adjacentIndices = this.dateTimeService.getAdjacentIndices(
    //     this.lastTime || new Date(),
    //     this.timesteps
    //   );
    //   if (adjacentIndices.includes(index)) {
    //     console.log(`[wind] Precomputing geometry for adjacent timestep ${index}`);
    //     this.precomputePromise = this.precomputeGeometry(index).finally(() => {
    //       this.precomputePromise = null;
    //     });
    //   }
    // }
  }

  /**
   * Precompute geometry for a single timestep (for caching)
   */
  private async precomputeGeometry(index: number): Promise<void> {
    if (!this.device || !this.pipeline || !this.bindGroupLayout) {
      console.warn(`[wind] Cannot precompute: GPU not initialized`);
      return;
    }

    if (this.windBuffers.length < (index + 1) * 2) {
      console.warn(`[wind] Cannot precompute index ${index}: buffers not uploaded`);
      return;
    }

    const uBuffer = this.windBuffers[index * 2];
    const vBuffer = this.windBuffers[index * 2 + 1];
    if (!uBuffer || !vBuffer) {
      console.warn(`[wind] Cannot precompute index ${index}: buffers are null`);
      return;
    }

    if (!this.blendBuffer || !this.seedBuffer || !this.outputBuffer || !this.stagingBuffer) {
      console.warn(`[wind] Cannot precompute: required buffers not initialized`);
      return;
    }

    // Set blend to 0 (no interpolation, just this timestep)
    this.device.queue.writeBuffer(this.blendBuffer, 0, new Float32Array([0.0]));

    // Create bind group for this timestep (use same buffers for both U/V)
    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.seedBuffer } },
        { binding: 1, resource: { buffer: this.outputBuffer } },
        { binding: 2, resource: { buffer: uBuffer } },
        { binding: 3, resource: { buffer: vBuffer } },
        { binding: 4, resource: { buffer: uBuffer } }, // Same for interpolation
        { binding: 5, resource: { buffer: vBuffer } }, // Same for interpolation
        { binding: 6, resource: { buffer: this.blendBuffer } },
      ],
    });

    // Run compute shader
    const commandEncoder = this.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(this.pipeline);
    passEncoder.setBindGroup(0, bindGroup);

    const numWorkgroups = Math.ceil(this.seeds.length / 64);
    passEncoder.dispatchWorkgroups(numWorkgroups);
    passEncoder.end();

    const outputSize = this.seeds.length * WindLayer.LINE_STEPS * 4 * 4;
    commandEncoder.copyBufferToBuffer(this.outputBuffer, 0, this.stagingBuffer, 0, outputSize);
    this.device.queue.submit([commandEncoder.finish()]);

    // Read back results
    await this.stagingBuffer.mapAsync(GPUMapMode.READ);
    const resultData = new Float32Array(this.stagingBuffer.getMappedRange());

    // Copy to cache (make a copy since we'll unmap the buffer)
    const positions = new Float32Array(resultData.length);
    positions.set(resultData);
    this.stagingBuffer.unmap();

    // Generate colors and build geometry arrays (same logic as updateGeometry)
    const { count } = this.geometry.calculateVisibleSeeds(this.lastCameraPosition);

    // For now, cache the raw vertex data - we'll build geometry on demand
    this.geometryCache.set(index, {
      positions,
      colors: new Float32Array(0), // Will be generated when needed
      visibleCount: count
    });

    console.log(`[wind] Precomputed geometry for timestep ${index}`);
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
      const seed = this.seeds[i];
      if (!seed) continue; // Skip if seed doesn't exist

      seedData[i * 4 + 0] = seed.x;
      seedData[i * 4 + 1] = seed.y;
      seedData[i * 4 + 2] = seed.z;
      seedData[i * 4 + 3] = 0;  // padding
    }

    if (!this.device) {
      throw new Error('GPU device not initialized');
    }

    this.seedBuffer = this.device.createBuffer({
      size: seedData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.seedBuffer, 0, seedData);

    // Create output buffer (vec4f = 4 floats = 16 bytes per vertex)
    const outputSize = this.seeds.length * WindLayer.LINE_STEPS * 4 * 4;
    this.outputBuffer = this.device.createBuffer({
      size: outputSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    this.stagingBuffer = this.device.createBuffer({
      size: outputSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // Load shader code from external file
    const shaderModule = this.device.createShaderModule({ code: windComputeShader });

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
   * Register with DownloadService and initialize data loading
   */
  async initialize(
    timesteps: TimeStep[],
    currentTime: Date,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<void> {
    this.timesteps = timesteps;

    // Initialize availability tracking
    this.timestepAvailable = new Array(timesteps.length).fill(false);

    // Register with DownloadService
    this.downloadService.registerLayer('wind', timesteps);

    // Initialize with on-demand strategy (±1 adjacent only during bootstrap)
    await this.downloadService.initializeLayer(
      'wind',
      currentTime,
      onProgress,
      'on-demand'  // Bootstrap always uses on-demand mode
    );

    console.log(`[wind] Initialized with ${timesteps.length} timesteps`);
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
      const { indices, count } = this.geometry.calculateVisibleSeeds(cameraPosition);
      this.visibleSeeds = indices;
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

      // Get adjacent timestep indices for interpolation
      const adjacentIndices = this.dateTimeService.getAdjacentIndices(currentTime, this.timesteps);
      const index0 = adjacentIndices[0];
      if (index0 === undefined) {
        console.error('No adjacent index found for timeIndex', timeIndex);
        return;
      }

      const index1 = adjacentIndices.length > 1 && adjacentIndices[1] !== undefined
        ? adjacentIndices[1]
        : index0;
      // Blend factor between the two timesteps (0.0 to 1.0)
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

    if (!this.blendBuffer || !this.seedBuffer || !this.outputBuffer ||
        !this.bindGroupLayout || !this.pipeline || !this.stagingBuffer) {
      console.error('GPU buffers not initialized');
      return;
    }

    // Try to use cached geometry if blend is close to 0 or 1
    if (blend < 0.01 && this.geometryCache.has(index0)) {
      const cached = this.geometryCache.get(index0)!;
      const result = this.geometry.updateGeometry(
        cached.positions,
        this.visibleSeeds,
        this.visibleCount,
        this.lines,
        this.group,
        this.material
      );
      this.lines = result.lines;
      this.material = result.material;
      console.log(`[wind] Used cached geometry for index ${index0}`);
      return;
    }

    if (blend > 0.99 && this.geometryCache.has(index1)) {
      const cached = this.geometryCache.get(index1)!;
      const result = this.geometry.updateGeometry(
        cached.positions,
        this.visibleSeeds,
        this.visibleCount,
        this.lines,
        this.group,
        this.material
      );
      this.lines = result.lines;
      this.material = result.material;
      console.log(`[wind] Used cached geometry for index ${index1}`);
      return;
    }

    // No cached geometry available, run full WebGPU compute with interpolation
    const startTime = performance.now();

    this.device.queue.writeBuffer(this.blendBuffer, 0, new Float32Array([blend]));

    const cacheKey = `${index0}-${index1}`;
    let bindGroup = this.bindGroupCache.get(cacheKey);
    const wasInCache = !!bindGroup;

    if (!bindGroup) {
      const uBuffer0 = this.windBuffers[index0 * 2];
      const vBuffer0 = this.windBuffers[index0 * 2 + 1];
      const uBuffer1 = this.windBuffers[index1 * 2];
      const vBuffer1 = this.windBuffers[index1 * 2 + 1];

      if (!uBuffer0 || !vBuffer0 || !uBuffer1 || !vBuffer1) {
        console.error('Wind buffers not loaded for indices', index0, index1);
        return;
      }

      bindGroup = this.device.createBindGroup({
        layout: this.bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.seedBuffer } },
          { binding: 1, resource: { buffer: this.outputBuffer } },
          { binding: 2, resource: { buffer: uBuffer0 } },
          { binding: 3, resource: { buffer: vBuffer0 } },
          { binding: 4, resource: { buffer: uBuffer1 } },
          { binding: 5, resource: { buffer: vBuffer1 } },
          { binding: 6, resource: { buffer: this.blendBuffer } },
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

    const outputSize = this.seeds.length * WindLayer.LINE_STEPS * 4 * 4;
    commandEncoder.copyBufferToBuffer(this.outputBuffer, 0, this.stagingBuffer, 0, outputSize);
    this.device.queue.submit([commandEncoder.finish()]);

    const submitTime = performance.now();

    await this.stagingBuffer.mapAsync(GPUMapMode.READ);
    const mapTime = performance.now();

    const resultData = new Float32Array(this.stagingBuffer.getMappedRange());
    const result = this.geometry.updateGeometry(
      resultData,
      this.visibleSeeds,
      this.visibleCount,
      this.lines,
      this.group,
      this.material
    );
    this.lines = result.lines;
    this.material = result.material;
    const geometryTime = performance.now();

    this.stagingBuffer.unmap();

    const totalTime = performance.now() - startTime;
    const submitMs = submitTime - startTime;
    const mapMs = mapTime - submitTime;
    const geomMs = geometryTime - mapTime;
    const cacheHit = wasInCache ? '✓ cache' : 'created';
    const visibilityPct = this.visibleCount > 0 ?
      ((this.visibleCount / this.seeds.length) * 100).toFixed(0) : '100';

    console.log(`Wind update: ${totalTime.toFixed(1)}ms [submit: ${submitMs.toFixed(1)}ms, map: ${mapMs.toFixed(1)}ms, geom: ${geomMs.toFixed(1)}ms] bindGroup: ${cacheHit}, visible: ${visibilityPct}%`);
  }

  // ILayer interface implementation

  /**
   * Update layer based on animation state (called every frame)
   * Checks for time, camera position, and camera distance changes
   */
  update(state: AnimationState): void {
    // Check camera movement (for culling update)
    const cameraMoved = this.lastCameraPosition.distanceToSquared(state.camera.position) > 0.01;

    // Check time change OR camera movement
    if (!this.lastTime || state.time.getTime() !== this.lastTime.getTime() || cameraMoved) {
      // Check data availability for interpolation (floor and ceil indices)
      if (this.timesteps.length > 0) {
        const timeIndex = this.dateTimeService.timeToIndex(state.time, this.timesteps);
        const idx1 = Math.floor(timeIndex);
        const idx2 = Math.min(idx1 + 1, this.timesteps.length - 1);

        const data1 = this.timestepAvailable[idx1] || false;
        const data2 = this.timestepAvailable[idx2] || false;
        const hasData = data1 && data2;

        if (hasData) {
          // Data available, update geometry and show layer
          this.group.visible = true;
          this.updateTimeAsync(state.time, state.camera.position).catch(err => {
            console.error('Failed to update wind layer:', err);
          });
        } else {
          // Data not available, request prioritized download
          this.downloadService.prioritizeTimestamps('wind', state.time);

          // Hide layer while waiting for data
          this.group.visible = false;
        }
      }

      this.lastTime = state.time;
      if (cameraMoved) {
        this.lastCameraPosition.copy(state.camera.position);
      }
    }

    // Check distance change (for line width scaling)
    if (this.lastDistance !== state.camera.distance) {
      this.geometry.updateLineWidth(state.camera.distance, this.material);
      this.lastDistance = state.camera.distance;
    }

    // Update snake animation
    if (this.material && state.deltaTime > 0) {
      const animationSpeed = 20.0;
      const cycleLength = WindLayer.LINE_STEPS + WindLayer.SNAKE_LENGTH;
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

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  getGroup(): THREE.Group {
    return this.group;
  }

  setResolution(width: number, height: number): void {
    this.geometry.setResolution(width, height, this.material);
  }

  updateDistance(distance: number): void {
    this.geometry.updateLineWidth(distance, this.material);
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

  getNumSeeds(): number {
    return this.seeds.length;
  }

  getLineWidth(): number | undefined {
    return this.material?.linewidth;
  }

  getConfig() {
    return WIND_CONFIG;
  }

  dispose(): void {
    // Cleanup event listeners
    for (const cleanup of this.eventCleanup) {
      cleanup();
    }
    this.eventCleanup = [];

    // Clear geometry cache
    this.geometryCache.clear();

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
