/**
 * Pressure Layer - Event-Driven Architecture
 *
 * MSL (mean sea level pressure) contour visualization layer.
 * Refactored to use DownloadService events instead of direct data loading.
 *
 * Key changes from pressure.render-service.ts:
 * - Downloads managed by DownloadService
 * - Listens to download events for data availability
 * - Web Worker still handles contour generation (CPU-only)
 * - No texture management (uses LineSegments geometry)
 *
 * Special characteristics:
 * - CPU-only layer (no WebGL textures)
 * - Uses Web Worker for marching squares contour generation
 * - Simpler than temp2m/precipitation (no GPU texture uploads)
 */

import * as THREE from 'three';
import type { ILayer, LayerId } from '../ILayer';
import type { AnimationState } from '../../visualization/IAnimationState';
import type { DownloadService } from '../../services/DownloadService';
import type { DateTimeService } from '../../services/DateTimeService';
import type { ConfigService } from '../../services/ConfigService';
import type { TimeStep } from '../../config/types';
import { PRESSURE_CONFIG } from '../../config';
import ContourWorker from './contour.worker?worker';

interface WorkerResponse {
  vertices: Float32Array;
  timestamp: number;
}

export class PressureLayer implements ILayer {
  private layerId: LayerId;
  private group: THREE.Group;
  private lineSegments: THREE.LineSegments;
  private material: THREE.LineBasicMaterial;
  private geometry: THREE.BufferGeometry;

  private worker: Worker;
  private currentRequestTimestamp: number = 0;

  // Services
  private downloadService: DownloadService;
  private dateTimeService: DateTimeService;
  private configService: ConfigService;

  // Timesteps and data
  private timesteps: TimeStep[] = [];
  private loadedData = new Map<number, Float32Array>();
  private lastTime?: Date;

  constructor(
    layerId: LayerId,
    downloadService: DownloadService,
    dateTimeService: DateTimeService,
    configService: ConfigService
  ) {
    this.layerId = layerId;
    this.downloadService = downloadService;
    this.dateTimeService = dateTimeService;
    this.configService = configService;

    // Create material from config
    this.material = new THREE.LineBasicMaterial({
      color: PRESSURE_CONFIG.visual.color,
      opacity: PRESSURE_CONFIG.visual.opacity,
      transparent: PRESSURE_CONFIG.visual.transparent,
      depthTest: PRESSURE_CONFIG.visual.depthTest,
      linewidth: PRESSURE_CONFIG.visual.linewidth
    });

    // Create geometry (initially empty)
    this.geometry = new THREE.BufferGeometry();

    // Create LineSegments (marching squares produces disconnected segments)
    this.lineSegments = new THREE.LineSegments(this.geometry, this.material);

    // Group for scene management
    this.group = new THREE.Group();
    this.group.add(this.lineSegments);

    // Initialize Web Worker
    this.worker = new ContourWorker();
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      this.handleWorkerResponse(e.data);
    };

    // Listen to download events
    this.setupDownloadListeners();
  }

  /**
   * Decode FP16 to Float32
   */
  private decodeFP16(binary: number): number {
    const sign = (binary & 0x8000) >> 15;
    let exponent = (binary & 0x7C00) >> 10;
    let fraction = binary & 0x03FF;

    if (exponent === 0) {
      if (fraction === 0) return sign ? -0 : 0;
      return (sign ? -1 : 1) * Math.pow(2, -14) * (fraction / 1024);
    }

    if (exponent === 0x1F) {
      return fraction ? NaN : sign ? -Infinity : Infinity;
    }

    exponent -= 15;
    fraction /= 1024;
    return (sign ? -1 : 1) * Math.pow(2, exponent) * (1 + fraction);
  }

  /**
   * Decode Uint16Array (FP16) to Float32Array
   */
  private decodeGrid(fp16Data: Uint16Array): Float32Array {
    const float32Data = new Float32Array(fp16Data.length);
    for (let i = 0; i < fp16Data.length; i++) {
      float32Data[i] = this.decodeFP16(fp16Data[i]!);
    }
    return float32Data;
  }

  /**
   * Setup listeners for download events
   */
  private setupDownloadListeners(): void {
    this.downloadService.on('timestampLoaded', (event) => {
      if (event.layerId === this.layerId) {
        const { index, data } = event;

        // Extract Uint16Array from event (might be wrapped in object)
        const layerData = data instanceof Uint16Array ? data : data?.data;
        if (!layerData) {
          console.error(`[PressureLayer] Invalid data format for index ${index}`);
          return;
        }

        // Decode FP16 → Float32 once in main thread
        const decodedData = this.decodeGrid(layerData);

        // Store decoded Float32Array
        this.loadedData.set(index, decodedData);

        // Re-trigger rendering with current time if we have a lastTime
        if (this.lastTime) {
          this.updateTime(this.lastTime);
        }
      }
    });
  }

  /**
   * Initialize layer with timesteps
   */
  initialize(timesteps: TimeStep[]): void {
    this.timesteps = timesteps;
  }

  /**
   * Update based on current time (from ILayer interface)
   */
  updateTime(time: Date): void {
    if (this.timesteps.length === 0) return;

    const timeIndex = this.dateTimeService.findTimeIndex(time, this.timesteps);
    this.setTimeIndex(timeIndex);
  }

  /**
   * Update layer based on time index
   */
  private setTimeIndex(index: number): void {
    // Extract integer and fractional parts
    const stepA = Math.floor(index);
    const stepB = Math.min(stepA + 1, this.timesteps.length - 1); // Clamp to last timestep
    const blend = index - stepA;

    // Clear geometry if out of valid range
    if (stepA < 0 || stepA >= this.timesteps.length) {
      this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
      this.geometry.computeBoundingSphere();
      return;
    }

    // Check if we have the required data loaded
    const hasStepA = this.loadedData.has(stepA);
    const hasStepB = this.loadedData.has(stepB);

    if (!hasStepA || !hasStepB) {
      // Data not yet loaded, clear geometry
      this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
      this.geometry.computeBoundingSphere();
      return;
    }

    // Request contours from worker
    this.requestContours(stepA, stepB, blend);
  }

  /**
   * Request contour generation from worker
   */
  private requestContours(stepA: number, stepB: number, blend: number): void {
    // Create timestamp for stale response detection
    const timestamp = Date.now();
    this.currentRequestTimestamp = timestamp;

    // Get layer config for URL construction in worker
    const layer = this.configService.getLayerById(this.layerId);
    if (!layer) {
      throw new Error(`Layer not found: ${this.layerId}`);
    }
    const hypatiaConfig = this.configService.getHypatiaConfig();

    // Send request to worker with loaded data
    // Note: Using structured clone (not transfer) so data stays in main thread cache
    const dataA = this.loadedData.get(stepA);
    const dataB = this.loadedData.get(stepB);

    if (!dataA || !dataB) {
      console.error('[PressureLayer] Missing data for contour generation');
      return;
    }

    this.worker.postMessage({
      stepA,
      blend,
      isobarLevels: PRESSURE_CONFIG.isobars.levels,
      timestamp,
      timeSteps: this.timesteps,
      dataBaseUrl: hypatiaConfig.data.dataBaseUrl,
      dataFolder: layer.dataFolders[0] || this.layerId,
      // Pass decoded Float32Array to worker (structured clone, ~2-4ms overhead)
      dataA,
      dataB
    });
  }

  /**
   * Handle worker response with contour vertices
   */
  private handleWorkerResponse(response: WorkerResponse): void {
    const { vertices, timestamp } = response;

    // Ignore stale responses
    if (timestamp < this.currentRequestTimestamp) {
      return;
    }

    // Update geometry with new contour vertices
    this.geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    this.geometry.computeBoundingSphere();
  }

  // ILayer interface implementation

  update(state: AnimationState): void {
    if (!this.lastTime || state.time.getTime() !== this.lastTime.getTime()) {
      this.updateTime(state.time);
      this.lastTime = state.time;
    }
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  getSceneObject(): THREE.Object3D {
    return this.group;
  }

  getGroup(): THREE.Group {
    return this.group;
  }

  setResolution(_width: number, _height: number): void {
    // No-op - pressure layer doesn't depend on resolution
  }

  updateDistance(_distance: number): void {
    // No-op - pressure layer doesn't change with distance
  }

  updateSunDirection(_sunDir: THREE.Vector3): void {
    // No-op - pressure layer doesn't use lighting
  }

  setTextService(_textService: any): void {
    // No-op - pressure layer doesn't produce text
  }

  updateTextEnabled(_enabled: boolean): void {
    // No-op - pressure layer doesn't produce text
  }

  getConfig() {
    return PRESSURE_CONFIG;
  }

  dispose(): void {
    // Cleanup event listeners
    this.downloadService.off('timestampLoaded', () => {});

    // Terminate worker
    this.worker.terminate();

    // Dispose Three.js resources
    this.geometry.dispose();
    this.material.dispose();
    this.group.remove(this.lineSegments);
  }
}
