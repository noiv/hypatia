import * as THREE from 'three';

export interface TimeStep {
  date: string;    // YYYYMMDD
  cycle: string;   // 00z, 06z, 12z, 18z
  filePath: string;
}

export class Temp2mService {
  private static readonly WIDTH = 1441; // Includes wrapping column
  private static readonly HEIGHT = 721;
  private static readonly BYTES_PER_FLOAT = 4;
  private static readonly EXPECTED_SIZE = Temp2mService.WIDTH * Temp2mService.HEIGHT * Temp2mService.BYTES_PER_FLOAT;

  /**
   * Generate list of time steps for the given delta
   */
  static generateTimeSteps(delta: number = 1, useLSM: boolean = false): TimeStep[] {
    const steps: TimeStep[] = [];
    const cycles = ['00z', '06z', '12z', '18z'];

    // TEMPORARY: Load land-sea mask for testing
    if (useLSM) {
      steps.push({
        date: '20251029',
        cycle: '00z',
        filePath: `/data/land_sea_mask/20251029_00z.bin`
      });
      return steps;
    }

    // Calculate date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let offset = -delta; offset <= delta; offset++) {
      const date = new Date(today);
      date.setDate(date.getDate() + offset);
      const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');

      for (const cycle of cycles) {
        steps.push({
          date: dateStr,
          cycle,
          filePath: `/data/temp2m/${dateStr}_${cycle}.bin`
        });
      }
    }

    return steps;
  }

  /**
   * Load a single binary file as Float32Array
   * Note: Data files already include wrapping column (1441 columns)
   */
  private static async loadBinaryFile(path: string): Promise<Float32Array> {
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

    // Data already includes wrapping column from Python processing
    return new Float32Array(buffer);
  }

  /**
   * Load all time steps and create a Data3DTexture
   */
  static async loadTexture(steps: TimeStep[], onProgress?: (loaded: number, total: number) => void): Promise<THREE.Data3DTexture> {
    const depth = steps.length;
    const totalSize = this.WIDTH * this.HEIGHT * depth;
    const data = new Float32Array(totalSize);

    // Load each time step
    for (let i = 0; i < steps.length; i++) {
      try {
        const layerData = await this.loadBinaryFile(steps[i].filePath);

        // Copy into the 3D texture data array
        const offset = i * this.WIDTH * this.HEIGHT;
        data.set(layerData, offset);

        if (onProgress) {
          onProgress(i + 1, steps.length);
        }
      } catch (error) {
        console.warn(`Failed to load ${steps[i].filePath}:`, error);
        // Leave as zeros (will be handled as NODATA in shader)
      }
    }

    // Create Data3DTexture
    const texture = new THREE.Data3DTexture(data, this.WIDTH, this.HEIGHT, depth);
    texture.format = THREE.RedFormat;
    texture.type = THREE.FloatType;
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
  static timeToIndex(currentTime: Date, steps: TimeStep[]): number {
    // Find the two closest time steps
    const currentMs = currentTime.getTime();

    for (let i = 0; i < steps.length - 1; i++) {
      const step1 = this.parseTimeStep(steps[i]);
      const step2 = this.parseTimeStep(steps[i + 1]);

      if (currentMs >= step1.getTime() && currentMs <= step2.getTime()) {
        // Interpolate between i and i+1
        const total = step2.getTime() - step1.getTime();
        const elapsed = currentMs - step1.getTime();
        return i + (elapsed / total);
      }
    }

    // Out of range - clamp
    if (currentMs < this.parseTimeStep(steps[0]).getTime()) {
      return -1; // Before first step
    }

    return steps.length; // After last step
  }

  /**
   * Parse time step into Date object
   */
  private static parseTimeStep(step: TimeStep): Date {
    const year = parseInt(step.date.slice(0, 4));
    const month = parseInt(step.date.slice(4, 6)) - 1;
    const day = parseInt(step.date.slice(6, 8));
    const hour = parseInt(step.cycle.slice(0, 2));

    return new Date(year, month, day, hour, 0, 0, 0);
  }
}
