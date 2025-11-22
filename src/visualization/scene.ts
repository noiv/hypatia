import * as THREE from 'three';
import { ViewportControlsService, type ViewportControlsCallbacks, tweenGroup } from '../services/ViewportControlsService';
import type { LayerRenderState } from '../config/types';
import type { ILayer, LayerId } from '../layers/ILayer';
import type { AnimationState } from './IAnimationState';
import type { EarthRenderService } from '../layers/earth/earth.render-service';
import type { SunRenderService } from '../layers/sun/sun.render-service';
import { TextRenderService } from '../layers/text/text.render-service';
import { updateProgressCanvas } from '../components/ProgressCanvas';
import type { DownloadService } from '../services/DownloadService';
import * as perform from '../utils/performance';
import { mouseToNDC, raycastObject, cartesianToLatLon } from '../utils/raycasting';

export class Scene {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private viewportControls?: ViewportControlsService;
  private layers: Map<LayerId, ILayer> = new Map();
  private preloadedImages?: Map<string, HTMLImageElement> | undefined;
  private currentTime: Date;
  private animationId: number | null = null;
  private raycaster: THREE.Raycaster;
  private lastFrameTime: number = performance.now();
  private stats: Stats | null = null;
  private perform = perform;
  private performanceElement: HTMLElement | null = null;
  private textEnabled: boolean = false;
  private progressCanvases: Map<LayerId, HTMLCanvasElement> = new Map();
  private downloadService: DownloadService | null = null;

  constructor(canvas: HTMLCanvasElement, initialTime?: Date, preloadedImages?: Map<string, HTMLImageElement>) {
    this.preloadedImages = preloadedImages;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x161616);

    // Get size from parent container or window
    const container = canvas.parentElement;
    const width = container ? container.clientWidth : window.innerWidth;
    const height = container ? container.clientHeight : window.innerHeight;

    // Camera (75° frustum as specified)
    this.camera = new THREE.PerspectiveCamera(
      75,
      width / height,
      0.1,
      1000
    );
    this.camera.position.set(0, 0, 3);
    this.camera.lookAt(0, 0, 0);

    // Raycaster for mouse interaction
    this.raycaster = new THREE.Raycaster();

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Stats.js for FPS monitoring
    // @ts-ignore - Stats is loaded via script tag
    this.stats = new Stats();
    this.stats.showPanel(0); // 0: fps, 1: ms, 2: mb
    this.stats.dom.style.left = 'auto';
    this.stats.dom.style.right = '0px';
    document.body.appendChild(this.stats.dom);

    // high-res performance render measurements
    this.perform = perform;

    // Ambient light (dim) so dark side isn't completely black
    const ambient = new THREE.AmbientLight(0x404040, 0.4);
    this.scene.add(ambient);

    // Note: Debug axes are now handled by DebugRenderService layer (dev only)
    // Note: Mouse/click/wheel event listeners are managed by App component
    // ViewportControlsService handles all input and camera controls

    // Initialize current time (use provided initialTime from URL, or fallback to browser time)
    this.currentTime = initialTime || new Date();

    // No default layers - all layers are optional and loaded on demand
    // Layers are loaded via createLayer() method from URL state or user interaction

    // Note: Animation loop is NOT started here - call start() after bootstrap
  }

  /**
   * Start the animation loop
   * Should be called after bootstrap completes and initial layers are loaded
   */
  start(): void {
    if (!this.animationId) {
      console.log('Scene.animate');
      this.animate();
    }
  }

  /**
   * Create viewport controls service (called after Scene construction)
   */
  createViewportControls(callbacks: ViewportControlsCallbacks, configService: any, dateTimeService?: any): ViewportControlsService {
    this.viewportControls = new ViewportControlsService(
      this.camera,
      this,
      configService,
      callbacks,
      dateTimeService
    );
    return this.viewportControls;
  }

  /**
   * Get renderer (for ViewportControlsService)
   */
  getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  /**
   * Get preloaded images (for Earth layer)
   */
  getPreloadedImages(): Map<string, HTMLImageElement> | undefined {
    return this.preloadedImages;
  }

  /**
   * Render a single frame (used during bootstrap to upload empty textures to GPU)
   */
  renderFrame(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Add a layer to the scene (used by LayersService)
   * @param layerId - Layer identifier
   * @param layer - ILayer instance
   * @param sceneObject - THREE.js object to add to scene
   */
  addLayer(layerId: LayerId, layer: ILayer, sceneObject: THREE.Object3D): void {
    // Store layer reference for getLayer() compatibility
    this.layers.set(layerId, layer);
    // Add THREE.js object to scene
    this.scene.add(sceneObject);
  }

  /**
   * Get layer by ID (for ViewportControlsService)
   */
  getLayer(layerId: LayerId): ILayer | undefined {
    return this.layers.get(layerId);
  }


  onWindowResize = () => {
    const canvas = this.renderer.domElement;
    const container = canvas.parentElement;
    const width = container ? container.clientWidth : window.innerWidth;
    const height = container ? container.clientHeight : window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);

    // Update Line2 material resolution for wind layer
    const windLayer = this.layers.get('wind');
    if (windLayer && 'setResolution' in windLayer && typeof (windLayer as any).setResolution === 'function') {
      (windLayer as any).setResolution(width, height);
    }
  };

  onMouseDown = (_e: MouseEvent) => {
    // Reserved for future use (cursor changes, drag detection, etc.)
  };

  onClick = (e: MouseEvent) => {
    const earthLayer = this.layers.get('earth');
    if (!earthLayer) return;

    const mouse = mouseToNDC(e.clientX, e.clientY, this.renderer.domElement);
    const intersection = raycastObject(mouse, this.camera, earthLayer.getSceneObject(), this.raycaster);

    if (intersection?.point) {
      const { lat, lon } = cartesianToLatLon(intersection.point);
      console.log(`Clicked: Lat=${lat.toFixed(2)}, Lon=${lon.toFixed(2)}`);
    }
  };

  /**
   *  ANIMATE
   */

  private animate = () => {
    this.stats?.begin();
    this.perform.done('fps')
    this.perform.start('fps')
    this.perform.start('frame')

    this.animationId = requestAnimationFrame(this.animate);

    // Calculate frame timing
    const currentTime = performance.now();
    const deltaTime = (currentTime - this.lastFrameTime) / 1000;
    this.lastFrameTime = currentTime;

    // Update tween animations
    tweenGroup.update();

    // Update viewport controls
    if (this.viewportControls) {
      this.viewportControls.update();
    }

    // Build animation state once
    const distance = this.camera.position.length();
    const animState: AnimationState = {
      time: this.currentTime,
      deltaTime,
      wallTime: currentTime,
      camera: {
        position: this.camera.position,
        distance,
        quaternion: this.camera.quaternion
      },
      sunDirection: this.getSunDirection(),
      textEnabled: this.textEnabled,
      collectedText: new Map()
    };

    // Single iteration over sorted layers
    this.perform.start('update');
    const sortedLayers = this.getSortedLayers();
    sortedLayers.forEach(layer => {
      layer.update(animState);
    });
    this.perform.done('update');

    // Render
    this.perform.start('render');
    this.renderer.render(this.scene, this.camera);
    this.perform.done('render');

    this.stats?.end();
    this.perform.done('frame');

    // Update performance display directly (no Mithril redraw)
    if (this.performanceElement) {
      this.performanceElement.textContent = this.perform.line();
    }

    // Update progress canvases directly (no Mithril redraw)
    this.updateProgressCanvases(currentTime);
  };

  /**
   * Update time - stores new time for next animate() frame
   */
  updateTime(time: Date) {
    this.currentTime = time;
    // Next animate() will pick up the change
  }

  /**
   * Get sun direction for lighting
   * Returns zero vector if sun layer not present or not visible
   */
  private getSunDirection(): THREE.Vector3 {
    const sunLayer = this.layers.get('sun') as SunRenderService | undefined;
    if (sunLayer && sunLayer.getSceneObject().visible) {
      return sunLayer.getSunDirection();
    }
    // No sun or sun disabled - use flat lighting (no day/night effect)
    return new THREE.Vector3(0, 0, 0);
  }

  /**
   * Get layers sorted by updateOrder from config
   */
  private getSortedLayers(): ILayer[] {
    return Array.from(this.layers.values())
      .sort((a, b) => {
        return a.getConfig().updateOrder - b.getConfig().updateOrder;
      });
  }

  /**
   * Set basemap blend factor (0.0 = rtopo2, 1.0 = gmlc)
   */
  setBasemapBlend(blend: number) {
    const earthLayer = this.layers.get('earth') as EarthRenderService | undefined;
    if (earthLayer) {
      (earthLayer as any).setBlend(blend);
    }
  }

  /**
   * Get camera state (position and distance)
   */
  getCameraState(): { x: number; y: number; z: number; distance: number } {
    const target = new THREE.Vector3(0, 0, 0); // Camera always looks at origin
    return {
      x: this.camera.position.x,
      y: this.camera.position.y,
      z: this.camera.position.z,
      distance: this.camera.position.distanceTo(target)
    };
  }

  /**
   * Set camera position and distance
   */
  setCameraState(position: { x: number; y: number; z: number }, distance: number) {
    // Calculate normalized direction
    const direction = new THREE.Vector3(position.x, position.y, position.z);
    direction.normalize();

    // Set camera position at specified distance
    this.camera.position.set(
      direction.x * distance,
      direction.y * distance,
      direction.z * distance
    );

    this.camera.lookAt(0, 0, 0);
  }

  /**
   * Check if mouse position is over Earth using screen-space projection
   * Accounts for camera distance - calculates visible radius based on silhouette edge
   * Works regardless of Earth layer visibility
   */
  checkMouseOverEarth(clientX: number, clientY: number): boolean {
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();

    // Convert client coordinates to canvas-relative coordinates
    const canvasX = clientX - rect.left;
    const canvasY = clientY - rect.top;

    // Project Earth center (0,0,0) to screen space
    const centerWorld = new THREE.Vector3(0, 0, 0);
    const centerScreen = centerWorld.clone().project(this.camera);

    // Check if Earth is behind camera
    if (centerScreen.z > 1) return false;

    // Convert NDC to canvas coordinates
    const centerX = (centerScreen.x * 0.5 + 0.5) * rect.width;
    const centerY = (1 - (centerScreen.y * 0.5 + 0.5)) * rect.height;

    // Calculate visible radius based on camera distance
    // Find a point on Earth's silhouette edge (perpendicular to view direction)
    const EARTH_RADIUS = 1; // EARTH_RADIUS_UNITS

    // Get camera's view direction and perpendicular vector
    const viewDirection = new THREE.Vector3(0, 0, 0).sub(this.camera.position).normalize();
    const upVector = this.camera.up.clone().normalize();

    // Create a perpendicular vector to find a point on the silhouette
    const perpVector = new THREE.Vector3().crossVectors(viewDirection, upVector).normalize();

    // Calculate point on Earth's edge perpendicular to view direction
    // This point is on the visible silhouette from camera's perspective
    const edgePoint = perpVector.multiplyScalar(EARTH_RADIUS);
    const edgeScreen = edgePoint.clone().project(this.camera);

    const edgeX = (edgeScreen.x * 0.5 + 0.5) * rect.width;
    const edgeY = (1 - (edgeScreen.y * 0.5 + 0.5)) * rect.height;

    // Calculate projected radius (distance from center to edge in screen space)
    const projectedRadius = Math.sqrt(
      Math.pow(edgeX - centerX, 2) + Math.pow(edgeY - centerY, 2)
    );

    // Check if mouse is within projected circle
    const mouseDistance = Math.sqrt(
      Math.pow(canvasX - centerX, 2) + Math.pow(canvasY - centerY, 2)
    );

    return mouseDistance <= projectedRadius;
  }

  // ========================================================================
  // Layer Management API
  // ========================================================================

  /**
   * Toggle layer visibility (layer must be created first)
   */
  setLayerVisible(layerId: LayerId, visible: boolean): void {
    const layer = this.layers.get(layerId);
    if (layer) {
      layer.setVisible(visible);
      // Sun direction updates automatically on next frame via animate()
    }
  }

  /**
   * Toggle multiple layers at once
   */
  toggleLayers(layerIds: LayerId[], visible: boolean): void {
    for (const layerId of layerIds) {
      this.setLayerVisible(layerId, visible);
    }
  }

  /**
   * Check if layer is created (data loaded, visualization exists)
   */
  isLayerCreated(layerId: LayerId): boolean {
    return this.layers.has(layerId);
  }

  /**
   * Check if layer is visible
   */
  private isLayerVisible(layerId: LayerId): boolean {
    const layer = this.layers.get(layerId);
    if (!layer) return false;

    const sceneObject = layer.getSceneObject();
    return sceneObject.visible;
  }

  /**
   * Get layer render state
   */
  getLayerState(layerId: LayerId): LayerRenderState {
    const created = this.isLayerCreated(layerId);
    if (!created) {
      return { created: false, visible: false };
    }
    return { created: true, visible: this.isLayerVisible(layerId) };
  }

  /**
   * Get all created layer IDs
   */
  getCreatedLayers(): LayerId[] {
    return Array.from(this.layers.keys());
  }

  /**
   * Get all visible layer IDs
   */
  getVisibleLayers(): LayerId[] {
    return this.getCreatedLayers().filter(layerId => this.isLayerVisible(layerId));
  }

  /**
   * Get text service for label management
   */
  getTextService(): TextRenderService | undefined {
    const textLayer = this.layers.get('text');
    return textLayer as TextRenderService | undefined;
  }

  /**
   * Set text enabled state (broadcasts to all layers)
   */
  setTextEnabled(enabled: boolean): void {
    this.textEnabled = enabled;
    // Next animate() will pick up the change
  }

  /**
   * Set performance display element for direct DOM updates
   */
  setPerformanceElement(element: HTMLElement): void {
    this.performanceElement = element;
  }

  /**
   * Set download service for progress canvas updates
   */
  setDownloadService(downloadService: DownloadService): void {
    this.downloadService = downloadService;
  }

  /**
   * Register a progress canvas for direct updates in animate() loop
   */
  setProgressCanvas(layerId: LayerId, canvas: HTMLCanvasElement): void {
    this.progressCanvases.set(layerId, canvas);
  }

  /**
   * Update all progress canvases with current download state
   * Called from animate() loop with wallTime for pulsing animations
   */
  private updateProgressCanvases(wallTime: number): void {
    if (!this.downloadService) return;

    this.progressCanvases.forEach((canvas, layerId) => {
      const totalTimestamps = this.downloadService!.getTimestepCount(layerId);
      const loadedIndices = this.downloadService!.getLoadedIndices(layerId);
      const loadingIndex = this.downloadService!.getLoadingIndex(layerId);
      const failedIndices = this.downloadService!.getFailedIndices(layerId);

      updateProgressCanvas(
        canvas,
        layerId,
        totalTimestamps,
        loadedIndices,
        loadingIndex,
        failedIndices,
        wallTime
      );
    });
  }

  /**
   * Clean up resources
   */
  dispose() {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
    }

    // Dispose all layers
    this.layers.forEach(layer => {
      layer.dispose();
    });
    this.layers.clear();

    // Dispose viewport controls (which disposes OrbitControls)
    if (this.viewportControls) {
      this.viewportControls.dispose();
    }

    // Dispose THREE.js resources
    this.renderer.dispose();
  }
}
