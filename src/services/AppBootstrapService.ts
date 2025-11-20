/**
 * App Bootstrap Service
 *
 * Handles application initialization sequence with explicit error handling
 */

import { getCurrentTime } from './TimeService';
import { getLatestRun } from './ECMWFService';
import { getUserLocation } from './GeolocationService';
import { checkBrowserCapabilities, getCapabilityHelpUrls } from '../utils/capabilityCheck';
import { preloadFont } from 'troika-three-text';
import { TEXT_CONFIG } from '../config';
import type { LayerId } from '../layers/ILayer';
import { parseUrlState } from './UrlService';
import type { LayersService } from './LayersService';
import type { DownloadService } from './DownloadService';
import type { ConfigService } from './ConfigService';
import type { AppStateService } from './AppStateService';
import type { Scene } from '../visualization/scene';

export type BootstrapStatus = 'loading' | 'waiting' | 'ready' | 'error';

export interface BootstrapProgress {
  loaded: number;
  total: number;
  percentage: number;
  currentFile: string;
}

// BootstrapState is now internal-only for tracking progress through steps
// All actual state is mutated directly in AppStateService
interface BootstrapState {
  // Just used internally for progress reporting
}

export interface BootstrapStepProgress {
  percentage: number;
  label: string;
}

export type BootstrapProgressCallback = (progress: BootstrapStepProgress) => void;

export interface AppInstance {
  initializeScene: () => Promise<Scene | undefined>;
  activate: () => void;
  configService: ConfigService;
  getScene: () => Scene | undefined;
  stateService: AppStateService;
  layersService: LayersService;
  downloadService: DownloadService;
  setAppService: (service: any) => void; // Setter for AppService
  isBootstrapping: () => boolean; // Function that returns current bootstrap state
}

interface StepResult {
  success: boolean;
  error?: string;
}

interface BootstrapStepConfig {
  start: number;
  end: number;
  label: string;
  run: (state: BootstrapState, app: AppInstance, onProgress?: BootstrapProgressCallback) => Promise<void>;
}

export class AppBootstrapService {
  private static readonly STEPS: Record<string, BootstrapStepConfig> = {
    CAPABILITIES: {
      start: 0,
      end: 5,
      label: 'Checking browser capabilities...',
      async run() {
        const capabilities = checkBrowserCapabilities();
        if (!capabilities.supported) {
          const helpUrls = getCapabilityHelpUrls();
          const missing = capabilities.missing.join(', ');
          throw new Error(
            `Your browser does not support required features: ${missing}.\n\n` +
            `Please check:\n` +
            `• WebGL2: ${helpUrls.webgl}\n` +
            `• WebGPU: ${helpUrls.webgpu}`
          );
        }
      }
    },

    CONFIG: {
      start: 5,
      end: 10,
      label: 'Loading configurations...',
      async run(_state, app) {
        await app.configService.loadAll();

        // Note: LayerState is now initialized in LayersService constructor
        // No separate initialization needed here
      }
    },

    TEXT_PRELOAD: {
      start: 10,
      end: 15,
      label: 'Preloading text glyphs...',
      async run() {
        return new Promise<void>((resolve) => {
          preloadFont(
            {
              font: TEXT_CONFIG.font.url,
              characters: TEXT_CONFIG.performance.characters
            },
            () => {
              resolve();
            }
          );
        });
      }
    },

    TIME: {
      start: 15,
      end: 25,
      label: 'Fetching server time...',
      async run(_state, app) {
        // Only fetch server time if not already set from URL
        const currentTime = app.stateService.getCurrentTime();
        if (!currentTime) {
          const time = await getCurrentTime(app.configService);
          app.stateService.setCurrentTime(time);
        }
      }
    },

    FORECAST: {
      start: 25,
      end: 35,
      label: 'Checking latest forecast...',
      async run(_state, app) {
        const currentTime = app.stateService.getCurrentTime();
        if (currentTime) {
          const latestRun = await getLatestRun(currentTime);
          if (latestRun) {
            app.stateService.setLatestRun(latestRun);
          }
        }
      }
    },

    GEOLOCATION: {
      start: 35,
      end: 35,
      label: 'Getting location...',
      async run(_state, app) {
        // Optional - fire and forget
        const hypatiaConfig = app.configService.getHypatiaConfig();
        if (hypatiaConfig.features.enableGeolocation) {
          getUserLocation()
            .then(location => {
              if (location) {
                app.stateService.setUserLocation(location);
              }
            })
            .catch(() => {
              // Silently fail - geolocation is optional
            });
        }
      }
    },

    SCENE: {
      start: 35,
      end: 40,
      label: 'Initializing scene...',
      async run(_state, app) {
        // Create scene and canvas
        const scene = await app.initializeScene();
        if (!scene) {
          throw new Error('Scene not initialized');
        }

        // Get layers from URL
        const urlState = parseUrlState();
        const urlLayerIds: LayerId[] = [];
        if (urlState && urlState.layers.length > 0) {
          for (const urlKey of urlState.layers) {
            const layerId = app.configService.urlKeyToLayerId(urlKey) as LayerId;
            urlLayerIds.push(layerId);
          }
        }

        // Always create sun, graticule, text (truly non-data layers)
        // Earth should only be created if in URL (it downloads images)
        const alwaysCreateLayers: LayerId[] = ['sun', 'graticule', 'text'];

        // Merge into Set to deduplicate
        const allLayers = new Set<LayerId>([...alwaysCreateLayers, ...urlLayerIds]);
        console.log('[SCENE] Creating layers:', Array.from(allLayers));

        // Create all layers via LayersService
        const currentTime = app.stateService.getCurrentTime();
        await app.layersService.createLayers(Array.from(allLayers), currentTime);

        // Set visibility for URL layers (data will be loaded in LOAD_LAYER_DATA step)
        for (const layerId of urlLayerIds) {
          const metadata = app.layersService.getMetadata(layerId);
          if (metadata) {
            metadata.isVisible = true;
            metadata.layer.setVisible(true);
            console.log(`[LayersService] ${layerId} visibility: true`);
          }
        }

        // Force one render frame to upload empty textures to GPU
        // This ensures __webglTexture exists for texSubImage3D in LOAD_LAYER_DATA
        scene.renderFrame();
        console.log('[SCENE] Forced render to upload empty textures to GPU');
      }
    },

    LOAD_LAYER_DATA: {
      start: 40,
      end: 95,
      label: 'Loading layer data...',
      async run(_state, app, onProgress) {
        const LOAD_LAYER_DATA_START = 40;
        const LOAD_LAYER_DATA_RANGE = 55; // 40-95%

        // Track progress messages for debugging
        (window as any).__progressMessages = [];
        const captureProgress = (msg: BootstrapStepProgress) => {
          (window as any).__progressMessages.push({ ...msg, timestamp: Date.now() });
          if (onProgress) onProgress(msg);
        };

        // Get layers from URL
        const urlState = parseUrlState();
        console.log('[LOAD_LAYER_DATA] URL state:', urlState);
        if (!urlState || urlState.layers.length === 0) {
          console.log('[LOAD_LAYER_DATA] No layer data to load');
          return;
        }

        // Convert URL keys to layer IDs
        const layersToLoad: LayerId[] = [];
        for (const urlKey of urlState.layers) {
          const layerId = app.configService.urlKeyToLayerId(urlKey) as LayerId;
          layersToLoad.push(layerId);
        }
        console.log('[LOAD_LAYER_DATA] Layers with data to load:', layersToLoad);

        // Filter to only data layers (layers were already created in SCENE step)
        const dataLayersToLoad = layersToLoad.filter(layerId =>
          layerId === 'temp' || layerId === 'rain'
        );

        if (dataLayersToLoad.length === 0) {
          console.log('[LOAD_LAYER_DATA] No data layers to load');
          return;
        }

        console.log('[LOAD_LAYER_DATA] Data layers:', dataLayersToLoad);

        // Use DownloadService for progressive loading
        console.log('[LOAD_LAYER_DATA] Using DownloadService for progressive loading');

        // Calculate per-layer progress allocation
        const progressPerLayer = LOAD_LAYER_DATA_RANGE / dataLayersToLoad.length;
        let currentLayerIndex = 0;

        const currentTime = urlState.time || new Date();

        // Initialize data loading for each layer
        for (const layerId of dataLayersToLoad) {
            const layerProgressStart = LOAD_LAYER_DATA_START + (currentLayerIndex * progressPerLayer);

            captureProgress({
              percentage: layerProgressStart,
              label: `Loading ${layerId}...`
            });

          // Initialize layer with progress callback
          // Always use 'on-demand' during bootstrap (only load 2 critical timestamps)
          await app.downloadService!.initializeLayer(
              layerId,
              currentTime,
              (loaded, total) => {
                const fileProgress = loaded / total;
                const percentage = layerProgressStart + (fileProgress * progressPerLayer);
                captureProgress({
                  percentage,
                  label: `Loading ${layerId} ${loaded}/${total}...`
                });
              },
              'on-demand'  // Bootstrap always uses on-demand mode
            );

          currentLayerIndex++;
        }

        // Wait for all critical downloads to complete
        captureProgress({
          percentage: LOAD_LAYER_DATA_START + LOAD_LAYER_DATA_RANGE - 5,
          label: 'Waiting for critical data...'
        });

        await app.downloadService!.done();

        captureProgress({
          percentage: LOAD_LAYER_DATA_START + LOAD_LAYER_DATA_RANGE,
          label: 'All layer data loaded'
        });
      }
    },

    ACTIVATE: {
      start: 95,
      end: 96,
      label: 'Activating...',
      async run(_state, app) {
        // Force one final render to ensure all textures are uploaded
        const scene = app.stateService.get().scene;
        if (scene) {
          scene.renderFrame();
          console.log('[ACTIVATE] Final render before starting animation loop');
        }

        // Activate scene and UI (starts animation loop)
        app.activate();
      }
    },

    CREATE_APP_SERVICE: {
      start: 96,
      end: 98,
      label: 'Initializing services...',
      async run(_state, app) {
        // Create AppService now that scene and layers are ready
        const { AppService } = await import('../services/AppService');
        const appService = new AppService(
          app.stateService,
          app.getScene,
          app.layersService!,
          app.isBootstrapping
        );

        // Set it on the actual app component via setter
        app.setAppService(appService);

        console.log('[CREATE_APP_SERVICE] AppService created');
      }
    },

    FINALIZE: {
      start: 98,
      end: 100,
      label: 'Ready',
      async run(_state, app) {
        // Check autoContinue BEFORE setting status
        const hypatiaConfig = app.configService.getHypatiaConfig();
        const autoContinue = hypatiaConfig.bootstrap.autoContinue;

        if (!autoContinue) {
          // Set to waiting immediately (UI + modal appear together)
          app.stateService.setBootstrapStatus('waiting');
          console.log('Bootstrap.done (waiting for user to choose download mode)');
        } else {
          // Auto-continue: use default download mode from config
          const defaultDownloadMode = hypatiaConfig.dataCache.downloadMode;
          app.stateService.setDownloadMode(defaultDownloadMode);
          app.stateService.setBootstrapStatus('ready');
          console.log(`Bootstrap.done (auto-continue with ${defaultDownloadMode} mode)`);
        }

        // Brief pause for animation to complete
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  };

  /**
   * Run a single bootstrap step with explicit error handling
   */
  private static async runStep(
    step: BootstrapStepConfig,
    state: BootstrapState,
    app: AppInstance,
    onProgress?: BootstrapProgressCallback
  ): Promise<StepResult> {
    try {
      // Get delay config
      const hypatiaConfig = app.configService.getHypatiaConfig();
      const stepDelayMs = hypatiaConfig.bootstrap.stepDelayMs || 0;

      // Update progress to start
      this.updateProgress(step, step.start, app, onProgress);
      if (stepDelayMs > 0) await new Promise(resolve => setTimeout(resolve, stepDelayMs));

      // Run step logic
      await step.run(state, app, onProgress);

      // Update progress to end
      this.updateProgress(step, step.end, app, onProgress);
      if (stepDelayMs > 0) await new Promise(resolve => setTimeout(resolve, stepDelayMs));

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  /**
   * Update progress state
   */
  private static updateProgress(
    step: BootstrapStepConfig,
    percentage: number,
    app: AppInstance,
    onProgress?: BootstrapProgressCallback
  ): void {
    // Update AppStateService directly
    app.stateService.setBootstrapProgress({
      loaded: 0,
      total: 100,
      percentage,
      currentFile: step.label
    });

    if (onProgress) {
      onProgress({ percentage, label: step.label });
    }
  }

  /**
   * Run full bootstrap sequence
   */
  static async bootstrap(
    app: AppInstance,
    onProgress?: BootstrapProgressCallback
  ): Promise<void> {
    const state: BootstrapState = {};

    // Set initial bootstrap status
    app.stateService.setBootstrapStatus('loading');

    console.log('Bootstrap.start');

    // Run each step in sequence
    for (const [name, step] of Object.entries(this.STEPS)) {
      const { success, error } = await this.runStep(step, state, app, onProgress);

      if (!success) {
        console.error(`Bootstrap failed at ${name}:`, error);
        app.stateService.setBootstrapStatus('error');
        app.stateService.setBootstrapError(error ?? null);
        return;
      }
    }

    // Status is now set by WAIT_OR_CONTINUE step
    // No additional logic needed here
  }

  /**
   * Get estimated bootstrap time
   */
  static getEstimatedDuration(): number {
    // Estimate: ~3-5 seconds for typical connection
    return 4000;
  }
}
