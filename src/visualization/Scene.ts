import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Earth } from './Earth';
import { Sun } from './Sun';
import { cartesianToLatLon, formatLatLon } from '../utils/coordinates';

export class Scene {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private earth: Earth;
  private sun: Sun;
  private animationId: number | null = null;
  private onCameraChangeCallback: (() => void) | null = null;
  private raycaster: THREE.Raycaster;
  private mouseOverEarth: boolean = false;
  private onTimeScrollCallback: ((delta: number) => void) | null = null;
  private wheelGestureMode: 'none' | 'vertical' | 'horizontal' = 'none';
  private wheelGestureTimeout: number | null = null;
  private readonly wheelGestureTimeoutMs = 300;

  constructor(canvas: HTMLCanvasElement) {
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

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
    this.earth = new Earth();
    this.scene.add(this.earth.mesh);

    // Sun
    this.sun = new Sun();
    this.scene.add(this.sun.mesh);
    this.scene.add(this.sun.getLight());
    this.scene.add(this.sun.getLight().target);

    // Initialize sun direction for Earth's shader
    const sunDir = this.sun.mesh.position.clone().normalize();
    this.earth.setSunDirection(sunDir);

    // Ambient light (dim) so dark side isn't completely black
    const ambient = new THREE.AmbientLight(0x404040, 0.4);
    this.scene.add(ambient);

    // Add axes helpers
    this.addAxesHelpers();

    // Handle window resize
    window.addEventListener('resize', this.onWindowResize);

    // Handle mouse interaction for raycasting
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('click', this.onClick);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });

    // Start animation loop
    this.animate();

    console.log('Scene initialized');
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

    // Prime Meridian at 0° lon, 0° lat (green line from center to surface at +Z)
    const primeMeridianGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 1.2)
    ]);
    const primeMeridianLine = new THREE.Line(
      primeMeridianGeometry,
      new THREE.LineBasicMaterial({ color: 0x00ff00 })
    );
    this.scene.add(primeMeridianLine);
  }

  private onWindowResize = () => {
    const canvas = this.renderer.domElement;
    const container = canvas.parentElement;
    const width = container ? container.clientWidth : window.innerWidth;
    const height = container ? container.clientHeight : window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private onMouseDown = (e: MouseEvent) => {
    // Check if mouse is over Earth
    this.checkEarthIntersection(e.clientX, e.clientY);
  };

  private onClick = (e: MouseEvent) => {
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
      const intersection = intersects[0]!;
      const point = intersection.point;

      // Convert to lat/lon
      const { lat, lon } = cartesianToLatLon(point);
      const formatted = formatLatLon(lat, lon);

      console.log(`Clicked Earth at: ${formatted} (lat: ${lat.toFixed(3)}, lon: ${lon.toFixed(3)}) - XYZ: (${point.x.toFixed(3)}, ${point.y.toFixed(3)}, ${point.z.toFixed(3)})`);
    }
  };

  private onWheel = (e: WheelEvent) => {
    const absY = Math.abs(e.deltaY);
    const absX = Math.abs(e.deltaX);

    // Clear existing timeout
    if (this.wheelGestureTimeout) {
      clearTimeout(this.wheelGestureTimeout);
    }

    // Determine gesture mode only on first event (lock it in)
    if (this.wheelGestureMode === 'none') {
      if (absX > absY) {
        this.wheelGestureMode = 'horizontal';
      } else {
        this.wheelGestureMode = 'vertical';
      }
    }

    // Set timeout to reset gesture mode
    this.wheelGestureTimeout = window.setTimeout(() => {
      this.wheelGestureMode = 'none';
      this.wheelGestureTimeout = null;
      // Re-enable OrbitControls when gesture ends
      this.controls.enabled = true;
    }, this.wheelGestureTimeoutMs);

    // Execute appropriate action based on gesture mode
    if (this.wheelGestureMode === 'vertical') {
      // Vertical wheel: zoom via OrbitControls
      // Ensure OrbitControls is enabled
      this.controls.enabled = true;
    } else if (this.wheelGestureMode === 'horizontal') {
      // Horizontal wheel: change time
      // Disable OrbitControls to prevent zoom
      this.controls.enabled = false;
      e.preventDefault();

      if (this.onTimeScrollCallback) {
        // Determine time delta (hours)
        const hoursDelta = e.deltaX > 0 ? -1 : 1;
        this.onTimeScrollCallback(hoursDelta);
      }
    }
  };

  private animate = () => {
    this.animationId = requestAnimationFrame(this.animate);

    // Adjust rotation speed based on altitude above surface
    // Makes mouse pointer "stick" to same location while dragging
    const distance = this.camera.position.length();
    const altitude = distance - 1.0; // altitude above Earth surface (radius = 1)
    const baseSpeed = 1.0;
    this.controls.rotateSpeed = baseSpeed * altitude;

    // Update controls (damping)
    this.controls.update();

    // Render
    this.renderer.render(this.scene, this.camera);
  };

  /**
   * Update time - rotates sun around earth
   */
  updateTime(time: Date) {
    this.sun.updatePosition(time);

    // Update sun direction for Earth's shader lighting
    const sunDir = this.sun.mesh.position.clone().normalize();
    this.earth.setSunDirection(sunDir);
  }

  /**
   * Set basemap blend factor (0.0 = rtopo2, 1.0 = gmlc)
   */
  setBlend(blend: number) {
    this.earth.setBlend(blend);
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
   * Register callback for camera changes
   */
  onCameraChange(callback: () => void) {
    this.onCameraChangeCallback = callback;
    this.controls.addEventListener('change', callback);
  }

  /**
   * Register callback for time scroll (when scrolling over Earth)
   * @param callback - Called with hours delta (+1 or -1)
   */
  onTimeScroll(callback: (hoursDelta: number) => void) {
    this.onTimeScrollCallback = callback;
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
   * Clean up resources
   */
  dispose() {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
    }

    if (this.wheelGestureTimeout !== null) {
      clearTimeout(this.wheelGestureTimeout);
      this.wheelGestureTimeout = null;
    }

    if (this.onCameraChangeCallback) {
      this.controls.removeEventListener('change', this.onCameraChangeCallback);
    }

    const canvas = this.renderer.domElement;
    canvas.removeEventListener('mousedown', this.onMouseDown);
    canvas.removeEventListener('click', this.onClick);
    canvas.removeEventListener('wheel', this.onWheel);

    window.removeEventListener('resize', this.onWindowResize);
    this.controls.dispose();
    this.renderer.dispose();
    this.earth.dispose();
    this.sun.dispose();
  }
}
