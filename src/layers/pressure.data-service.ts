import type { DatasetInfo } from '../config';
import { PRESSURE_CONFIG } from '../config/pressure.config';

export interface TimeStep {
  date: string;    // YYYYMMDD
  cycle: string;   // 00z, 06z, 12z, 18z
  filePath: string;
}

/**
 * Pressure Data Service
 *
 * Loads MSL (mean sea level pressure) data at 2° resolution
 * Grid: 181×91 (with wrapping column for dateline continuity)
 */
export class PressureDataService {
  private static readonly WIDTH = PRESSURE_CONFIG.grid.width;   // From config
  private static readonly HEIGHT = PRESSURE_CONFIG.grid.height; // From config
  private static readonly BYTES_PER_FLOAT16 = 2; // fp16 = 2 bytes
  private readonly EXPECTED_SIZE: number;

  constructor(
    private readonly datasetInfo: DatasetInfo,
    private readonly dataBaseUrl: string,
    private readonly paramName: string
  ) {
    this.EXPECTED_SIZE = PressureDataService.WIDTH * PressureDataService.HEIGHT * PressureDataService.BYTES_PER_FLOAT16;
  }

  /**
   * Generate list of time steps from compact manifest format
   * Parses range "20251030_00z-20251107_18z" with step "6h"
   */
  generateTimeSteps(): TimeStep[] {
    const steps: TimeStep[] = [];

    // Parse range: "20251030_00z-20251107_18z"
    const rangeParts = this.datasetInfo.range.split('-');
    if (rangeParts.length !== 2) {
      throw new Error(`Invalid range format: ${this.datasetInfo.range}`);
    }
    const startStr = rangeParts[0];
    const endStr = rangeParts[1];
    if (!startStr || !endStr) {
      throw new Error(`Invalid range format: ${this.datasetInfo.range}`);
    }
    const startDate = this.parseTimestamp(startStr);
    const endDate = this.parseTimestamp(endStr);

    // Parse step (e.g., "6h" -> 6)
    const stepHours = parseInt(this.datasetInfo.step);

    // Generate timesteps
    const current = new Date(startDate);
    while (current <= endDate) {
      const year = current.getUTCFullYear();
      const month = String(current.getUTCMonth() + 1).padStart(2, '0');
      const day = String(current.getUTCDate()).padStart(2, '0');
      const hour = String(current.getUTCHours()).padStart(2, '0');

      const dateStr = `${year}${month}${day}`;
      const cycle = `${hour}z`;
      const filePath = `${this.dataBaseUrl}/${this.paramName}/${dateStr}_${cycle}.bin`;

      steps.push({
        date: dateStr,
        cycle,
        filePath
      });

      // Increment by step hours
      current.setUTCHours(current.getUTCHours() + stepHours);
    }

    console.log(`${this.paramName}: ${steps.length} timesteps (${this.datasetInfo.range})`);

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
   * Load a single binary file and decode fp16 to Float32Array
   * Worker needs Float32 for pressure interpolation and contour calculation
   */
  async loadPressureData(path: string): Promise<Float32Array> {
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

    // Decode fp16 to Float32
    const fp16Data = new Uint16Array(buffer);
    const float32Data = new Float32Array(fp16Data.length);

    for (let i = 0; i < fp16Data.length; i++) {
      const val = fp16Data[i];
      if (val !== undefined) {
        float32Data[i] = this.decodeFP16(val);
      }
    }

    return float32Data;
  }

  /**
   * Decode FP16 (half-precision float) to FP32
   * Based on IEEE 754 half-precision format
   */
  private decodeFP16(binary: number): number {
    const sign = (binary & 0x8000) >> 15;
    let exponent = (binary & 0x7C00) >> 10;
    let fraction = binary & 0x03FF;

    if (exponent === 0) {
      if (fraction === 0) {
        // Zero
        return sign ? -0 : 0;
      }
      // Subnormal
      return (sign ? -1 : 1) * Math.pow(2, -14) * (fraction / 1024);
    }

    if (exponent === 0x1F) {
      // Infinity or NaN
      return fraction ? NaN : sign ? -Infinity : Infinity;
    }

    // Normalized
    exponent -= 15;
    fraction /= 1024;
    return (sign ? -1 : 1) * Math.pow(2, exponent) * (1 + fraction);
  }

  /**
   * Load two adjacent timesteps for interpolation
   * Returns tuple [dataA, dataB]
   */
  async loadAdjacentTimesteps(
    steps: TimeStep[],
    index: number
  ): Promise<[Float32Array, Float32Array]> {
    const stepA = Math.floor(index);
    const stepB = Math.ceil(index);

    const timeStepA = steps[stepA];
    const timeStepB = steps[stepB];

    if (!timeStepA || !timeStepB) {
      throw new Error(`Invalid time index: ${index}`);
    }

    const [dataA, dataB] = await Promise.all([
      this.loadPressureData(timeStepA.filePath),
      this.loadPressureData(timeStepB.filePath)
    ]);

    return [dataA, dataB];
  }

  /**
   * Get grid dimensions
   */
  static getGridDimensions(): { width: number; height: number } {
    return {
      width: PressureDataService.WIDTH,
      height: PressureDataService.HEIGHT
    };
  }
}
