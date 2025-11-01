import type * as THREE from 'three';
import { Earth } from './Earth';
import type { ILayer } from './ILayer';

/**
 * EarthLayer - Wrapper around Earth class implementing ILayer interface
 *
 * Provides polymorphic layer interface for the Earth basemap
 */
export class EarthLayer implements ILayer {
  private earth: Earth;

  private constructor(earth: Earth) {
    this.earth = earth;
  }

  /**
   * Factory method to create EarthLayer
   */
  static async create(preloadedImages?: Map<string, HTMLImageElement>): Promise<EarthLayer> {
    const earth = new Earth(preloadedImages);
    return new EarthLayer(earth);
  }

  // ILayer interface implementation

  /**
   * Update layer based on current time
   * Earth doesn't change with time, but must implement interface
   */
  updateTime(_time: Date): void {
    // No-op - Earth doesn't change with time
  }

  /**
   * Update layer based on camera distance
   * Earth doesn't change with distance, but must implement interface
   */
  updateDistance(_distance: number): void {
    // No-op - Earth doesn't change with distance
  }

  /**
   * Set layer visibility
   */
  setVisible(visible: boolean): void {
    this.earth.mesh.visible = visible;
  }

  /**
   * Get the THREE.js object to add to scene
   */
  getSceneObject(): THREE.Object3D {
    return this.earth.mesh;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.earth.dispose();
  }

  /**
   * Set basemap blend (0.0 = first basemap, 1.0 = second basemap)
   */
  setBlend(blend: number): void {
    this.earth.setBlend(blend);
  }

  /**
   * Update sun direction for lighting calculation
   */
  updateSunDirection(direction: THREE.Vector3): void {
    this.earth.setSunDirection(direction);
  }
}
