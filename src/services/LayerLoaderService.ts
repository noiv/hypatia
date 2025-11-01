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
    scene: Scene
  ): Promise<LayerLoadResult> {
    const layerId = entry.layer.id;

    try {
      console.log(`LayerLoaderService: Loading layer ${layerId}`);

      // Route to appropriate loader based on layer ID
      switch (layerId) {
        case 'temp2m':
          await scene.loadTemp2mLayer();
          break;

        case 'precipitation':
          await scene.loadPratesfcLayer();
          break;

        case 'wind10m':
          await scene.loadWindLayer();
          break;

        default:
          throw new Error(`No loader implemented for layer: ${layerId}`);
      }

      console.log(`LayerLoaderService: Successfully loaded layer ${layerId}`);
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

    console.log(`LayerLoaderService: Unloading layer ${layerId}`);

    switch (layerId) {
      case 'temp2m':
        scene.toggleTemp2m(false);
        break;

      case 'precipitation':
        scene.toggleRain(false);
        break;

      case 'wind10m':
        scene.toggleWind(false);
        break;

      default:
        console.warn(`No unloader implemented for layer: ${layerId}`);
    }

    console.log(`LayerLoaderService: Layer ${layerId} hidden`);
  }

  /**
   * Update layer data for new time
   */
  static async updateLayerTime(
    entry: LayerStateEntry,
    scene: Scene,
    _newTime: Date
  ): Promise<LayerLoadResult> {
    // For now, reload the layer with new time
    // Future: implement incremental updates
    return this.loadLayer(entry, scene);
  }
}
