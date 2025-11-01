/**
 * Layer State Service
 *
 * Manages layer state lifecycle and initialization
 */

import { LayerState } from '../state/LayerState';
import { configLoader } from '../config';

export class LayerStateService {
  private static instance: LayerState | null = null;

  /**
   * Initialize layer state from configurations
   */
  static async initialize(): Promise<LayerState> {
    if (this.instance) {
      return this.instance;
    }

    await configLoader.loadAll();
    const layers = configLoader.getLayers();

    this.instance = new LayerState(layers);
    return this.instance;
  }

  /**
   * Get the current layer state instance
   */
  static getInstance(): LayerState {
    if (!this.instance) {
      throw new Error('LayerStateService not initialized. Call initialize() first.');
    }
    return this.instance;
  }

  /**
   * Initialize layer state from URL parameters
   */
  static initializeFromUrl(urlKeys: string[]): LayerState {
    const state = this.getInstance();

    if (urlKeys.length > 0) {
      state.enableFromUrlKeys(urlKeys);
    } else {
      state.enableDefaults();
    }

    return state;
  }

  /**
   * Check if service is ready
   */
  static isReady(): boolean {
    return this.instance !== null;
  }

  /**
   * Reset the service (useful for testing)
   */
  static reset(): void {
    this.instance = null;
  }
}
