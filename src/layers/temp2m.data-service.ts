import * as THREE from 'three';
import type { DatasetInfo } from '../config';

export interface TimeStep {
  date: string;    // YYYYMMDD
  cycle: string;   // 00z, 06z, 12z, 18z
  filePath: string;
}

export class Temp2mDataService {
  private static readonly WIDTH = 1441; // Includes wrapping column
  private static readonly HEIGHT = 721;
  private static readonly BYTES_PER_FLOAT16 = 2; // fp16 = 2 bytes
  private static readonly NO_DATA_SENTINEL = 0xFFFF; // Max fp16 value, never reached by real temp data
  private readonly EXPECTED_SIZE: number;

  constructor(
    private readonly datasetInfo: DatasetInfo,
    private readonly dataBaseUrl: string,
    private readonly paramName: string
  ) {
    this.EXPECTED_SIZE = Temp2mDataService.WIDTH * Temp2mDataService.HEIGHT * Temp2mDataService.BYTES_PER_FLOAT16;
  }

  /**
   * Generate list of time steps from maxRangeDays config (not dataset range)
   * Creates timesteps centered at currentTime ± (maxRangeDays/2)
   */
  generateTimeSteps(currentTime: Date, maxRangeDays: number): TimeStep[] {
    const steps: TimeStep[] = [];

    // Parse step (e.g., "6h" -> 6)
    const stepHours = parseInt(this.datasetInfo.step);

    // Calculate first day: currentTime - floor(maxRangeDays / 2) days
    const daysBack = Math.floor(maxRangeDays / 2);
    const startDate = new Date(currentTime);
    startDate.setUTCDate(startDate.getUTCDate() - daysBack);
    startDate.setUTCHours(0, 0, 0, 0); // Start at 00z

    // Calculate end time: first day + maxRangeDays
    const endDate = new Date(startDate);
    endDate.setUTCDate(endDate.getUTCDate() + maxRangeDays);

    // Generate timesteps (exactly maxRangeDays * 4 = 60 for 15 days)
    const current = new Date(startDate);
    while (current < endDate) {
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

    console.log(`${this.paramName}: ${steps.length} timesteps (maxRangeDays=${maxRangeDays})`);

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
   * Note: Data files are stored as fp16, we keep them as-is for GPU
   * Note: Data files already include wrapping column (1441 columns)
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
   * Load all time steps and create a Data3DTexture with native fp16 support
   */
  async loadTexture(steps: TimeStep[], onProgress?: (loaded: number, total: number) => void): Promise<THREE.Data3DTexture> {
    const depth = steps.length;
    const totalSize = Temp2mDataService.WIDTH * Temp2mDataService.HEIGHT * depth;
    const data = new Uint16Array(totalSize);

    // Load each time step
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step) continue;

      try {
        const layerData = await this.loadBinaryFile(step.filePath);

        // Copy into the 3D texture data array
        const offset = i * Temp2mDataService.WIDTH * Temp2mDataService.HEIGHT;
        data.set(layerData, offset);

        if (onProgress) {
          onProgress(i + 1, steps.length);
        }
      } catch (error) {
        console.warn(`Failed to load ${step.filePath}:`, error);
        // Leave as zeros (will be handled as NODATA in shader)
      }
    }

    // Create Data3DTexture with HalfFloatType for native fp16 support
    // This saves 50% GPU memory compared to FloatType
    const texture = new THREE.Data3DTexture(data, Temp2mDataService.WIDTH, Temp2mDataService.HEIGHT, depth);
    texture.format = THREE.RedFormat;
    texture.type = THREE.HalfFloatType; // Use fp16 natively
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping; // Use repeat to handle dateline wrapping
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;

    return texture;
  }

  /**
   * Calculate time index (0 to steps.length-1) from current time
   */
  timeToIndex(currentTime: Date, steps: TimeStep[]): number {
    // Find the two closest time steps
    const currentMs = currentTime.getTime();

    for (let i = 0; i < steps.length - 1; i++) {
      const stepA = steps[i];
      const stepB = steps[i + 1];
      if (!stepA || !stepB) continue;

      const step1 = this.parseTimeStep(stepA);
      const step2 = this.parseTimeStep(stepB);

      if (currentMs >= step1.getTime() && currentMs <= step2.getTime()) {
        // Interpolate between i and i+1
        const total = step2.getTime() - step1.getTime();
        const elapsed = currentMs - step1.getTime();
        return i + (elapsed / total);
      }
    }

    // Out of range - clamp
    const firstStep = steps[0];
    if (firstStep && currentMs < this.parseTimeStep(firstStep).getTime()) {
      return -1; // Before first step
    }

    return steps.length; // After last step
  }

  /**
   * Parse time step into Date object (in UTC)
   */
  private parseTimeStep(step: TimeStep): Date {
    const year = parseInt(step.date.slice(0, 4));
    const month = parseInt(step.date.slice(4, 6)) - 1;
    const day = parseInt(step.date.slice(6, 8));
    const hour = parseInt(step.cycle.slice(0, 2));

    return new Date(Date.UTC(year, month, day, hour, 0, 0, 0));
  }

  // ============================================================================
  // Progressive Loading Methods
  // ============================================================================

  /**
   * Create empty 3D texture with NO_DATA sentinel values
   * Used for progressive loading - texture created upfront, slices loaded on-demand
   */
  createEmptyTexture(depth: number): THREE.Data3DTexture {
    const totalSize = Temp2mDataService.WIDTH * Temp2mDataService.HEIGHT * depth;
    const data = new Uint16Array(totalSize);

    // Fill with sentinel value to indicate "no data loaded yet"
    data.fill(Temp2mDataService.NO_DATA_SENTINEL);

    // Create Data3DTexture with HalfFloatType
    const texture = new THREE.Data3DTexture(
      data,
      Temp2mDataService.WIDTH,
      Temp2mDataService.HEIGHT,
      depth
    );
    texture.format = THREE.RedFormat;
    texture.type = THREE.HalfFloatType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;

    return texture;
  }

  /**
   * Load a single timestamp and update texture slice
   * Used by LayerCacheControl for progressive loading
   */
  async loadTimestampIntoTexture(
    texture: THREE.Data3DTexture,
    step: TimeStep,
    index: number
  ): Promise<void> {
    try {
      const layerData = await this.loadBinaryFile(step.filePath);

      // Update slice in existing texture
      const offset = index * Temp2mDataService.WIDTH * Temp2mDataService.HEIGHT;
      const texData = texture.image.data as unknown as Uint16Array;
      texData.set(layerData, offset);

      // Mark texture for update on next render
      texture.needsUpdate = true;

      console.log(`Temp2m: Loaded timestamp ${index} (${step.date}_${step.cycle})`);
    } catch (error) {
      console.warn(`Temp2m: Failed to load ${step.filePath}:`, error);
      throw error;
    }
  }

  /**
   * Get the NO_DATA sentinel value for shader usage
   */
  static getNoDataSentinel(): number {
    return Temp2mDataService.NO_DATA_SENTINEL;
  }

  /**
   * Get grid dimensions
   */
  static getGridDimensions(): { width: number; height: number } {
    return {
      width: Temp2mDataService.WIDTH,
      height: Temp2mDataService.HEIGHT
    };
  }
}
