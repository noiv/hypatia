/**
 * Layer Toggle Service
 *
 * Handles user interactions for enabling/disabling layers
 */

import type { Scene } from '../visualization/Scene';
import { LayerState } from '../state/LayerState';
import { LayerLoaderService } from './LayerLoaderService';

export interface LayerToggleResult {
  success: boolean;
  newStatus: 'disabled' | 'loading' | 'active';
  error?: string | undefined;
}

export class LayerToggleService {
  /**
   * Check if a layer is actually loaded in the scene
   */
  private static isLayerLoadedInScene(layerId: string, scene: Scene): boolean {
    switch (layerId) {
      case 'temp2m':
        return scene.isTemp2mLoaded();
      case 'precipitation':
        return scene.isRainLoaded();
      case 'wind10m':
        return scene.isWindLoaded();
      default:
        return false;
    }
  }

  /**
   * Toggle a layer on/off
   */
  static async toggle(
    layerId: string,
    layerState: LayerState,
    scene: Scene | null
  ): Promise<LayerToggleResult> {
    const entry = layerState.get(layerId);

    if (!entry) {
      return {
        success: false,
        newStatus: 'disabled',
        error: `Layer ${layerId} not found`
      };
    }

    // Get current status before toggle
    const wasEnabled = layerState.isEnabled(layerId);

    // Toggle the state
    const newStatus = layerState.toggle(layerId);

    // If we're disabling, unload immediately
    if (wasEnabled && scene) {
      LayerLoaderService.unloadLayer(entry, scene);
      return {
        success: true,
        newStatus
      };
    }

    // If we're enabling, start loading
    if (!wasEnabled && scene) {
      const result = await LayerLoaderService.loadLayer(entry, scene);

      if (result.success) {
        layerState.setStatus(layerId, 'active');
        return {
          success: true,
          newStatus: 'active'
        };
      } else {
        // Loading failed, revert to disabled
        layerState.setStatus(layerId, 'disabled');
        return {
          success: false,
          newStatus: 'disabled',
          error: result.error
        };
      }
    }

    return {
      success: true,
      newStatus
    };
  }

  /**
   * Enable a layer
   */
  static async enable(
    layerId: string,
    layerState: LayerState,
    scene: Scene | null
  ): Promise<LayerToggleResult> {
    const entry = layerState.get(layerId);

    if (!entry) {
      return {
        success: false,
        newStatus: 'disabled',
        error: `Layer ${layerId} not found`
      };
    }

    // Check if layer is already loaded in the scene (not just enabled in state)
    const isActuallyLoaded = scene && this.isLayerLoadedInScene(layerId, scene);

    if (isActuallyLoaded) {
      // Already loaded, just ensure it's visible and state is correct
      layerState.setStatus(layerId, 'active');
      return {
        success: true,
        newStatus: 'active'
      };
    }

    layerState.setStatus(layerId, 'loading');

    if (!scene) {
      return {
        success: true,
        newStatus: 'loading'
      };
    }

    const result = await LayerLoaderService.loadLayer(entry, scene);

    if (result.success) {
      layerState.setStatus(layerId, 'active');
      return {
        success: true,
        newStatus: 'active'
      };
    } else {
      layerState.setStatus(layerId, 'disabled');
      return {
        success: false,
        newStatus: 'disabled',
        error: result.error
      };
    }
  }

  /**
   * Disable a layer
   */
  static disable(
    layerId: string,
    layerState: LayerState,
    scene: Scene | null
  ): LayerToggleResult {
    const entry = layerState.get(layerId);

    if (!entry) {
      return {
        success: false,
        newStatus: 'disabled',
        error: `Layer ${layerId} not found`
      };
    }

    if (scene) {
      LayerLoaderService.unloadLayer(entry, scene);
    }

    layerState.setStatus(layerId, 'disabled');

    return {
      success: true,
      newStatus: 'disabled'
    };
  }
}
