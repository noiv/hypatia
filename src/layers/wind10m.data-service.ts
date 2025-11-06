import * as THREE from 'three';
import type { DatasetInfo } from '../config';

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
export class Wind10mDataService {
  private static readonly WIDTH = 1441; // Includes wrapping column
  private static readonly HEIGHT = 721;
  private static readonly BYTES_PER_FLOAT16 = 2; // fp16 = 2 bytes
  private readonly EXPECTED_SIZE: number;

  constructor(
    private readonly uDatasetInfo: DatasetInfo,
    private readonly vDatasetInfo: DatasetInfo,
    private readonly dataBaseUrl: string,
    private readonly uParamName: string,
    private readonly vParamName: string
  ) {
    this.EXPECTED_SIZE = Wind10mDataService.WIDTH * Wind10mDataService.HEIGHT * Wind10mDataService.BYTES_PER_FLOAT16;

    // Validate U and V have same range
    if (this.uDatasetInfo.range !== this.vDatasetInfo.range) {
      throw new Error(`Wind U and V components must have same range: U=${this.uDatasetInfo.range}, V=${this.vDatasetInfo.range}`);
    }
  }

  /**
   * Generate list of time steps from compact manifest format
   * Parses range "20251030_00z-20251107_18z" with step "6h"
   */
  generateTimeSteps(): TimeStep[] {
    const steps: TimeStep[] = [];

    // Parse range: "20251030_00z-20251107_18z"
    const rangeParts = this.uDatasetInfo.range.split('-');
    if (rangeParts.length !== 2) {
      throw new Error(`Invalid range format: ${this.uDatasetInfo.range}`);
    }
    const startStr = rangeParts[0];
    const endStr = rangeParts[1];
    if (!startStr || !endStr) {
      throw new Error(`Invalid range format: ${this.uDatasetInfo.range}`);
    }
    const startDate = this.parseTimestamp(startStr);
    const endDate = this.parseTimestamp(endStr);

    // Parse step (e.g., "6h" -> 6)
    const stepHours = parseInt(this.uDatasetInfo.step);

    // Generate timesteps
    const current = new Date(startDate);
    while (current <= endDate) {
      const year = current.getUTCFullYear();
      const month = String(current.getUTCMonth() + 1).padStart(2, '0');
      const day = String(current.getUTCDate()).padStart(2, '0');
      const hour = String(current.getUTCHours()).padStart(2, '0');

      const dateStr = `${year}${month}${day}`;
      const cycle = `${hour}z`;

      steps.push({
        date: dateStr,
        cycle,
        uFilePath: `${this.dataBaseUrl}/${this.uParamName}/${dateStr}_${cycle}.bin`,
        vFilePath: `${this.dataBaseUrl}/${this.vParamName}/${dateStr}_${cycle}.bin`
      });

      // Increment by step hours
      current.setUTCHours(current.getUTCHours() + stepHours);
    }

    console.log(`${this.uParamName}+${this.vParamName}: ${steps.length} timesteps (${this.uDatasetInfo.range})`);

    return steps;
  }

  /**
   * Parse timestamp like "20251030_00z" into Date
   */
  private parseTimestamp(timestamp: string): Date {
    const parts = timestamp.split('_');
    if (parts.length !== 2) {
      throw new Error(`Invalid timestamp format: ${timestamp}`);
    }

    const dateStr = parts[0];
    const cycleStr = parts[1];

    if (!dateStr || !cycleStr) {
      throw new Error(`Invalid timestamp format: ${timestamp}`);
    }

    const year = parseInt(dateStr.slice(0, 4));
    const month = parseInt(dateStr.slice(4, 6)) - 1;
    const day = parseInt(dateStr.slice(6, 8));
    const hour = parseInt(cycleStr.slice(0, 2));

    return new Date(Date.UTC(year, month, day, hour, 0, 0, 0));
  }

  /**
   * Load a single binary file as Uint16Array (fp16)
   */
  private async loadBinaryFile(path: string): Promise<Uint16Array> {
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
  async loadTimeStep(timestep: TimeStep): Promise<{ u: Uint16Array; v: Uint16Array }> {
    console.log(`Loading wind data for ${timestep.date} ${timestep.cycle}...`);

    const [u, v] = await Promise.all([
      this.loadBinaryFile(timestep.uFilePath),
      this.loadBinaryFile(timestep.vFilePath)
    ]);

    console.log(`Loaded wind U/V components (${u.length} values each)`);

    return { u, v };
  }

  /**
   * Load all timesteps for U and V components (for GPU-based interpolation)
   * Returns arrays of Uint16Array (fp16 data)
   */
  async loadAllTimeSteps(
    timesteps: TimeStep[],
    onProgress?: (loaded: number, total: number) => void
  ): Promise<{ uData: Uint16Array[], vData: Uint16Array[] }> {
    const uData: Uint16Array[] = [];
    const vData: Uint16Array[] = [];

    const totalFiles = timesteps.length * 2; // U + V for each timestep
    let loadedFiles = 0;

    for (let i = 0; i < timesteps.length; i++) {
      const timestep = timesteps[i]!;

      // Load U and V in parallel
      const [u, v] = await Promise.all([
        this.loadBinaryFile(timestep.uFilePath),
        this.loadBinaryFile(timestep.vFilePath)
      ]);

      uData.push(u);
      vData.push(v);

      loadedFiles += 2;
      if (onProgress) {
        onProgress(loadedFiles, totalFiles);
      }
    }

    console.log(`Loaded ${timesteps.length} wind timesteps (${uData.length} U + ${vData.length} V)`);

    return { uData, vData };
  }

  /**
   * Calculate fractional time index from current time
   * Returns value between 0 and timesteps.length-1
   * Fractional part is used for interpolation
   */
  timeToIndex(currentTime: Date, timesteps: TimeStep[]): number {
    const currentMs = currentTime.getTime();

    for (let i = 0; i < timesteps.length - 1; i++) {
      const step1 = this.parseTimeStepToDate(timesteps[i]!);
      const step2 = this.parseTimeStepToDate(timesteps[i + 1]!);

      if (currentMs >= step1.getTime() && currentMs <= step2.getTime()) {
        // Interpolate between i and i+1
        const total = step2.getTime() - step1.getTime();
        const elapsed = currentMs - step1.getTime();
        return i + (elapsed / total);
      }
    }

    // Out of range - clamp
    if (currentMs < this.parseTimeStepToDate(timesteps[0]!).getTime()) {
      return 0;
    }

    return timesteps.length - 1;
  }

  /**
   * Parse TimeStep to Date object
   */
  private parseTimeStepToDate(step: TimeStep): Date {
    const year = parseInt(step.date.slice(0, 4));
    const month = parseInt(step.date.slice(4, 6)) - 1;
    const day = parseInt(step.date.slice(6, 8));
    const hour = parseInt(step.cycle.slice(0, 2));

    return new Date(Date.UTC(year, month, day, hour, 0, 0, 0));
  }

  /**
   * Get adjacent timestep indices and blend factor
   */
  getAdjacentTimesteps(timeIndex: number): {
    index0: number;
    index1: number;
    blend: number;
  } {
    const index0 = Math.floor(timeIndex);
    const index1 = Math.ceil(timeIndex);
    const blend = timeIndex - index0;

    return { index0, index1, blend };
  }

  /**
   * Create a THREE.DataTexture from fp16 binary data
   * For wind components, we need to preserve sign and precision
   */
  createDataTexture(data: Uint16Array): THREE.DataTexture {
    const texture = new THREE.DataTexture(
      data as any,
      Wind10mDataService.WIDTH,
      Wind10mDataService.HEIGHT,
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
  sampleWind(u: Uint16Array, v: Uint16Array, lat: number, lon: number): { u: number; v: number } {
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
    const idx00 = y0 * Wind10mDataService.WIDTH + x0;
    const idx10 = y0 * Wind10mDataService.WIDTH + x1;
    const idx01 = y1 * Wind10mDataService.WIDTH + x0;
    const idx11 = y1 * Wind10mDataService.WIDTH + x1;

    // Decode fp16 to float32 for CPU-side calculations
    const u00 = this.fp16ToFloat32(u[idx00] ?? 0);
    const u10 = this.fp16ToFloat32(u[idx10] ?? 0);
    const u01 = this.fp16ToFloat32(u[idx01] ?? 0);
    const u11 = this.fp16ToFloat32(u[idx11] ?? 0);

    const v00 = this.fp16ToFloat32(v[idx00] ?? 0);
    const v10 = this.fp16ToFloat32(v[idx10] ?? 0);
    const v01 = this.fp16ToFloat32(v[idx01] ?? 0);
    const v11 = this.fp16ToFloat32(v[idx11] ?? 0);

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
  private fp16ToFloat32(h: number): number {
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
