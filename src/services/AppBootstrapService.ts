/**
 * App Bootstrap Service
 *
 * Handles application initialization sequence with explicit error handling
 */

import { getCurrentTime } from './TimeService';
import { getLatestRun, type ECMWFRun } from './ECMWFService';
import { preloadImages, type LoadProgress } from './ResourceManager';
import { getUserLocation, type UserLocation } from './GeolocationService';
import { LayerStateService } from './LayerStateService';
import { UrlLayerSyncService } from './UrlLayerSyncService';
import { configLoader } from '../config';
import { checkBrowserCapabilities, getCapabilityHelpUrls } from '../utils/capabilityCheck';
import { preloadFont } from 'troika-three-text';
import { TEXT_CONFIG } from '../config/text.config';

export type BootstrapStatus = 'loading' | 'ready' | 'error';

export interface BootstrapState {
  bootstrapStatus: BootstrapStatus;
  bootstrapProgress: LoadProgress | null;
  bootstrapError: string | null;
  currentTime: Date | null;
  latestRun: ECMWFRun | null;
  userLocation: UserLocation | null;
  preloadedImages: Map<string, HTMLImageElement> | null;
}

export interface BootstrapStepProgress {
  percentage: number;
  label: string;
}

export type BootstrapProgressCallback = (progress: BootstrapStepProgress) => void;

export interface AppInstance {
  initializeScene: () => Promise<void>;
  loadEnabledLayers: () => Promise<void>;
  activate: () => void;
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
              console.log('TextBootstrap: Glyphs preloaded');
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
        state.currentTime = await getCurrentTime();
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

    IMAGES: {
      start: 35,
      end: 90,
      label: 'Loading resources...',
      async run(state, _app, onProgress) {
        const progressUpdater = (progress: LoadProgress) => {
          const imagesStart = this.start;
          const imagesRange = this.end - imagesStart;
          const percentage = imagesStart + (progress.loaded / progress.total) * imagesRange;

          state.bootstrapProgress = {
            loaded: progress.loaded,
            total: progress.total,
            percentage,
            currentFile: progress.currentFile || ''
          };

          if (onProgress) {
            onProgress({ percentage, label: progress.currentFile || '' });
          }
        };

        state.preloadedImages = await preloadImages('critical', progressUpdater);
      }
    },

    GEOLOCATION: {
      start: 90,
      end: 90,
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

    LAYERS: {
      start: 90,
      end: 93,
      label: 'Initializing layers...',
      async run() {
        const layerState = LayerStateService.getInstance();
        await UrlLayerSyncService.initializeLayersFromUrl(layerState);
      }
    },

    SCENE: {
      start: 93,
      end: 95,
      label: 'Initializing scene...',
      async run(_state, app) {
        await app.initializeScene();
      }
    },

    LOAD_LAYERS: {
      start: 95,
      end: 97,
      label: 'Loading enabled layers...',
      async run(_state, app) {
        await app.loadEnabledLayers();
      }
    },

    ACTIVATE: {
      start: 97,
      end: 99,
      label: 'Activating...',
      async run(_state, app) {
        app.activate();
      }
    },

    READY: {
      start: 99,
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

    state.bootstrapStatus = 'ready';
    console.log('Bootstrap.done');

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
