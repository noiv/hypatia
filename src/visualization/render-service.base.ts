/**
 * Time Series Layer Base Class
 *
 * Shared implementation for weather data layers with time interpolation
 */

import type * as THREE from 'three';
import type { ILayer } from './ILayer';
import type { TimeStep } from '../layers/temp2m.data-service';

/**
 * Abstract base class for layers with time-series data
 */
export abstract class TimeSeriesLayer implements ILayer {
  protected timeSteps: TimeStep[];

  constructor(timeSteps: TimeStep[]) {
    this.timeSteps = timeSteps;
  }

  /**
   * Update layer based on current time
   * Calculates time index and delegates to setTimeIndex
   */
  updateTime(time: Date): void {
    const timeIndex = this.calculateTimeIndex(time);
    this.setTimeIndex(timeIndex);
  }

  /**
   * Update layer based on camera distance
   * Default implementation is no-op; subclasses can override if needed
   */
  updateDistance(_distance: number): void {
    // No-op - time series layers don't change with distance by default
  }

  /**
   * Update sun direction for lighting
   * Default implementation is no-op; subclasses can override if needed
   */
  updateSunDirection(_sunDir: THREE.Vector3): void {
    // No-op - time series layers don't use sun direction by default
  }

  /**
   * Set text service (no-op - time series layers don't produce text by default)
   */
  setTextService(_textService: any): void {
    // No-op - time series layers don't produce text
  }

  /**
   * Update text enabled state (no-op - time series layers don't produce text by default)
   */
  updateTextEnabled(_enabled: boolean): void {
    // No-op - time series layers don't produce text
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
  abstract dispose(): void;
}
