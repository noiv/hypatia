/**
 * Layer Loader Service
 *
 * Handles async loading of layer data (textures, data files)
 */

import type { Scene } from '../visualization/Scene';
import type { LayerStateEntry } from '../state/LayerState';

export interface LayerLoadResult {
  success: boolean;
  error?: string;
}

export class LayerLoaderService {
  /**
   * Load a layer's data into the scene
   */
  static async loadLayer(
    entry: LayerStateEntry,
    scene: Scene,
    currentTime: Date
  ): Promise<LayerLoadResult> {
    const layerId = entry.layer.id;

    try {
      // Route to appropriate loader based on layer ID
      switch (layerId) {
        case 'temp2m':
          await scene.loadTemp2mLayer(currentTime);
          break;

        case 'precipitation':
          await scene.loadPratesfcLayer(currentTime);
          break;

        case 'wind10m':
          await scene.loadWindLayer(currentTime);
          break;

        default:
          throw new Error(`No loader implemented for layer: ${layerId}`);
      }

      return { success: true };

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to load layer ${layerId}:`, message);
      return {
        success: false,
        error: message
      };
    }
  }

  /**
   * Unload a layer from the scene
   */
  static unloadLayer(entry: LayerStateEntry, scene: Scene): void {
    const layerId = entry.layer.id;

    switch (layerId) {
      case 'temp2m':
        scene.temp2mLayer = null;
        break;

      case 'precipitation':
        scene.pratesfcLayer = null;
        break;

      case 'wind10m':
        scene.windLayer = null;
        break;

      default:
        console.warn(`No unloader implemented for layer: ${layerId}`);
    }
  }

  /**
   * Update layer data for new time
   */
  static async updateLayerTime(
    entry: LayerStateEntry,
    scene: Scene,
    newTime: Date
  ): Promise<LayerLoadResult> {
    // For now, reload the layer with new time
    // Future: implement incremental updates
    return this.loadLayer(entry, scene, newTime);
  }
}
