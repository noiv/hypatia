import * as THREE from 'three';
import { EARTH_RADIUS_UNITS } from '../utils/constants';
import { generateRandomSphere } from '../utils/sphereSeeds';

/**
 * Wind Layer - Stage 1: Seed Points Visualization
 *
 * Renders 1000 randomly distributed red sprite points on the sphere
 * to validate UI/UX integration before implementing full wind lines.
 */
export class WindLayer {
  public group: THREE.Group;
  private seeds: THREE.Vector3[];
  private sprites: THREE.Points;

  constructor(numSeeds: number = 1000) {
    this.group = new THREE.Group();
    this.group.name = 'wind-layer';

    // Generate randomly distributed seed points with uniform distribution
    this.seeds = generateRandomSphere(numSeeds, EARTH_RADIUS_UNITS);

    console.log(`🌬️  Wind layer: Generated ${numSeeds} random seed points`);

    // Create sprite points for visualization
    this.sprites = this.createSpritePoints();
    this.group.add(this.sprites);
  }

  /**
   * Create red sprite points at each seed location
   */
  private createSpritePoints(): THREE.Points {
    // Create geometry from seed positions
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.seeds.length * 3);

    this.seeds.forEach((seed, i) => {
      positions[i * 3 + 0] = seed.x;
      positions[i * 3 + 1] = seed.y;
      positions[i * 3 + 2] = seed.z;
    });

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Create red sprite material
    const material = new THREE.PointsMaterial({
      color: 0xff0000, // Red
      size: 0.01,      // Size in scene units
      sizeAttenuation: true,
      transparent: false,
      depthWrite: true,
      depthTest: true
    });

    return new THREE.Points(geometry, material);
  }

  /**
   * Get the Three.js group containing all wind visualization objects
   */
  getGroup(): THREE.Group {
    return this.group;
  }

  /**
   * Set visibility of wind layer
   */
  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /**
   * Get number of seed points
   */
  getNumSeeds(): number {
    return this.seeds.length;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (this.sprites) {
      this.sprites.geometry.dispose();
      (this.sprites.material as THREE.Material).dispose();
    }
  }
}
