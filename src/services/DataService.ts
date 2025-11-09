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
      case 'temp2m': {
        const datasetInfo = configLoader.getDatasetInfo('temp2m');
        if (!datasetInfo) {
          throw new Error('temp2m dataset not found in manifest');
        }

        const service = new Temp2mDataService(
          datasetInfo,
          configLoader.getDataBaseUrl(),
          'temp2m'
        );
        timeSteps = service.generateTimeSteps();
        texture = await service.loadTexture(timeSteps, progressCallback);
        sizeBytes = this.estimateTextureSize(texture);
        break;
      }

      case 'precipitation': {
        const datasetInfo = configLoader.getDatasetInfo('tprate');
        if (!datasetInfo) {
          throw new Error('tprate dataset not found in manifest');
        }

        const service = new PrecipitationDataService(
          datasetInfo,
          configLoader.getDataBaseUrl(),
          'tprate'
        );
        timeSteps = service.generateTimeSteps();
        texture = await service.loadTexture(timeSteps, progressCallback);
        sizeBytes = this.estimateTextureSize(texture);
        break;
      }

      case 'wind10m': {
        const uDatasetInfo = configLoader.getDatasetInfo('wind10m_u');
        const vDatasetInfo = configLoader.getDatasetInfo('wind10m_v');
        if (!uDatasetInfo || !vDatasetInfo) {
          throw new Error('wind10m_u or wind10m_v dataset not found in manifest');
        }

        // Note: Wind layer has its own loading mechanism in WindLayerGPUCompute
        // Wind uses separate TimeStep type with uFilePath/vFilePath
        throw new Error(`Layer ${layerId} does not use DataService for texture loading yet`);
      }

      case 'earth':
      case 'sun':
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

        dataServiceInstance = new Temp2mDataService(
          datasetInfo,
          configLoader.getDataBaseUrl(),
          'temp2m'
        );
        timeSteps = dataServiceInstance.generateTimeSteps();

        // Create empty texture
        texture = dataServiceInstance.createEmptyTexture(timeSteps.length);
        sizeBytes = this.estimateTextureSize(texture);

        // Register with cache control
        cacheControl.registerLayer(layerId, timeSteps);

        // Listen to cache events and update texture
        cacheControl.on('timestampLoaded', async (event: any) => {
          if (event.layerId === layerId && event.data) {
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

        dataServiceInstance = new PrecipitationDataService(
          datasetInfo,
          configLoader.getDataBaseUrl(),
          'tprate'
        );
        timeSteps = dataServiceInstance.generateTimeSteps();

        // Create empty texture
        texture = dataServiceInstance.createEmptyTexture(timeSteps.length);
        sizeBytes = this.estimateTextureSize(texture);

        // Register with cache control
        cacheControl.registerLayer(layerId, timeSteps);

        // Listen to cache events and update texture
        cacheControl.on('timestampLoaded', async (event: any) => {
          if (event.layerId === layerId && event.data) {
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
