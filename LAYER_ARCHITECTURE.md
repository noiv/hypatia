# Unified Layer Architecture - Implementation Plan

## Overview

Refactoring Hypatia to use a **polymorphic layer system** where all visual elements (Earth, Sun, Atmosphere, Weather Data) implement a common interface and are managed uniformly by Scene.

## Current Status: WIP (Work In Progress)

**Completed:**
- ✅ `ILayer` interface defined
- ✅ `TimeSeriesLayer` base class for weather data layers
- ✅ `Temp2mLayer` refactored to implement ILayer
- ✅ `LayerId` type unified across codebase

**In Progress:**
- ⏳ Refactoring remaining layers (PratesfcLayer, Sun, Earth, Atmosphere, Wind)
- ⏳ LayerFactory implementation
- ⏳ Scene refactor to use Map<LayerId, ILayer>

**Not Started:**
- ❌ DataService loading Earth basemap images
- ❌ Testing unified architecture
- ❌ Removing old LayerState/LayerToggleService/LayerLoaderService

## Architecture Design

### 1. ILayer Interface

**Contract all layers must implement:**

```typescript
interface ILayer {
  updateTime(time: Date): void;           // Update based on time
  setVisible(visible: boolean): void;     // Show/hide layer
  getSceneObject(): THREE.Object3D;       // Get THREE.js object for scene
  dispose(): void;                        // Clean up resources
  setOpacity?(opacity: number): void;     // Optional opacity control
}
```

### 2. Layer Types

**Type Definition:**
```typescript
type LayerId =
  | 'earth'          // Base globe geometry + 2 blendable basemaps
  | 'sun'            // Light source + visual mesh
  | 'atmosphere'     // Atmospheric scattering effect
  | 'temp2m'         // Temperature data (time-series)
  | 'precipitation'  // Precipitation data (time-series)
  | 'wind10m';       // Wind data (time-series)
```

### 3. Class Hierarchy

```
ILayer (interface)
├── TimeSeriesLayer (abstract class)
│   ├── Temp2mLayer
│   ├── PrecipitationLayer (renamed from PratesfcLayer)
│   └── WindLayer
└── Direct implementations
    ├── EarthLayer
    ├── SunLayer
    └── AtmosphereLayer
```

**TimeSeriesLayer:**
- Base class for weather data layers with time interpolation
- Owns `timeSteps: TimeStep[]`
- Implements `updateTime()` by calculating index and calling abstract `setTimeIndex()`
- Shared `calculateTimeIndex()` and `parseTimeStep()` logic
- Subclasses only implement visualization-specific methods

### 4. Factory Pattern

**LayerFactory for polymorphic creation:**

```typescript
class LayerFactory {
  static async create(
    layerId: LayerId,
    dataService: DataService,
    currentTime: Date,
    preloadedImages?: Map<string, HTMLImageElement>,
    renderer?: THREE.WebGLRenderer
  ): Promise<ILayer> {
    switch (layerId) {
      case 'earth':
        return EarthLayer.create(preloadedImages);

      case 'sun':
        return new SunLayer(currentTime);

      case 'atmosphere':
        return new AtmosphereLayer();

      case 'temp2m':
        return await Temp2mLayer.create(dataService);

      case 'precipitation':
        return await PrecipitationLayer.create(dataService);

      case 'wind10m':
        return await WindLayer.create(dataService, renderer!);
    }
  }
}
```

### 5. Scene Simplification

**Before (current):**
```typescript
class Scene {
  private earth: Earth;
  private sun: Sun;
  private atmosphereLayer: AtmosphereLayer | null;
  private temp2mLayer: Temp2mLayer | null;
  private temp2mTimeSteps: TimeStep[];
  private pratesfcLayer: PratesfcLayer | null;
  private pratesfcTimeSteps: TimeStep[];
  private windLayerGPU: WindLayerGPUCompute | null;

  updateTime(time: Date) {
    this.sun.updatePosition(time);
    if (this.temp2mLayer) {
      const idx = Temp2mService.timeToIndex(time, this.temp2mTimeSteps);
      this.temp2mLayer.setTimeIndex(idx);
    }
    if (this.pratesfcLayer) {
      const idx = PratesfcService.timeToIndex(time, this.pratesfcTimeSteps);
      this.pratesfcLayer.setTimeIndex(idx);
    }
    // ... more special cases
  }
}
```

**After (target):**
```typescript
class Scene {
  private layers: Map<LayerId, ILayer> = new Map();
  private dataService: DataService;

  async createLayer(layerId: LayerId): Promise<boolean> {
    if (this.layers.has(layerId)) return false;

    const layer = await LayerFactory.create(
      layerId,
      this.dataService,
      this.currentTime,
      this.preloadedImages,
      this.renderer
    );

    this.layers.set(layerId, layer);
    this.scene.add(layer.getSceneObject());
    return true;
  }

  updateTime(time: Date): void {
    this.currentTime = time;
    this.layers.forEach(layer => layer.updateTime(time));
  }

  setLayerVisible(layerId: LayerId, visible: boolean): void {
    this.layers.get(layerId)?.setVisible(visible);
  }

  getCreatedLayers(): LayerId[] {
    return Array.from(this.layers.keys());
  }
}
```

**Benefits:**
- No more special cases per layer type
- No more storing timeSteps separately
- Each layer owns its own data and behavior
- Scene is pure layer collection manager
- Easy to add new layer types

## Implementation Steps

### Step 1: Refactor Remaining Layers

**PrecipitationLayer (rename from PratesfcLayer):**
```typescript
export class PrecipitationLayer extends TimeSeriesLayer {
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  private constructor(dataTexture: THREE.Data3DTexture, timeSteps: TimeStep[], timeStepCount: number) {
    super(timeSteps);
    // ... existing constructor logic
  }

  static async create(dataService: DataService): Promise<PrecipitationLayer> {
    const layerData = await dataService.loadLayer('precipitation');
    return new PrecipitationLayer(layerData.texture, layerData.timeSteps, layerData.timeSteps.length);
  }

  getSceneObject(): THREE.Object3D { return this.mesh; }
  setTimeIndex(index: number) { /* existing logic */ }
  setVisible(visible: boolean) { this.mesh.visible = visible; }
  setOpacity(opacity: number) { /* existing logic */ }
  dispose() { /* cleanup */ }
}
```

**SunLayer (wrap existing Sun class):**
```typescript
export class SunLayer implements ILayer {
  private sun: Sun;  // Existing Sun class

  constructor(currentTime: Date) {
    this.sun = new Sun();
    this.sun.updatePosition(currentTime);
  }

  updateTime(time: Date): void {
    this.sun.updatePosition(time);
  }

  setVisible(visible: boolean): void {
    this.sun.mesh.visible = visible;
    this.sun.getLight().visible = visible;
  }

  getSceneObject(): THREE.Object3D {
    // Return a Group containing both mesh and light
    const group = new THREE.Group();
    group.add(this.sun.mesh);
    group.add(this.sun.getLight());
    return group;
  }

  getDirection(): THREE.Vector3 {
    return this.sun.getDirection();
  }

  dispose(): void {
    this.sun.dispose();
  }
}
```

**EarthLayer (wrap existing Earth class):**
```typescript
export class EarthLayer implements ILayer {
  private earth: Earth;

  private constructor(preloadedImages?: Map<string, HTMLImageElement>) {
    this.earth = new Earth(preloadedImages);
  }

  static async create(preloadedImages?: Map<string, HTMLImageElement>): Promise<EarthLayer> {
    // Could load images here via DataService in future
    return new EarthLayer(preloadedImages);
  }

  updateTime(time: Date): void {
    // Earth doesn't change with time (basemaps are static)
  }

  setVisible(visible: boolean): void {
    this.earth.mesh.visible = visible;
  }

  getSceneObject(): THREE.Object3D {
    return this.earth.mesh;
  }

  setBlend(blend: number): void {
    this.earth.setBlend(blend);
  }

  setSunDirection(direction: THREE.Vector3): void {
    this.earth.setSunDirection(direction);
  }

  dispose(): void {
    this.earth.dispose();
  }
}
```

**AtmosphereLayer (already close to ILayer):**
```typescript
export class AtmosphereLayer implements ILayer {
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  // ... existing constructor

  updateTime(time: Date): void {
    // Atmosphere doesn't change with time directly
    // (sun position updates happen via setSunPosition)
  }

  getSceneObject(): THREE.Object3D {
    return this.mesh;
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  dispose(): void {
    if (this.mesh.geometry) this.mesh.geometry.dispose();
    if (this.material) this.material.dispose();
  }
}
```

**WindLayer (wrapper for WindLayerGPUCompute):**
```typescript
export class WindLayer implements ILayer {
  private windGPU: WindLayerGPUCompute;

  private constructor(windGPU: WindLayerGPUCompute) {
    this.windGPU = windGPU;
  }

  static async create(dataService: DataService, renderer: THREE.WebGLRenderer): Promise<WindLayer> {
    const windGPU = new WindLayerGPUCompute(8192);
    await windGPU.initGPU(renderer);
    await windGPU.loadWindData();
    return new WindLayer(windGPU);
  }

  async updateTime(time: Date): Promise<void> {
    await this.windGPU.updateTime(time);
  }

  setVisible(visible: boolean): void {
    this.windGPU.setVisible(visible);
  }

  getSceneObject(): THREE.Object3D {
    return this.windGPU.getGroup();
  }

  dispose(): void {
    // WindLayerGPUCompute needs dispose method
  }
}
```

### Step 2: Create LayerFactory

**File: `src/visualization/LayerFactory.ts`**

```typescript
import type { ILayer, LayerId } from './ILayer';
import type { DataService } from '../services/DataService';
import type * as THREE from 'three';
import { Temp2mLayer } from './Temp2mLayer';
import { PrecipitationLayer } from './PrecipitationLayer';
import { WindLayer } from './WindLayer';
import { EarthLayer } from './EarthLayer';
import { SunLayer } from './SunLayer';
import { AtmosphereLayer } from './AtmosphereLayer';

export class LayerFactory {
  static async create(
    layerId: LayerId,
    dataService: DataService,
    currentTime: Date,
    preloadedImages?: Map<string, HTMLImageElement>,
    renderer?: THREE.WebGLRenderer
  ): Promise<ILayer> {
    switch (layerId) {
      case 'earth':
        return await EarthLayer.create(preloadedImages);

      case 'sun':
        return new SunLayer(currentTime);

      case 'atmosphere':
        return new AtmosphereLayer();

      case 'temp2m':
        return await Temp2mLayer.create(dataService);

      case 'precipitation':
        return await PrecipitationLayer.create(dataService);

      case 'wind10m':
        if (!renderer) {
          throw new Error('WindLayer requires renderer');
        }
        return await WindLayer.create(dataService, renderer);

      default:
        throw new Error(`Unknown layer: ${layerId}`);
    }
  }
}
```

### Step 3: Refactor Scene

**Key changes:**

1. Replace individual layer properties with `Map<LayerId, ILayer>`
2. Remove all `temp2mTimeSteps`, `pratesfcTimeSteps` storage
3. Simplify `updateTime()` to iterate layers
4. Remove layer-specific methods (toggleTemp2m, toggleRain, etc.)
5. Keep unified API (createLayer, setLayerVisible, toggleLayers, etc.)

**Constructor changes:**
```typescript
constructor(canvas: HTMLCanvasElement, preloadedImages?: Map<string, HTMLImageElement>, userOptions?: UserOptions) {
  this.dataService = new DataService();
  this.preloadedImages = preloadedImages;
  this.layers = new Map();

  // ... THREE.js setup

  // No more direct layer instantiation here
  // Layers created on demand via createLayer()
}
```

**Time update simplification:**
```typescript
updateTime(time: Date) {
  this.currentTime = time;

  // Update all layers polymorphically
  this.layers.forEach(layer => layer.updateTime(time));

  // Special handling for Earth sun direction
  const sunLayer = this.layers.get('sun') as SunLayer | undefined;
  const earthLayer = this.layers.get('earth') as EarthLayer | undefined;
  if (sunLayer && earthLayer) {
    earthLayer.setSunDirection(sunLayer.getDirection());
  }

  // Special handling for atmosphere sun position
  const atmosphereLayer = this.layers.get('atmosphere') as AtmosphereLayer | undefined;
  if (sunLayer && atmosphereLayer) {
    atmosphereLayer.setSunPosition(sunLayer.getDirection());
  }
}
```

### Step 4: Update Bootstrap

**Initialize default layers:**

```typescript
async initializeScene() {
  const canvas = document.querySelector('.scene-canvas') as HTMLCanvasElement;
  const scene = new Scene(canvas, this.state.preloadedImages, this.userOptions);

  // Create mandatory base layers
  await scene.createLayer('earth');
  await scene.createLayer('sun');

  // Optionally create atmosphere if enabled
  if (this.userOptions?.atmosphere.enabled) {
    await scene.createLayer('atmosphere');
  }

  this.state.scene = scene;
}
```

## Data Flow

### Layer Creation Flow

```
User clicks layer button
  → App.handleLayerToggle(layerId)
    → Scene.createLayer(layerId)
      → LayerFactory.create(layerId, ...)
        → [For data layers] DataService.loadLayer(layerId)
          → Service.loadTexture(timeSteps, ...)
          → Returns LayerData { texture, timeSteps, sizeBytes }
        → Layer.create(dataService) [factory method]
          → new Layer(texture, timeSteps, ...)
          → Returns ILayer instance
      → layers.set(layerId, layer)
      → scene.add(layer.getSceneObject())
```

### Time Update Flow

```
User drags time slider
  → App wheel handler or TimeSlider
    → Scene.updateTime(newTime)
      → layers.forEach(layer => layer.updateTime(time))
        → [TimeSeriesLayer] calculateTimeIndex(time) → setTimeIndex(idx)
        → [SunLayer] sun.updatePosition(time)
        → [EarthLayer/AtmosphereLayer] no-op
```

## Migration Strategy

1. **Phase 1:** Complete layer refactoring (all implement ILayer)
2. **Phase 2:** Create LayerFactory
3. **Phase 3:** Refactor Scene to use layers Map
4. **Phase 4:** Update App/Bootstrap
5. **Phase 5:** Remove old services (LayerState, LayerToggleService, etc.)
6. **Phase 6:** Test thoroughly
7. **Phase 7:** Future enhancement - DataService loads Earth images

## Benefits

### Code Simplification
- ❌ Remove: ~200 lines of layer-specific Scene methods
- ❌ Remove: LayerState class
- ❌ Remove: LayerToggleService
- ❌ Remove: LayerLoaderService
- ❌ Remove: UrlLayerSyncService
- ✅ Add: ~100 lines of ILayer/Factory/wrappers
- **Net reduction: ~300 lines**

### Architecture Benefits
- ✅ **Polymorphism** - All layers treated uniformly
- ✅ **Encapsulation** - Each layer owns its data and behavior
- ✅ **Extensibility** - Easy to add new layer types
- ✅ **Testability** - Layers can be tested in isolation
- ✅ **Maintainability** - No special cases in Scene

### Developer Experience
- ✅ **Single source of truth** - Scene.layers Map
- ✅ **Consistent API** - createLayer(), setLayerVisible(), etc.
- ✅ **No duplicated logic** - TimeSeriesLayer base class
- ✅ **Type safety** - LayerId union type

## Known Issues / Future Work

1. **Sun/Earth coupling** - Earth shader needs sun direction
   - Currently handled in Scene.updateTime() as special case
   - Future: Event system or observer pattern?

2. **Atmosphere/Sun coupling** - Atmosphere needs sun position
   - Same issue as above

3. **Wind layer async updateTime** - Only layer with async time update
   - ILayer.updateTime() is sync, WindLayer needs async
   - Possible solution: Make ILayer.updateTime() return Promise<void>

4. **DataService Earth images** - Not yet implemented
   - Earth basemaps still preloaded in Bootstrap
   - Future: DataService.loadImages('earth') or similar

5. **Layer dependencies** - Some layers depend on others
   - Temp2m needs Sun for lighting
   - Could enforce creation order or lazy init

## Testing Checklist

After implementation:
- [ ] Can create/destroy each layer type independently
- [ ] Time updates propagate to all layers
- [ ] Visibility toggles work for all layers
- [ ] URL state reflects visible layers correctly
- [ ] Bootstrap loads layers from URL
- [ ] Memory cleanup (dispose) works correctly
- [ ] No TypeScript errors
- [ ] Build succeeds
- [ ] App runs without console errors
- [ ] Layer toggle buttons show correct state

## Estimated Effort

- **Remaining Implementation:** 2-3 hours
- **Testing:** 1 hour
- **Bug fixes:** 1-2 hours
- **Total:** 4-6 hours

## Files to Modify

**Created:**
- ✅ src/visualization/ILayer.ts
- ✅ src/visualization/TimeSeriesLayer.ts
- ⏳ src/visualization/LayerFactory.ts
- ⏳ src/visualization/EarthLayer.ts
- ⏳ src/visualization/SunLayer.ts
- ⏳ src/visualization/PrecipitationLayer.ts (rename PratesfcLayer)
- ⏳ src/visualization/WindLayer.ts (wrapper)

**Modified:**
- ✅ src/visualization/Temp2mLayer.ts
- ⏳ src/visualization/Scene.ts (major refactor)
- ⏳ src/visualization/AtmosphereLayer.ts (minor - add getSceneObject)
- ✅ src/services/DataService.ts (minor - export LayerId)
- ⏳ src/app.ts (minor - adjust to Scene changes)

**Deleted (eventually):**
- ❌ src/state/LayerState.ts
- ❌ src/services/LayerStateService.ts
- ❌ src/services/LayerToggleService.ts
- ❌ src/services/LayerLoaderService.ts
- ❌ src/services/UrlLayerSyncService.ts

---

**Document Status:** Work in Progress
**Last Updated:** 2025-11-01
**Author:** Claude Code Assistant
