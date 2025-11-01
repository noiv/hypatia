/**
 * Data Service
 *
 * Centralized data loading and caching for all weather layers.
 * Handles texture loading, time step management, and data streaming.
 *
 * Future Architecture:
 * - Streaming: Load data in chunks as needed (sliding time window)
 * - Partial loading: Load only visible time ranges
 * - Memory management: Evict old data when memory limits reached
 * - Multi-resolution: Load lower-res data first, upgrade to high-res
 * - Prefetching: Preload next time steps based on user interaction patterns
 */

import * as THREE from 'three';
import type { LayerData, TimeStep, LoadProgress } from '../config/types';
import { Temp2mService } from './Temp2mService';
import { PratesfcService } from './PratesfcService';

// Re-export LayerId for convenience
export type { LayerId } from '../visualization/ILayer';

export class DataService {
  private cache: Map<LayerId, LayerData> = new Map();
  private loadingProgress: Map<LayerId, LoadProgress> = new Map();

  /**
   * Load layer data (with caching)
   */
  async loadLayer(
    layerId: LayerId,
    onProgress?: (progress: LoadProgress) => void
  ): Promise<LayerData> {
    // Return from cache if already loaded
    const cached = this.cache.get(layerId);
    if (cached) {
      return cached;
    }

    // Initialize progress tracking
    this.loadingProgress.set(layerId, {
      loaded: 0,
      total: 100,
      percentage: 0,
      currentItem: `Loading ${layerId}...`
    });

    // Route to appropriate service based on layer ID
    let texture: THREE.Data3DTexture;
    let timeSteps: TimeStep[];
    let sizeBytes: number;

    const progressCallback = (loaded: number, total: number) => {
      const progress: LoadProgress = {
        loaded,
        total,
        percentage: (loaded / total) * 100,
        currentItem: `Loading ${layerId} (${loaded}/${total})`
      };
      this.loadingProgress.set(layerId, progress);
      if (onProgress) {
        onProgress(progress);
      }
    };

    switch (layerId) {
      case 'temp2m':
        timeSteps = Temp2mService.generateTimeSteps();
        texture = await Temp2mService.loadTexture(timeSteps, progressCallback);
        sizeBytes = this.estimateTextureSize(texture);
        break;

      case 'precipitation':
        timeSteps = PratesfcService.generateTimeSteps();
        texture = await PratesfcService.loadTexture(timeSteps, progressCallback);
        sizeBytes = this.estimateTextureSize(texture);
        break;

      case 'wind10m':
      case 'earth':
      case 'sun':
      case 'atmosphere':
        // These layers handle their own data loading
        throw new Error(`Layer ${layerId} does not use DataService for data loading`);

      default:
        throw new Error(`Unknown layer: ${layerId}`);
    }

    const layerData: LayerData = {
      layerId,
      texture,
      timeSteps,
      sizeBytes
    };

    this.cache.set(layerId, layerData);
    this.loadingProgress.delete(layerId);

    return layerData;
  }

  /**
   * Get layer data if already loaded (no loading)
   */
  getLayer(layerId: LayerId): LayerData | undefined {
    return this.cache.get(layerId);
  }

  /**
   * Check if layer is currently loading
   */
  isLoading(layerId: LayerId): boolean {
    return this.loadingProgress.has(layerId);
  }

  /**
   * Get loading progress for a layer
   */
  getLoadProgress(layerId: LayerId): LoadProgress | undefined {
    return this.loadingProgress.get(layerId);
  }

  /**
   * Get loading progress for multiple layers
   */
  getLoadProgressMultiple(layerIds: LayerId[]): Map<LayerId, LoadProgress> {
    const progress = new Map<LayerId, LoadProgress>();
    for (const layerId of layerIds) {
      const p = this.loadingProgress.get(layerId);
      if (p) {
        progress.set(layerId, p);
      }
    }
    return progress;
  }

  /**
   * Unload layer data from cache
   */
  unloadLayer(layerId: LayerId): void {
    const layerData = this.cache.get(layerId);
    if (layerData) {
      // Dispose THREE.js resources
      layerData.texture.dispose();
      this.cache.delete(layerId);
    }
  }

  /**
   * Get total memory usage across all cached layers
   */
  getTotalMemoryUsage(): number {
    let total = 0;
    for (const layerData of this.cache.values()) {
      total += layerData.sizeBytes;
    }
    return total;
  }

  /**
   * Get list of all loaded layer IDs
   */
  getLoadedLayers(): LayerId[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    for (const layerId of this.cache.keys()) {
      this.unloadLayer(layerId);
    }
  }

  /**
   * Estimate texture size in bytes
   */
  private estimateTextureSize(texture: THREE.Data3DTexture | THREE.DataTexture): number {
    const image = texture.image;
    if (!image) return 0;

    // Data3DTexture has width/height/depth
    if ('depth' in image) {
      const width = image.width || 0;
      const height = image.height || 0;
      const depth = image.depth || 0;

      // HalfFloatType = 2 bytes per value
      const bytesPerPixel = texture.type === THREE.HalfFloatType ? 2 : 4;
      return width * height * depth * bytesPerPixel;
    }

    // DataTexture has width/height only
    const width = image.width || 0;
    const height = image.height || 0;
    const bytesPerPixel = texture.type === THREE.HalfFloatType ? 2 : 4;
    return width * height * bytesPerPixel;
  }
}
