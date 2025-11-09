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
import { Temp2mDataService } from '../layers/temp2m.data-service';
import { PrecipitationDataService } from '../layers/precipitation.data-service';
import type { LayerId } from '../visualization/ILayer';
import { configLoader } from '../config';
import { getLayerCacheControl } from './LayerCacheControl';
import { generateTimeSteps } from '../utils/timeUtils';

// Re-export LayerId for convenience
export type { LayerId } from '../visualization/ILayer';

export class DataService {
  private cache: Map<LayerId, LayerData> = new Map();
  private loadingProgress: Map<LayerId, LoadProgress> = new Map();

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
   * Load layer with progressive loading (new method)
   * Creates empty texture, loads adjacent timestamps, queues rest
   */
  async loadLayerProgressive(
    layerId: LayerId,
    currentTime: Date,
    onProgress?: (progress: LoadProgress) => void
  ): Promise<LayerData> {
    // Return from cache if already loaded
    const cached = this.cache.get(layerId);
    if (cached) {
      return cached;
    }

    const cacheControl = getLayerCacheControl();
    let texture: THREE.Data3DTexture;
    let timeSteps: TimeStep[];
    let sizeBytes: number;
    let dataServiceInstance: Temp2mDataService | PrecipitationDataService;

    switch (layerId) {
      case 'temp2m': {
        const datasetInfo = configLoader.getDatasetInfo('temp2m');
        if (!datasetInfo) {
          throw new Error('temp2m dataset not found in manifest');
        }

        dataServiceInstance = new Temp2mDataService();

        // Generate timesteps using centralized timeUtils (SINGLE SOURCE OF TRUTH)
        const hypatiaConfig = configLoader.getHypatiaConfig();
        const maxRangeDays = hypatiaConfig.data.maxRangeDays;
        const stepHours = parseInt(datasetInfo.step); // e.g., "6h" -> 6
        timeSteps = generateTimeSteps(
          currentTime,
          maxRangeDays,
          stepHours,
          configLoader.getDataBaseUrl(),
          'temp2m'
        );

        // Create empty texture
        texture = dataServiceInstance.createEmptyTexture(timeSteps.length);
        sizeBytes = this.estimateTextureSize(texture);

        // Register with cache control
        cacheControl.registerLayer(layerId, timeSteps);

        // Listen to cache events and update texture
        cacheControl.on('fileLoadUpdate', async (event: any) => {
          console.log(`[DataService] fileLoadUpdate event for ${event.layerId}[${event.index}], hasData: ${!!event.data}`);
          if (event.layerId === layerId && event.data) {
            console.log(`[DataService] Loading ${layerId}[${event.index}] into texture`);
            await dataServiceInstance.loadTimestampIntoTexture(
              texture,
              event.timeStep,
              event.index
            );
          }
        });

        // Start progressive loading (loads ±1, queues rest)
        const progressWrapper = onProgress ? (loaded: number, total: number) => {
          onProgress({
            loaded,
            total,
            percentage: (loaded / total) * 100,
            currentItem: `Loading ${layerId} (${loaded}/${total})`
          });
        } : undefined;

        await cacheControl.initializeLayer(layerId, currentTime, progressWrapper);
        break;
      }

      case 'precipitation': {
        const datasetInfo = configLoader.getDatasetInfo('tprate');
        if (!datasetInfo) {
          throw new Error('tprate dataset not found in manifest');
        }

        dataServiceInstance = new PrecipitationDataService();

        // Generate timesteps using centralized timeUtils (SINGLE SOURCE OF TRUTH)
        const hypatiaConfig = configLoader.getHypatiaConfig();
        const maxRangeDays = hypatiaConfig.data.maxRangeDays;
        const stepHours = parseInt(datasetInfo.step); // e.g., "6h" -> 6
        timeSteps = generateTimeSteps(
          currentTime,
          maxRangeDays,
          stepHours,
          configLoader.getDataBaseUrl(),
          'tprate'
        );

        // Create empty texture
        texture = dataServiceInstance.createEmptyTexture(timeSteps.length);
        sizeBytes = this.estimateTextureSize(texture);

        // Register with cache control
        cacheControl.registerLayer(layerId, timeSteps);

        // Listen to cache events and update texture
        cacheControl.on('fileLoadUpdate', async (event: any) => {
          console.log(`[DataService] fileLoadUpdate event for ${event.layerId}[${event.index}], hasData: ${!!event.data}`);
          if (event.layerId === layerId && event.data) {
            console.log(`[DataService] Loading ${layerId}[${event.index}] into texture`);
            await dataServiceInstance.loadTimestampIntoTexture(
              texture,
              event.timeStep,
              event.index
            );
          }
        });

        // Start progressive loading
        const progressWrapper = onProgress ? (loaded: number, total: number) => {
          onProgress({
            loaded,
            total,
            percentage: (loaded / total) * 100,
            currentItem: `Loading ${layerId} (${loaded}/${total})`
          });
        } : undefined;

        await cacheControl.initializeLayer(layerId, currentTime, progressWrapper);
        break;
      }

      default:
        throw new Error(`Progressive loading not supported for ${layerId}`);
    }

    const layerData: LayerData = {
      layerId,
      texture,
      timeSteps,
      sizeBytes
    };

    this.cache.set(layerId, layerData);
    return layerData;
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
