/**
 * Graticule Layer
 *
 * Renders lat/lon grid lines with Level of Detail (LOD) based on camera distance
 */

import * as THREE from 'three';
import type { ILayer, LayerId } from './ILayer';
import type { AnimationState } from './AnimationState';
import { latLonToCartesian } from '../utils/coordinates';
import type { TextLabel } from './text.render-service';
import { TEXT_CONFIG } from '../config';
import { GRATICULE_CONFIG } from '../config';

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

export class GraticuleRenderService implements ILayer {
  private layerId: LayerId;
  private group: THREE.Group;
  private lineSegments: THREE.LineSegments | null = null;
  private material: THREE.LineBasicMaterial;
  private currentLOD: number = -1;
  private readonly radius: number;
  private lastDistance?: number;
  private lastSubmittedLOD: number = -1;

  constructor(layerId: LayerId, config: GraticuleConfig = {}) {
    this.layerId = layerId;
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
   * Factory method to create GraticuleRenderService
   */
  static async create(layerId: LayerId, config?: GraticuleConfig): Promise<GraticuleRenderService> {
    return new GraticuleRenderService(layerId, config);
  }

  /**
   * Update layer based on animation state
   */
  update(state: AnimationState): void {
    // Check distance change for LOD
    if (this.lastDistance !== state.camera.distance) {
      this.updateDistanceLOD(state.camera.distance);
      this.lastDistance = state.camera.distance;
    }

    // Submit text labels if enabled and layer is visible
    if (state.textEnabled && this.group.visible && this.currentLOD >= 0) {
      if (this.currentLOD !== this.lastSubmittedLOD) {
        const level = LOD_LEVELS[this.currentLOD];
        if (level) {
          const labels = this.generateLabels(level.latStep, level.lonStep);
          state.collectedText.set(this.layerId, labels);
          this.lastSubmittedLOD = this.currentLOD;
        }
      } else {
        // LOD hasn't changed, but still need to submit to keep labels alive
        const level = LOD_LEVELS[this.currentLOD];
        if (level) {
          const labels = this.generateLabels(level.latStep, level.lonStep);
          state.collectedText.set(this.layerId, labels);
        }
      }
    }
  }

  /**
   * Update based on camera distance
   * Switches LOD levels and updates line width
   */
  private updateDistanceLOD(distance: number): void {
    // Determine LOD level
    let lodLevel = 0;
    for (let i = 0; i < LOD_LEVELS.length; i++) {
      const level = LOD_LEVELS[i];
      if (level && distance <= level.maxDistance) {
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
   * Set text service for labels
   */

  /**
   * Update text enabled state (broadcast from Scene)
   */

  /**
   * Get layer configuration
   */
  getConfig() {
    return GRATICULE_CONFIG;
  }

  /**
   * Clear labels
   */

  /**
   * Update labels based on current LOD
   */

  /**
   * Generate labels for lat/lon grid intersections
   */
  private generateLabels(latStep: number, lonStep: number): TextLabel[] {
    const labels: TextLabel[] = [];
    const labelRadius = this.radius * TEXT_CONFIG.positioning.graticuleRadiusMultiplier;

    // Latitude labels (on prime meridian - longitude 0)
    for (let lat = -90; lat <= 90; lat += latStep) {
      // Skip equator (too crowded), but include poles
      if (lat === 0) continue;

      const position = latLonToCartesian(lat, 0, labelRadius);
      const text = this.formatLatitude(lat);
      labels.push({
        text,
        position,
        color: TEXT_CONFIG.color.graticule
      });
    }

    // Longitude labels (on equator - latitude 0)
    for (let lon = -180; lon < 180; lon += lonStep) {
      // Skip prime meridian (0) as it overlaps with lat labels
      if (lon === 0) continue;

      const position = latLonToCartesian(0, lon, labelRadius);
      const text = this.formatLongitude(lon);
      labels.push({
        text,
        position,
        color: TEXT_CONFIG.color.graticule
      });
    }

    return labels;
  }

  /**
   * Format latitude as string (e.g., "45°N", "30°S")
   */
  private formatLatitude(lat: number): string {
    if (lat === 0) return '0°';
    if (lat === 90) return '90°N';
    if (lat === -90) return '90°S';

    const abs = Math.abs(lat);
    const dir = lat > 0 ? 'N' : 'S';
    return `${abs}°${dir}`;
  }

  /**
   * Format longitude as string (e.g., "90°E", "120°W")
   */
  private formatLongitude(lon: number): string {
    if (lon === 0) return '0°';
    if (lon === 180 || lon === -180) return '180°';

    const abs = Math.abs(lon);
    const dir = lon > 0 ? 'E' : 'W';
    return `${abs}°${dir}`;
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
    if (!config) return;

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
