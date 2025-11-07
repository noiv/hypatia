/**
 * App Logic Service
 *
 * Contains business logic for:
 * - Layer toggle operations
 * - URL state synchronization
 * - Reference state navigation
 */

import { AppStateService } from './AppStateService';
import { SceneLifecycleService } from './SceneLifecycleService';
import { configLoader } from '../config';
import { debouncedUpdateUrlState } from '../utils/urlState';
import type { LayerId } from '../visualization/ILayer';

export class AppLogicService {
  constructor(
    private stateService: AppStateService,
    private sceneService: SceneLifecycleService,
    private isBootstrapping: () => boolean
  ) {}

  /**
   * Handle layer toggle (create if needed, toggle visibility)
   */
  async handleLayerToggle(layerId: LayerId): Promise<void> {
    const scene = this.sceneService.getScene();
    if (!scene) return;

    try {
      const state = scene.getLayerState(layerId);

      if (!state.created) {
        // Layer not created yet - create and show it
        await scene.createLayer(layerId);
        scene.setLayerVisible(layerId, true);
      } else {
        // Layer exists - toggle visibility
        scene.setLayerVisible(layerId, !state.visible);
      }
    } catch (error) {
      console.error(`Layer toggle failed:`, error);
    }
  }

  /**
   * Update URL with current application state
   */
  updateUrl(): void {
    // Don't update URL during bootstrap - preserve URL parameters from page load
    if (this.isBootstrapping()) {
      return;
    }

    const scene = this.sceneService.getScene();
    const state = this.stateService.get();
    if (!scene) return;

    // Get visible layers from scene (returns LayerIDs like 'temp2m')
    const visibleLayerIds = scene.getVisibleLayers();

    // Convert LayerIDs to URL keys (temp2m -> temp, etc.)
    const visibleUrlKeys = visibleLayerIds.map(layerId =>
      configLoader.layerIdToUrlKey(layerId)
    );

    // Add 'text' to layers if enabled and not already present
    const layers = state.textEnabled && !visibleUrlKeys.includes('text')
      ? [...visibleUrlKeys, 'text']
      : visibleUrlKeys;

    debouncedUpdateUrlState({
      time: state.currentTime,
      camera: scene.getCameraState(),
      layers
    }, 100);
  }

  /**
   * Navigate to reference state (fixed time and position)
   */
  handleReferenceClick(): void {
    const scene = this.sceneService.getScene();

    // Reference state: 2x Earth radius altitude, looking at lat=0 lon=0
    const referenceTime = new Date('2025-10-29T12:00:00Z');
    const referenceAltitude = 12742000; // 2x Earth radius in meters
    const referenceDistance = (referenceAltitude / 6371000) + 1; // Convert to THREE.js units

    const referencePosition = {
      x: 0,
      y: 0,
      z: referenceDistance
    };

    // Update state
    this.stateService.setCurrentTime(referenceTime);

    if (scene) {
      scene.updateTime(referenceTime);
      scene.setCameraState(referencePosition, referenceDistance);
    }

    // Update URL
    this.updateUrl();
  }
}
