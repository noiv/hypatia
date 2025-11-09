/**
 * Scene Lifecycle Service
 *
 * Manages Scene initialization, layer loading, and disposal.
 * Separates scene management logic from app component.
 */

import { Scene } from '../visualization/scene';
import { configLoader } from '../config';
import type { LayerId } from '../visualization/ILayer';

export class SceneLifecycleService {
  private scene: Scene | null = null;

  /**
   * Initialize the Scene with canvas and initial state
   */
  async initializeScene(
    canvas: HTMLCanvasElement,
    initialState: {
      blend: number;
      currentTime: Date;
      cameraState?: { x: number; y: number; z: number; distance: number };
    },
    preloadedImages?: Map<string, HTMLImageElement>
  ): Promise<Scene> {
    const scene = new Scene(canvas, preloadedImages);

    // Set camera position from URL if available
    if (initialState.cameraState) {
      scene.setCameraState(
        initialState.cameraState,
        initialState.cameraState.distance
      );
    }

    // Set initial scene state
    scene.setBasemapBlend(initialState.blend);
    scene.updateTime(initialState.currentTime);

    this.scene = scene;
    return scene;
  }

  /**
   * Load layers from URL keys
   * Progress is tracked via LayerCacheControl events
   */
  async loadLayersFromUrl(layerUrlKeys: string[]): Promise<void> {
    if (!this.scene) {
      console.error('Scene not initialized');
      return;
    }

    if (layerUrlKeys.length > 0) {
      console.log(`Bootstrap.loading: ${layerUrlKeys.join(', ')}`);
    }

    for (const urlKey of layerUrlKeys) {
      try {
        // Convert URL key to layer ID (temp -> temp2m, etc.)
        const layerId = configLoader.urlKeyToLayerId(urlKey) as LayerId;

        // Create and show layer (data loading fires LayerCacheControl events)
        await this.scene.createLayer(layerId);
        this.scene.setLayerVisible(layerId, true);
      } catch (error) {
        console.error(`Bootstrap.error: ${urlKey}`, error);
      }
    }
  }

  /**
   * Get the scene instance
   */
  getScene(): Scene | null {
    return this.scene;
  }

  /**
   * Cleanup scene resources
   */
  dispose(): void {
    if (this.scene) {
      this.scene.dispose();
      this.scene = null;
    }
  }
}
