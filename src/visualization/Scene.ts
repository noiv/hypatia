import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
// import { latLonToCartesian } from '../utils/coordinates';
import { DataService } from '../services/DataService';
import type { LayerRenderState } from '../config/types';
import type { ILayer, LayerId } from './ILayer';
import { LayerFactory } from './LayerFactory';
import type { SunLayer } from './SunLayer';
import type { EarthLayer } from './EarthLayer';
import type { WindLayerGPUCompute } from './WindLayerGPUCompute';

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
  private mouseOverEarth: boolean = false;
  private lastFrameTime: number = performance.now();
  private stats: any;
  private dataService: DataService;

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
    const windLayer = this.layers.get('wind10m') as WindLayerGPUCompute | undefined;
    if (windLayer) {
      windLayer.setResolution(width, height);
    }
  };

  onMouseDown = (e: MouseEvent) => {
    // Check if mouse is over Earth
    this.checkEarthIntersection(e.clientX, e.clientY);
  };

  onClick = (e: MouseEvent) => {
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();

    // Convert to normalized device coordinates (-1 to +1)
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    // Update raycaster
    this.raycaster.setFromCamera(mouse, this.camera);

    // Check intersection with Earth mesh
    const earthLayer = this.layers.get('earth');
    if (!earthLayer) return;

    const earthObject = earthLayer.getSceneObject();
    const intersects = this.raycaster.intersectObject(earthObject, false);

    if (intersects.length > 0) {
      // Click detected on Earth
    }
  };

  private animate = () => {
    this.stats.begin();

    this.animationId = requestAnimationFrame(this.animate);

    // Calculate delta time
    const currentTime = performance.now();
    const deltaTime = (currentTime - this.lastFrameTime) / 1000; // Convert to seconds
    this.lastFrameTime = currentTime;

    // Adjust rotation speed based on altitude above surface
    // Makes mouse pointer "stick" to same location while dragging
    const distance = this.camera.position.length();
    const altitude = distance - 1.0; // altitude above Earth surface (radius = 1)
    const baseSpeed = 1.0;
    this.controls.rotateSpeed = baseSpeed * altitude;

    // Update controls (damping)
    this.controls.update();

    // Update sun layer camera position (for atmosphere shader if enabled)
    const sunLayer = this.layers.get('sun') as SunLayer | undefined;
    if (sunLayer) {
      sunLayer.setCameraPosition(this.camera.position);
    }

    // Update all layers with camera distance (polymorphic call)
    this.layers.forEach(layer => {
      layer.updateDistance(distance);
    });

    // Update wind layer animation (wind-specific)
    const windLayer = this.layers.get('wind10m') as WindLayerGPUCompute | undefined;
    if (windLayer) {
      windLayer.updateAnimation(deltaTime);
    }

    // Render
    this.renderer.render(this.scene, this.camera);

    this.stats.end();
  };

  /**
   * Update time - updates all layers polymorphically
   */
  updateTime(time: Date) {
    this.currentTime = time;

    // Update all layers (polymorphic call)
    this.layers.forEach(layer => {
      layer.updateTime(time);
    });

    // Update sun direction for all layers (polymorphic call)
    const sunLayer = this.layers.get('sun') as SunLayer | undefined;

    // Get sun direction - use neutral direction if sun layer not present or not visible
    let sunDir: THREE.Vector3;
    if (sunLayer && sunLayer.getSceneObject().visible) {
      sunDir = sunLayer.getSunDirection();
    } else {
      // No sun or sun disabled - use flat lighting (no day/night effect)
      sunDir = new THREE.Vector3(0, 0, 0);
    }

    // Update all layers with sun direction (polymorphic call)
    this.layers.forEach(layer => {
      layer.updateSunDirection(sunDir);
    });
  }

  /**
   * Set basemap blend factor (0.0 = rtopo2, 1.0 = gmlc)
   */
  setBasemapBlend(blend: number) {
    const earthLayer = this.layers.get('earth') as EarthLayer | undefined;
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
   * Check if mouse position intersects Earth
   * @param x - Mouse X in pixels
   * @param y - Mouse Y in pixels
   * @returns true if mouse is over Earth
   */
  checkEarthIntersection(x: number, y: number): boolean {
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();

    // Convert to normalized device coordinates (-1 to +1)
    const mouse = new THREE.Vector2(
      ((x - rect.left) / rect.width) * 2 - 1,
      -((y - rect.top) / rect.height) * 2 + 1
    );

    // Update raycaster
    this.raycaster.setFromCamera(mouse, this.camera);

    // Check intersection with Earth mesh
    const earthLayer = this.layers.get('earth');
    if (!earthLayer) {
      this.mouseOverEarth = false;
      return false;
    }

    const earthObject = earthLayer.getSceneObject();
    const intersects = this.raycaster.intersectObject(earthObject, false);

    this.mouseOverEarth = intersects.length > 0;
    return this.mouseOverEarth;
  }

  /**
   * Get whether mouse is currently over Earth
   */
  isMouseOverEarth(): boolean {
    return this.mouseOverEarth;
  }

  /**
   * Toggle orbit controls
   */
  toggleControls(enabled: boolean) {
    this.controls.enabled = enabled;
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

    // Special handling for sun layer - add directional light
    if (layerId === 'sun') {
      const sunLayer = layer as SunLayer;
      this.scene.add(sunLayer.getLight());
      this.scene.add(sunLayer.getLight().target);
    }

    // Update with current time
    layer.updateTime(this.currentTime);

    return true;
  }

  /**
   * Toggle layer visibility (layer must be created first)
   */
  setLayerVisible(layerId: LayerId, visible: boolean): void {
    const layer = this.layers.get(layerId);
    if (layer) {
      layer.setVisible(visible);

      // Special handling: when sun visibility changes, update sun direction immediately
      if (layerId === 'sun') {
        this.updateTime(this.currentTime);
      }
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
