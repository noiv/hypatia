import * as THREE from 'three';
import { TextLabel } from './text.render-service';

/**
 * Immutable animation state passed to layers each frame
 *
 * Contains all data layers need to update themselves.
 * Layers should compare values to cached state and only update when changed.
 */
export interface AnimationState {
  // Time data
  readonly time: Date;
  readonly deltaTime: number;  // seconds since last frame

  // Camera data
  readonly camera: {
    readonly position: THREE.Vector3;  // Layers must not mutate
    readonly distance: number;  // from origin (Earth center)
    readonly quaternion: THREE.Quaternion;  // Camera rotation for billboarding
  };

  // Lighting
  readonly sunDirection: THREE.Vector3;  // Layers must not mutate

  // Text system
  readonly textEnabled: boolean;
  readonly collectedText: Map<string, TextLabel[]>;  // layerId -> labels (mutable - layers populate)
}
