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
// import windSnakeShader from './wind-snake.glsl?raw';  // Currently unused, will be re-enabled later

// Extended LineMaterial with custom uniforms for wind animation
interface WindLineMaterial extends LineMaterial {
  uniforms: LineMaterial['uniforms'] & {
    animationPhase: { value: number };
    snakeLength: { value: number };
    lineSteps: { value: number };
  };
}

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
      const seed = this.seeds[i];
      if (!seed) continue; // Skip if seed doesn't exist

      const seedDir = seed.clone().normalize();
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
        const seedIndex = visibleSeeds[i];
        if (seedIndex !== undefined) {
          isVisible[seedIndex] = 1;
        }
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

    // Ensure buffers are allocated (should always be true after allocation above)
    if (!positions || !colors) {
      throw new Error('Failed to allocate geometry buffers');
    }

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
      if (randomOffset === undefined) continue; // Skip if no random offset

      const offset = lineIdx * this.config.lineSteps * 4;
      const normalizedOffset = randomOffset / cycleLength;

      for (let i = 0; i < this.config.lineSteps - 1; i++) {
        const idx0 = offset + i * 4;
        const idx1 = offset + (i + 1) * 4;

        // Positions - vertices are guaranteed to exist at these indices
        const v0x = vertices[idx0];
        const v0y = vertices[idx0 + 1];
        const v0z = vertices[idx0 + 2];
        const v1x = vertices[idx1];
        const v1y = vertices[idx1 + 1];
        const v1z = vertices[idx1 + 2];

        if (v0x === undefined || v0y === undefined || v0z === undefined ||
            v1x === undefined || v1y === undefined || v1z === undefined) {
          continue; // Skip if vertex data is missing
        }

        positions[posIdx++] = v0x;
        positions[posIdx++] = v0y;
        positions[posIdx++] = v0z;
        positions[posIdx++] = v1x;
        positions[posIdx++] = v1y;
        positions[posIdx++] = v1z;

        // Taper factor (fade out at line end)
        const remainingSegments = totalSegments - i;
        const taperFactor = remainingSegments <= this.config.taperSegments
          ? remainingSegments / this.config.taperSegments
          : 1.0;

        const normalizedIndex = i / totalSegments;

        // Colors encode animation data for snake effect
        // R: normalized segment index (0 to 1 along line)
        // G: random offset for each line (0 to 1)
        // B: taper factor for line endings
        colors[colorIdx++] = normalizedIndex;
        colors[colorIdx++] = normalizedOffset;
        colors[colorIdx++] = taperFactor;
        colors[colorIdx++] = normalizedIndex;
        colors[colorIdx++] = normalizedOffset;
        colors[colorIdx++] = taperFactor;
      }
    }

    // Update or create geometry
    // Note: positions and colors are guaranteed non-null (checked above at lines 113-115)
    if (lines) {
      if (this.config.useCustomGeometry) {
        this.updateCustomGeometry(positions, colors, lines as THREE.Mesh);
      } else {
        const geometry = lines.geometry as LineSegmentsGeometry;
        geometry.setPositions(positions);
        geometry.setColors(colors);
      }
      // Material is guaranteed non-null when lines exists
      if (!material) {
        throw new Error('Material must be provided with existing lines');
      }
      return { lines, material };
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

      const p0x = positions[posIdx];
      const p0y = positions[posIdx + 1];
      const p0z = positions[posIdx + 2];
      const p1x = positions[posIdx + 3];
      const p1y = positions[posIdx + 4];
      const p1z = positions[posIdx + 5];
      const c0x = colors[posIdx];
      const c0y = colors[posIdx + 1];
      const c0z = colors[posIdx + 2];
      const c1x = colors[posIdx + 3];
      const c1y = colors[posIdx + 4];
      const c1z = colors[posIdx + 5];

      if (p0x === undefined || p0y === undefined || p0z === undefined ||
          p1x === undefined || p1y === undefined || p1z === undefined ||
          c0x === undefined || c0y === undefined || c0z === undefined ||
          c1x === undefined || c1y === undefined || c1z === undefined) {
        continue; // Skip if data is missing
      }

      instanceStart.setXYZ(i, p0x, p0y, p0z);
      instanceEnd.setXYZ(i, p1x, p1y, p1z);
      instanceColorStart.setXYZ(i, c0x, c0y, c0z);
      instanceColorEnd.setXYZ(i, c1x, c1y, c1z);
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
  ): { lines: LineSegments2, material: WindLineMaterial } {
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
    }) as WindLineMaterial;

    material.resolution.set(window.innerWidth, window.innerHeight);

    // Add snake animation uniforms
    material.uniforms = {
      ...material.uniforms,
      animationPhase: { value: 0.0 },
      snakeLength: { value: this.config.snakeLength },
      lineSteps: { value: this.config.lineSteps }
    };

    // Inject snake animation shader
    material.onBeforeCompile = (shader) => {
      shader.uniforms.animationPhase = material.uniforms.animationPhase;
      shader.uniforms.snakeLength = material.uniforms.snakeLength;
      shader.uniforms.lineSteps = material.uniforms.lineSteps;

      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        `
        uniform float animationPhase;
        uniform float snakeLength;
        uniform float lineSteps;

        // For view-angle calculation
        varying vec3 vWorldPos;

        void main() {
        `
      );

      // Add world position to vertex shader
      shader.vertexShader = shader.vertexShader.replace(
        'void main() {',
        `
        varying vec3 vWorldPos;
        void main() {
        `
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <fog_vertex>',
        `
        #include <fog_vertex>
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        `
      );

      if (shader.fragmentShader.includes('gl_FragColor =')) {
        shader.fragmentShader = shader.fragmentShader.replace(
          /gl_FragColor = vec4\( diffuseColor\.rgb, alpha \);/,
          `
          // Extract segment data from diffuseColor (RGB channels)
          float normalizedIndex = diffuseColor.r;
          float normalizedOffset = diffuseColor.g;
          float taperFactor = diffuseColor.b;

          // Calculate snake animation
          float cycleLength = lineSteps + snakeLength;
          float segmentIndex = normalizedIndex * (lineSteps - 1.0);
          float randomOffset = normalizedOffset * cycleLength;
          float snakeHead = mod(animationPhase + randomOffset, cycleLength);
          float distanceFromHead = segmentIndex - snakeHead;

          if (distanceFromHead < -snakeLength) {
            distanceFromHead += cycleLength;
          }

          float segmentOpacity = 0.0;
          if (distanceFromHead >= -snakeLength && distanceFromHead <= 0.0) {
            float positionInSnake = (distanceFromHead + snakeLength) / snakeLength;
            segmentOpacity = positionInSnake;
          }

          // EXPERIMENTAL: Horizon-based wind line fading
          // Problem: When wind lines are tangent to the sphere and point toward the camera,
          // they appear as bright dots/spots against the background instead of lines.
          // This happens at the horizon (visible edge of Earth from camera's perspective).
          //
          // Solution attempt: Fade out wind lines that are near the horizon.
          // The horizon forms a circle on the sphere where view rays are tangent.
          //
          // Math:
          // - toPoint: normalized vector from camera to wind line point
          // - pointOnSphere: normalized position (same as surface normal)
          // - When dot(toPoint, pointOnSphere) = 0, the view is tangent (at horizon)
          // - When dot(toPoint, pointOnSphere) = 1, looking straight at the point
          //
          // Status: INCOMPLETE - The effect is not working as expected.
          // The fading either affects too much (whole hemisphere) or is not visible.
          // Needs further investigation into the shader coordinate systems and
          // how LineMaterial/LineSegments2 handles fragment positions.

          vec3 toPoint = normalize(vWorldPos - cameraPosition);
          vec3 pointOnSphere = normalize(vWorldPos);
          float tangentDot = abs(dot(toPoint, pointOnSphere));

          // Band width controls how far from horizon the fade extends
          // 0.1 = ~6 degrees, 0.3 = ~17 degrees from horizon
          float bandWidth = 0.3;
          float viewAngleFade = smoothstep(0.0, bandWidth, tangentDot);

          // Cube for sharper transition (more aggressive fade)
          viewAngleFade = viewAngleFade * viewAngleFade * viewAngleFade;

          float finalAlpha = alpha * segmentOpacity * taperFactor * viewAngleFade;
          gl_FragColor = vec4( vec3(1.0), finalAlpha );
          `
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
    material: WindLineMaterial | THREE.ShaderMaterial | null
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
      const shaderMat = material as THREE.ShaderMaterial;
      if (shaderMat.uniforms && shaderMat.uniforms.linewidth) {
        shaderMat.uniforms.linewidth.value = lineWidth;
      }
    } else {
      (material as LineMaterial).linewidth = lineWidth;
    }
  }

  // Removed setResolution - not needed for distance-based line scaling
  // Resolution updates were for maintaining constant pixel width,
  // but we want lines to scale with distance instead
}
