import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DataService } from '../services/DataService';
import type { LayerRenderState } from '../config/types';
import type { ILayer, LayerId } from './ILayer';
import type { AnimationState } from './AnimationState';
import { LayerFactory } from './LayerFactory';
import type { EarthRenderService } from './earth.render-service';
import type { SunRenderService } from './sun.render-service';
import { TextRenderService } from './text.render-service';
import * as perform from '../utils/performance';
import { mouseToNDC, raycastObject, cartesianToLatLon } from '../utils/raycasting';

export class Scene {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private layers: Map<LayerId, ILayer> = new Map();
  private preloadedImages?: Map<string, HTMLImageElement> | undefined;
  private currentTime: Date;
  private animationId: number | null = null;
  private onCameraChangeCallback: (() => void) | null = null;
  private raycaster: THREE.Raycaster;
  private lastFrameTime: number = performance.now();
  private stats: any;
  private perform: any;
  private performanceElement: HTMLElement | null = null;
  private dataService: DataService;
  private textEnabled: boolean = false;

  constructor(canvas: HTMLCanvasElement, preloadedImages?: Map<string, HTMLImageElement>) {
    this.dataService = new DataService();
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

    // Controls - smooth with damping for "mass" feeling
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.rotateSpeed = 0.5; // Base rotation speed (adjusted dynamically)
    this.controls.zoomSpeed = 0.8;
    this.controls.minDistance = 1.157; // 1M meters above surface
    this.controls.maxDistance = 10;
    this.controls.target.set(0, 0, 0); // Always look at scene origin

    // Ambient light (dim) so dark side isn't completely black
    const ambient = new THREE.AmbientLight(0x404040, 0.4);
    this.scene.add(ambient);

    // Add axes helpers
    this.addAxesHelpers();

    // Note: Mouse/click/wheel event listeners are managed by App component
    // OrbitControls manages its own wheel listener for zoom

    // Initialize current time
    this.currentTime = new Date();

    // No default layers - all layers are optional and loaded on demand
    // Layers are loaded via createLayer() method from URL state or user interaction

    // Start animation loop
    this.animate();
  }


  private addAxesHelpers() {
    // North Pole axis (red line from center to top)
    const northPoleGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 1.5, 0)
    ]);
    const northPoleLine = new THREE.Line(
      northPoleGeometry,
      new THREE.LineBasicMaterial({ color: 0xff0000 })
    );
    this.scene.add(northPoleLine);

    // South Pole axis (blue line from center to bottom)
    const southPoleGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, -1.5, 0)
    ]);
    const southPoleLine = new THREE.Line(
      southPoleGeometry,
      new THREE.LineBasicMaterial({ color: 0x0000ff })
    );
    this.scene.add(southPoleLine);

    // Prime Meridian at 0° lon, 0° lat (green line through entire sphere)
    // +Z direction: 0° lon, 0° lat
    // -Z direction: 180° lon, 0° lat (dateline)
    const primeMeridianGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, -1.2), // Through to 180° lon
      new THREE.Vector3(0, 0, 1.2)   // To 0° lon
    ]);
    const primeMeridianLine = new THREE.Line(
      primeMeridianGeometry,
      new THREE.LineBasicMaterial({ color: 0x00ff00 })
    );
    this.scene.add(primeMeridianLine);
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
    const windLayer = this.layers.get('wind10m');
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
    this.stats.begin();
    this.perform.done('fps')
    this.perform.start('fps')
    this.perform.start('frame')

    this.animationId = requestAnimationFrame(this.animate);

    // Calculate frame timing
    const currentTime = performance.now();
    const deltaTime = (currentTime - this.lastFrameTime) / 1000;
    this.lastFrameTime = currentTime;

    // Update controls
    const distance = this.camera.position.length();
    const altitude = distance - 1.0;
    this.controls.rotateSpeed = 1.0 * altitude;
    this.controls.update();

    // Build animation state once
    const animState: AnimationState = {
      time: this.currentTime,
      deltaTime,
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

    this.stats.end();
    this.perform.done('frame');

    // Update performance display directly (no Mithril redraw)
    if (this.performanceElement) {
      this.performanceElement.textContent = this.perform.line();
    }
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
    return {
      x: this.camera.position.x,
      y: this.camera.position.y,
      z: this.camera.position.z,
      distance: this.camera.position.distanceTo(this.controls.target)
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
   * Register callback for camera changes
   */
  onCameraChange(callback: () => void) {
    this.onCameraChangeCallback = callback;
    this.controls.addEventListener('change', callback);
  }


  /**
   * Toggle orbit controls
   */
  toggleControls(enabled: boolean) {
    this.controls.enabled = enabled;
  }

  /**
   * Check if mouse position is over Earth using screen-space projection
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

    // Project a point on Earth's surface to get projected radius
    const EARTH_RADIUS = 1; // EARTH_RADIUS_UNITS
    const surfacePoint = new THREE.Vector3(EARTH_RADIUS, 0, 0);
    const surfaceScreen = surfacePoint.clone().project(this.camera);

    const surfaceX = (surfaceScreen.x * 0.5 + 0.5) * rect.width;
    const surfaceY = (1 - (surfaceScreen.y * 0.5 + 0.5)) * rect.height;

    // Calculate projected radius
    const projectedRadius = Math.sqrt(
      Math.pow(surfaceX - centerX, 2) + Math.pow(surfaceY - centerY, 2)
    );

    // Check if mouse is within projected circle
    const mouseDistance = Math.sqrt(
      Math.pow(canvasX - centerX, 2) + Math.pow(canvasY - centerY, 2)
    );

    return mouseDistance <= projectedRadius;
  }

  // ========================================================================
  // New Unified Layer API
  // ========================================================================

  /**
   * Create a layer (loads data if needed, creates visualization)
   * Returns true if layer was created, false if already exists
   */
  async createLayer(layerId: LayerId): Promise<boolean> {
    // Check if already created
    if (this.layers.has(layerId)) {
      return false;
    }

    // Create layer using factory
    const layer = await LayerFactory.create(
      layerId,
      this.dataService,
      this.currentTime,
      this.preloadedImages,
      this.renderer
    );

    // Store and add to scene
    this.layers.set(layerId, layer);
    this.scene.add(layer.getSceneObject());

    return true;
  }

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
   * Clean up resources
   */
  dispose() {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
    }

    if (this.onCameraChangeCallback) {
      this.controls.removeEventListener('change', this.onCameraChangeCallback);
    }

    // Dispose all layers
    this.layers.forEach(layer => {
      layer.dispose();
    });
    this.layers.clear();

    // Dispose THREE.js resources
    this.controls.dispose();
    this.renderer.dispose();
  }
}
