import * as THREE from 'three';
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
  private lines: THREE.LineSegments | null = null;
  private windDataU: Uint16Array | null = null;
  private windDataV: Uint16Array | null = null;

  private static readonly LINE_STEPS = 32;  // Number of vertices per line
  private static readonly STEP_FACTOR = 0.000075; // Controls step size in spherical coordinates (half of 0.00015)

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

    // Trace from each seed
    for (const seed of this.seeds) {
      const line = this.traceLine(seed);

      // Add line segments (pairs of consecutive vertices)
      for (let i = 0; i < line.length - 1; i++) {
        positions.push(
          line[i].x, line[i].y, line[i].z,
          line[i + 1].x, line[i + 1].y, line[i + 1].z
        );
      }
    }

    // Create line geometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    // Create material - simple white lines
    const material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      depthTest: true
    });

    // Create line segments
    this.lines = new THREE.LineSegments(geometry, material);
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
   * Get number of seed points
   */
  getNumSeeds(): number {
    return this.seeds.length;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (this.lines) {
      this.lines.geometry.dispose();
      (this.lines.material as THREE.Material).dispose();
    }
  }
}
