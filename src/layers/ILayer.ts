/**
 * Layer Interface
 *
 * Common interface for all visualization layers (Earth, Sun, Atmosphere, Weather Data)
 */

import type * as THREE from 'three';
import type { AnimationState } from '../visualization/IAnimationState';

/**
 * Base layer config - all layer configs must include these fields
 */
export interface LayerConfig {
  updateOrder: number;
  [key: string]: any; // Allow additional config properties
}

/**
 * Base interface that all layers must implement
 */
export interface ILayer {
  /**
   * Update layer state based on animation frame data
   *
   * Layers should:
   * - Check what changed (compare to cached values)
   * - Perform necessary updates (textures, geometry, etc.)
   * - Optionally add text labels to state.collectedText
   *
   * @param state - Immutable animation state for this frame
   */
  update(state: AnimationState): void;

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
   * Get layer configuration
   */
  getConfig(): LayerConfig;

  /**
   * Clean up resources
   */
  dispose(): void;
}

/**
 * Layer ID type - all possible layers in the system
 * Uses urlKey as the canonical identifier (matches URL params and folder names)
 */
export type LayerId =
  // Cubemaps
  | 'earth'
  // Decoration layers
  | 'sun'
  | 'graticule'
  | 'text'
  // Data layers
  | 'temp'
  | 'wind'
  | 'rain'
  | 'pressure'
  | 'humidity'
  | 'clouds'
  | 'waves';
