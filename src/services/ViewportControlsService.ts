/**
 * Viewport Controls Service
 *
 * Custom camera controls for viewport interaction:
 * - Physics-based rotation using spherical coordinates and angular velocity
 * - Pixel-based velocity calculation for consistent drag feel
 * - Input handling (mouse, wheel, touch gestures)
 * - Gesture detection (horizontal scroll for time, vertical scroll for zoom)
 * - Touch gestures (pinch zoom, two-finger pan for time scrubbing)
 */

import * as THREE from 'three';
import * as TWEEN from '@tweenjs/tween.js';
import type { Scene } from '../visualization/scene';
import { clampTimeToDataRange } from '../utils/timeUtils';
import { mouseToNDC, raycastObject } from '../utils/raycasting';
import { configLoader } from '../config/loader';

export type GestureDirection = 'none' | 'vertical' | 'horizontal';

export interface ViewportControlsCallbacks {
  onTimeChange?: (newTime: Date) => void;
  onCameraChange?: () => void;
  getCurrentTime?: () => Date;
}

// Global tween group for camera animations
export const tweenGroup = new TWEEN.Group();

export class ViewportControlsService {
  private camera: THREE.PerspectiveCamera;
  private scene: Scene;
  private callbacks: ViewportControlsCallbacks;
  private raycaster: THREE.Raycaster;
  private config: any;

  // Spherical coordinates for camera position
  private theta: number = Math.PI / 2; // Azimuthal angle (0 to 2π)
  private phi: number = Math.PI / 3;   // Polar angle (0 to π)
  private distance: number = 3.0;      // Distance from origin

  // Angular velocity (physics-based rotation)
  private thetaVelocity: number = 0;   // Radians per second
  private phiVelocity: number = 0;     // Radians per second

  // Target distance (for zoom damping)
  private targetDistance: number = 3.0;

  // Last frame time for deltaTime calculation
  private lastFrameTime: number = performance.now();

  // Gesture detection state
  private gestureMode: GestureDirection = 'none';
  private gestureTimeout: number | null = null;

  // Tween animation state
  private activeTween: TWEEN.Tween<any> | null = null;

  // Double-tap detection for touch devices
  private lastTapTime: number = 0;
  private lastTapX: number = 0;
  private lastTapY: number = 0;

  // Drag state
  private isDragging: boolean = false;
  private lastMouseTime: number = 0;
  private lastMouseX: number = 0;
  private lastMouseY: number = 0;

  // Current mouse position (tracked continuously for wheel zoom check)
  private currentMouseX: number = 0;
  private currentMouseY: number = 0;

  // Touch gesture state
  private touchCount: number = 0;
  private lastTouchDistance: number = 0;
  private lastTouchX: number = 0;
  private lastTouchY: number = 0;

  constructor(
    camera: THREE.PerspectiveCamera,
    scene: Scene,
    callbacks: ViewportControlsCallbacks = {}
  ) {
    this.camera = camera;
    this.scene = scene;
    this.callbacks = callbacks;
    this.raycaster = new THREE.Raycaster();

    // Load config
    const hypatiaConfig = configLoader.getHypatiaConfig();
    this.config = hypatiaConfig.camera;

    // Initialize from camera position
    this.updateSphericalFromCamera();

    // Set initial distance
    this.distance = this.config.defaultDistance;
    this.targetDistance = this.distance;

    this.updateCameraFromSpherical();
  }

  /**
   * Update spherical coordinates from current camera position
   */
  private updateSphericalFromCamera(): void {
    const position = this.camera.position;
    this.distance = position.length();
    this.theta = Math.atan2(position.x, position.z);
    this.phi = Math.acos(THREE.MathUtils.clamp(position.y / this.distance, -1, 1));
  }

  /**
   * Update camera position from spherical coordinates
   */
  private updateCameraFromSpherical(): void {
    const sinPhiRadius = Math.sin(this.phi) * this.distance;
    this.camera.position.x = sinPhiRadius * Math.sin(this.theta);
    this.camera.position.y = Math.cos(this.phi) * this.distance;
    this.camera.position.z = sinPhiRadius * Math.cos(this.theta);
    this.camera.lookAt(0, 0, 0);

    if (this.callbacks.onCameraChange) {
      this.callbacks.onCameraChange();
    }
  }

  /**
   * Update controls (call in animation loop) - Physics integration
   */
  update(): void {
    // Calculate deltaTime (seconds)
    const currentTime = performance.now();
    const deltaTime = (currentTime - this.lastFrameTime) / 1000;
    this.lastFrameTime = currentTime;

    // Clamp deltaTime to prevent huge jumps (e.g., when tab is inactive)
    const clampedDeltaTime = Math.min(deltaTime, 0.1);

    // Apply angular velocity to rotation (physics integration)
    this.theta += this.thetaVelocity * clampedDeltaTime;
    this.phi += this.phiVelocity * clampedDeltaTime;

    // Normalize theta to [-π, π] to prevent accumulation and wrapping issues
    while (this.theta > Math.PI) this.theta -= 2 * Math.PI;
    while (this.theta < -Math.PI) this.theta += 2 * Math.PI;

    // Clamp phi to prevent gimbal lock
    this.phi = THREE.MathUtils.clamp(this.phi, 0.1, Math.PI - 0.1);

    // Apply friction to slow down rotation
    const friction = this.config.rotationFriction;
    this.thetaVelocity *= friction;
    this.phiVelocity *= friction;

    // Stop completely when velocity is very small (prevent tiny drifts)
    const minVel = this.config.minVelocity;
    if (Math.abs(this.thetaVelocity) < minVel) this.thetaVelocity = 0;
    if (Math.abs(this.phiVelocity) < minVel) this.phiVelocity = 0;

    // Apply zoom damping (keep smooth zoom separate from rotation physics)
    const dampingFactor = this.config.dampingFactor;
    this.distance += (this.targetDistance - this.distance) * dampingFactor;

    this.updateCameraFromSpherical();
  }

  /**
   * Convert pixel velocity to angular velocity
   */
  private pixelVelocityToAngular(pixelVelocityX: number, pixelVelocityY: number): { theta: number; phi: number } {
    const canvas = this.scene.getRenderer().domElement;
    const canvasHeight = canvas.clientHeight;
    const pixelToAngular = 300.0; // Tuning factor for pixel-based rotation

    return {
      // Horizontal: negative because moving right rotates camera right
      theta: THREE.MathUtils.clamp(
        -pixelVelocityX / canvasHeight * pixelToAngular * this.config.rotationSensitivity,
        -this.config.maxVelocity,
        this.config.maxVelocity
      ),
      // Vertical: negative for natural drag feel (drag down = move down)
      phi: THREE.MathUtils.clamp(
        -pixelVelocityY / canvasHeight * pixelToAngular * this.config.rotationSensitivity,
        -this.config.maxVelocity,
        this.config.maxVelocity
      )
    };
  }

  /**
   * Handle wheel events (zoom + time scroll)
   */
  handleWheel(e: WheelEvent): void {
    const gestureMode = this.detectGesture(e);

    // Handle horizontal scroll (time change)
    if (gestureMode === 'horizontal') {
      e.preventDefault();

      // Inverted: scroll right = go back in time
      const minutes = -e.deltaX * this.config.timeScrubMinutesPerPixel;
      const hoursDelta = minutes / 60;

      if (this.callbacks.getCurrentTime && this.callbacks.onTimeChange) {
        const currentTime = this.callbacks.getCurrentTime();
        const newTime = new Date(currentTime.getTime() + hoursDelta * 3600000);
        const clampedTime = clampTimeToDataRange(newTime);
        this.callbacks.onTimeChange(clampedTime);
      }
    }
    // Handle vertical scroll (zoom)
    else if (gestureMode === 'vertical') {
      // Only zoom when mouse is over Earth (use tracked position)
      const isOverEarth = this.scene.checkMouseOverEarth(this.currentMouseX, this.currentMouseY);
      if (!isOverEarth) {
        e.preventDefault();
        return;
      }

      // Zoom (scale by distance for consistent feel)
      e.preventDefault();
      const invertMultiplier = this.config.invertZoom ? -1 : 1;
      const zoomDelta = e.deltaY * this.config.zoomSpeed * 0.001 * this.targetDistance * invertMultiplier;
      this.targetDistance = THREE.MathUtils.clamp(
        this.targetDistance + zoomDelta,
        this.config.minDistance,
        this.config.maxDistance
      );
    }
  }

  /**
   * Handle mouse down events
   */
  handleMouseDown(e: MouseEvent): void {
    // Always track current position
    this.currentMouseX = e.clientX;
    this.currentMouseY = e.clientY;

    if (e.button === 0) { // Left button
      this.isDragging = true;

      // Initialize mouse position for pixel-based velocity calculation
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.lastMouseTime = performance.now();

      // Stop any existing velocity when grabbing
      this.thetaVelocity = 0;
      this.phiVelocity = 0;
    }

    this.scene.onMouseDown(e);
  }

  /**
   * Handle mouse move events - Convert pixel velocity to angular velocity
   */
  handleMouseMove(e: MouseEvent): void {
    // Always track current mouse position for wheel zoom check
    this.currentMouseX = e.clientX;
    this.currentMouseY = e.clientY;

    if (!this.isDragging) return;

    // Calculate time delta for velocity calculation
    const currentTime = performance.now();
    const deltaTime = (currentTime - this.lastMouseTime) / 1000;

    // Prevent division by zero or huge spikes
    if (deltaTime < 0.001 || deltaTime > 0.1) {
      this.lastMouseTime = currentTime;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      return;
    }

    // Calculate mouse pixel movement
    const deltaX = e.clientX - this.lastMouseX;
    const deltaY = e.clientY - this.lastMouseY;

    // Calculate pixel velocity (pixels/second) and convert to angular velocity
    const pixelVelocityX = deltaX / deltaTime;
    const pixelVelocityY = deltaY / deltaTime;
    const angular = this.pixelVelocityToAngular(pixelVelocityX, pixelVelocityY);

    this.thetaVelocity = angular.theta;
    this.phiVelocity = angular.phi;

    // Update last mouse state for next frame
    this.lastMouseTime = currentTime;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
  }

  /**
   * Handle mouse up events
   */
  handleMouseUp(e: MouseEvent): void {
    if (e.button === 0) {
      this.isDragging = false;
      // Velocity continues based on last movement (momentum)
    }
  }

  /**
   * Handle click events
   */
  handleClick(e: MouseEvent): void {
    this.scene.onClick(e);
  }

  /**
   * Handle double-click events (smooth rotation to clicked position)
   */
  handleDoubleClick(e: MouseEvent): void {
    this.animateToPosition(e.clientX, e.clientY);
  }

  /**
   * Handle touch start events
   */
  handleTouchStart(e: TouchEvent): void {
    this.touchCount = e.touches.length;

    if (e.touches.length === 1) {
      // Single finger - start drag (pixel-based)
      const touch = e.touches[0];
      if (!touch) return;

      this.isDragging = true;

      // Initialize touch position for pixel-based velocity calculation
      this.lastTouchX = touch.clientX;
      this.lastTouchY = touch.clientY;
      this.lastMouseTime = performance.now();

      // Stop any existing velocity when grabbing
      this.thetaVelocity = 0;
      this.phiVelocity = 0;
    } else if (e.touches.length === 2) {
      // Two fingers - prepare for pinch/pan
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      if (!touch1 || !touch2) return;

      // Calculate initial distance for pinch
      const dx = touch2.clientX - touch1.clientX;
      const dy = touch2.clientY - touch1.clientY;
      this.lastTouchDistance = Math.sqrt(dx * dx + dy * dy);

      // Calculate center point for pan
      this.lastTouchX = (touch1.clientX + touch2.clientX) / 2;
      this.lastTouchY = (touch1.clientY + touch2.clientY) / 2;

      // Stop rotation
      this.isDragging = false;
    }
  }

  /**
   * Handle touch move events (pinch zoom, 2-finger gestures)
   */
  handleTouchMove(e: TouchEvent): void {
    if (e.touches.length === 1 && this.isDragging) {
      // Single finger drag - same pixel-based velocity as mouse
      const touch = e.touches[0];
      if (!touch) return;

      const currentTime = performance.now();
      const deltaTime = (currentTime - this.lastMouseTime) / 1000;

      if (deltaTime < 0.001 || deltaTime > 0.1) {
        this.lastMouseTime = currentTime;
        this.lastTouchX = touch.clientX;
        this.lastTouchY = touch.clientY;
        return;
      }

      // Calculate touch pixel movement
      const deltaX = touch.clientX - this.lastTouchX;
      const deltaY = touch.clientY - this.lastTouchY;

      // Calculate pixel velocity (pixels/second) and convert to angular velocity
      const pixelVelocityX = deltaX / deltaTime;
      const pixelVelocityY = deltaY / deltaTime;
      const angular = this.pixelVelocityToAngular(pixelVelocityX, pixelVelocityY);

      this.thetaVelocity = angular.theta;
      this.phiVelocity = angular.phi;

      // Update last touch state
      this.lastMouseTime = currentTime;
      this.lastTouchX = touch.clientX;
      this.lastTouchY = touch.clientY;
    } else if (e.touches.length === 2) {
      // Two finger gestures
      e.preventDefault();

      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      if (!touch1 || !touch2) return;

      // Pinch zoom
      const dx = touch2.clientX - touch1.clientX;
      const dy = touch2.clientY - touch1.clientY;
      const currentDistance = Math.sqrt(dx * dx + dy * dy);

      if (this.lastTouchDistance > 0) {
        const distanceDelta = currentDistance - this.lastTouchDistance;
        const invertMultiplier = this.config.invertZoom ? 1 : -1; // Inverted for pinch (spreading = zoom in)
        const zoomDelta = distanceDelta * this.config.zoomSpeed * 0.01 * invertMultiplier;
        this.targetDistance = THREE.MathUtils.clamp(
          this.targetDistance - zoomDelta,
          this.config.minDistance,
          this.config.maxDistance
        );
      }

      this.lastTouchDistance = currentDistance;

      // Two-finger pan for time scrubbing
      const centerX = (touch1.clientX + touch2.clientX) / 2;
      const centerY = (touch1.clientY + touch2.clientY) / 2;

      if (this.lastTouchX !== 0) {
        const deltaX = centerX - this.lastTouchX;
        const deltaY = centerY - this.lastTouchY;

        // Determine if horizontal or vertical gesture
        if (Math.abs(deltaX) > Math.abs(deltaY) * 2) {
          // Horizontal - time scrubbing (inverted: swipe right = go back in time)
          const minutes = -deltaX * this.config.timeScrubMinutesPerPixel;
          const hoursDelta = minutes / 60;

          if (this.callbacks.getCurrentTime && this.callbacks.onTimeChange) {
            const currentTime = this.callbacks.getCurrentTime();
            const newTime = new Date(currentTime.getTime() + hoursDelta * 3600000);
            const clampedTime = clampTimeToDataRange(newTime);
            this.callbacks.onTimeChange(clampedTime);
          }
        }
      }

      this.lastTouchX = centerX;
      this.lastTouchY = centerY;
    }
  }

  /**
   * Handle touch end events (for double-tap detection and cleanup)
   */
  handleTouchEnd(e: TouchEvent): void {
    // Reset touch state
    this.touchCount = e.touches.length;

    if (this.touchCount === 0) {
      this.isDragging = false;
      this.lastTouchDistance = 0;
      this.lastTouchX = 0;
      this.lastTouchY = 0;
    }

    // Double-tap detection (only for single finger)
    if (e.changedTouches.length !== 1) return;

    const touch = e.changedTouches[0];
    if (!touch) return;

    const now = Date.now();
    const timeSinceLastTap = now - this.lastTapTime;
    const dx = touch.clientX - this.lastTapX;
    const dy = touch.clientY - this.lastTapY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Check if this is a double-tap
    if (timeSinceLastTap < this.config.doubleTapThresholdMs &&
        distance < this.config.doubleTapDistanceThreshold) {
      // Double-tap detected
      e.preventDefault();
      this.animateToPosition(touch.clientX, touch.clientY);
      // Reset to prevent triple-tap
      this.lastTapTime = 0;
    } else {
      // Single tap - store for next tap
      this.lastTapTime = now;
      this.lastTapX = touch.clientX;
      this.lastTapY = touch.clientY;
    }
  }

  /**
   * Animate camera to position (shared by double-click and double-tap)
   */
  private animateToPosition(clientX: number, clientY: number): void {
    // Check if click is over Earth (works even without Earth layer)
    const isOverEarth = this.scene.checkMouseOverEarth(clientX, clientY);
    if (!isOverEarth) {
      return; // Ignore double-click outside Earth
    }

    // Convert mouse position to NDC
    const ndc = mouseToNDC(clientX, clientY, this.scene.getRenderer().domElement);

    // Try to raycast to Earth to get the exact point
    const earthLayer = this.scene.getLayer('earth');
    let targetPoint: THREE.Vector3 | null = null;

    if (earthLayer) {
      const intersection = raycastObject(ndc, this.camera, earthLayer.getSceneObject(), this.raycaster);
      if (intersection?.point) {
        targetPoint = intersection.point;
      }
    }

    // If no intersection (e.g., Earth layer not visible), calculate point on sphere
    if (!targetPoint) {
      // Cast ray from camera through mouse position to intersect with unit sphere
      this.raycaster.setFromCamera(ndc, this.camera);
      const sphereCenter = new THREE.Vector3(0, 0, 0);
      const sphereRadius = 1.0;

      // Calculate ray-sphere intersection
      const ray = this.raycaster.ray;
      const oc = ray.origin.clone().sub(sphereCenter);
      const a = ray.direction.dot(ray.direction);
      const b = 2.0 * oc.dot(ray.direction);
      const c = oc.dot(oc) - sphereRadius * sphereRadius;
      const discriminant = b * b - 4 * a * c;

      if (discriminant >= 0) {
        const t = (-b - Math.sqrt(discriminant)) / (2.0 * a);
        targetPoint = ray.origin.clone().add(ray.direction.clone().multiplyScalar(t));
      } else {
        return; // No intersection with sphere
      }
    }

    // Calculate target spherical coordinates
    const targetDistance = Math.max(this.config.minDistance, this.distance * this.config.doubleTapZoomFactor);
    const targetTheta = Math.atan2(targetPoint.x, targetPoint.z);
    const targetPhi = Math.acos(THREE.MathUtils.clamp(targetPoint.y / targetPoint.length(), -1, 1));

    // Cancel any active tween
    if (this.activeTween) {
      this.activeTween.stop();
      this.activeTween = null;
    }

    // Normalize target theta to take shortest path (handle ±π wrapping)
    let normalizedTargetTheta = targetTheta;
    let thetaDiff = targetTheta - this.theta;
    if (thetaDiff > Math.PI) normalizedTargetTheta -= 2 * Math.PI;
    if (thetaDiff < -Math.PI) normalizedTargetTheta += 2 * Math.PI;

    // Create smooth tween animation for spherical coordinates
    const startState = {
      theta: this.theta,
      phi: this.phi,
      distance: this.distance
    };

    const endState = {
      theta: normalizedTargetTheta,
      phi: targetPhi,
      distance: targetDistance
    };

    // Stop any existing velocity
    this.thetaVelocity = 0;
    this.phiVelocity = 0;

    this.activeTween = new TWEEN.Tween(startState, tweenGroup)
      .to(endState, this.config.doubleTapAnimationMs)
      .easing(TWEEN.Easing.Cubic.InOut)
      .onUpdate(() => {
        // Update position directly during tween
        this.theta = startState.theta;
        this.phi = startState.phi;
        this.distance = startState.distance;
        this.targetDistance = startState.distance;
        // Keep velocity at zero during tween
        this.thetaVelocity = 0;
        this.phiVelocity = 0;
        this.updateCameraFromSpherical();
      })
      .onComplete(() => {
        this.activeTween = null;
        // Ensure velocity is zero
        this.thetaVelocity = 0;
        this.phiVelocity = 0;
        // Sync zoom target
        this.targetDistance = this.distance;
      })
      .onStop(() => {
        this.activeTween = null;
        // Ensure velocity is zero
        this.thetaVelocity = 0;
        this.phiVelocity = 0;
        // Sync zoom target
        this.targetDistance = this.distance;
      })
      .start();
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
    }, this.config.gestureTimeoutMs);

    return this.gestureMode;
  }

  /**
   * Clean up
   */
  dispose(): void {
    if (this.gestureTimeout !== null) {
      clearTimeout(this.gestureTimeout);
      this.gestureTimeout = null;
    }
  }
}
