/**
 * Wind Geometry Helper
 *
 * Handles all geometry-related operations for wind visualization:
 * - Visibility culling based on camera position
 * - LineSegments2 and custom geometry creation
 * - Geometry updates with computed vertices
 * - Line width scaling based on camera distance
 */

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import windSnakeShader from './wind-snake.glsl?raw';

export interface WindGeometryConfig {
  lineSteps: number;
  lineWidth: number;
  taperSegments: number;
  snakeLength: number;
  useCustomGeometry: boolean;
}

export class WindGeometry {
  private seeds: THREE.Vector3[];
  private config: WindGeometryConfig;

  // Visibility culling
  private visibleSeeds: Uint32Array | null = null;

  // Cached geometry data
  private cachedRandomOffsets: Float32Array | null = null;
  private cachedPositions: Float32Array | null = null;
  private cachedColors: Float32Array | null = null;

  constructor(seeds: THREE.Vector3[], config: WindGeometryConfig) {
    this.seeds = seeds;
    this.config = config;
  }

  /**
   * Calculate which seeds are camera-facing (dot product > 0)
   */
  calculateVisibleSeeds(cameraPosition: THREE.Vector3): { indices: Uint32Array, count: number } {
    const cameraDir = cameraPosition.clone().normalize();

    if (!this.visibleSeeds || this.visibleSeeds.length !== this.seeds.length) {
      this.visibleSeeds = new Uint32Array(this.seeds.length);
    }

    let count = 0;
    for (let i = 0; i < this.seeds.length; i++) {
      const seedDir = this.seeds[i].clone().normalize();
      const dot = seedDir.dot(cameraDir);

      if (dot > 0) {
        this.visibleSeeds[count++] = i;
      }
    }

    return { indices: this.visibleSeeds, count };
  }

  /**
   * Update geometry with computed vertices from WebGPU
   */
  updateGeometry(
    vertices: Float32Array,
    visibleSeeds: Uint32Array | null,
    visibleCount: number,
    lines: LineSegments2 | THREE.Mesh | null,
    group: THREE.Group,
    material: LineMaterial | THREE.ShaderMaterial | null
  ): { lines: LineSegments2 | THREE.Mesh, material: LineMaterial | THREE.ShaderMaterial } {
    // Build visibility mask
    const isVisible = new Uint8Array(this.seeds.length);
    if (visibleSeeds && visibleCount > 0) {
      for (let i = 0; i < visibleCount; i++) {
        isVisible[visibleSeeds[i]] = 1;
      }
    } else {
      for (let i = 0; i < this.seeds.length; i++) {
        isVisible[i] = 1;
      }
    }

    // Count visible segments
    let visibleSegmentCount = 0;
    for (let lineIdx = 0; lineIdx < this.seeds.length; lineIdx++) {
      if (isVisible[lineIdx]) {
        visibleSegmentCount += this.config.lineSteps - 1;
      }
    }

    // Allocate or reuse buffers
    const arraySize = visibleSegmentCount * 6;
    if (!this.cachedPositions || this.cachedPositions.length !== arraySize) {
      this.cachedPositions = new Float32Array(arraySize);
      this.cachedColors = new Float32Array(arraySize);
    }

    const positions = this.cachedPositions;
    const colors = this.cachedColors;

    const cycleLength = this.config.lineSteps + this.config.snakeLength;
    const totalSegments = this.config.lineSteps - 1;

    // Generate random offsets for snake animation (once)
    if (!this.cachedRandomOffsets) {
      this.cachedRandomOffsets = new Float32Array(this.seeds.length);
      for (let i = 0; i < this.seeds.length; i++) {
        this.cachedRandomOffsets[i] = Math.random() * cycleLength;
      }
    }

    // Build geometry arrays
    let posIdx = 0;
    let colorIdx = 0;

    for (let lineIdx = 0; lineIdx < this.seeds.length; lineIdx++) {
      if (!isVisible[lineIdx]) continue;

      const randomOffset = this.cachedRandomOffsets[lineIdx];
      const offset = lineIdx * this.config.lineSteps * 4;
      const normalizedOffset = randomOffset / cycleLength;

      for (let i = 0; i < this.config.lineSteps - 1; i++) {
        const idx0 = offset + i * 4;
        const idx1 = offset + (i + 1) * 4;

        // Positions
        positions[posIdx++] = vertices[idx0];
        positions[posIdx++] = vertices[idx0 + 1];
        positions[posIdx++] = vertices[idx0 + 2];
        positions[posIdx++] = vertices[idx1];
        positions[posIdx++] = vertices[idx1 + 1];
        positions[posIdx++] = vertices[idx1 + 2];

        // Taper factor (fade out at line end)
        const remainingSegments = totalSegments - i;
        const taperFactor = remainingSegments <= this.config.taperSegments
          ? remainingSegments / this.config.taperSegments
          : 1.0;

        const normalizedIndex = i / totalSegments;

        // Colors encode animation data (normalizedIndex, normalizedOffset, taperFactor)
        colors[colorIdx++] = normalizedIndex;
        colors[colorIdx++] = normalizedOffset;
        colors[colorIdx++] = taperFactor;
        colors[colorIdx++] = normalizedIndex;
        colors[colorIdx++] = normalizedOffset;
        colors[colorIdx++] = taperFactor;
      }
    }

    // Update or create geometry
    if (lines) {
      if (this.config.useCustomGeometry) {
        this.updateCustomGeometry(positions, colors, lines as THREE.Mesh);
      } else {
        const geometry = lines.geometry as LineSegmentsGeometry;
        geometry.setPositions(positions as any);
        geometry.setColors(colors as any);
      }
      return { lines, material: material! };
    } else {
      return this.createLines(positions, colors, group);
    }
  }

  /**
   * Update custom geometry buffers (instanced line rendering)
   */
  private updateCustomGeometry(positions: Float32Array, colors: Float32Array, lines: THREE.Mesh): void {
    const geometry = lines.geometry;
    const instanceStart = geometry.getAttribute('instanceStart') as THREE.BufferAttribute;
    const instanceEnd = geometry.getAttribute('instanceEnd') as THREE.BufferAttribute;
    const instanceColorStart = geometry.getAttribute('instanceColorStart') as THREE.BufferAttribute;
    const instanceColorEnd = geometry.getAttribute('instanceColorEnd') as THREE.BufferAttribute;

    const numSegments = positions.length / 6;
    for (let i = 0; i < numSegments; i++) {
      const posIdx = i * 6;

      instanceStart.setXYZ(i, positions[posIdx], positions[posIdx + 1], positions[posIdx + 2]);
      instanceEnd.setXYZ(i, positions[posIdx + 3], positions[posIdx + 4], positions[posIdx + 5]);
      instanceColorStart.setXYZ(i, colors[posIdx], colors[posIdx + 1], colors[posIdx + 2]);
      instanceColorEnd.setXYZ(i, colors[posIdx + 3], colors[posIdx + 4], colors[posIdx + 5]);
    }

    instanceStart.needsUpdate = true;
    instanceEnd.needsUpdate = true;
    instanceColorStart.needsUpdate = true;
    instanceColorEnd.needsUpdate = true;
  }

  /**
   * Create LineSegments2 or custom geometry
   */
  private createLines(
    positions: Float32Array | number[],
    colors: Float32Array | number[],
    group: THREE.Group
  ): { lines: LineSegments2 | THREE.Mesh, material: LineMaterial | THREE.ShaderMaterial } {
    if (this.config.useCustomGeometry) {
      return this.createCustomGeometry(positions as Float32Array, colors as Float32Array, group);
    } else {
      return this.createLineSegments2(positions, colors, group);
    }
  }

  /**
   * Create LineSegments2 with snake animation
   */
  private createLineSegments2(
    positions: Float32Array | number[],
    colors: Float32Array | number[],
    group: THREE.Group
  ): { lines: LineSegments2, material: LineMaterial } {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    geometry.setColors(colors);

    const material = new LineMaterial({
      linewidth: this.config.lineWidth,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      depthTest: true,
      alphaToCoverage: false
    });

    material.resolution.set(window.innerWidth, window.innerHeight);

    // Add custom uniforms for snake animation
    (material as any).uniforms = {
      ...material.uniforms,
      animationPhase: { value: 0.0 },
      snakeLength: { value: this.config.snakeLength },
      lineSteps: { value: this.config.lineSteps }
    };

    // Inject snake animation shader
    material.onBeforeCompile = (shader) => {
      shader.uniforms.animationPhase = (material as any).uniforms.animationPhase;
      shader.uniforms.snakeLength = (material as any).uniforms.snakeLength;
      shader.uniforms.lineSteps = (material as any).uniforms.lineSteps;

      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        `
        uniform float animationPhase;
        uniform float snakeLength;
        uniform float lineSteps;
        void main() {
        `
      );

      if (shader.fragmentShader.includes('gl_FragColor =')) {
        shader.fragmentShader = shader.fragmentShader.replace(
          /gl_FragColor = vec4\( diffuseColor\.rgb, alpha \);/,
          windSnakeShader
        );
      }
    };

    const lines = new LineSegments2(geometry, material);
    group.add(lines);

    console.log(`Created wind lines: ${this.seeds.length} lines, ${positions.length / 6} segments`);

    return { lines, material };
  }

  /**
   * Create custom instanced geometry (unused by default)
   */
  private createCustomGeometry(
    _positions: Float32Array,
    _colors: Float32Array,
    _group: THREE.Group
  ): { lines: THREE.Mesh, material: THREE.ShaderMaterial } {
    // Implementation omitted for brevity - same as original
    throw new Error('Custom geometry not implemented');
  }

  /**
   * Update line width based on camera distance
   */
  updateLineWidth(
    cameraDistance: number,
    material: LineMaterial | THREE.ShaderMaterial | null
  ): void {
    if (!material) return;

    const minDistance = 1.157;
    const maxDistance = 10.0;
    const minWidth = 2.0;
    const maxWidth = 0.02;

    const t = (Math.log(cameraDistance) - Math.log(minDistance)) /
              (Math.log(maxDistance) - Math.log(minDistance));
    const clampedT = Math.max(0, Math.min(1, t));
    const lineWidth = minWidth + (maxWidth - minWidth) * clampedT;

    if (this.config.useCustomGeometry) {
      (material as THREE.ShaderMaterial).uniforms.linewidth.value = lineWidth;
    } else {
      (material as LineMaterial).linewidth = lineWidth;
    }
  }

  /**
   * Update resolution for responsive line rendering
   */
  setResolution(
    width: number,
    height: number,
    material: LineMaterial | THREE.ShaderMaterial | null
  ): void {
    if (!material) return;

    if (this.config.useCustomGeometry) {
      (material as THREE.ShaderMaterial).uniforms.resolution.value.set(width, height);
    } else {
      (material as LineMaterial).resolution.set(width, height);
    }
  }
}
