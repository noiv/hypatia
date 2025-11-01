import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { EARTH_RADIUS_UNITS } from '../utils/constants';
import { generateRandomSphere } from '../utils/sphereSeeds';
import { Wind10mService } from '../services/Wind10mService';

/**
 * Wind Layer - Stage 2: Flow Line Visualization
 *
 * Traces wind vectors from seed points to create flow lines.
 * Each line follows the wind vector field for a fixed number of steps.
 */
export class WindLayer {
  public group: THREE.Group;
  private seeds: THREE.Vector3[];
  private lines: LineSegments2 | null = null;
  private material: LineMaterial | null = null;
  private windDataU: Uint16Array | null = null;
  private windDataV: Uint16Array | null = null;

  private static readonly LINE_STEPS = 32;  // Number of vertices per line
  private static readonly STEP_FACTOR = 0.00015; // Controls step size in spherical coordinates (doubled from 0.000075)
  private static readonly LINE_WIDTH = 2.0; // Line width in pixels
  private static readonly TAPER_SEGMENTS = 4; // Number of segments to taper at the end
  private static readonly SNAKE_LENGTH = 10; // Number of segments in the animated snake
  private animationPhase: number = 0; // Current animation phase (0 to cycleLength)

  constructor(numSeeds: number = 16384) {
    this.group = new THREE.Group();
    this.group.name = 'wind-layer';

    // Generate randomly distributed seed points with uniform distribution
    this.seeds = generateRandomSphere(numSeeds, EARTH_RADIUS_UNITS);

    console.log(`🌬️  Wind layer: Generated ${numSeeds} random seed points`);
  }

  /**
   * Load wind data and trace flow lines
   */
  async loadWindData(currentTime: Date): Promise<void> {
    // Generate timesteps and find closest match
    const timesteps = Wind10mService.generateTimeSteps();

    if (timesteps.length === 0) {
      throw new Error('No wind timesteps available');
    }

    // Find closest timestep to current time
    const targetTime = currentTime.getTime();
    const closest = timesteps.reduce((prev, curr) => {
      const prevTime = this.parseTimestep(prev).getTime();
      const currTime = this.parseTimestep(curr).getTime();
      return Math.abs(currTime - targetTime) < Math.abs(prevTime - targetTime) ? curr : prev;
    });

    console.log(`🌬️  Loading wind data for ${closest.date} ${closest.cycle}...`);

    // Load U and V components
    const { u, v } = await Wind10mService.loadTimeStep(closest);
    this.windDataU = u;
    this.windDataV = v;

    // Trace flow lines from seeds
    this.traceFlowLines();

    console.log(`🌬️  Flow lines traced from ${this.seeds.length} seeds`);
  }

  /**
   * Parse timestep to Date object
   */
  private parseTimestep(timestep: { date: string; cycle: string }): Date {
    const year = parseInt(timestep.date.substring(0, 4));
    const month = parseInt(timestep.date.substring(4, 6)) - 1;
    const day = parseInt(timestep.date.substring(6, 8));
    const hour = parseInt(timestep.cycle.replace('z', ''));

    return new Date(Date.UTC(year, month, day, hour));
  }

  /**
   * Trace flow lines from seed points following the wind vector field
   */
  private traceFlowLines(): void {
    if (!this.windDataU || !this.windDataV) {
      console.error('Wind data not loaded');
      return;
    }

    const positions: number[] = [];
    const colors: number[] = [];

    // Trace from each seed
    for (const seed of this.seeds) {
      const line = this.traceLine(seed);

      // Random offset for this line's animation (0 to cycleLength)
      const cycleLength = WindLayer.LINE_STEPS + WindLayer.SNAKE_LENGTH;
      const randomOffset = Math.random() * cycleLength;

      // Add line segments (pairs of consecutive vertices) with segment index data
      for (let i = 0; i < line.length - 1; i++) {
        const segmentIndex = i;
        const totalSegments = line.length - 1;

        const pt1 = line[i];
        const pt2 = line[i + 1];
        if (!pt1 || !pt2) continue;

        // Calculate taper factor for this segment (1.0 = full width, 0.0 = zero width)
        const remainingSegments = totalSegments - segmentIndex;
        let taperFactor = 1.0;

        if (remainingSegments <= WindLayer.TAPER_SEGMENTS) {
          // Linear taper in the last N segments
          taperFactor = remainingSegments / WindLayer.TAPER_SEGMENTS;
        }

        // Add segment start and end positions
        positions.push(
          pt1.x, pt1.y, pt1.z,
          pt2.x, pt2.y, pt2.z
        );

        // Store segment data in color channels:
        // R: segment index (normalized 0-1)
        // G: random offset for this line (normalized 0-1)
        // B: taper factor
        const normalizedIndex = segmentIndex / totalSegments;
        const normalizedOffset = randomOffset / cycleLength;
        colors.push(
          normalizedIndex, normalizedOffset, taperFactor,  // Start vertex
          normalizedIndex, normalizedOffset, taperFactor   // End vertex
        );
      }
    }

    // Create LineSegmentsGeometry
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    geometry.setColors(colors);

    // Create LineMaterial
    this.material = new LineMaterial({
      color: 0xffffff,
      linewidth: WindLayer.LINE_WIDTH,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      depthTest: true,
      alphaToCoverage: false
    });

    // Set initial resolution (will be updated by Scene on resize)
    this.material.resolution.set(window.innerWidth, window.innerHeight);

    // Add uniforms directly to material
    (this.material as any).uniforms = {
      ...this.material.uniforms,
      animationPhase: { value: 0.0 },
      snakeLength: { value: WindLayer.SNAKE_LENGTH },
      lineSteps: { value: WindLayer.LINE_STEPS }
    };

    // Add custom shader code for snake animation
    this.material.onBeforeCompile = (shader) => {
      // Link shader uniforms to material uniforms
      shader.uniforms.animationPhase = (this.material as any).uniforms.animationPhase;
      shader.uniforms.snakeLength = (this.material as any).uniforms.snakeLength;
      shader.uniforms.lineSteps = (this.material as any).uniforms.lineSteps;

      // Modify fragment shader to add snake animation
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        `
        uniform float animationPhase;
        uniform float snakeLength;
        uniform float lineSteps;

        void main() {
        `
      );

      // Try to find where to inject the animation code - look for gl_FragColor assignment
      if (shader.fragmentShader.includes('gl_FragColor =')) {
        shader.fragmentShader = shader.fragmentShader.replace(
          /gl_FragColor = vec4\( diffuseColor\.rgb, alpha \);/,
          `
          // Extract segment data from vColor (RGB channels)
          float normalizedIndex = vColor.r;
          float normalizedOffset = vColor.g;
          float taperFactor = vColor.b;

          // Calculate cycle length (lineSteps + snakeLength)
          float cycleLength = lineSteps + snakeLength;

          // Denormalize values
          float segmentIndex = normalizedIndex * (lineSteps - 1.0);
          float randomOffset = normalizedOffset * cycleLength;

          // Calculate position of snake head (wraps around) with random offset
          float snakeHead = mod(animationPhase + randomOffset, cycleLength);

          // Calculate distance from segment to snake head
          float distanceFromHead = segmentIndex - snakeHead;

          // Handle wrapping (snake can wrap around the end)
          if (distanceFromHead < -snakeLength) {
            distanceFromHead += cycleLength;
          }

          // Calculate opacity based on distance from head
          float segmentOpacity = 0.0;
          if (distanceFromHead >= -snakeLength && distanceFromHead <= 0.0) {
            // Inside snake: fade from 0 at tail to 1 at head
            float positionInSnake = (distanceFromHead + snakeLength) / snakeLength;
            segmentOpacity = positionInSnake;
          }

          // Apply opacity and taper factor, reset color to white
          float finalAlpha = alpha * segmentOpacity * taperFactor;
          gl_FragColor = vec4( vec3(1.0), finalAlpha );
          `
        );
      }
    };

    // Create LineSegments2
    this.lines = new LineSegments2(geometry, this.material);
    this.group.add(this.lines);

    console.log(`🌬️  Created ${this.seeds.length} flow lines with ${positions.length / 6} segments`);
  }

  /**
   * Trace a single line from a seed point following wind vectors
   */
  private traceLine(seed: THREE.Vector3): THREE.Vector3[] {
    const vertices: THREE.Vector3[] = [];
    let currentPos = seed.clone();

    for (let step = 0; step < WindLayer.LINE_STEPS; step++) {
      vertices.push(currentPos.clone());

      // Convert cartesian to lat/lon
      const { lat, lon } = this.cartesianToLatLon(currentPos);

      // Sample wind at current position
      const wind = Wind10mService.sampleWind(this.windDataU!, this.windDataV!, lat, lon);

      // Check for invalid wind data
      if (isNaN(wind.u) || isNaN(wind.v)) {
        break;
      }

      // Update position using spherical coordinates
      const spherical = new THREE.Spherical();
      spherical.setFromVector3(currentPos);

      // Apply wind vector
      // U component affects longitude (theta)
      // V component affects latitude (phi)
      // Adjust U for latitude convergence
      const uAdjusted = wind.u / Math.cos(lat * Math.PI / 180);

      spherical.theta += uAdjusted * WindLayer.STEP_FACTOR;
      spherical.phi -= wind.v * WindLayer.STEP_FACTOR;

      // Clamp phi to valid range [0, PI]
      spherical.phi = Math.max(0.01, Math.min(Math.PI - 0.01, spherical.phi));

      // Update position
      currentPos.setFromSpherical(spherical);
    }

    return vertices;
  }

  /**
   * Convert cartesian coordinates to lat/lon
   * Must match the rain layer's coordinate system:
   * - 90° west rotation
   * - Horizontal mirror
   */
  private cartesianToLatLon(v: THREE.Vector3): { lat: number; lon: number } {
    const normalized = v.clone().normalize();

    // Convert to spherical - matching rain layer shader
    const lon = Math.atan2(normalized.z, normalized.x); // atan(z, x)
    const lat = Math.asin(normalized.y); // asin(y)

    // Apply rain layer transformation
    // Rotate 90 degrees west: lon - PI/2
    // Then normalize to 0-1 and mirror: u = 1.0 - ((lon - PI/2 + PI) / TWO_PI)
    // Simplified: u = 1.0 - ((lon + PI/2) / TWO_PI)
    // Convert back: lon_texture = (1 - u) * 360 - 180

    const PI = Math.PI;
    let u = ((lon - PI/2) + PI) / (2 * PI);
    u = 1.0 - u; // Mirror horizontally

    // Latitude: north pole (y=1) -> V=0, south pole (y=-1) -> V=1
    // v = 1.0 - ((lat + PI/2) / PI)

    // Convert to degrees for sampling
    const lonDeg = u * 360 - 180; // -180 to 180
    const latDeg = lat * 180 / PI; // -90 to 90

    return { lat: latDeg, lon: lonDeg };
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
   * Update resolution for LineMaterial (call on window resize)
   */
  setResolution(width: number, height: number): void {
    if (this.material) {
      this.material.resolution.set(width, height);
    }
  }

  /**
   * Update line width based on camera altitude
   * @param cameraDistance Distance from camera to origin (Earth center)
   */
  updateLineWidth(cameraDistance: number): void {
    if (!this.material) return;

    // Earth radius is 1.0 in our units
    // Camera distance ranges from ~1.157 (min) to 10 (max)
    // Map this to line width: 2px at low altitude, 0.02px at high altitude
    const minDistance = 1.157;
    const maxDistance = 10.0;
    const minWidth = 2.0;
    const maxWidth = 0.02;

    // Logarithmic interpolation for more natural feel
    // Use log scale since altitude changes exponentially with zoom
    const t = (Math.log(cameraDistance) - Math.log(minDistance)) /
              (Math.log(maxDistance) - Math.log(minDistance));
    const clampedT = Math.max(0, Math.min(1, t));
    const lineWidth = minWidth + (maxWidth - minWidth) * clampedT;

    this.material.linewidth = lineWidth;
  }

  /**
   * Get number of seed points
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
   * Update animation phase for snake effect
   * Call this every frame with deltaTime in seconds
   */
  updateAnimation(deltaTime: number): void {
    if (!this.material) return;

    // Animation speed: segments per second
    const animationSpeed = 20.0;

    // Update phase
    const cycleLength = WindLayer.LINE_STEPS + WindLayer.SNAKE_LENGTH;
    this.animationPhase = (this.animationPhase + deltaTime * animationSpeed) % cycleLength;

    // Update uniform on material
    const uniforms = (this.material as any).uniforms;
    if (uniforms?.animationPhase) {
      uniforms.animationPhase.value = this.animationPhase;
    }
  }

  /**
   * Dispose of resources
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
