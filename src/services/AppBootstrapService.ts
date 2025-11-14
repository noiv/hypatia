/**
 * App Bootstrap Service
 *
 * Handles application initialization sequence with explicit error handling
 */

import { getCurrentTime } from './TimeService';
import { getLatestRun, type ECMWFRun } from './ECMWFService';
import { getUserLocation, type UserLocation } from './GeolocationService';
import type { LocaleInfo } from './LocaleService';
import { LayerStateService } from './LayerStateService';
import { configLoader } from '../config';
import { checkBrowserCapabilities, getCapabilityHelpUrls } from '../utils/capabilityCheck';
import { preloadFont } from 'troika-three-text';
import { TEXT_CONFIG } from '../config';
import { initializeLayerCacheControl, getLayerCacheControl } from './LayerCacheControl';
import type { LayerId } from '../visualization/ILayer';
import { parseUrlState } from '../utils/urlState';

export type BootstrapStatus = 'loading' | 'waiting' | 'ready' | 'error';

export interface BootstrapProgress {
  loaded: number;
  total: number;
  percentage: number;
  currentFile: string;
}

export interface BootstrapState {
  bootstrapStatus: BootstrapStatus;
  bootstrapProgress: BootstrapProgress | null;
  bootstrapError: string | null;
  currentTime: Date | null;
  latestRun: ECMWFRun | null;
  userLocation: UserLocation | null;
  localeInfo: LocaleInfo | null;
  preloadedImages: Map<string, HTMLImageElement> | null;
}

export interface BootstrapStepProgress {
  percentage: number;
  label: string;
}

export type BootstrapProgressCallback = (progress: BootstrapStepProgress) => void;

export interface AppInstance {
  initializeScene: () => Promise<void>;
  activate: () => void;
  sceneService?: {
    getScene: () => { createLayer: (layerId: LayerId) => Promise<boolean>; setLayerVisible: (layerId: LayerId, visible: boolean) => void; } | null;
  };
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
      async run() {
        await configLoader.loadAll();
        await LayerStateService.initialize();

        // Initialize Layer Cache Control for progressive loading
        const hypatiaConfig = configLoader.getHypatiaConfig();
        initializeLayerCacheControl({
          maxRangeDays: hypatiaConfig.data.maxRangeDays,
          maxConcurrentDownloads: hypatiaConfig.dataCache.maxConcurrentDownloads
        });
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
      async run(state) {
        // Only fetch server time if not already set from URL
        if (!state.currentTime) {
          state.currentTime = await getCurrentTime();
        }
      }
    },

    FORECAST: {
      start: 25,
      end: 35,
      label: 'Checking latest forecast...',
      async run(state) {
        state.latestRun = await getLatestRun(state.currentTime!);
      }
    },

    GEOLOCATION: {
      start: 35,
      end: 35,
      label: 'Getting location...',
      async run(state) {
        // Optional - fire and forget
        const hypatiaConfig = configLoader.getHypatiaConfig();
        if (hypatiaConfig.features.enableGeolocation) {
          getUserLocation()
            .then(location => {
              state.userLocation = location;
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
        await app.initializeScene();

        // Get URL layers
        const urlState = parseUrlState();
        if (!urlState || urlState.layers.length === 0) {
          return;
        }

        // Get scene instance
        const scene = app.sceneService?.getScene();
        if (!scene) {
          throw new Error('Scene not initialized');
        }

        // Create all layers with empty textures (for data layers)
        const layersToCreate: LayerId[] = [];
        for (const urlKey of urlState.layers) {
          const layerId = configLoader.urlKeyToLayerId(urlKey) as LayerId;
          layersToCreate.push(layerId);
        }

        console.log('[SCENE] Creating layers:', layersToCreate);
        for (const layerId of layersToCreate) {
          await scene.createLayer(layerId);
          scene.setLayerVisible(layerId, true);
        }

        // Force one render frame to upload empty textures to GPU
        // This ensures __webglTexture exists for texSubImage3D in LOAD_LAYER_DATA
        const renderer = scene.getRenderer();
        const camera = (scene as any).camera;
        const threeScene = (scene as any).scene;
        if (renderer && camera && threeScene) {
          renderer.render(threeScene, camera);
          console.log('[SCENE] Forced render to upload empty textures to GPU');
        }
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
          const layerId = configLoader.urlKeyToLayerId(urlKey) as LayerId;
          layersToLoad.push(layerId);
        }
        console.log('[LOAD_LAYER_DATA] Layers with data to load:', layersToLoad);

        // Filter to only data layers (layers were already created in SCENE step)
        const dataLayersToLoad = layersToLoad.filter(layerId =>
          layerId === 'temp2m' || layerId === 'precipitation'
        );

        if (dataLayersToLoad.length === 0) {
          console.log('[LOAD_LAYER_DATA] No data layers to load');
          return;
        }

        console.log('[LOAD_LAYER_DATA] Data layers:', dataLayersToLoad);

        // Calculate per-layer progress allocation
        const progressPerLayer = LOAD_LAYER_DATA_RANGE / dataLayersToLoad.length;
        let currentLayerIndex = 0;

        // Get cache control for event tracking
        const cacheControl = getLayerCacheControl();

        // Load data for each layer (2 adjacent timestamps per layer)
        for (const layerId of dataLayersToLoad) {
          const layerProgressStart = LOAD_LAYER_DATA_START + (currentLayerIndex * progressPerLayer);
          const layerProgressEnd = layerProgressStart + progressPerLayer;

          let filesLoaded = 0;
          const expectedFiles = 2; // Floor and ceil timestamps
          let layerComplete = false;

          // Create promise that resolves when both timestamps loaded
          const layerLoadPromise = new Promise<void>((resolve) => {
            const fileLoadUpdateHandler = (event: any) => {
              // Check if this event is for our layer and is critical priority
              if (event.layerId === layerId && event.priority === 'critical' && !layerComplete) {
                filesLoaded++;

                // Calculate progress within this layer's range
                const fileProgress = filesLoaded / expectedFiles;
                const percentage = layerProgressStart + (fileProgress * progressPerLayer);

                captureProgress({
                  percentage,
                  label: `Loading ${layerId} ${filesLoaded}/${expectedFiles}...`
                });

                // Check if layer complete
                if (filesLoaded >= expectedFiles) {
                  layerComplete = true;
                  cacheControl.removeListener('fileLoadUpdate', fileLoadUpdateHandler);
                  captureProgress({
                    percentage: layerProgressEnd,
                    label: `Loading ${layerId} ${expectedFiles}/${expectedFiles} done`
                  });
                  resolve();
                }
              }
            };

            cacheControl.on('fileLoadUpdate', fileLoadUpdateHandler);
          });

          // Start loading critical timestamps
          captureProgress({
            percentage: layerProgressStart,
            label: `Loading ${layerId}...`
          });

          // Trigger critical timestamp loading (LayerCacheControl already initialized)
          // The layer was already created with empty texture in SCENE step
          // This will load floor/ceil timestamps using texSubImage3D
          const currentTime = urlState.time || new Date();
          await cacheControl.initializeLayer(layerId, currentTime);

          // Wait for both timestamps to load
          await layerLoadPromise;

          currentLayerIndex++;
        }

        // All layer data loaded
        captureProgress({
          percentage: LOAD_LAYER_DATA_START + LOAD_LAYER_DATA_RANGE,
          label: 'All layer data loaded'
        });
      }
    },

    ACTIVATE: {
      start: 95,
      end: 98,
      label: 'Activating...',
      async run(_state, app) {
        app.activate();
      }
    },

    READY: {
      start: 98,
      end: 100,
      label: 'Ready',
      async run() {
        await new Promise(resolve => setTimeout(resolve, 1000));
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
      // Update progress to start
      this.updateProgress(step, step.start, state, onProgress);

      // Run step logic
      await step.run(state, app, onProgress);

      // Update progress to end
      this.updateProgress(step, step.end, state, onProgress);

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
    state: BootstrapState,
    onProgress?: BootstrapProgressCallback
  ): void {
    state.bootstrapProgress = {
      loaded: 0,
      total: 100,
      percentage,
      currentFile: step.label
    };

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
  ): Promise<BootstrapState> {
    const state: BootstrapState = {
      bootstrapStatus: 'loading',
      bootstrapProgress: null,
      bootstrapError: null,
      currentTime: null,
      latestRun: null,
      userLocation: null,
      localeInfo: null,
      preloadedImages: null
    };

    console.log('Bootstrap.start');

    // Run each step in sequence
    for (const [name, step] of Object.entries(this.STEPS)) {
      const { success, error } = await this.runStep(step, state, app, onProgress);

      if (!success) {
        console.error(`Bootstrap failed at ${name}:`, error);
        state.bootstrapStatus = 'error';
        state.bootstrapError = error ?? null;
        return state;
      }
    }

    // Check autoContinue setting
    const hypatiaConfig = configLoader.getHypatiaConfig();
    const autoContinue = hypatiaConfig.bootstrap.autoContinue;

    if (autoContinue) {
      state.bootstrapStatus = 'ready';
      console.log('Bootstrap.done (auto-continue)');
    } else {
      state.bootstrapStatus = 'waiting';
      console.log('Bootstrap.done (waiting for user)');
    }

    return state;
  }

  /**
   * Get estimated bootstrap time
   */
  static getEstimatedDuration(): number {
    // Estimate: ~3-5 seconds for typical connection
    return 4000;
  }
}
