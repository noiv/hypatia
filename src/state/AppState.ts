/**
 * Application State Interface
 *
 * Central state definition for the application
 */

import type { Scene } from '../visualization/scene';
import type { ECMWFRun } from '../services/ECMWFService';
import type { UserLocation } from '../services/GeolocationService';
import type { BootstrapStatus } from '../services/AppBootstrapService';
import type { LoadProgress } from '../services/ResourceManager';
import type { LayerState } from './LayerState';

export interface AppState {
  // Time
  currentTime: Date;

  // Scene
  scene: Scene | null;
  isFullscreen: boolean;
  blend: number;

  // Bootstrap
  bootstrapStatus: BootstrapStatus;
  bootstrapProgress: LoadProgress | null;
  bootstrapError: string | null;

  // Preloaded resources
  preloadedImages: Map<string, HTMLImageElement> | null;

  // External data
  latestRun: ECMWFRun | null;
  userLocation: UserLocation | null;

  // Layer state (config-driven)
  layerState: LayerState | null;
}
