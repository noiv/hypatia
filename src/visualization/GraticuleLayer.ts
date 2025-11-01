/**
 * Graticule Layer
 *
 * Renders lat/lon grid lines with Level of Detail (LOD) based on camera distance
 */

import * as THREE from 'three';
import type { ILayer } from './ILayer';
import { latLonToCartesian } from '../utils/coordinates';

interface GraticuleConfig {
  color?: number;
  opacity?: number;
  radius?: number;
}

/**
 * LOD Configuration
 * Distance thresholds for different grid densities
 */
const LOD_LEVELS = [
  { maxDistance: 1.5, latStep: 10, lonStep: 10 },   // Close: every 10°
  { maxDistance: 3.0, latStep: 15, lonStep: 15 },   // Medium: every 15°
  { maxDistance: 6.0, latStep: 30, lonStep: 30 },   // Far: every 30°
  { maxDistance: Infinity, latStep: 45, lonStep: 45 } // Very far: every 45°
];

export class GraticuleLayer implements ILayer {
  private group: THREE.Group;
  private lineSegments: THREE.LineSegments | null = null;
  private material: THREE.LineBasicMaterial;
  private currentLOD: number = -1;
  private readonly radius: number;

  constructor(config: GraticuleConfig = {}) {
    this.group = new THREE.Group();
    this.group.name = 'graticule';

    // Render on top of all other layers
    this.group.renderOrder = 1000;

    this.radius = config.radius ?? 1.01; // Higher above Earth surface to avoid z-fighting with basemap

    this.material = new THREE.LineBasicMaterial({
      color: config.color ?? 0x444444,
      opacity: config.opacity ?? 0.5,
      transparent: true,
      linewidth: 1,
      depthTest: true,    // Respect depth - don't show back side through front
      depthWrite: false   // Don't write to depth buffer to avoid z-fighting
    });

    // Start with medium LOD
    this.rebuildGeometry(1);
  }

  /**
   * Factory method to create GraticuleLayer
   */
  static async create(config?: GraticuleConfig): Promise<GraticuleLayer> {
    return new GraticuleLayer(config);
  }

  /**
   * Update time (no-op for graticule)
   */
  updateTime(_time: Date): void {
    // No-op - graticule doesn't change with time
  }

  /**
   * Update based on camera distance
   * Switches LOD levels and updates line width
   */
  updateDistance(distance: number): void {
    // Determine LOD level
    let lodLevel = 0;
    for (let i = 0; i < LOD_LEVELS.length; i++) {
      if (distance <= LOD_LEVELS[i].maxDistance) {
        lodLevel = i;
        break;
      }
    }

    // Rebuild geometry if LOD changed
    if (lodLevel !== this.currentLOD) {
      this.rebuildGeometry(lodLevel);
      this.currentLOD = lodLevel;
    }

    // Update line width based on distance (not supported in WebGL LineBasicMaterial)
    // LineBasicMaterial linewidth is always 1 regardless of value
    // For variable line width, would need to use Line2/LineMaterial or custom shader
  }

  /**
   * Update sun direction (no-op for graticule)
   */
  updateSunDirection(_sunDir: THREE.Vector3): void {
    // No-op - graticule doesn't use lighting
  }

  /**
   * Set layer visibility
   */
  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /**
   * Set layer opacity
   */
  setOpacity(opacity: number): void {
    this.material.opacity = opacity;
  }

  /**
   * Get the THREE.js object
   */
  getSceneObject(): THREE.Object3D {
    return this.group;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.lineSegments) {
      this.lineSegments.geometry.dispose();
    }
    this.material.dispose();
  }

  /**
   * Rebuild geometry for current LOD level
   */
  private rebuildGeometry(lodLevel: number): void {
    // Remove old geometry
    if (this.lineSegments) {
      this.group.remove(this.lineSegments);
      this.lineSegments.geometry.dispose();
    }

    const config = LOD_LEVELS[lodLevel];
    const geometry = this.createGraticuleGeometry(config.latStep, config.lonStep);

    this.lineSegments = new THREE.LineSegments(geometry, this.material);
    this.lineSegments.name = 'graticule-lines';
    this.group.add(this.lineSegments);
  }

  /**
   * Create graticule geometry with specified grid spacing
   */
  private createGraticuleGeometry(latStep: number, lonStep: number): THREE.BufferGeometry {
    const positions: number[] = [];
    const segmentsPerLine = 20; // Number of segments to interpolate between grid points

    // Generate latitude lines (parallels)
    for (let lat = -90; lat <= 90; lat += latStep) {
      // Skip poles for parallels
      if (lat === -90 || lat === 90) continue;

      for (let lon = -180; lon < 180; lon += lonStep) {
        const lon1 = lon;
        const lon2 = lon + lonStep;

        // Interpolate points along the parallel
        for (let i = 0; i < segmentsPerLine; i++) {
          const t1 = i / segmentsPerLine;
          const t2 = (i + 1) / segmentsPerLine;

          const lonA = lon1 + t1 * (lon2 - lon1);
          const lonB = lon1 + t2 * (lon2 - lon1);

          const p1 = latLonToCartesian(lat, lonA, this.radius);
          const p2 = latLonToCartesian(lat, lonB, this.radius);

          positions.push(p1.x, p1.y, p1.z);
          positions.push(p2.x, p2.y, p2.z);
        }
      }
    }

    // Generate longitude lines (meridians)
    for (let lon = -180; lon < 180; lon += lonStep) {
      for (let lat = -90; lat < 90; lat += latStep) {
        const lat1 = lat;
        const lat2 = lat + latStep;

        // Interpolate points along the meridian
        for (let i = 0; i < segmentsPerLine; i++) {
          const t1 = i / segmentsPerLine;
          const t2 = (i + 1) / segmentsPerLine;

          const latA = lat1 + t1 * (lat2 - lat1);
          const latB = lat1 + t2 * (lat2 - lat1);

          const p1 = latLonToCartesian(latA, lon, this.radius);
          const p2 = latLonToCartesian(latB, lon, this.radius);

          positions.push(p1.x, p1.y, p1.z);
          positions.push(p2.x, p2.y, p2.z);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    return geometry;
  }
}
