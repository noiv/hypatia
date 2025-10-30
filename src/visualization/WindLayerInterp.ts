import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { EARTH_RADIUS_UNITS } from '../utils/constants';
import { generateRandomSphere } from '../utils/sphereSeeds';
import { Wind10mService, TimeStep } from '../services/Wind10mService';
import { WindGPUService } from '../services/WindGPUService';

/**
 * WindLayerInterp - CPU-based wind line tracing with time interpolation
 *
 * Loads all timesteps and interpolates between them based on current time.
 * Updates lines only when time changes (debounced).
 */
export class WindLayerInterp {
  public group: THREE.Group;
  private seeds: THREE.Vector3[];
  private lines: LineSegments2 | null = null;
  private material: LineMaterial | null = null;

  // Wind data
  private timesteps: TimeStep[] = [];
  private windDataU: Uint16Array[] = [];
  private windDataV: Uint16Array[] = [];

  // State
  private lastTimeIndex: number = -1;
  private animationPhase: number = 0;

  private static readonly LINE_STEPS = 32;
  private static readonly STEP_FACTOR = 0.00015;
  private static readonly LINE_WIDTH = 2.0;
  private static readonly TAPER_SEGMENTS = 4;
  private static readonly SNAKE_LENGTH = 10;

  constructor(numSeeds: number = 16384) {
    this.group = new THREE.Group();
    this.group.name = 'wind-layer-interp';

    // Generate seed points
    this.seeds = generateRandomSphere(numSeeds, EARTH_RADIUS_UNITS);

    console.log(`🌬️  WindLayerInterp: Generated ${numSeeds} seed points`);
  }

  /**
   * Load all wind data timesteps
   */
  async loadWindData(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    // Generate timesteps from manifest
    this.timesteps = Wind10mService.generateTimeSteps();

    if (this.timesteps.length === 0) {
      throw new Error('No wind timesteps available');
    }

    console.log(`🌬️  Loading ${this.timesteps.length} wind timesteps...`);

    // Load all timesteps
    const { uData, vData } = await WindGPUService.loadAllTimeSteps(this.timesteps, onProgress);
    this.windDataU = uData;
    this.windDataV = vData;

    console.log(`✅ Loaded ${this.timesteps.length} wind timesteps`);
  }

  /**
   * Update wind lines for current time
   */
  async updateTime(currentTime: Date): Promise<void> {
    if (this.timesteps.length === 0) return;

    // Calculate time index
    const timeIndex = WindGPUService.timeToIndex(currentTime, this.timesteps);

    // Only recompute if time changed
    if (Math.abs(timeIndex - this.lastTimeIndex) < 0.001) {
      return; // No change, skip compute
    }

    this.lastTimeIndex = timeIndex;

    // Get adjacent timesteps and blend factor
    const { index0, index1, blend } = WindGPUService.getAdjacentTimesteps(timeIndex);

    console.log(`🌬️  Tracing wind lines: t=${timeIndex.toFixed(2)} (${index0}→${index1}, blend=${blend.toFixed(2)})`);

    // Trace lines on CPU with interpolation
    const startTime = performance.now();
    this.traceLinesOnCPU(index0, index1, blend);
    const traceTime = performance.now() - startTime;

    console.log(`✅ Traced ${this.seeds.length} lines in ${traceTime.toFixed(2)}ms`);
  }

  /**
   * Trace lines on CPU with time interpolation
   */
  private traceLinesOnCPU(index0: number, index1: number, blend: number): void {
    const positions: number[] = [];
    const colors: number[] = [];

    const u0 = this.windDataU[index0]!;
    const v0 = this.windDataV[index0]!;
    const u1 = this.windDataU[index1]!;
    const v1 = this.windDataV[index1]!;

    // Trace from each seed
    for (const seed of this.seeds) {
      const line = this.traceLine(seed, u0, v0, u1, v1, blend);

      const cycleLength = WindLayerInterp.LINE_STEPS + WindLayerInterp.SNAKE_LENGTH;
      const randomOffset = Math.random() * cycleLength;

      // Add line segments
      for (let i = 0; i < line.length - 1; i++) {
        const segmentIndex = i;
        const totalSegments = line.length - 1;

        let taperFactor = 1.0;
        const remainingSegments = totalSegments - segmentIndex;
        if (remainingSegments <= WindLayerInterp.TAPER_SEGMENTS) {
          taperFactor = remainingSegments / WindLayerInterp.TAPER_SEGMENTS;
        }

        positions.push(
          line[i]!.x, line[i]!.y, line[i]!.z,
          line[i + 1]!.x, line[i + 1]!.y, line[i + 1]!.z
        );

        const normalizedIndex = segmentIndex / totalSegments;
        const normalizedOffset = randomOffset / cycleLength;
        colors.push(
          normalizedIndex, normalizedOffset, taperFactor,
          normalizedIndex, normalizedOffset, taperFactor
        );
      }
    }

    // Update or create geometry
    if (this.lines) {
      // Update existing geometry
      const geometry = this.lines.geometry as LineSegmentsGeometry;
      geometry.setPositions(positions);
      geometry.setColors(colors);
    } else {
      // Create new geometry and material
      this.createLines(positions, colors);
    }
  }

  /**
   * Trace a single line with interpolated wind data
   */
  private traceLine(seed: THREE.Vector3, u0: Uint16Array, v0: Uint16Array,
                    u1: Uint16Array, v1: Uint16Array, blend: number): THREE.Vector3[] {
    const vertices: THREE.Vector3[] = [];
    let currentPos = seed.clone();

    for (let step = 0; step < WindLayerInterp.LINE_STEPS; step++) {
      vertices.push(currentPos.clone());

      const { lat, lon } = this.cartesianToLatLon(currentPos);

      // Sample both timesteps
      const wind0 = Wind10mService.sampleWind(u0, v0, lat, lon);
      const wind1 = Wind10mService.sampleWind(u1, v1, lat, lon);

      // Interpolate
      const windU = wind0.u * (1 - blend) + wind1.u * blend;
      const windV = wind0.v * (1 - blend) + wind1.v * blend;

      if (isNaN(windU) || isNaN(windV)) break;

      const spherical = new THREE.Spherical();
      spherical.setFromVector3(currentPos);

      const uAdjusted = windU / Math.cos(lat * Math.PI / 180);
      spherical.theta += uAdjusted * WindLayerInterp.STEP_FACTOR;
      spherical.phi -= windV * WindLayerInterp.STEP_FACTOR;
      spherical.phi = Math.max(0.01, Math.min(Math.PI - 0.01, spherical.phi));

      currentPos.setFromSpherical(spherical);
    }

    return vertices;
  }

  /**
   * Convert cartesian to lat/lon (matching rain layer)
   */
  private cartesianToLatLon(v: THREE.Vector3): { lat: number; lon: number } {
    const normalized = v.clone().normalize();
    const lon = Math.atan2(normalized.z, normalized.x);
    const lat = Math.asin(normalized.y);

    const PI = Math.PI;
    let u = ((lon - PI/2) + PI) / (2 * PI);
    u = 1.0 - u;

    const lonDeg = u * 360 - 180;
    const latDeg = lat * 180 / PI;

    return { lat: latDeg, lon: lonDeg };
  }

  /**
   * Create LineSegments2 with given positions and colors
   */
  private createLines(positions: number[], colors: number[]): void {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    geometry.setColors(colors);

    this.material = new LineMaterial({
      color: 0xffffff,
      linewidth: WindLayerInterp.LINE_WIDTH,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      depthTest: true,
      alphaToCoverage: false
    });

    this.material.resolution.set(window.innerWidth, window.innerHeight);

    // Add uniforms for snake animation
    (this.material as any).uniforms = {
      ...this.material.uniforms,
      animationPhase: { value: 0.0 },
      snakeLength: { value: WindLayerInterp.SNAKE_LENGTH },
      lineSteps: { value: WindLayerInterp.LINE_STEPS }
    };

    // Add snake animation shader
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.animationPhase = (this.material as any).uniforms.animationPhase;
      shader.uniforms.snakeLength = (this.material as any).uniforms.snakeLength;
      shader.uniforms.lineSteps = (this.material as any).uniforms.lineSteps;

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
          `
          float normalizedIndex = vColor.r;
          float normalizedOffset = vColor.g;
          float taperFactor = vColor.b;

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

          float finalAlpha = alpha * segmentOpacity * taperFactor;
          gl_FragColor = vec4( vec3(1.0), finalAlpha );
          `
        );
      }
    };

    this.lines = new LineSegments2(geometry, this.material);
    this.group.add(this.lines);

    console.log(`✅ Created wind lines: ${this.seeds.length} lines, ${positions.length / 6} segments`);
  }

  /**
   * Get the Three.js group
   */
  getGroup(): THREE.Group {
    return this.group;
  }

  /**
   * Set visibility
   */
  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /**
   * Update resolution for LineMaterial
   */
  setResolution(width: number, height: number): void {
    if (this.material) {
      this.material.resolution.set(width, height);
    }
  }

  /**
   * Update line width based on camera distance
   */
  updateLineWidth(cameraDistance: number): void {
    if (!this.material) return;

    const minDistance = 1.157;
    const maxDistance = 10.0;
    const minWidth = 2.0;
    const maxWidth = 0.02;

    const t = (Math.log(cameraDistance) - Math.log(minDistance)) /
              (Math.log(maxDistance) - Math.log(minDistance));
    const clampedT = Math.max(0, Math.min(1, t));
    const lineWidth = minWidth + (maxWidth - minWidth) * clampedT;

    this.material.linewidth = lineWidth;
  }

  /**
   * Update animation phase for snake effect
   */
  updateAnimation(deltaTime: number): void {
    if (!this.material) return;

    const animationSpeed = 20.0;
    const cycleLength = WindLayerInterp.LINE_STEPS + WindLayerInterp.SNAKE_LENGTH;
    this.animationPhase = (this.animationPhase + deltaTime * animationSpeed) % cycleLength;

    const uniforms = (this.material as any).uniforms;
    if (uniforms?.animationPhase) {
      uniforms.animationPhase.value = this.animationPhase;
    }
  }

  /**
   * Get number of seeds
   */
  getNumSeeds(): number {
    return this.seeds.length;
  }

  /**
   * Get current line width
   */
  getLineWidth(): number | undefined {
    return this.material?.linewidth;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    if (this.lines) {
      this.lines.geometry.dispose();
    }
    if (this.material) {
      this.material.dispose();
    }
  }
}
