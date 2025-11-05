/**
 * Time Series Layer Base Class
 *
 * Shared implementation for weather data layers with time interpolation
 */

import type * as THREE from 'three';
import type { ILayer, LayerId } from './ILayer';
import type { AnimationState } from './AnimationState';
import type { TimeStep } from '../layers/temp2m.data-service';

/**
 * Abstract base class for layers with time-series data
 */
export abstract class TimeSeriesLayer implements ILayer {
  protected timeSteps: TimeStep[];
  protected layerId: LayerId;
  protected lastTime?: Date;
  protected lastSunDirection?: THREE.Vector3;

  constructor(layerId: LayerId, timeSteps: TimeStep[]) {
    this.layerId = layerId;
    this.timeSteps = timeSteps;
  }

  /**
   * Update layer based on animation state
   * Delegates to subclass hooks for specific changes
   */
  update(state: AnimationState): void {
    // Check time change
    if (!this.lastTime || state.time.getTime() !== this.lastTime.getTime()) {
      const timeIndex = this.calculateTimeIndex(state.time);
      this.setTimeIndex(timeIndex);
      this.lastTime = state.time;
    }

    // Check sun direction change (if subclass uses it)
    if (!this.lastSunDirection || !this.lastSunDirection.equals(state.sunDirection)) {
      this.updateSunDirection(state.sunDirection);
      this.lastSunDirection = state.sunDirection.clone();
    }
  }

  /**
   * Update sun direction for lighting
   * Default implementation is no-op; subclasses can override if needed
   */
  protected updateSunDirection(_sunDir: THREE.Vector3): void {
    // No-op - subclasses override if they use sun direction
  }

  /**
   * Calculate interpolated time index from current time
   */
  protected calculateTimeIndex(currentTime: Date): number {
    const currentMs = currentTime.getTime();

    // Find the two closest time steps
    for (let i = 0; i < this.timeSteps.length - 1; i++) {
      const stepA = this.timeSteps[i];
      const stepB = this.timeSteps[i + 1];
      if (!stepA || !stepB) continue;

      const step1 = this.parseTimeStep(stepA);
      const step2 = this.parseTimeStep(stepB);

      if (currentMs >= step1.getTime() && currentMs <= step2.getTime()) {
        // Interpolate between i and i+1
        const total = step2.getTime() - step1.getTime();
        const elapsed = currentMs - step1.getTime();
        return i + (elapsed / total);
      }
    }

    // Out of range - clamp
    const firstStep = this.timeSteps[0];
    if (firstStep && currentMs < this.parseTimeStep(firstStep).getTime()) {
      return -1; // Before first step
    }

    return this.timeSteps.length; // After last step
  }

  /**
   * Parse TimeStep into Date
   */
  protected parseTimeStep(step: TimeStep): Date {
    // Format: YYYYMMDD/HHz (e.g., "20251029/00z")
    const year = parseInt(step.date.substring(0, 4));
    const month = parseInt(step.date.substring(4, 6)) - 1; // JS months are 0-indexed
    const day = parseInt(step.date.substring(6, 8));
    const hour = parseInt(step.cycle.substring(0, 2));

    return new Date(Date.UTC(year, month, day, hour, 0, 0, 0));
  }

  // Abstract methods that subclasses must implement
  abstract setTimeIndex(index: number): void;
  abstract setVisible(visible: boolean): void;
  abstract getSceneObject(): THREE.Object3D;
  abstract getConfig(): any;
  abstract dispose(): void;
}
