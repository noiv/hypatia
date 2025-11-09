/**
 * Time Series Layer Base Class
 *
 * Shared implementation for weather data layers with time interpolation
 */

import type * as THREE from 'three';
import type { ILayer, LayerId } from './ILayer';
import type { AnimationState } from './AnimationState';
import type { TimeStep } from '../config/types';
import { timeToIndex } from '../utils/timeUtils';

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
      // Use centralized timeUtils for consistent calculations
      const timeIndex = timeToIndex(state.time, this.timeSteps);
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

  // Removed: calculateTimeIndex() and parseTimeStep() - now using utils/timeUtils.ts
  // This ensures render service uses SAME calculations as bootstrap

  // Abstract methods that subclasses must implement
  abstract setTimeIndex(index: number): void;
  abstract setVisible(visible: boolean): void;
  abstract getSceneObject(): THREE.Object3D;
  abstract getConfig(): any;
  abstract dispose(): void;
}
