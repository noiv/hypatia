import * as THREE from 'three';
import type { TimeStep } from '../config/types';

export class Temp2mDataService {
  private static readonly WIDTH = 1441; // Includes wrapping column
  private static readonly HEIGHT = 721;
  private static readonly BYTES_PER_FLOAT16 = 2; // fp16 = 2 bytes
  private static readonly NO_DATA_SENTINEL = 0xFFFF; // Max fp16 value, never reached by real temp data
  private readonly EXPECTED_SIZE: number;

  constructor() {
    // Data service no longer needs constructor params - timesteps generated centrally by app
    this.EXPECTED_SIZE = Temp2mDataService.WIDTH * Temp2mDataService.HEIGHT * Temp2mDataService.BYTES_PER_FLOAT16;
  }

  // Removed: generateTimeSteps() - now using utils/timeUtils.ts
  // App/bootstrap generates timesteps centrally and passes to all layers

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

  // Removed: timeToIndex() and parseTimeStep() - now using utils/timeUtils.ts
  // This ensures consistent calculations across bootstrap and rendering

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

      // Suppress verbose logging (LayerCacheControl already logs critical loads)
      // console.log(`Temp2m: Loaded timestamp ${index} (${step.date}_${step.cycle})`);
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
