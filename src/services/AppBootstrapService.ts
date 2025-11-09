/**
 * App Bootstrap Service
 *
 * Handles application initialization sequence with explicit error handling
 */

import { getCurrentTime } from './TimeService';
import { getLatestRun, type ECMWFRun } from './ECMWFService';
import { getUserLocation, type UserLocation } from './GeolocationService';
import { detectLocale, type LocaleInfo } from './LocaleService';
import { LayerStateService } from './LayerStateService';
import { UrlLayerSyncService } from './UrlLayerSyncService';
import { configLoader } from '../config';
import { checkBrowserCapabilities, getCapabilityHelpUrls } from '../utils/capabilityCheck';
import { preloadFont } from 'troika-three-text';
import { TEXT_CONFIG } from '../config';
import { initializeLayerCacheControl, getLayerCacheControl } from './LayerCacheControl';
import type { FileLoadUpdateEvent } from './LayerCacheControl';
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

    LOCALE: {
      start: 5,
      end: 7,
      label: 'Detecting locale...',
      async run(state) {
        state.localeInfo = detectLocale();
      }
    },

    CONFIG: {
      start: 7,
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

    LAYERS: {
      start: 35,
      end: 40,
      label: 'Initializing layers...',
      async run() {
        const layerState = LayerStateService.getInstance();
        await UrlLayerSyncService.initializeLayersFromUrl(layerState);
      }
    },

    SCENE: {
      start: 40,
      end: 45,
      label: 'Initializing scene...',
      async run(_state, app) {
        await app.initializeScene();
      }
    },

    LOAD_LAYERS: {
      start: 45,
      end: 95,
      label: 'Initializing scene...',
      async run(state, app, onProgress) {
        // Setup event-based progress tracking
        const cacheControl = getLayerCacheControl();
        const LOAD_LAYERS_START = 45;
        const LOAD_LAYERS_RANGE = 50; // 45-95%

        // Track which adjacent timestamps are loaded per layer
        const layerProgress = new Map<LayerId, Set<string>>();

        // Get layers from URL - only track data layers that will actually be loaded
        const urlState = parseUrlState();
        if (!urlState) {
          // No layers to load
          return;
        }

        // Map URL keys to layer IDs and filter to only data layers
        const allDataLayers: LayerId[] = ['temp2m', 'precipitation', 'wind10m', 'pressure_msl'];
        const dataLayers: LayerId[] = [];

        for (const urlKey of urlState.layers) {
          const layerId = configLoader.urlKeyToLayerId(urlKey) as LayerId;
          if (allDataLayers.includes(layerId)) {
            dataLayers.push(layerId);
          }
        }

        // Each data layer needs 2 critical adjacent timesteps for bootstrap
        const CRITICAL_FILES_PER_LAYER = 2;
        let totalCriticalFiles = dataLayers.length * CRITICAL_FILES_PER_LAYER;

        // Check if earth layer is in URL
        const hasEarth = urlState.layers.includes('earth');
        const EARTH_BASEMAP_FILES = 12; // 6 faces × 2 resolutions
        if (hasEarth) {
          totalCriticalFiles += EARTH_BASEMAP_FILES;
        }

        // If no critical files, skip to ready
        if (totalCriticalFiles === 0) {
          state.bootstrapStatus = 'waiting';
          if (onProgress) {
            onProgress({
              percentage: LOAD_LAYERS_START + LOAD_LAYERS_RANGE,
              label: 'Ready'
            });
          }
          await app.loadEnabledLayers();
          return;
        }

        // Calculate which timestamps are adjacent to current time
        const currentTime = state.currentTime!;
        const currentTimeMs = currentTime.getTime();
        const adjacentTimestamps = new Map<LayerId, Set<string>>();

        // 6 hours in milliseconds (timestep interval)
        const TIMESTEP_MS = 6 * 60 * 60 * 1000;

        for (const layerId of dataLayers) {
          layerProgress.set(layerId, new Set());

          // Get dataset info to calculate timesteps
          const datasetKey = layerId === 'temp2m' ? 'temp2m' :
                             layerId === 'precipitation' ? 'tprate' :
                             layerId === 'wind10m' ? 'wind10m_u' :
                             'prmsl';

          const datasetInfo = configLoader.getDatasetInfo(datasetKey);
          if (!datasetInfo) continue;

          // Find the 2 adjacent timestamps (before and at/after currentTime)
          // Round currentTime down to nearest 6-hour boundary
          const currentHour = currentTime.getUTCHours();
          const nearestCycle = Math.floor(currentHour / 6) * 6;

          const timestampBefore = new Date(currentTime);
          timestampBefore.setUTCHours(nearestCycle, 0, 0, 0);

          const timestampAfter = new Date(timestampBefore);
          timestampAfter.setTime(timestampAfter.getTime() + TIMESTEP_MS);

          // If currentTime is exactly on a cycle, use current and next
          const isExactCycle = currentTimeMs === timestampBefore.getTime();
          const adjacent1 = isExactCycle ? timestampBefore : new Date(timestampBefore.getTime() - TIMESTEP_MS);
          const adjacent2 = timestampBefore;

          // Format as "YYYYMMDD_HHz" to match timeStep format
          const formatTimestamp = (date: Date) => {
            const yyyy = date.getUTCFullYear();
            const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(date.getUTCDate()).padStart(2, '0');
            const hh = String(date.getUTCHours()).padStart(2, '0');
            return `${yyyy}${mm}${dd}_${hh}z`;
          };

          const adjacent = new Set<string>([
            formatTimestamp(adjacent1),
            formatTimestamp(adjacent2)
          ]);
          adjacentTimestamps.set(layerId, adjacent);
        }

        let totalCriticalLoaded = 0;
        let bootstrapReady = false;

        // Listen to cache events
        const fileLoadUpdateHandler = (event: FileLoadUpdateEvent) => {
          const { layerId, timeStep } = event;

          // Only track data layers during bootstrap
          if (!dataLayers.includes(layerId)) return;

          const progress = layerProgress.get(layerId);
          const adjacent = adjacentTimestamps.get(layerId);
          if (!progress || !adjacent) return;

          // Check if this is one of the 2 adjacent timestamps
          const timestampKey = `${timeStep.date}_${timeStep.cycle}`;
          if (adjacent.has(timestampKey) && !progress.has(timestampKey)) {
            progress.add(timestampKey);
            totalCriticalLoaded++;

            // Calculate percentage based on critical files only
            const percentage = LOAD_LAYERS_START + (totalCriticalLoaded / totalCriticalFiles) * LOAD_LAYERS_RANGE;

            // Format progress label with layer name
            const label = `Loading ${layerId}... ${progress.size}/${CRITICAL_FILES_PER_LAYER}`;

            if (onProgress) {
              onProgress({ percentage, label });
            }

            // Check if all critical files loaded
            if (totalCriticalLoaded === totalCriticalFiles && !bootstrapReady) {
              bootstrapReady = true;
              state.bootstrapStatus = 'waiting';
              if (onProgress) {
                onProgress({
                  percentage: LOAD_LAYERS_START + LOAD_LAYERS_RANGE,
                  label: 'Ready'
                });
              }
            }
          }
        };

        cacheControl.on('fileLoadUpdate', fileLoadUpdateHandler);

        try {
          // Load enabled layers (this triggers the events and continues downloading in background)
          await app.loadEnabledLayers();

          // If not already marked as waiting, do so now
          if (!bootstrapReady) {
            state.bootstrapStatus = 'waiting';
            if (onProgress) {
              onProgress({
                percentage: LOAD_LAYERS_START + LOAD_LAYERS_RANGE,
                label: 'Ready'
              });
            }
          }
        } finally {
          // Cleanup event listener
          cacheControl.removeListener('fileLoadUpdate', fileLoadUpdateHandler);
        }
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
