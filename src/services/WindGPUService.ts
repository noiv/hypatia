import { TimeStep } from './Wind10mService';

/**
 * WindGPUService - Manages wind data loading for WebGPU compute
 * Loads all timesteps at once for GPU-based interpolation
 */
export class WindGPUService {
  private static readonly WIDTH = 1441;
  private static readonly HEIGHT = 721;

  /**
   * Load all timesteps for U and V components
   * Returns arrays of Uint16Array (fp16 data)
   */
  static async loadAllTimeSteps(
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

    console.log(`✅ Loaded ${timesteps.length} wind timesteps (${uData.length} U + ${vData.length} V)`);

    return { uData, vData };
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
    const expectedSize = this.WIDTH * this.HEIGHT * 2; // 2 bytes per fp16

    if (buffer.byteLength !== expectedSize) {
      throw new Error(
        `Invalid file size for ${path}: expected ${expectedSize} bytes, got ${buffer.byteLength}`
      );
    }

    return new Uint16Array(buffer);
  }

  /**
   * Calculate fractional time index from current time
   * Returns value between 0 and timesteps.length-1
   * Fractional part is used for interpolation
   */
  static timeToIndex(currentTime: Date, timesteps: TimeStep[]): number {
    const currentMs = currentTime.getTime();

    for (let i = 0; i < timesteps.length - 1; i++) {
      const step1 = this.parseTimeStep(timesteps[i]!);
      const step2 = this.parseTimeStep(timesteps[i + 1]!);

      if (currentMs >= step1.getTime() && currentMs <= step2.getTime()) {
        // Interpolate between i and i+1
        const total = step2.getTime() - step1.getTime();
        const elapsed = currentMs - step1.getTime();
        return i + (elapsed / total);
      }
    }

    // Out of range - clamp
    if (currentMs < this.parseTimeStep(timesteps[0]!).getTime()) {
      return 0;
    }

    return timesteps.length - 1;
  }

  /**
   * Parse timestep to Date object
   */
  private static parseTimeStep(step: TimeStep): Date {
    const year = parseInt(step.date.slice(0, 4));
    const month = parseInt(step.date.slice(4, 6)) - 1;
    const day = parseInt(step.date.slice(6, 8));
    const hour = parseInt(step.cycle.slice(0, 2));

    return new Date(Date.UTC(year, month, day, hour, 0, 0, 0));
  }

  /**
   * Get adjacent timestep indices and blend factor
   */
  static getAdjacentTimesteps(timeIndex: number): {
    index0: number;
    index1: number;
    blend: number;
  } {
    const index0 = Math.floor(timeIndex);
    const index1 = Math.ceil(timeIndex);
    const blend = timeIndex - index0;

    return { index0, index1, blend };
  }
}
