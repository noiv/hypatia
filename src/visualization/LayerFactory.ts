import type * as THREE from 'three';
import type { ILayer, LayerId } from './ILayer';
import type { DataService } from '../services/DataService';
import { EarthLayer } from './EarthLayer';
import { SunLayer } from './SunLayer';
import { Temp2mLayer } from './Temp2mLayer';
import { PratesfcLayer } from './PratesfcLayer';
import { WindLayerGPUCompute } from './WindLayerGPUCompute';

/**
 * LayerFactory - Polymorphic factory for creating all layer types
 *
 * Centralizes layer creation logic and provides uniform async interface
 */
export class LayerFactory {
  /**
   * Create any layer by ID
   *
   * @param layerId - The layer to create
   * @param dataService - DataService for loading layer data
   * @param currentTime - Current simulation time
   * @param preloadedImages - Optional preloaded Earth basemap images
   * @param renderer - Optional WebGL renderer (required for wind layer)
   * @returns Promise resolving to ILayer instance
   */
  static async create(
    layerId: LayerId,
    dataService: DataService,
    currentTime: Date,
    preloadedImages?: Map<string, HTMLImageElement>,
    renderer?: THREE.WebGLRenderer
  ): Promise<ILayer> {
    switch (layerId) {
      case 'earth':
        return EarthLayer.create(preloadedImages);

      case 'sun':
        return SunLayer.create(currentTime, false); // Atmosphere shader disabled (not ready)

      case 'temp2m':
        return Temp2mLayer.create(dataService);

      case 'precipitation':
        return PratesfcLayer.create(dataService);

      case 'wind10m':
        if (!renderer) {
          throw new Error('Wind layer requires WebGL renderer');
        }
        const windLayer = new WindLayerGPUCompute();
        await windLayer.initGPU(renderer);
        await windLayer.loadWindData();
        return windLayer;

      default:
        // TypeScript exhaustiveness check
        const _exhaustive: never = layerId;
        throw new Error(`Unknown layer: ${_exhaustive}`);
    }
  }

  /**
   * Get list of all available layer IDs
   */
  static getAllLayerIds(): LayerId[] {
    return ['earth', 'sun', 'temp2m', 'precipitation', 'wind10m'];
  }

  /**
   * Get default layers that should be created on startup
   * Returns empty array - all layers are optional in dev mode
   */
  static getDefaultLayers(): LayerId[] {
    return [];
  }

  /**
   * Get optional layers that can be toggled by user
   */
  static getOptionalLayers(): LayerId[] {
    return ['earth', 'sun', 'temp2m', 'precipitation', 'wind10m'];
  }
}
