import type * as THREE from 'three';
import type { ILayer, LayerId } from './ILayer';
import type { DataService } from '../services/DataService';
import { EarthRenderService } from './earth.render-service';
import { SunRenderService } from './sun.render-service';
import { GraticuleRenderService } from './graticule.render-service';
import { Temp2mRenderService } from './temp2m.render-service';
import { PrecipitationRenderService } from './precipitation.render-service';
import { Wind10mRenderService } from './wind10m.render-service';
import { PressureRenderService } from './pressure.render-service';
import { TextRenderService } from './text.render-service';

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
        return EarthRenderService.create(layerId, preloadedImages);

      case 'sun':
        return SunRenderService.create(layerId, currentTime, false); // Atmosphere shader disabled (not ready)

      case 'graticule':
        return GraticuleRenderService.create(layerId);

      case 'temp2m':
        return Temp2mRenderService.create(layerId, dataService);

      case 'precipitation':
        return PrecipitationRenderService.create(layerId, dataService);

      case 'wind10m':
        // Renderer guaranteed to exist (WebGL2 checked during bootstrap)
        const windLayer = new Wind10mRenderService(layerId);
        await windLayer.initGPU(renderer!);
        await windLayer.loadWindData();
        return windLayer;

      case 'pressure':
        return PressureRenderService.create(layerId);

      case 'text':
        return TextRenderService.create(layerId);

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
    return ['earth', 'sun', 'graticule', 'temp2m', 'precipitation', 'wind10m', 'pressure', 'text'];
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
    return ['earth', 'sun', 'graticule', 'temp2m', 'precipitation', 'wind10m', 'pressure', 'text'];
  }
}
