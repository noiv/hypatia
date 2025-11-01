/**
 * Layer Interface
 *
 * Common interface for all visualization layers (Earth, Sun, Atmosphere, Weather Data)
 */

import type * as THREE from 'three';

/**
 * Base interface that all layers must implement
 */
export interface ILayer {
  /**
   * Update layer based on current time
   */
  updateTime(time: Date): void;

  /**
   * Set layer visibility
   */
  setVisible(visible: boolean): void;

  /**
   * Get the THREE.js object to add to scene
   */
  getSceneObject(): THREE.Object3D;

  /**
   * Clean up resources
   */
  dispose(): void;

  /**
   * Set layer opacity (optional - not all layers support this)
   */
  setOpacity?(opacity: number): void;
}

/**
 * Layer ID type - all possible layers in the system
 */
export type LayerId =
  | 'earth'
  | 'sun'
  | 'atmosphere'
  | 'temp2m'
  | 'precipitation'
  | 'wind10m';
