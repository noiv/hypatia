import type * as THREE from 'three';
import type { ILayer, LayerId } from './ILayer';
import type { DownloadService } from '../services/DownloadService';
import type { TextureService } from '../services/TextureService';
import type { DateTimeService } from '../services/DateTimeService';
import type { ConfigService } from '../services/ConfigService';
import { EarthRenderService } from './earth/earth.render-service';
import { SunRenderService } from './sun/sun.render-service';
import { GraticuleRenderService } from './graticule/graticule.render-service';
import { TextRenderService } from './text/text.render-service';

// New event-driven layers
import { TempLayer } from './temp/temp.layer';
import { RainLayer } from './rain/rain.layer';
import { WindLayer } from './wind/wind.layer';
import { PressureLayer } from './pressure/pressure.layer';

/**
 * LayerFactory - Polymorphic factory for creating all layer types
 *
 * Centralizes layer creation logic and provides uniform async interface
 * Updated to use new event-driven architecture for data layers
 */
export class LayerFactory {
  /**
   * Create any layer by ID
   *
   * @param layerId - The layer to create
   * @param downloadService - DownloadService for event-driven data loading
   * @param textureService - TextureService for GPU texture uploads
   * @param dateTimeService - DateTimeService for time calculations
   * @param configService - ConfigService for layer configuration
   * @param currentTime - Current simulation time
   * @param preloadedImages - Optional preloaded Earth basemap images
   * @param renderer - Optional WebGL renderer (required for wind layer WebGPU)
   * @returns Promise resolving to ILayer instance
   */
  static async create(
    layerId: LayerId,
    downloadService: DownloadService,
    textureService: TextureService,
    dateTimeService: DateTimeService,
    configService: ConfigService,
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

      case 'temp': {
        // Get timesteps from DateTimeService (generated once during bootstrap)
        const timeSteps = dateTimeService.getTimeSteps();

        // Create layer with services
        const layer = new TempLayer(
          layerId,
          timeSteps,
          downloadService,
          textureService,
          dateTimeService
        );

        // Register with DownloadService for event-driven loading
        downloadService.registerLayer(layerId, timeSteps);

        return layer;
      }

      case 'rain': {
        // Get timesteps from DateTimeService (generated once during bootstrap)
        const timeSteps = dateTimeService.getTimeSteps();

        // Create layer with services
        const layer = new RainLayer(
          layerId,
          timeSteps,
          downloadService,
          textureService,
          dateTimeService
        );

        // Register with DownloadService for event-driven loading
        downloadService.registerLayer(layerId, timeSteps);

        return layer;
      }

      case 'wind': {
        // Get timesteps from DateTimeService (generated once during bootstrap)
        const timeSteps = dateTimeService.getTimeSteps();

        // Wind layer doesn't use TextureService (uses WebGPU compute)
        const layer = new WindLayer(
          layerId,
          downloadService,
          dateTimeService,
          16384 // numSeeds
        );

        // Initialize WebGPU (requires renderer check)
        if (!renderer) {
          throw new Error('Wind layer requires WebGL renderer for WebGPU initialization');
        }

        // Initialize GPU resources and timesteps
        await layer.initGPU(renderer);

        // Initialize with timesteps and current time
        // Layer will register with DownloadService internally
        await layer.initialize(timeSteps, currentTime);

        return layer;
      }

      case 'pressure': {
        // Get timesteps from DateTimeService (generated once during bootstrap)
        const timeSteps = dateTimeService.getTimeSteps();

        // Pressure layer is CPU-only (no TextureService needed)
        const layer = new PressureLayer(
          layerId,
          downloadService,
          dateTimeService,
          configService
        );

        // Initialize with timesteps
        layer.initialize(timeSteps);

        // Register with DownloadService for event-driven loading
        downloadService.registerLayer(layerId, timeSteps);

        return layer;
      }

      case 'text':
        return TextRenderService.create(layerId);

      case 'humidity':
      case 'clouds':
      case 'waves':
        throw new Error(`Layer not yet implemented: ${layerId}`);

      default:
        // TypeScript exhaustiveness check
        const _exhaustive: never = layerId;
        throw new Error(`Unknown layer: ${_exhaustive}`);
    }
  }
}
