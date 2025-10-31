# Layer Organization Architecture

## Overview

The Layer Organization system provides a config-driven, modular architecture for managing visualization layers in Hypatia. It replaces hardcoded layer definitions with flexible, declarative configurations.

## Architecture Principles

1. **Separation of Concerns**: Each responsibility handled by a dedicated service
2. **Config-Driven**: Layer definitions, parameters, and app settings in JSON
3. **Type-Safe**: Full TypeScript typing throughout
4. **Testable**: Services are stateless and easily testable
5. **Extensible**: Adding new layers requires only config changes

## Directory Structure

```
code/
├── config/                          # Configuration files
│   ├── hypatia.config.json         # App-level settings
│   ├── params-config.json          # ECMWF parameter catalog
│   └── layer-config.json           # Layer definitions
├── src/
│   ├── config/                     # Config loading
│   │   ├── types.ts               # TypeScript interfaces
│   │   ├── loader.ts              # Config loader singleton
│   │   └── index.ts               # Public exports
│   ├── state/                      # State management
│   │   ├── AppState.ts            # Main app state interface
│   │   └── LayerState.ts          # Layer state class
│   └── services/                   # Business logic
│       ├── LayerStateService.ts    # Layer state lifecycle
│       ├── LayerLoaderService.ts   # Layer data loading
│       ├── LayerToggleService.ts   # User interactions
│       ├── UrlLayerSyncService.ts  # URL synchronization
│       └── AppBootstrapService.ts  # App initialization
└── scripts/
    └── scrape-ecmwf-params.py     # Parameter catalog scraper
```

## Component Responsibilities

### Configuration Layer

**config/hypatia.config.json**
- App name, version, description
- Data directory paths and maxRangeDays
- Visualization defaults (center, zoom)
- Performance tuning (workers, cache strategy)

**config/params-config.json**
- Complete ECMWF parameter catalog (27 parameters)
- Metadata: name, description, units, category, level
- Categories: temperature, wind, precipitation, pressure, humidity, surface, ocean, static

**config/layer-config.json**
- Layer definitions (7 layers currently)
- Separate `id` (code reference) and `urlKey` (URL parameter)
- `label.short` and `label.long` for UI
- `ecmwfParams[]` - data fetch keys
- `visualization` - colormap, range, opacity, rendering options
- `ui` - icon, group, order, defaultEnabled
- `groups` - layer organization

### State Management

**LayerState** (`src/state/LayerState.ts`)
- Core state class managing layer status: `disabled` → `loading` → `active`
- Methods:
  - `enableFromUrlKeys(urlKeys)` - Initialize from URL
  - `enableDefaults()` - Enable default layers
  - `toggle(layerId)` - Toggle layer on/off
  - `setStatus(layerId, status)` - Update status
  - `isEnabled/isActive/isLoading(layerId)` - Query status
  - `getAllLayers()` - Get all layers sorted
  - `getActiveLayers()` - Get enabled layers
  - `getActiveUrlKeys()` - For URL sync

**AppState** (`src/state/AppState.ts`)
- Clean interface replacing hardcoded booleans
- Includes `layerState: LayerState | null`
- Removes: `showTemp2m`, `temp2mLoading`, `showRain`, `rainLoading`, `showWind`

### Services

**LayerStateService** (`src/services/LayerStateService.ts`)
- Singleton managing LayerState lifecycle
- `initialize()` - Load configs and create LayerState
- `initializeFromUrl(urlKeys)` - Initialize from URL
- `getInstance()` - Access current state
- `isReady()` - Check initialization status

**LayerLoaderService** (`src/services/LayerLoaderService.ts`)
- Handles async loading of layer data
- `loadLayer(entry, scene, time)` - Load layer data
- `unloadLayer(entry, scene)` - Cleanup layer
- `updateLayerTime(entry, scene, time)` - Refresh for new time
- Routes to appropriate Scene methods based on layer ID

**LayerToggleService** (`src/services/LayerToggleService.ts`)
- User interaction handling
- `toggle(layerId, layerState, scene, time)` - Toggle layer
- `enable(layerId, ...)` - Enable layer
- `disable(layerId, ...)` - Disable layer
- Returns `LayerToggleResult` with success/error status

**UrlLayerSyncService** (`src/services/UrlLayerSyncService.ts`)
- Syncs layers with URL parameters
- `parseLayersFromUrl()` - Extract layer keys from URL
- `updateUrl(layerState, appState)` - Update URL with active layers
- `initializeLayersFromUrl(layerState)` - Init from URL or defaults

**AppBootstrapService** (`src/services/AppBootstrapService.ts`)
- Application initialization sequence
- `bootstrap(onProgress)` - Run full bootstrap
- Steps:
  1. Load configurations (configs + layer state)
  2. Get server time
  3. Fetch latest forecast
  4. Preload critical resources
  5. Optional: Get user location
- Returns `BootstrapState` with all loaded data

## Data Flow

### Application Startup

```
1. App.oninit()
   ↓
2. AppBootstrapService.bootstrap()
   ├→ ConfigLoader.loadAll()
   ├→ LayerStateService.initialize()
   ├→ getCurrentTime()
   ├→ getLatestRun()
   └→ preloadImages()
   ↓
3. UrlLayerSyncService.initializeLayersFromUrl()
   ↓
4. Scene initialization
   ↓
5. Load active layers via LayerLoaderService
```

### Layer Toggle

```
User clicks layer button
   ↓
LayerToggleService.toggle(layerId, layerState, scene, time)
   ├→ layerState.toggle(layerId)  // Update state
   ├→ If enabling:
   │    └→ LayerLoaderService.loadLayer(entry, scene, time)
   └→ If disabling:
        └→ LayerLoaderService.unloadLayer(entry, scene)
   ↓
UrlLayerSyncService.updateUrl(layerState, appState)
   ↓
m.redraw()
```

### Time Change

```
User changes time slider
   ↓
For each active layer:
   LayerLoaderService.updateLayerTime(entry, scene, newTime)
   ↓
UrlLayerSyncService.updateUrl(layerState, appState)
   ↓
m.redraw()
```

## Layer Configuration Schema

### Layer Definition

```json
{
  "id": "temp2m",                    // Internal code reference
  "urlKey": "temp",                  // URL parameter key
  "label": {
    "short": "Temp",                 // Button label
    "long": "Temperature"            // Full name
  },
  "description": "Surface air temperature at 2 meters above ground",
  "ecmwfParams": ["2t"],            // ECMWF parameter codes
  "visualization": {
    "colormap": "temperature",
    "range": { "min": 233, "max": 313 },
    "opacity": 0.7
  },
  "ui": {
    "icon": "thermometer",
    "group": "surface",
    "order": 1,
    "defaultEnabled": true
  }
}
```

### Parameter Definition

```json
{
  "2t": {
    "name": "2 Metre Temperature",
    "description": "Temperature at 2 meters above surface",
    "units": "K",
    "category": "temperature",
    "level": "surface"
  }
}
```

## Migration Path

### Phase 1: Services (Current)
- ✅ Create config files
- ✅ Build config loader
- ✅ Create LayerState class
- ✅ Implement all services
- ✅ Document architecture

### Phase 2: Integration (Next)
- Update app.ts to use services
- Replace hardcoded layer booleans
- Update bootstrap flow
- Test layer loading/unloading

### Phase 3: Dynamic UI
- Generate layer buttons from config
- Remove hardcoded Controls props
- Implement group-based organization
- Add icon rendering

### Phase 4: Testing & Polish
- Unit tests for services
- Integration tests
- Performance optimization
- Documentation updates

## Adding New Layers

1. **Add ECMWF parameters** (if new): Edit `config/params-config.json`
2. **Define layer**: Add to `config/layer-config.json`
3. **Implement loader**: Add case to `LayerLoaderService.loadLayer()`
4. **Implement Scene method**: Add `loadXxxLayer()` to Scene class
5. **Deploy**: Config change automatically enables new layer in UI

## Benefits

### Before (Hardcoded)
```typescript
interface AppState {
  showTemp2m: boolean;
  temp2mLoading: boolean;
  showRain: boolean;
  rainLoading: boolean;
  showWind: boolean;
  // ... 2 booleans per layer
}
```

- 10 lines of code per layer in app.ts
- Hardcoded UI components
- URL state manually managed
- Difficult to add layers

### After (Config-Driven)
```typescript
interface AppState {
  layerState: LayerState | null;
  // ... just one field
}
```

- Single `layerState` field
- Dynamic UI generation
- Automatic URL sync
- Add layers via config only

## Performance Considerations

- **Lazy Loading**: Layers loaded on-demand
- **Status Tracking**: Prevent duplicate loads
- **Config Caching**: Configs loaded once at startup
- **Incremental Updates**: Only update changed layers on time change

## Security

- Config files are static JSON (no code execution)
- Type validation via TypeScript
- URL parameters validated against known layer keys
- No user-provided config injection

## Future Enhancements

1. **Layer Groups**: Collapsible UI sections
2. **Layer Dependencies**: Auto-enable required layers
3. **Custom Colormaps**: User-defined color schemes
4. **Layer Presets**: Save/load layer combinations
5. **Animation**: Sequence through time with selected layers
6. **Multi-parameter Layers**: Combine multiple ECMWF params
7. **Derived Layers**: Compute new fields from existing data
