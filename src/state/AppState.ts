/**
 * Application State Interface
 *
 * Central state definition for the application
 */

import type { Scene } from '../visualization/scene';
import type { ECMWFRun } from '../services/ECMWFService';
import type { UserLocation } from '../services/GeolocationService';
import type { BootstrapStatus, BootstrapProgress } from '../services/AppBootstrapService';
import type { LayerState } from './LayerState';
import type { LocaleInfo } from '../services/LocaleService';

export interface AppState {
  // Time
  currentTime: Date;
  sliderStartTime: Date;  // Fixed slider edge (calculated once at init from maxRangeDays)
  sliderEndTime: Date;    // Fixed slider edge (calculated once at init from maxRangeDays)

  // Locale
  localeInfo: LocaleInfo;
  timezone: {
    short: string;  // e.g., "PST", "EST", "GMT+1"
    long: string;   // e.g., "Pacific Standard Time"
  };

  // Scene
  scene: Scene | null;
  isFullscreen: boolean;
  blend: number;
  textEnabled: boolean;

  // Bootstrap
  bootstrapStatus: BootstrapStatus;
  bootstrapProgress: BootstrapProgress | null;
  bootstrapError: string | null;

  // Preloaded resources
  preloadedImages: Map<string, HTMLImageElement> | null;

  // External data
  latestRun: ECMWFRun | null;
  userLocation: UserLocation | null;

  // Layer state (config-driven)
  layerState: LayerState | null;
}
