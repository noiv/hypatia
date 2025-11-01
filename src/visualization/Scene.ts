import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Earth } from './Earth';
import { Sun } from './Sun';
import { AtmosphereLayer } from './AtmosphereLayer';
import { Temp2mLayer } from './Temp2mLayer';
import { PratesfcLayer } from './PratesfcLayer';
import { WindLayerGPUCompute } from './WindLayerGPUCompute';
import { Temp2mService, TimeStep } from '../services/Temp2mService';
import { PratesfcService, TimeStep as PratesfcTimeStep } from '../services/PratesfcService';
import { latLonToCartesian } from '../utils/coordinates';
import { UserOptions } from '../services/UserOptionsService';
import { DataService, type LayerId } from '../services/DataService';
import type { LayerRenderState } from '../config/types';

export class Scene {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private earth: Earth;
  private sun: Sun;
  private atmosphereLayer: AtmosphereLayer | null = null;
  private temp2mLayer: Temp2mLayer | null = null;
  private temp2mTimeSteps: TimeStep[] = [];
  private pratesfcLayer: PratesfcLayer | null = null;
  private pratesfcTimeSteps: PratesfcTimeStep[] = [];
  private windLayerGPU: WindLayerGPUCompute | null = null;
  private currentTime: Date;
  private animationId: number | null = null;
  private onCameraChangeCallback: (() => void) | null = null;
  private raycaster: THREE.Raycaster;
  private mouseOverEarth: boolean = false;
  private lastDistance: number = 0;
  private zoomEndTimeout: number | null = null;
  private readonly zoomEndTimeoutMs = 500;
  private lastFrameTime: number = performance.now();
  private stats: any;
  private dataService: DataService;

  constructor(canvas: HTMLCanvasElement, preloadedImages?: Map<string, HTMLImageElement>, userOptions?: UserOptions) {
    this.dataService = new DataService();
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

    // Earth (always at center)
    this.earth = new Earth(preloadedImages);
    this.scene.add(this.earth.mesh);

    // Sun
    this.sun = new Sun();
    this.scene.add(this.sun.mesh);
    this.scene.add(this.sun.getLight());
    this.scene.add(this.sun.getLight().target);

    // Atmosphere (conditional based on user options)
    if (userOptions?.atmosphere.enabled) {
      this.atmosphereLayer = new AtmosphereLayer();
      this.scene.add(this.atmosphereLayer.mesh);
    }

    // Initialize sun direction for Earth's shader
    const sunDir = this.sun.mesh.position.clone().normalize();
    this.earth.setSunDirection(sunDir);

    // Ambient light (dim) so dark side isn't completely black
    const ambient = new THREE.AmbientLight(0x404040, 0.4);
    this.scene.add(ambient);

    // Add axes helpers
    this.addAxesHelpers();

    // Note: Mouse/click/wheel event listeners are managed by App component
    // OrbitControls manages its own wheel listener for zoom

    // Initialize current time
    this.currentTime = new Date();

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
    if (this.windLayerGPU) {
      this.windLayerGPU.setResolution(width, height);
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
    const intersects = this.raycaster.intersectObject(this.earth.mesh, false);

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

    // Update atmosphere layer uniforms (if enabled)
    if (this.atmosphereLayer) {
      this.atmosphereLayer.setCameraPosition(this.camera.position);
      this.atmosphereLayer.setSunPosition(this.sun.mesh.position);
    }

    // Update wind layer line width and animation based on camera altitude
    if (this.windLayerGPU) {
      this.windLayerGPU.updateLineWidth(distance);
      this.windLayerGPU.updateAnimation(deltaTime);

      // Detect zoom changes and log when zoom ends
      if (Math.abs(distance - this.lastDistance) > 0.001) {
        // Distance changed, reset timeout
        if (this.zoomEndTimeout !== null) {
          window.clearTimeout(this.zoomEndTimeout);
        }
        this.zoomEndTimeout = window.setTimeout(() => {
          // Zoom has ended, log the final values
          const altitudeKm = altitude * 6371; // Earth radius = 6371 km
          this.windLayerGPU?.updateLineWidth(altitudeKm);
        }, this.zoomEndTimeoutMs);
        this.lastDistance = distance;
      }
    }

    // Render
    this.renderer.render(this.scene, this.camera);

    this.stats.end();
  };

  /**
   * Update time - rotates sun around earth and updates data layers
   */
  updateTime(time: Date) {
    this.currentTime = time;
    this.sun.updatePosition(time);

    // Update sun direction for Earth's shader lighting
    const sunDir = this.sun.mesh.position.clone().normalize();
    this.earth.setSunDirection(sunDir);

    // Update temp2m layer if loaded
    if (this.temp2mLayer && this.temp2mTimeSteps.length > 0) {
      const timeIndex = Temp2mService.timeToIndex(time, this.temp2mTimeSteps);
      this.temp2mLayer.setTimeIndex(timeIndex);
      this.temp2mLayer.setSunDirection(sunDir);
    }

    // Update pratesfc layer if loaded
    if (this.pratesfcLayer && this.pratesfcTimeSteps.length > 0) {
      const timeIndex = PratesfcService.timeToIndex(time, this.pratesfcTimeSteps);
      this.pratesfcLayer.setTimeIndex(timeIndex);
    }

    // Update wind layer if loaded (async, but non-blocking)
    if (this.windLayerGPU) {
      this.windLayerGPU.updateTime(time).catch(err => {
        console.error('Failed to update wind layer:', err);
      });
    }
  }

  /**
   * Set basemap blend factor (0.0 = rtopo2, 1.0 = gmlc)
   */
  setBlend(blend: number) {
    this.earth.setBlend(blend);
  }

  /**
   * Load temp2m layer from manifest data
   */
  async loadTemp2mLayer(_delta: number = 1, onProgress?: (loaded: number, total: number) => void): Promise<void> {
    // Generate time steps from manifest
    this.temp2mTimeSteps = Temp2mService.generateTimeSteps();

    // Load data texture
    const dataTexture = await Temp2mService.loadTexture(this.temp2mTimeSteps, onProgress);

    // Create layer
    this.temp2mLayer = new Temp2mLayer(dataTexture, this.temp2mTimeSteps.length);

    // Add to scene
    this.scene.add(this.temp2mLayer.mesh);

    // Update with current time and sun direction
    const timeIndex = Temp2mService.timeToIndex(this.currentTime, this.temp2mTimeSteps);
    this.temp2mLayer.setTimeIndex(timeIndex);

    const sunDir = this.sun.mesh.position.clone().normalize();
    this.temp2mLayer.setSunDirection(sunDir);
  }

  /**
   * Load pratesfc (precipitation) layer from manifest data
   */
  async loadPratesfcLayer(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    // Generate time steps from manifest
    this.pratesfcTimeSteps = PratesfcService.generateTimeSteps();

    // Load data texture
    const dataTexture = await PratesfcService.loadTexture(this.pratesfcTimeSteps, onProgress);

    // Create layer
    this.pratesfcLayer = new PratesfcLayer(dataTexture, this.pratesfcTimeSteps.length);

    // Add to scene
    this.scene.add(this.pratesfcLayer.mesh);

    // Update with current time
    const timeIndex = PratesfcService.timeToIndex(this.currentTime, this.pratesfcTimeSteps);
    this.pratesfcLayer.setTimeIndex(timeIndex);
  }

  /**
   * Toggle temp2m layer visibility
   */
  toggleTemp2m(visible: boolean) {
    if (this.temp2mLayer) {
      this.temp2mLayer.setVisible(visible);
    }
  }

  /**
   * Check if temp2m layer is loaded
   */
  isTemp2mLoaded(): boolean {
    return this.temp2mLayer !== null;
  }

  /**
   * Toggle pratesfc layer visibility
   */
  toggleRain(visible: boolean) {
    if (this.pratesfcLayer) {
      this.pratesfcLayer.setVisible(visible);
    }
  }

  /**
   * Check if pratesfc layer is loaded
   */
  isRainLoaded(): boolean {
    return this.pratesfcLayer !== null;
  }

  /**
   * Load wind layer with GPU compute
   */
  async loadWindLayer(): Promise<void> {
    if (this.windLayerGPU) {
      this.windLayerGPU.setVisible(true);
      return;
    }

    this.windLayerGPU = new WindLayerGPUCompute(8192);

    // Initialize WebGPU
    await this.windLayerGPU.initGPU(this.renderer);

    // Load all wind data timesteps and upload to GPU
    await this.windLayerGPU.loadWindData();

    // Trace initial geometry
    await this.windLayerGPU.updateTime(this.currentTime);

    // Add to scene
    this.scene.add(this.windLayerGPU.getGroup());

    // Ensure visibility is set to true
    this.windLayerGPU.setVisible(true);
  }

  /**
   * Toggle wind layer visibility
   */
  toggleWind(visible: boolean) {
    if (this.windLayerGPU) {
      this.windLayerGPU.setVisible(visible);
    }
  }

  /**
   * Check if wind layer is loaded
   */
  isWindLoaded(): boolean {
    return this.windLayerGPU !== null;
  }

  /**
   * Get camera position
   */
  getCameraPosition(): { x: number; y: number; z: number } {
    return {
      x: this.camera.position.x,
      y: this.camera.position.y,
      z: this.camera.position.z
    };
  }

  /**
   * Get camera distance from origin
   */
  getCameraDistance(): number {
    return this.camera.position.distanceTo(this.controls.target);
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
   * Set camera to look at a specific lat/lon location
   * @param lat - Latitude in degrees
   * @param lon - Longitude in degrees
   * @param distance - Camera distance from center (default 3)
   */
  setCameraToLocation(lat: number, lon: number, distance: number = 3) {
    const position = latLonToCartesian(lat, lon);
    this.setCameraState(
      { x: position.x, y: position.y, z: position.z },
      distance
    );
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
    const intersects = this.raycaster.intersectObject(this.earth.mesh, false);

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
   * Enable orbit controls
   */
  enableControls() {
    this.controls.enabled = true;
  }

  /**
   * Disable orbit controls
   */
  disableControls() {
    this.controls.enabled = false;
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
    if (this.isLayerCreated(layerId)) {
      return false;
    }

    // Create visualization based on layer type
    switch (layerId) {
      case 'temp2m':
        {
          // Load data through DataService
          const layerData = await this.dataService.loadLayer(layerId);
          this.temp2mTimeSteps = layerData.timeSteps;
          this.temp2mLayer = new Temp2mLayer(layerData.texture, layerData.timeSteps.length);
          this.scene.add(this.temp2mLayer.mesh);

          // Update with current time and sun direction
          const timeIndex = Temp2mService.timeToIndex(this.currentTime, this.temp2mTimeSteps);
          this.temp2mLayer.setTimeIndex(timeIndex);
          this.temp2mLayer.setSunDirection(this.sun.getDirection());
        }
        break;

      case 'precipitation':
        {
          // Load data through DataService
          const layerData = await this.dataService.loadLayer(layerId);
          this.pratesfcTimeSteps = layerData.timeSteps;
          this.pratesfcLayer = new PratesfcLayer(layerData.texture, layerData.timeSteps.length);
          this.scene.add(this.pratesfcLayer.mesh);

          // Update with current time
          const prateTimeIndex = PratesfcService.timeToIndex(this.currentTime, this.pratesfcTimeSteps);
          this.pratesfcLayer.setTimeIndex(prateTimeIndex);
        }
        break;

      case 'wind10m':
        // Wind layer doesn't use DataService yet - loads directly
        this.windLayerGPU = new WindLayerGPUCompute(8192);
        await this.windLayerGPU.initGPU(this.renderer);
        await this.windLayerGPU.loadWindData();
        await this.windLayerGPU.updateTime(this.currentTime);
        this.scene.add(this.windLayerGPU.getGroup());
        break;
    }

    return true;
  }

  /**
   * Toggle layer visibility (layer must be created first)
   */
  setLayerVisible(layerId: LayerId, visible: boolean): void {
    switch (layerId) {
      case 'temp2m':
        if (this.temp2mLayer) {
          this.temp2mLayer.setVisible(visible);
        }
        break;

      case 'precipitation':
        if (this.pratesfcLayer) {
          this.pratesfcLayer.setVisible(visible);
        }
        break;

      case 'wind10m':
        if (this.windLayerGPU) {
          this.windLayerGPU.setVisible(visible);
        }
        break;
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
    switch (layerId) {
      case 'temp2m':
        return this.temp2mLayer !== null;
      case 'precipitation':
        return this.pratesfcLayer !== null;
      case 'wind10m':
        return this.windLayerGPU !== null;
      default:
        return false;
    }
  }

  /**
   * Check if layer is visible
   */
  isLayerVisible(layerId: LayerId): boolean {
    switch (layerId) {
      case 'temp2m':
        return this.temp2mLayer?.mesh.visible ?? false;
      case 'precipitation':
        return this.pratesfcLayer?.mesh.visible ?? false;
      case 'wind10m':
        return this.windLayerGPU?.getGroup().visible ?? false;
      default:
        return false;
    }
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
    const layers: LayerId[] = [];
    if (this.temp2mLayer) layers.push('temp2m');
    if (this.pratesfcLayer) layers.push('precipitation');
    if (this.windLayerGPU) layers.push('wind10m');
    return layers;
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

    // Note: Event listeners are managed by App component, nothing to remove here
    this.controls.dispose();
    this.renderer.dispose();
    this.earth.dispose();
    this.sun.dispose();
  }
}
