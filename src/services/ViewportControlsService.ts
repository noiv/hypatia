/**
 * Viewport Controls Service
 *
 * Unified service for all viewport interaction:
 * - Camera controls (rotation, zoom)
 * - Input handling (mouse, wheel, touch)
 * - Gesture detection (horizontal/vertical wheel)
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Scene } from '../visualization/scene';
import { clampTimeToDataRange } from '../utils/timeUtils';

export type GestureDirection = 'none' | 'vertical' | 'horizontal';

export interface ViewportControlsCallbacks {
  onTimeChange?: (newTime: Date) => void;
  onCameraChange?: () => void;
  getCurrentTime?: () => Date;
}

export class ViewportControlsService {
  private controls: OrbitControls;
  private scene: Scene;
  private callbacks: ViewportControlsCallbacks;

  // Gesture detection state
  private gestureMode: GestureDirection = 'none';
  private gestureTimeout: number | null = null;
  private readonly gestureTimeoutMs = 100;

  constructor(
    camera: THREE.PerspectiveCamera,
    canvas: HTMLCanvasElement,
    scene: Scene,
    callbacks: ViewportControlsCallbacks = {}
  ) {
    this.scene = scene;
    this.callbacks = callbacks;

    // Initialize OrbitControls
    this.controls = new OrbitControls(camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.rotateSpeed = 0.5;
    this.controls.zoomSpeed = 0.8;
    this.controls.minDistance = 1.157;
    this.controls.maxDistance = 10;
    this.controls.target.set(0, 0, 0);

    // Setup camera change callback
    if (callbacks.onCameraChange) {
      this.controls.addEventListener('change', callbacks.onCameraChange);
    }
  }

  /**
   * Update controls (call in animation loop)
   */
  update(): void {
    this.controls.update();
  }

  /**
   * Update rotation speed based on camera distance
   */
  updateRotateSpeed(distance: number): void {
    const altitude = distance - 1.0;
    this.controls.rotateSpeed = 1.0 * altitude;
  }

  /**
   * Handle wheel events (zoom + time scroll)
   */
  handleWheel(e: WheelEvent): void {
    const gestureMode = this.detectGesture(e);

    // Handle horizontal scroll (time change)
    if (gestureMode === 'horizontal') {
      e.preventDefault();

      // Disable OrbitControls during horizontal gesture
      this.controls.enabled = false;

      // Time change: 1 minute per pixel of scroll
      const minutesPerPixel = 1;
      const minutes = e.deltaX * minutesPerPixel;
      const hoursDelta = minutes / 60;

      if (this.callbacks.getCurrentTime && this.callbacks.onTimeChange) {
        const currentTime = this.callbacks.getCurrentTime();
        const newTime = new Date(currentTime.getTime() + hoursDelta * 3600000);
        const clampedTime = clampTimeToDataRange(newTime);
        this.callbacks.onTimeChange(clampedTime);
      }
    }
    // Handle vertical scroll (zoom) - only when over Earth
    else if (gestureMode === 'vertical') {
      const isOverEarth = this.scene.checkMouseOverEarth(e.clientX, e.clientY);
      if (!isOverEarth) {
        e.preventDefault();
        this.controls.enabled = false;
        // Re-enable on next gesture reset
      }
      // If over Earth, ensure controls are enabled for zoom
      else {
        this.controls.enabled = true;
      }
    }
  }

  /**
   * Handle mouse down events
   */
  handleMouseDown(e: MouseEvent): void {
    this.scene.onMouseDown(e);
  }

  /**
   * Handle click events
   */
  handleClick(e: MouseEvent): void {
    this.scene.onClick(e);
  }

  /**
   * Detect and lock wheel gesture direction
   */
  private detectGesture(e: WheelEvent): GestureDirection {
    const absY = Math.abs(e.deltaY);
    const absX = Math.abs(e.deltaX);

    // Clear existing timeout
    if (this.gestureTimeout !== null) {
      clearTimeout(this.gestureTimeout);
    }

    // Determine gesture mode only on first event (lock it in)
    if (this.gestureMode === 'none') {
      if (absX > absY) {
        this.gestureMode = 'horizontal';
      } else {
        this.gestureMode = 'vertical';
      }
    }

    // Set timeout to reset gesture mode
    this.gestureTimeout = window.setTimeout(() => {
      this.gestureMode = 'none';
      this.gestureTimeout = null;
      // Re-enable controls on gesture reset
      this.controls.enabled = true;
    }, this.gestureTimeoutMs);

    return this.gestureMode;
  }

  /**
   * Get OrbitControls instance (for migration period)
   */
  getControls(): OrbitControls {
    return this.controls;
  }

  /**
   * Clean up
   */
  dispose(): void {
    if (this.gestureTimeout !== null) {
      clearTimeout(this.gestureTimeout);
      this.gestureTimeout = null;
    }
    this.controls.dispose();
  }
}
