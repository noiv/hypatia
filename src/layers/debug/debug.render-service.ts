/**
 * Debug Render Service
 *
 * Provides debug visualization helpers:
 * - North/South pole axes (red/blue)
 * - Prime meridian (green)
 * - Future: FPS overlay, coordinate picker, data inspector, etc.
 *
 * Only created in non-production environments (not on hypatia.earth)
 */

import * as THREE from 'three';
import type { ILayer, LayerId, LayerConfig } from '../ILayer';
import type { AnimationState } from '../../visualization/IAnimationState';

export class DebugRenderService implements ILayer {
  private group: THREE.Group;

  private constructor(_layerId: LayerId) {
    this.group = new THREE.Group();
    this.group.name = 'debug-helpers';

    this.createAxesHelpers();
  }

  /**
   * Create debug axes helpers
   */
  private createAxesHelpers(): void {
    // North Pole axis (red line from center to top)
    const northPoleGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 1.5, 0)
    ]);
    const northPoleLine = new THREE.Line(
      northPoleGeometry,
      new THREE.LineBasicMaterial({ color: 0xff0000 })
    );
    this.group.add(northPoleLine);

    // South Pole axis (blue line from center to bottom)
    const southPoleGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, -1.5, 0)
    ]);
    const southPoleLine = new THREE.Line(
      southPoleGeometry,
      new THREE.LineBasicMaterial({ color: 0x0000ff })
    );
    this.group.add(southPoleLine);

    // Prime Meridian at 0° lon, 0° lat (green line through entire sphere)
    // +Z direction: 0° lon, 0° lat
    // -Z direction: 180° lon, 0° lat (dateline)
    const primeMeridianGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, -1.2), // Through to 180° lon
      new THREE.Vector3(0, 0, 1.2)   // To 0° lon
    ]);
    const primeMeridianLine = new THREE.Line(
      primeMeridianGeometry,
      new THREE.LineBasicMaterial({ color: 0x00ff00 })
    );
    this.group.add(primeMeridianLine);
  }

  // ILayer interface implementation

  update(_state: AnimationState): void {
    // Static debug helpers don't need updates
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  getSceneObject(): THREE.Object3D {
    return this.group;
  }

  getConfig(): LayerConfig {
    return {
      updateOrder: 999 // Render last (on top of everything)
    };
  }

  dispose(): void {
    // Dispose geometries and materials
    this.group.traverse((child) => {
      if (child instanceof THREE.Line) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) {
          child.material.dispose();
        }
      }
    });
    this.group.clear();
  }

  /**
   * Factory method to create debug layer
   */
  static create(layerId: LayerId): Promise<ILayer> {
    return Promise.resolve(new DebugRenderService(layerId));
  }
}
