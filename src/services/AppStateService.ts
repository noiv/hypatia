/**
 * App State Service
 *
 * Centralizes application state management.
 * Provides typed getters/setters for state access.
 */

import type { AppState } from '../state/AppState';
import type { Scene } from '../visualization/scene';
import type { BootstrapStatus } from './AppBootstrapService';
import type { LoadProgress } from './ResourceManager';
import type { ECMWFRun } from './ECMWFService';
import type { UserLocation } from './GeolocationService';

export class AppStateService {
  private state: AppState;

  constructor(initialState: Partial<AppState>) {
    this.state = {
      currentTime: new Date(),
      isFullscreen: false,
      blend: 0.0,
      textEnabled: false,
      scene: null,
      bootstrapStatus: 'loading',
      bootstrapProgress: null,
      bootstrapError: null,
      preloadedImages: null,
      latestRun: null,
      userLocation: null,
      layerState: null,
      ...initialState
    };
  }

  /**
   * Get full state object (for passing to components)
   */
  get(): AppState {
    return this.state;
  }

  /**
   * Update multiple state properties at once
   */
  update(partial: Partial<AppState>): void {
    Object.assign(this.state, partial);
  }

  // Time
  getCurrentTime(): Date {
    return this.state.currentTime;
  }

  setCurrentTime(time: Date): void {
    this.state.currentTime = time;
  }

  // Scene
  getScene(): Scene | null {
    return this.state.scene;
  }

  setScene(scene: Scene): void {
    this.state.scene = scene;
  }

  // Fullscreen
  isFullscreen(): boolean {
    return this.state.isFullscreen;
  }

  setFullscreen(fullscreen: boolean): void {
    this.state.isFullscreen = fullscreen;
  }

  toggleFullscreen(): void {
    this.state.isFullscreen = !this.state.isFullscreen;
  }

  // Blend
  getBlend(): number {
    return this.state.blend;
  }

  setBlend(blend: number): void {
    this.state.blend = blend;
  }

  // Text
  isTextEnabled(): boolean {
    return this.state.textEnabled;
  }

  setTextEnabled(enabled: boolean): void {
    this.state.textEnabled = enabled;
  }

  toggleTextEnabled(): void {
    this.state.textEnabled = !this.state.textEnabled;
  }

  // Bootstrap
  getBootstrapStatus(): BootstrapStatus {
    return this.state.bootstrapStatus;
  }

  setBootstrapStatus(status: BootstrapStatus): void {
    this.state.bootstrapStatus = status;
  }

  getBootstrapProgress(): LoadProgress | null {
    return this.state.bootstrapProgress;
  }

  setBootstrapProgress(progress: LoadProgress | null): void {
    this.state.bootstrapProgress = progress;
  }

  getBootstrapError(): string | null {
    return this.state.bootstrapError;
  }

  setBootstrapError(error: string | null): void {
    this.state.bootstrapError = error;
  }

  // Preloaded resources
  setPreloadedImages(images: Map<string, HTMLImageElement>): void {
    this.state.preloadedImages = images;
  }

  // External data
  setLatestRun(run: ECMWFRun): void {
    this.state.latestRun = run;
  }

  setUserLocation(location: UserLocation): void {
    this.state.userLocation = location;
  }

  // Layer state
  setLayerState(layerState: import('../state/LayerState').LayerState): void {
    this.state.layerState = layerState;
  }
}
