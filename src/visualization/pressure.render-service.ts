/**
 * Pressure Render Service
 *
 * Renders MSL (mean sea level pressure) contours using Web Worker + marching squares
 * Interpolates between timesteps for minute-accurate visualization
 */

import * as THREE from 'three';
import { TimeSeriesLayer } from './render-service.base';
import { PressureDataService, type TimeStep } from '../layers/pressure.data-service';
import { configLoader } from '../config';
import ContourWorker from '../workers/contourWorker?worker';

interface WorkerResponse {
  vertices: Float32Array;
  timestamp: number;
}

export class PressureRenderService extends TimeSeriesLayer {
  private readonly group: THREE.Group;
  private readonly lineSegments: THREE.LineSegments;
  private readonly material: THREE.LineBasicMaterial;
  private readonly geometry: THREE.BufferGeometry;

  private readonly worker: Worker;
  private currentRequestTimestamp: number = 0;

  // Standard meteorological isobar levels (4 hPa spacing)
  private readonly isobarLevels = [
    980, 984, 988, 992, 996, 1000, 1004, 1008, 1012, 1016, 1020, 1024
  ];

  private constructor(timeSteps: TimeStep[]) {
    super(timeSteps);

    // Create material (white contour lines)
    this.material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      opacity: 0.85,
      transparent: true,
      depthTest: true,
      linewidth: 2
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

    console.log('PressureRenderService: Initialized with worker');
  }

  /**
   * Factory method to create pressure layer
   */
  static async create(): Promise<PressureRenderService> {
    // Get dataset info for pressure
    const datasetInfo = configLoader.getDatasetInfo('msl');
    if (!datasetInfo) {
      throw new Error('Pressure dataset not found in manifest');
    }

    // Create pressure data service
    const pressureDataService = new PressureDataService(
      datasetInfo,
      configLoader.getDataBaseUrl(),
      'msl'
    );

    // Generate timesteps
    const timeSteps = pressureDataService.generateTimeSteps();

    return new PressureRenderService(timeSteps);
  }

  /**
   * Update layer based on time index (from TimeSeriesLayer)
   */
  setTimeIndex(index: number): void {
    // Extract integer and fractional parts
    const stepA = Math.floor(index);
    const blend = index - stepA;

    // Clamp to valid range
    if (stepA < 0 || stepA >= this.timeSteps.length - 1) {
      console.warn(`PressureRenderService: Index ${index} out of range`);
      return;
    }

    // Load adjacent timesteps and send to worker
    this.requestContours(stepA, blend);
  }

  /**
   * Request contour generation from worker
   * Worker handles loading and caching of pressure data
   */
  private requestContours(stepA: number, blend: number): void {
    // Create timestamp for stale response detection
    const timestamp = Date.now();
    this.currentRequestTimestamp = timestamp;

    // Send request to worker (worker handles data loading/caching)
    this.worker.postMessage({
      stepA,
      blend,
      isobarLevels: this.isobarLevels,
      timestamp,
      timeSteps: this.timeSteps
    });
  }

  /**
   * Handle worker response with contour vertices
   */
  private handleWorkerResponse(response: WorkerResponse): void {
    const { vertices, timestamp } = response;

    // Ignore stale responses
    if (timestamp < this.currentRequestTimestamp) {
      console.log('PressureRenderService: Ignoring stale worker response');
      return;
    }

    // Update geometry with new contour vertices
    this.geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    this.geometry.computeBoundingSphere();

    console.log(`PressureRenderService: Updated with ${vertices.length / 6} line segments`);
  }

  /**
   * Set layer visibility
   */
  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /**
   * Get scene object for rendering
   */
  getSceneObject(): THREE.Object3D {
    return this.group;
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    // Terminate worker (clears its cache)
    this.worker.terminate();

    // Dispose Three.js resources
    this.geometry.dispose();
    this.material.dispose();
    this.group.remove(this.lineSegments);

    console.log('PressureRenderService: Disposed');
  }
}
