/**
 * App Bootstrap Service
 *
 * Handles application initialization sequence
 */

import { getCurrentTime } from './TimeService';
import { getLatestRun, type ECMWFRun } from './ECMWFService';
import { preloadImages, type LoadProgress } from './ResourceManager';
import { getUserLocation, type UserLocation } from './GeolocationService';
import { LayerStateService } from './LayerStateService';
import { UrlLayerSyncService } from './UrlLayerSyncService';
import { configLoader } from '../config';
import { checkBrowserCapabilities, getCapabilityHelpUrls } from '../utils/capabilityCheck';

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

export class AppBootstrapService {
  private static readonly STEPS = {
    INIT: { start: 0, end: 0, label: 'Starting...' },
    CAPABILITIES: { start: 0, end: 5, label: 'Checking browser capabilities...' },
    CONFIG: { start: 5, end: 15, label: 'Loading configurations...' },
    TIME: { start: 15, end: 25, label: 'Fetching server time...' },
    FORECAST: { start: 25, end: 35, label: 'Checking latest forecast...' },
    IMAGES: { start: 35, end: 90, label: 'Loading resources...' },
    LAYERS: { start: 90, end: 93, label: 'Initializing layers...' },
    SCENE: { start: 93, end: 95, label: 'Initializing scene...' },
    LOAD_LAYERS: { start: 95, end: 97, label: 'Loading enabled layers...' },
    ACTIVATE: { start: 97, end: 99, label: 'Activating...' },
    READY: { start: 99, end: 100, label: 'Ready' }
  };

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

    try {
      const updateProgress = (step: typeof this.STEPS[keyof typeof this.STEPS], percentage?: number) => {
        const percent = percentage ?? step.end;
        state.bootstrapProgress = {
          loaded: 0,
          total: 100,
          percentage: percent,
          currentFile: step.label
        };
        if (onProgress) {
          onProgress({ percentage: percent, label: step.label });
        }
      };

      console.log('Bootstrap.start');

      // Step 0: Check browser capabilities
      updateProgress(this.STEPS.CAPABILITIES, this.STEPS.CAPABILITIES.start);
      const capabilities = checkBrowserCapabilities();
      if (!capabilities.supported) {
        const helpUrls = getCapabilityHelpUrls();
        const missing = capabilities.missing.join(', ');
        const errorMessage = `Your browser does not support required features: ${missing}.\n\n` +
          `Please check:\n` +
          `• WebGL2: ${helpUrls.webgl}\n` +
          `• WebGPU: ${helpUrls.webgpu}`;

        throw new Error(errorMessage);
      }
      updateProgress(this.STEPS.CAPABILITIES, this.STEPS.CAPABILITIES.end);

      // Step 1: Load configurations
      updateProgress(this.STEPS.CONFIG, this.STEPS.CONFIG.start);
      await configLoader.loadAll();
      await LayerStateService.initialize();
      updateProgress(this.STEPS.CONFIG, this.STEPS.CONFIG.end);

      // Step 2: Get server time
      updateProgress(this.STEPS.TIME, this.STEPS.TIME.start);
      state.currentTime = await getCurrentTime();
      updateProgress(this.STEPS.TIME, this.STEPS.TIME.end);

      // Step 3: Get latest forecast
      updateProgress(this.STEPS.FORECAST, this.STEPS.FORECAST.start);
      state.latestRun = await getLatestRun(state.currentTime!);
      updateProgress(this.STEPS.FORECAST, this.STEPS.FORECAST.end);

      // Step 4: Preload resources
      updateProgress(this.STEPS.IMAGES, this.STEPS.IMAGES.start);

      const progressUpdater = (progress: LoadProgress) => {
        const imagesStart = this.STEPS.IMAGES.start;
        const imagesRange = this.STEPS.IMAGES.end - imagesStart;
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

      updateProgress(this.STEPS.IMAGES, this.STEPS.IMAGES.end);

      // Step 5: Optional - Get user location (if enabled in config)
      const hypatiaConfig = configLoader.getHypatiaConfig();
      if (hypatiaConfig.features.enableGeolocation) {
        getUserLocation().then(location => {
          state.userLocation = location;
        }).catch(() => {
          // Silently fail - geolocation is optional
        });
      }

      // Step 6: Initialize layers from URL
      updateProgress(this.STEPS.LAYERS, this.STEPS.LAYERS.start);
      const layerState = LayerStateService.getInstance();
      await UrlLayerSyncService.initializeLayersFromUrl(layerState);
      updateProgress(this.STEPS.LAYERS, this.STEPS.LAYERS.end);

      // Step 7: Initialize scene
      updateProgress(this.STEPS.SCENE, this.STEPS.SCENE.start);
      await app.initializeScene();
      updateProgress(this.STEPS.SCENE, this.STEPS.SCENE.end);

      // Step 8: Load enabled layers
      updateProgress(this.STEPS.LOAD_LAYERS, this.STEPS.LOAD_LAYERS.start);
      await app.loadEnabledLayers();
      updateProgress(this.STEPS.LOAD_LAYERS, this.STEPS.LOAD_LAYERS.end);

      // Step 9: Activate event handlers
      updateProgress(this.STEPS.ACTIVATE, this.STEPS.ACTIVATE.start);
      app.activate();
      updateProgress(this.STEPS.ACTIVATE, this.STEPS.ACTIVATE.end);

      // Step 10: Ready
      updateProgress(this.STEPS.READY, this.STEPS.READY.start);
      await new Promise(resolve => setTimeout(resolve, 1000));
      updateProgress(this.STEPS.READY, this.STEPS.READY.end);

      state.bootstrapStatus = 'ready';

      console.log('Bootstrap.done');

      return state;

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Bootstrap failed:', message);

      state.bootstrapStatus = 'error';
      state.bootstrapError = message;

      return state;
    }
  }

  /**
   * Get estimated bootstrap time
   */
  static getEstimatedDuration(): number {
    // Estimate: ~3-5 seconds for typical connection
    return 4000;
  }
}
