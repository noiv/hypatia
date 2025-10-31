/**
 * Layer State Management
 *
 * Dynamic layer state driven by configuration
 */

import type { Layer } from '../config/types';

export type LayerStatus = 'disabled' | 'loading' | 'active';

export interface LayerStateEntry {
  layer: Layer;
  status: LayerStatus;
}

export class LayerState {
  private layers: Map<string, LayerStateEntry> = new Map();

  /**
   * Initialize from layer configurations
   */
  constructor(layerConfigs: Layer[]) {
    for (const layer of layerConfigs) {
      this.layers.set(layer.id, {
        layer,
        status: 'disabled'
      });
    }
  }

  /**
   * Enable layers from URL keys (e.g., ['temp', 'wind'])
   */
  enableFromUrlKeys(urlKeys: string[]): void {
    for (const [layerId, entry] of this.layers) {
      if (urlKeys.includes(entry.layer.urlKey)) {
        entry.status = 'active';
      }
    }
  }

  /**
   * Enable default layers
   */
  enableDefaults(): void {
    for (const entry of this.layers.values()) {
      if (entry.layer.ui.defaultEnabled) {
        entry.status = 'active';
      }
    }
  }

  /**
   * Get layer state by ID
   */
  get(layerId: string): LayerStateEntry | undefined {
    return this.layers.get(layerId);
  }

  /**
   * Get layer state by URL key
   */
  getByUrlKey(urlKey: string): LayerStateEntry | undefined {
    for (const entry of this.layers.values()) {
      if (entry.layer.urlKey === urlKey) {
        return entry;
      }
    }
    return undefined;
  }

  /**
   * Set layer status
   */
  setStatus(layerId: string, status: LayerStatus): void {
    const entry = this.layers.get(layerId);
    if (entry) {
      entry.status = status;
    }
  }

  /**
   * Check if layer is enabled (loading or active)
   */
  isEnabled(layerId: string): boolean {
    const entry = this.layers.get(layerId);
    return entry ? entry.status !== 'disabled' : false;
  }

  /**
   * Check if layer is active
   */
  isActive(layerId: string): boolean {
    const entry = this.layers.get(layerId);
    return entry ? entry.status === 'active' : false;
  }

  /**
   * Check if layer is loading
   */
  isLoading(layerId: string): boolean {
    const entry = this.layers.get(layerId);
    return entry ? entry.status === 'loading' : false;
  }

  /**
   * Toggle layer on/off
   */
  toggle(layerId: string): LayerStatus {
    const entry = this.layers.get(layerId);
    if (!entry) {
      throw new Error(`Layer ${layerId} not found`);
    }

    if (entry.status === 'disabled') {
      entry.status = 'loading';
    } else {
      entry.status = 'disabled';
    }

    return entry.status;
  }

  /**
   * Get all layers sorted by UI order
   */
  getAllLayers(): LayerStateEntry[] {
    return Array.from(this.layers.values()).sort((a, b) => {
      if (a.layer.ui.group !== b.layer.ui.group) {
        return a.layer.ui.group.localeCompare(b.layer.ui.group);
      }
      return a.layer.ui.order - b.layer.ui.order;
    });
  }

  /**
   * Get active layers
   */
  getActiveLayers(): LayerStateEntry[] {
    return Array.from(this.layers.values())
      .filter(entry => entry.status === 'active');
  }

  /**
   * Get URL keys for active layers
   */
  getActiveUrlKeys(): string[] {
    return this.getActiveLayers()
      .map(entry => entry.layer.urlKey);
  }

  /**
   * Get layers by group
   */
  getLayersByGroup(group: string): LayerStateEntry[] {
    return Array.from(this.layers.values())
      .filter(entry => entry.layer.ui.group === group)
      .sort((a, b) => a.layer.ui.order - b.layer.ui.order);
  }
}
