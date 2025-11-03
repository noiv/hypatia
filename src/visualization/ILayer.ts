/**
 * Layer Interface
 *
 * Common interface for all visualization layers (Earth, Sun, Atmosphere, Weather Data)
 */

import type * as THREE from 'three';
import type { TextRenderService } from './text.render-service';

/**
 * Base interface that all layers must implement
 */
export interface ILayer {
  /**
   * Update layer based on current time
   */
  updateTime(time: Date): void;

  /**
   * Update layer based on camera distance from origin
   * Used for distance-dependent effects (e.g., line width)
   */
  updateDistance(distance: number): void;

  /**
   * Update sun direction for lighting
   * Layers that don't use sun direction should implement as no-op
   */
  updateSunDirection(sunDir: THREE.Vector3): void;

  /**
   * Set text service reference for submitting text labels
   * Layers that don't produce text should implement as no-op
   */
  setTextService(textService: TextRenderService): void;

  /**
   * Update text enabled state
   * Layers that produce text should generate/clear labels based on this state
   * Layers that don't produce text should implement as no-op
   */
  updateTextEnabled(enabled: boolean): void;

  /**
   * Set layer visibility
   */
  setVisible(visible: boolean): void;

  /**
   * Set layer opacity (optional - not all layers support this)
   */
  setOpacity?(opacity: number): void;

  /**
   * Get the THREE.js object to add to scene
   */
  getSceneObject(): THREE.Object3D;

  /**
   * Clean up resources
   */
  dispose(): void;
}

/**
 * Layer ID type - all possible layers in the system
 */
export type LayerId =
  | 'earth'
  | 'sun'
  | 'graticule'
  | 'temp2m'
  | 'precipitation'
  | 'wind10m'
  | 'pressure';
