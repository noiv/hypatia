import * as THREE from 'three';
import { DATA_MANIFEST } from '../manifest';

export interface TimeStep {
  date: string;    // YYYYMMDD
  cycle: string;   // 00z, 06z, 12z, 18z
  filePath: string;
}

export class Temp2mService {
  private static readonly WIDTH = 1441; // Includes wrapping column
  private static readonly HEIGHT = 721;
  private static readonly BYTES_PER_FLOAT16 = 2; // fp16 = 2 bytes
  private static readonly EXPECTED_SIZE = Temp2mService.WIDTH * Temp2mService.HEIGHT * Temp2mService.BYTES_PER_FLOAT16;

  /**
   * Generate list of time steps from manifest data
   */
  static generateTimeSteps(): TimeStep[] {
    const steps: TimeStep[] = [];
    const temp2mData = DATA_MANIFEST['temp2m'];

    if (!temp2mData) {
      console.warn('No temp2m data found in manifest');
      return steps;
    }

    // Parse start and end times from manifest
    const startTime = new Date(temp2mData.startTime);
    const endTime = new Date(temp2mData.endTime);

    // Generate timesteps at 6-hour intervals
    const current = new Date(startTime);
    while (current <= endTime) {
      const year = current.getUTCFullYear();
      const month = String(current.getUTCMonth() + 1).padStart(2, '0');
      const day = String(current.getUTCDate()).padStart(2, '0');
      const hour = String(current.getUTCHours()).padStart(2, '0');

      const dateStr = `${year}${month}${day}`;
      const cycle = `${hour}z`;
      const filePath = `/data/temp2m/${dateStr}_${cycle}.bin`;

      steps.push({
        date: dateStr,
        cycle,
        filePath
      });

      // Increment by 6 hours
      current.setUTCHours(current.getUTCHours() + 6);
    }

    console.log(`Temp2m: ${steps.length} timesteps (${startTime.toISOString()} to ${endTime.toISOString()})`);

    return steps;
  }

  /**
   * Load a single binary file as Uint16Array (fp16)
   * Note: Data files are stored as fp16, we keep them as-is for GPU
   * Note: Data files already include wrapping column (1441 columns)
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
   * Load all time steps and create a Data3DTexture with native fp16 support
   */
  static async loadTexture(steps: TimeStep[], onProgress?: (loaded: number, total: number) => void): Promise<THREE.Data3DTexture> {
    const depth = steps.length;
    const totalSize = this.WIDTH * this.HEIGHT * depth;
    const data = new Uint16Array(totalSize);

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

    // Create Data3DTexture with HalfFloatType for native fp16 support
    // This saves 50% GPU memory compared to FloatType
    const texture = new THREE.Data3DTexture(data, this.WIDTH, this.HEIGHT, depth);
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
   * Parse time step into Date object (in UTC)
   */
  private static parseTimeStep(step: TimeStep): Date {
    const year = parseInt(step.date.slice(0, 4));
    const month = parseInt(step.date.slice(4, 6)) - 1;
    const day = parseInt(step.date.slice(6, 8));
    const hour = parseInt(step.cycle.slice(0, 2));

    return new Date(Date.UTC(year, month, day, hour, 0, 0, 0));
  }
}
