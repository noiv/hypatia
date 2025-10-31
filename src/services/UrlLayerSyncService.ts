/**
 * URL Layer Sync Service
 *
 * Syncs layer state with URL parameters for shareability
 */

import { LayerState } from '../state/LayerState';
import { parseUrlState, updateUrlState, type AppUrlState } from '../utils/urlState';

export class UrlLayerSyncService {
  /**
   * Parse layer keys from URL
   */
  static parseLayersFromUrl(): string[] {
    const urlState = parseUrlState();
    return urlState?.layers ?? [];
  }

  /**
   * Update URL with current layer state
   */
  static updateUrl(
    layerState: LayerState,
    currentAppState: Omit<AppUrlState, 'layers'>
  ): void {
    const activeUrlKeys = layerState.getActiveUrlKeys();

    const newState: AppUrlState = {
      ...currentAppState,
      layers: activeUrlKeys.length > 0 ? activeUrlKeys : undefined
    };

    updateUrlState(newState);
  }

  /**
   * Initialize layer state from URL or defaults
   */
  static initializeLayersFromUrl(layerState: LayerState): void {
    const urlKeys = this.parseLayersFromUrl();

    if (urlKeys.length > 0) {
      layerState.enableFromUrlKeys(urlKeys);
    } else {
      layerState.enableDefaults();
    }
  }
}
