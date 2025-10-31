/**
 * App Bootstrap Service
 *
 * Handles application initialization sequence
 */

import { getCurrentTime } from './TimeService';
import { getLatestRun, type ECMWFRun } from './ECMWFService';
import { preloadImages, getTotalSize, type LoadProgress } from './ResourceManager';
import { getUserLocation, type UserLocation } from './GeolocationService';
import { LayerStateService } from './LayerStateService';
import { configLoader } from '../config';

export type BootstrapStatus = 'loading' | 'ready' | 'error';

export interface BootstrapState {
  status: BootstrapStatus;
  progress: LoadProgress | null;
  error: string | null;
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

export class AppBootstrapService {
  private static readonly STEPS = {
    INIT: { start: 0, end: 0, label: 'Starting...' },
    CONFIG: { start: 0, end: 10, label: 'Loading configurations...' },
    TIME: { start: 10, end: 20, label: 'Fetching server time...' },
    FORECAST: { start: 20, end: 30, label: 'Checking latest forecast...' },
    IMAGES: { start: 30, end: 100, label: 'Loading resources...' }
  };

  /**
   * Run full bootstrap sequence
   */
  static async bootstrap(
    onProgress?: BootstrapProgressCallback
  ): Promise<BootstrapState> {
    const state: BootstrapState = {
      status: 'loading',
      progress: null,
      error: null,
      currentTime: null,
      latestRun: null,
      userLocation: null,
      preloadedImages: null
    };

    try {
      const updateProgress = (step: typeof this.STEPS[keyof typeof this.STEPS], percentage?: number) => {
        const percent = percentage ?? step.end;
        state.progress = {
          loaded: 0,
          total: 100,
          percentage: percent,
          currentFile: step.label
        };
        if (onProgress) {
          onProgress({ percentage: percent, label: step.label });
        }
      };

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
      state.latestRun = await getLatestRun();
      updateProgress(this.STEPS.FORECAST, this.STEPS.FORECAST.end);

      // Step 4: Preload resources
      updateProgress(this.STEPS.IMAGES, this.STEPS.IMAGES.start);

      const totalBytes = getTotalSize('critical');
      const progressUpdater = (loaded: number, total: number, currentFile: string) => {
        const imagesStart = this.STEPS.IMAGES.start;
        const imagesRange = this.STEPS.IMAGES.end - imagesStart;
        const percentage = imagesStart + (loaded / total) * imagesRange;

        state.progress = {
          loaded,
          total,
          percentage,
          currentFile
        };

        if (onProgress) {
          onProgress({ percentage, label: currentFile });
        }
      };

      state.preloadedImages = await preloadImages('critical', progressUpdater);

      // Step 5: Optional - Get user location (non-blocking)
      getUserLocation().then(location => {
        state.userLocation = location;
      }).catch(() => {
        // Silently fail - geolocation is optional
      });

      updateProgress(this.STEPS.IMAGES, this.STEPS.IMAGES.end);

      state.status = 'ready';
      return state;

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Bootstrap failed:', message);

      state.status = 'error';
      state.error = message;

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
