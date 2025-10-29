import * as THREE from 'three';
import { calculateSunPosition } from '../utils/time';

export class Sun {
  public mesh: THREE.Mesh;
  private light: THREE.DirectionalLight;

  constructor() {
    // Sun mesh (larger sphere for visibility at distance)
    const geometry = new THREE.SphereGeometry(5, 32, 32);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffff00
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'Sun';

    // Directional light for illumination (stronger for longer distance)
    this.light = new THREE.DirectionalLight(0xffffff, 2);

    // Initial position
    this.updatePosition(new Date());
  }

  /**
   * Get the directional light
   */
  getLight(): THREE.DirectionalLight {
    return this.light;
  }

  /**
   * Update sun position based on time
   * Sun rotates around Earth (geocentric view)
   */
  updatePosition(time: Date) {
    const pos = calculateSunPosition(time);

    // Position sun at very large distance to minimize perspective distortion
    // Sun should appear circular, not warped by perspective
    const distance = 500;
    this.mesh.position.set(
      pos.x * distance,
      pos.y * distance,
      pos.z * distance
    );

    // Update light position to match sun
    this.light.position.copy(this.mesh.position);

    // Light points toward Earth (origin)
    this.light.target.position.set(0, 0, 0);
  }

  /**
   * Clean up resources
   */
  dispose() {
    if (this.mesh.geometry) {
      this.mesh.geometry.dispose();
    }

    if (this.mesh.material) {
      const material = this.mesh.material as THREE.Material;
      material.dispose();
    }

    this.light.dispose();
  }
}
