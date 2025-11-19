import type * as THREE from 'three';
import type { ILayer, LayerId } from './ILayer';
import type { DownloadService } from '../services/DownloadService';
import type { TextureService } from '../services/TextureService';
import type { DateTimeService } from '../services/DateTimeService';
import type { ConfigService } from '../services/ConfigService';
import { EarthRenderService } from './earth.render-service';
import { SunRenderService } from './sun.render-service';
import { GraticuleRenderService } from './graticule.render-service';
import { TextRenderService } from './text.render-service';

// New event-driven layers
import { Temp2mLayer } from '../layers/temp2m.layer';
import { PrecipitationLayer } from '../layers/precipitation.layer';
import { Wind10mLayer } from '../layers/wind10m.layer';
import { PressureLayer } from '../layers/pressure.layer';

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
    const hypatiaConfig = configService.getHypatiaConfig();
    const maxRangeDays = hypatiaConfig.data.maxRangeDays;
    const dataBaseUrl = hypatiaConfig.data.dataBaseUrl;

    switch (layerId) {
      case 'earth':
        return EarthRenderService.create(layerId, preloadedImages);

      case 'sun':
        return SunRenderService.create(layerId, currentTime, false); // Atmosphere shader disabled (not ready)

      case 'graticule':
        return GraticuleRenderService.create(layerId);

      case 'temp2m': {
        // Get data folder from config
        const layerConfig = configService.getLayerById(layerId);
        const dataFolder = layerConfig?.dataFolders[0] || 'temp2m';

        // Generate timesteps for the layer (6-hour intervals)
        const timeSteps = dateTimeService.generateTimeSteps(
          currentTime,
          maxRangeDays,
          6, // stepHours
          dataBaseUrl,
          dataFolder
        );

        // Create layer with services
        const layer = new Temp2mLayer(
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

      case 'precipitation': {
        // Get data folder from config
        const layerConfig = configService.getLayerById(layerId);
        const dataFolder = layerConfig?.dataFolders[0] || 'tprate';

        // Generate timesteps for the layer (6-hour intervals)
        const timeSteps = dateTimeService.generateTimeSteps(
          currentTime,
          maxRangeDays,
          6, // stepHours
          dataBaseUrl,
          dataFolder
        );

        // Create layer with services
        const layer = new PrecipitationLayer(
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

      case 'wind10m': {
        // Get data folders from config (U and V components)
        const layerConfig = configService.getLayerById(layerId);
        const dataFolderU = layerConfig?.dataFolders[0] || 'wind10m_u';

        // Generate timesteps for U component (6-hour intervals)
        const timeSteps = dateTimeService.generateTimeSteps(
          currentTime,
          maxRangeDays,
          6, // stepHours
          dataBaseUrl,
          dataFolderU
        );

        // Wind layer doesn't use TextureService (uses WebGPU compute)
        const layer = new Wind10mLayer(
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
        await layer.initialize(timeSteps);

        // Register both U and V components with DownloadService
        const timeStepsV = dateTimeService.generateTimeSteps(
          currentTime,
          maxRangeDays,
          6,
          dataBaseUrl,
          'wind10m_v' // Wind V component
        );
        downloadService.registerLayer('wind10m_u' as LayerId, timeSteps);
        downloadService.registerLayer('wind10m_v' as LayerId, timeStepsV);

        return layer;
      }

      case 'pressure_msl': {
        // Generate timesteps for the layer (6-hour intervals)
        const timeSteps = dateTimeService.generateTimeSteps(
          currentTime,
          maxRangeDays,
          6, // stepHours
          dataBaseUrl,
          'pressure_msl'
        );

        // Pressure layer is CPU-only (no TextureService needed)
        const layer = new PressureLayer(
          layerId,
          downloadService,
          dateTimeService
        );

        // Register with DownloadService for event-driven loading
        downloadService.registerLayer(layerId, timeSteps);

        return layer;
      }

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
    return ['earth', 'sun', 'graticule', 'temp2m', 'precipitation', 'wind10m', 'pressure_msl', 'text'];
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
    return ['earth', 'sun', 'graticule', 'temp2m', 'precipitation', 'wind10m', 'pressure_msl', 'text'];
  }
}
