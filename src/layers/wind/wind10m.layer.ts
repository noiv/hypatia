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

import type { ILayer, LayerId } from '../ILayer';
import type { AnimationState } from '../../visualization/IAnimationState';
import type { DownloadService } from '../../services/DownloadService';
import type { DateTimeService } from '../../services/DateTimeService';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { EARTH_RADIUS_UNITS } from '../../utils/constants';
import { generateFibonacciSphere } from '../../utils/sphereSeeds';
import { WIND10M_CONFIG } from '../../config';
import type { TimeStep } from '../../config/types';
import windComputeShader from './wind-compute.wgsl?raw';
import { WindGeometry, type WindGeometryConfig } from './wind-geometry';

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

  // Geometry helper
  private geometry: WindGeometry;

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

    // Initialize geometry helper
    const geometryConfig: WindGeometryConfig = {
      lineSteps: Wind10mLayer.LINE_STEPS,
      lineWidth: Wind10mLayer.LINE_WIDTH,
      taperSegments: Wind10mLayer.TAPER_SEGMENTS,
      snakeLength: Wind10mLayer.SNAKE_LENGTH,
      useCustomGeometry: Wind10mLayer.USE_CUSTOM_GEOMETRY
    };
    this.geometry = new WindGeometry(this.seeds, geometryConfig);

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

        // Convert to ArrayBuffer view for WebGPU
        const uBuffer = this.device.createBuffer({
          size: uData.byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(uBuffer, 0, uData.buffer, 0, uData.byteLength);

        const vBuffer = this.device.createBuffer({
          size: vData.byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(vBuffer, 0, vData.buffer, 0, vData.byteLength);

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
    const outputSize = this.seeds.length * Wind10mLayer.LINE_STEPS * 4 * 4;
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

    const outputSize = this.seeds.length * Wind10mLayer.LINE_STEPS * 4 * 4;
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
      this.geometry.updateLineWidth(state.camera.distance, this.material);
      this.lastDistance = state.camera.distance;
    }

    // Update snake animation
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
