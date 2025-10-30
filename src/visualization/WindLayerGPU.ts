import * as THREE from 'three/webgpu';
import { Fn, uniform, texture, float, vec2, vec3, instancedArray, instanceIndex,
         mix, atan2, asin, cos, sin, clamp, mod, mul, add, sub, div } from 'three/tsl';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { EARTH_RADIUS_UNITS } from '../utils/constants';
import { generateRandomSphere } from '../utils/sphereSeeds';
import { Wind10mService, TimeStep } from '../services/Wind10mService';
import { WindGPUService } from '../services/WindGPUService';

/**
 * WindLayerGPU - WebGPU compute shader-based wind line tracing
 *
 * Uses hybrid rendering:
 * - WebGPU compute shader for line tracing (parallel, fast)
 * - WebGL LineSegments2 for rendering (existing pipeline)
 *
 * Updates lines only when time changes, zero overhead when static.
 */
export class WindLayerGPU {
  public group: THREE.Group;
  private seeds: THREE.Vector3[];
  private lines: LineSegments2 | null = null;
  private material: LineMaterial | null = null;

  // WebGPU compute
  private webgpuRenderer: THREE.WebGPURenderer | null = null;
  private computeWindLines: any = null; // ComputeNode
  private positionsBuffer: any = null; // Storage buffer
  private seedsBuffer: any = null;

  // Wind data
  private timesteps: TimeStep[] = [];
  private windDataU: Uint16Array[] = [];
  private windDataV: Uint16Array[] = [];
  private windTexturesU: THREE.DataTexture[] = [];
  private windTexturesV: THREE.DataTexture[] = [];

  // Uniforms
  private uniformWindU_t0: any;
  private uniformWindV_t0: any;
  private uniformWindU_t1: any;
  private uniformWindV_t1: any;
  private uniformTimeBlend: any;
  private uniformStepFactor: any;

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
    this.group.name = 'wind-layer-gpu';

    // Generate seed points
    this.seeds = generateRandomSphere(numSeeds, EARTH_RADIUS_UNITS);

    console.log(`🌬️  WindLayerGPU: Generated ${numSeeds} seed points`);
  }

  /**
   * Initialize WebGPU compute infrastructure
   */
  async initWebGPU(): Promise<void> {
    console.log('🌬️  Initializing WebGPU compute...');

    // Create offscreen canvas for compute-only renderer
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;

    // Create WebGPU renderer
    this.webgpuRenderer = new THREE.WebGPURenderer({ canvas });
    await this.webgpuRenderer.init();

    console.log('✅ WebGPU renderer initialized');
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

    // Create WebGPU textures for each timestep
    for (let i = 0; i < this.timesteps.length; i++) {
      this.windTexturesU.push(this.createWindTexture(uData[i]));
      this.windTexturesV.push(this.createWindTexture(vData[i]));
    }

    console.log(`✅ Created ${this.windTexturesU.length} WebGPU wind textures`);
  }

  /**
   * Create WebGPU DataTexture from wind data
   */
  private createWindTexture(data: Uint16Array): THREE.DataTexture {
    const texture = new THREE.DataTexture(
      data,
      1441, // WIDTH
      721,  // HEIGHT
      THREE.RedFormat,
      THREE.HalfFloatType
    );

    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;

    return texture;
  }

  /**
   * Setup compute shader for wind line tracing
   */
  setupComputeShader(): void {
    if (!this.webgpuRenderer) {
      throw new Error('WebGPU not initialized');
    }

    const lineCount = this.seeds.length;
    const totalVertices = lineCount * WindLayerGPU.LINE_STEPS;

    // Create storage buffers
    const seedsData = new Float32Array(lineCount * 3);
    for (let i = 0; i < lineCount; i++) {
      seedsData[i * 3 + 0] = this.seeds[i].x;
      seedsData[i * 3 + 1] = this.seeds[i].y;
      seedsData[i * 3 + 2] = this.seeds[i].z;
    }

    this.seedsBuffer = instancedArray(lineCount, 'vec3');
    this.positionsBuffer = instancedArray(totalVertices, 'vec3');

    // Initialize uniforms
    this.uniformWindU_t0 = uniform(texture(this.windTexturesU[0]));
    this.uniformWindV_t0 = uniform(texture(this.windTexturesV[0]));
    this.uniformWindU_t1 = uniform(texture(this.windTexturesU[0]));
    this.uniformWindV_t1 = uniform(texture(this.windTexturesV[0]));
    this.uniformTimeBlend = uniform(0.0);
    this.uniformStepFactor = uniform(WindLayerGPU.STEP_FACTOR);

    // Define compute shader
    this.computeWindLines = Fn(() => {
      const lineId = instanceIndex;
      const seed = this.seedsBuffer.element(lineId);

      let pos = vec3(seed);

      // Trace 32 steps
      for (let step = 0; step < WindLayerGPU.LINE_STEPS; step++) {
        // Store current position
        const vertexId = mul(lineId, WindLayerGPU.LINE_STEPS).add(step);
        this.positionsBuffer.element(vertexId).assign(pos);

        // Convert cartesian to lat/lon
        const normalized = pos.normalize();
        const lon = atan2(normalized.z, normalized.x);
        const lat = asin(normalized.y);

        // Transform coordinates (match rain layer)
        const PI = float(3.14159265);
        const TWO_PI = float(6.28318530718);

        let u = mod(sub(lon, 1.57079632).add(PI), TWO_PI).div(TWO_PI);
        u = sub(1.0, u); // Mirror horizontally
        const v = sub(1.0, add(lat, 1.57079632).div(PI));

        const uv = vec2(u, v);

        // Sample wind at both timesteps with bilinear interpolation
        const windU0 = texture(this.uniformWindU_t0, uv).r;
        const windV0 = texture(this.uniformWindV_t0, uv).r;
        const windU1 = texture(this.uniformWindU_t1, uv).r;
        const windV1 = texture(this.uniformWindV_t1, uv).r;

        // Interpolate between timesteps
        const windU = mix(windU0, windU1, this.uniformTimeBlend);
        const windV = mix(windV0, windV1, this.uniformTimeBlend);

        // Update spherical coordinates
        const r = pos.length();
        let theta = atan2(normalized.z, normalized.x);
        let phi = add(asin(div(normalized.y, r)), 1.57079632); // 0 to PI

        // Latitude convergence adjustment
        const latRad = lat;
        const uAdjusted = div(windU, cos(latRad));

        theta = add(theta, mul(uAdjusted, this.uniformStepFactor));
        phi = sub(phi, mul(windV, this.uniformStepFactor));

        // Clamp phi to valid range
        phi = clamp(phi, 0.01, 3.13159);

        // Convert back to cartesian
        const sinPhi = sin(phi);
        pos.x = mul(mul(r, sinPhi), cos(theta));
        pos.y = mul(r, cos(phi));
        pos.z = mul(mul(r, sinPhi), sin(theta));
      }
    })().compute(lineCount);

    console.log(`✅ Compute shader created for ${lineCount} lines`);
  }

  /**
   * Update wind lines for current time
   */
  async updateTime(currentTime: Date): Promise<void> {
    if (this.timesteps.length === 0) return;
    if (!this.webgpuRenderer || !this.computeWindLines) return;

    // Calculate time index
    const timeIndex = WindGPUService.timeToIndex(currentTime, this.timesteps);

    // Only recompute if time changed
    if (Math.abs(timeIndex - this.lastTimeIndex) < 0.001) {
      return; // No change, skip compute
    }

    this.lastTimeIndex = timeIndex;

    // Get adjacent timesteps and blend factor
    const { index0, index1, blend } = WindGPUService.getAdjacentTimesteps(timeIndex);

    // Update uniforms
    this.uniformWindU_t0.value = this.windTexturesU[index0];
    this.uniformWindV_t0.value = this.windTexturesV[index0];
    this.uniformWindU_t1.value = this.windTexturesU[index1];
    this.uniformWindV_t1.value = this.windTexturesV[index1];
    this.uniformTimeBlend.value = blend;

    console.log(`🌬️  Computing wind lines: t=${timeIndex.toFixed(2)} (${index0}→${index1}, blend=${blend.toFixed(2)})`);

    // Run compute shader
    const startTime = performance.now();
    await this.webgpuRenderer.computeAsync(this.computeWindLines);
    const computeTime = performance.now() - startTime;

    console.log(`✅ Compute complete in ${computeTime.toFixed(2)}ms`);

    // Read positions back from GPU and update LineSegments2
    await this.updateLineGeometry();
  }

  /**
   * Read compute results and update LineSegments2 geometry
   */
  private async updateLineGeometry(): Promise<void> {
    if (!this.webgpuRenderer) return;

    const lineCount = this.seeds.length;
    const totalVertices = lineCount * WindLayerGPU.LINE_STEPS;

    // Read positions from storage buffer
    // Note: This is a simplified placeholder - actual implementation depends on THREE.js WebGPU API
    // For now, we'll reconstruct lines on CPU (fallback approach)

    console.warn('⚠️  GPU→CPU readback not yet implemented, using CPU tracing as fallback');
    this.traceLinesOnCPU();
  }

  /**
   * Fallback: Trace lines on CPU (temporary until GPU readback is working)
   */
  private traceLinesOnCPU(): void {
    if (this.windDataU.length === 0 || this.windDataV.length === 0) return;

    const { index0, index1, blend } = WindGPUService.getAdjacentTimesteps(this.lastTimeIndex);

    const positions: number[] = [];
    const colors: number[] = [];

    // Trace from each seed
    for (const seed of this.seeds) {
      const line = this.traceLine(seed, this.windDataU[index0], this.windDataV[index0],
                                         this.windDataU[index1], this.windDataV[index1], blend);

      const cycleLength = WindLayerGPU.LINE_STEPS + WindLayerGPU.SNAKE_LENGTH;
      const randomOffset = Math.random() * cycleLength;

      // Add line segments
      for (let i = 0; i < line.length - 1; i++) {
        const segmentIndex = i;
        const totalSegments = line.length - 1;

        let taperFactor = 1.0;
        const remainingSegments = totalSegments - segmentIndex;
        if (remainingSegments <= WindLayerGPU.TAPER_SEGMENTS) {
          taperFactor = remainingSegments / WindLayerGPU.TAPER_SEGMENTS;
        }

        positions.push(
          line[i].x, line[i].y, line[i].z,
          line[i + 1].x, line[i + 1].y, line[i + 1].z
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

    for (let step = 0; step < WindLayerGPU.LINE_STEPS; step++) {
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
      spherical.theta += uAdjusted * WindLayerGPU.STEP_FACTOR;
      spherical.phi -= windV * WindLayerGPU.STEP_FACTOR;
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
      linewidth: WindLayerGPU.LINE_WIDTH,
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
      snakeLength: { value: WindLayerGPU.SNAKE_LENGTH },
      lineSteps: { value: WindLayerGPU.LINE_STEPS }
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
    const cycleLength = WindLayerGPU.LINE_STEPS + WindLayerGPU.SNAKE_LENGTH;
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
    if (this.webgpuRenderer) {
      this.webgpuRenderer.dispose();
    }
  }
}
