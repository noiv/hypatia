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
import type { ILayer, LayerId } from '../visualization/ILayer';
import type { AnimationState } from '../visualization/AnimationState';
import type { DownloadService } from '../services/DownloadService';
import type { DateTimeService } from '../services/DateTimeService';
import type { TimeStep } from '../config/types';
import { PRESSURE_CONFIG } from '../config';
import ContourWorker from '../workers/contourWorker?worker';

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

  // Timesteps and data
  private timesteps: TimeStep[] = [];
  private loadedData = new Map<number, ArrayBuffer>();
  private lastTime?: Date;

  constructor(
    layerId: LayerId,
    downloadService: DownloadService,
    dateTimeService: DateTimeService
  ) {
    this.layerId = layerId;
    this.downloadService = downloadService;
    this.dateTimeService = dateTimeService;

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
   * Setup listeners for download events
   */
  private setupDownloadListeners(): void {
    this.downloadService.on('timestampLoaded', (event) => {
      if (event.layerId === this.layerId) {
        this.loadedData.set(event.timestepIndex, event.data);
        console.log(`[PressureLayer] Loaded timestep ${event.timestepIndex}`);
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
    const blend = index - stepA;

    // Clear geometry if out of valid range
    if (stepA < 0 || stepA >= this.timesteps.length - 1) {
      this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
      this.geometry.computeBoundingSphere();
      return;
    }

    // Check if we have the required data loaded
    const hasStepA = this.loadedData.has(stepA);
    const hasStepB = this.loadedData.has(stepA + 1);

    if (!hasStepA || !hasStepB) {
      // Data not yet loaded, clear geometry
      this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
      this.geometry.computeBoundingSphere();
      return;
    }

    // Request contours from worker
    this.requestContours(stepA, blend);
  }

  /**
   * Request contour generation from worker
   */
  private requestContours(stepA: number, blend: number): void {
    // Create timestamp for stale response detection
    const timestamp = Date.now();
    this.currentRequestTimestamp = timestamp;

    // Send request to worker with loaded data
    this.worker.postMessage({
      stepA,
      blend,
      isobarLevels: PRESSURE_CONFIG.isobars.levels,
      timestamp,
      timeSteps: this.timesteps,
      // Pass the actual data to the worker
      dataA: this.loadedData.get(stepA),
      dataB: this.loadedData.get(stepA + 1)
    }, [
      // Transfer ownership of buffers to worker (zero-copy)
      this.loadedData.get(stepA)!,
      this.loadedData.get(stepA + 1)!
    ]);
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
