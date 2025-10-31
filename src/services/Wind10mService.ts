import * as THREE from 'three';
import { DATA_MANIFEST } from '../manifest';

export interface TimeStep {
  date: string;    // YYYYMMDD
  cycle: string;   // 00z, 06z, 12z, 18z
  uFilePath: string;
  vFilePath: string;
}

/**
 * Wind10m Service - Loads U and V wind component data at 10m above ground
 *
 * Data format:
 * - Resolution: 1441 x 721 (0.25° with wrapping column)
 * - Format: Float16 (fp16), 2 bytes per value
 * - U component: East-West wind velocity (m/s)
 * - V component: North-South wind velocity (m/s)
 */
export class Wind10mService {
  private static readonly WIDTH = 1441; // Includes wrapping column
  private static readonly HEIGHT = 721;
  private static readonly BYTES_PER_FLOAT16 = 2; // fp16 = 2 bytes
  private static readonly EXPECTED_SIZE = Wind10mService.WIDTH * Wind10mService.HEIGHT * Wind10mService.BYTES_PER_FLOAT16;

  /**
   * Generate list of time steps from manifest data
   */
  static generateTimeSteps(): TimeStep[] {
    const steps: TimeStep[] = [];
    const wind10m_uData = DATA_MANIFEST['wind10m_u'];
    const wind10m_vData = DATA_MANIFEST['wind10m_v'];

    if (!wind10m_uData || !wind10m_vData) {
      console.warn('No wind10m_u or wind10m_v data found in manifest');
      return steps;
    }

    // Parse start and end times from manifest
    const startTime = new Date(wind10m_uData.startTime);
    const endTime = new Date(wind10m_uData.endTime);

    // Generate timesteps at 6-hour intervals
    const current = new Date(startTime);
    while (current <= endTime) {
      const year = current.getUTCFullYear();
      const month = String(current.getUTCMonth() + 1).padStart(2, '0');
      const day = String(current.getUTCDate()).padStart(2, '0');
      const hour = String(current.getUTCHours()).padStart(2, '0');

      const dateStr = `${year}${month}${day}`;
      const cycle = `${hour}z`;

      steps.push({
        date: dateStr,
        cycle,
        uFilePath: `/data/wind10m_u/${dateStr}_${cycle}.bin`,
        vFilePath: `/data/wind10m_v/${dateStr}_${cycle}.bin`
      });

      // Increment by 6 hours
      current.setUTCHours(current.getUTCHours() + 6);
    }

    console.log(`Wind: ${steps.length} timesteps (${startTime.toISOString()} to ${endTime.toISOString()})`);

    return steps;
  }

  /**
   * Load a single binary file as Uint16Array (fp16)
   */
  private static async loadBinaryFile(path: string): Promise<Uint16Array> {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to load ${path}: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();

    if (buffer.byteLength !== this.EXPECTED_SIZE) {
      throw new Error(
        `Invalid file size for ${path}: expected ${this.EXPECTED_SIZE} bytes, got ${buffer.byteLength}`
      );
    }

    // Return as Uint16Array - WebGL will handle fp16 natively
    return new Uint16Array(buffer);
  }

  /**
   * Load U and V components for a single timestep
   * Returns both as Uint16Array for GPU processing
   */
  static async loadTimeStep(timestep: TimeStep): Promise<{ u: Uint16Array; v: Uint16Array }> {
    console.log(`Loading wind data for ${timestep.date} ${timestep.cycle}...`);

    const [u, v] = await Promise.all([
      this.loadBinaryFile(timestep.uFilePath),
      this.loadBinaryFile(timestep.vFilePath)
    ]);

    console.log(`✅ Loaded wind U/V components (${u.length} values each)`);

    return { u, v };
  }

  /**
   * Create a THREE.DataTexture from fp16 binary data
   * For wind components, we need to preserve sign and precision
   */
  static createDataTexture(data: Uint16Array): THREE.DataTexture {
    const texture = new THREE.DataTexture(
      data,
      this.WIDTH,
      this.HEIGHT,
      THREE.RedFormat,
      THREE.HalfFloatType
    );

    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;  // Allow wrapping for longitude
    texture.wrapT = THREE.ClampToEdgeWrapping; // Clamp latitude at poles
    texture.needsUpdate = true;

    return texture;
  }

  /**
   * Sample wind vector at a given lat/lon from U/V textures
   * Uses bilinear interpolation
   *
   * @param u U-component data (Uint16Array)
   * @param v V-component data (Uint16Array)
   * @param lat Latitude in degrees (-90 to 90)
   * @param lon Longitude in degrees (-180 to 180)
   * @returns {u, v} Wind vector in m/s
   */
  static sampleWind(u: Uint16Array, v: Uint16Array, lat: number, lon: number): { u: number; v: number } {
    // Convert lat/lon to texture coordinates
    // Longitude: -180 to 180 -> 0 to 1440 (wrapping column at 1440)
    // Latitude: 90 to -90 -> 0 to 720
    const x = ((lon + 180) % 360) / 360 * 1440;
    const y = (90 - lat) / 180 * 720;

    // Bilinear interpolation
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, 1440);
    const y1 = Math.min(y0 + 1, 720);

    const fx = x - x0;
    const fy = y - y0;

    // Sample 4 corners
    const idx00 = y0 * this.WIDTH + x0;
    const idx10 = y0 * this.WIDTH + x1;
    const idx01 = y1 * this.WIDTH + x0;
    const idx11 = y1 * this.WIDTH + x1;

    // Decode fp16 to float32 for CPU-side calculations
    const u00 = this.fp16ToFloat32(u[idx00]);
    const u10 = this.fp16ToFloat32(u[idx10]);
    const u01 = this.fp16ToFloat32(u[idx01]);
    const u11 = this.fp16ToFloat32(u[idx11]);

    const v00 = this.fp16ToFloat32(v[idx00]);
    const v10 = this.fp16ToFloat32(v[idx10]);
    const v01 = this.fp16ToFloat32(v[idx01]);
    const v11 = this.fp16ToFloat32(v[idx11]);

    // Bilinear interpolation
    const uInterp =
      u00 * (1 - fx) * (1 - fy) +
      u10 * fx * (1 - fy) +
      u01 * (1 - fx) * fy +
      u11 * fx * fy;

    const vInterp =
      v00 * (1 - fx) * (1 - fy) +
      v10 * fx * (1 - fy) +
      v01 * (1 - fx) * fy +
      v11 * fx * fy;

    return { u: uInterp, v: vInterp };
  }

  /**
   * Convert fp16 (stored as uint16) to float32
   * Based on IEEE 754 half-precision format
   */
  private static fp16ToFloat32(h: number): number {
    const sign = (h & 0x8000) >> 15;
    const exponent = (h & 0x7C00) >> 10;
    const fraction = h & 0x03FF;

    if (exponent === 0) {
      // Subnormal or zero
      return (sign ? -1 : 1) * Math.pow(2, -14) * (fraction / 1024);
    } else if (exponent === 0x1F) {
      // Infinity or NaN
      return fraction ? NaN : (sign ? -Infinity : Infinity);
    } else {
      // Normalized
      return (sign ? -1 : 1) * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
    }
  }
}
