/**
 * Scene Lifecycle Service
 *
 * Manages Scene initialization and disposal.
 * Separates scene management logic from app component.
 */

import { Scene } from '../visualization/scene';

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
