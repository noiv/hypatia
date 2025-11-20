/**
 * Configuration Type Definitions
 *
 * TypeScript types matching the JSON config schemas
 */

export interface HypatiaConfig {
  app: {
    name: string;
    version: string;
    description: string;
  };
  data: {
    maxRangeDays: number;
    dataBaseUrl: string;
    updateIntervalMs: number;
    defaultResolution: string;
  };
  visualization: {
    defaultCenter: [number, number];
    defaultZoom: number;
    maxZoom: number;
    minZoom: number;
    defaultAltitude: number;
    defaultLayers: string[];
  };
  camera: {
    minDistance: number;
    maxDistance: number;
    defaultDistance: number;
    dampingFactor: number;
    rotateSpeed: number;
    zoomSpeed: number;
    invertZoom: boolean;
    rotationFriction: number;
    rotationSensitivity: number;
    minVelocity: number;
    maxVelocity: number;
    doubleTapZoomFactor: number;
    doubleTapAnimationMs: number;
    doubleTapThresholdMs: number;
    doubleTapDistanceThreshold: number;
    gestureTimeoutMs: number;
    timeScrubMinutesPerPixel: number;
  };
  performance: {
    workerCount: number;
    preloadCritical: boolean;
  };
  bootstrap: {
    autoContinue: boolean;
    defaultTime: 'nearest-run' | 'current-utc'; // How to calculate default time when URL has no dt
    stepDelayMs: number; // Delay after each bootstrap step (0 = no delay, for debugging/visibility)
  };
  dataCache: {
    maxConcurrentDownloads: number;
    cacheStrategy: 'future-first' | 'spiral-out';
    downloadMode: 'aggressive' | 'on-demand';
  };
  features: {
    enableGeolocation: boolean;
  };
  ui: {
    backgroundColor: string;
  };
  build: {
    version: string;
    hash: string;
    timestamp: string;
  };
}

export interface ParamInfo {
  name: string;
  description: string;
  units: string;
  category: string;
  level: string;
}

export interface ParamsConfig {
  version: string;
  source: string;
  updated: string;
  parameters: {
    [key: string]: ParamInfo;
  };
}

export interface LayerVisualization {
  colormap: string;
  range: {
    min: number;
    max: number;
  };
  opacity: number;
  vectors?: boolean;
  contours?: boolean;
  oceanOnly?: boolean;
}

export interface LayerUI {
  icon: string;
  group: string;
  order: number;
  defaultEnabled: boolean;
}

export interface Layer {
  id: string;
  urlKey: string;
  label: {
    short: string;
    long: string;
  };
  description: string;
  ecmwfParams: string[];
  dataFolders: string[];
  visualization: LayerVisualization;
  ui: LayerUI;
  availability?: 'limited' | 'full';
}

export interface LayerGroup {
  name: string;
  description: string;
  order: number;
}

export interface LayersConfig {
  version: string;
  layers: Layer[];
  groups: {
    [key: string]: LayerGroup;
  };
}

// ============================================================================
// Data Manifest Types
// ============================================================================

export interface DatasetInfo {
  range: string;        // "20251030_00z-20251107_18z"
  step: string;         // "6h"
  count: number;        // 38
  missing: string[];    // ["20251031_06z", ...]
  size_bytes: number;   // Single file size
}

export interface DataManifest {
  generated: string;    // ISO timestamp
  datasets: {
    [paramName: string]: DatasetInfo;
  };
}

// ============================================================================
// Data Service Types
// ============================================================================

/**
 * Timestep metadata for a data file
 * Used by all layer types
 *
 * Note: File paths are constructed by UrlBuilder when needed,
 * not stored in timesteps (separation of concerns)
 */
export interface TimeStep {
  date: string;    // YYYYMMDD (e.g., "20251109")
  cycle: string;   // HHz format (e.g., "00z", "06z", "12z", "18z")
}

/**
 * Result from loading layer data
 * Contains everything Scene needs to create and render a layer
 */
export interface LayerData {
  /** Layer identifier matching Layer.id */
  layerId: string;

  /** 3D texture containing the actual data (1441x721 grid × timesteps) */
  texture: THREE.Data3DTexture;

  /** Metadata for each timestep in the texture */
  timeSteps: TimeStep[];

  /** Total bytes loaded (for memory tracking) */
  sizeBytes: number;
}

/**
 * Progress information for data loading
 * Used for UI progress indicators
 */
export interface LoadProgress {
  /** Number of items loaded (files/timesteps) */
  loaded: number;

  /** Total number of items to load */
  total: number;

  /** Percentage (0-100) */
  percentage: number;

  /** Optional: currently loading item description */
  currentItem?: string;
}

/**
 * Time range for partial data loading (future use)
 */
export interface TimeRange {
  start: Date;
  end: Date;
}

// ============================================================================
// Scene API Types
// ============================================================================

/**
 * Layer visibility and creation state
 * Scene is the single source of truth for these states
 */
export type LayerRenderState =
  | { created: false; visible: false }
  | { created: true; visible: boolean };

// Import THREE types (assuming THREE is available)
import type * as THREE from 'three';

// ============================================================================
// Layer Config Types
// ============================================================================

export interface EarthConfig {
  updateOrder: number;
  geometry: {
    segments: number;
  };
  visual: {
    dayNightFactor: number;
    dayNightSharpness: number;
  };
  basemaps: {
    sets: Array<{
      name: string;
      path: string;
    }>;
  };
}

export interface Temp2mConfig {
  updateOrder: number;
  tempRange: {
    min: number;
    max: number;
  };
  palette: Array<{
    temp: number;
    color: [number, number, number];
    hex: string;
  }>;
  visual: {
    opacity: number;
    altitudeKm: number;
    dayNightFactor: number;
    dayNightSharpness: number;
  };
  depth: {
    polygonOffset: boolean;
    polygonOffsetFactor: number;
    polygonOffsetUnits: number;
  };
  geometry: {
    widthSegments: number;
    heightSegments: number;
  };
}

export interface AtmosphereConfig {
  updateOrder: number;
  geometry: {
    widthSegments: number;
    heightSegments: number;
  };
  physical: {
    planetRadius: number;
    atmosphereRadius: number;
    rayleighCoefficient: [number, number, number];
    rayleighScaleHeight: number;
    mieCoefficient: number;
    mieScaleHeight: number;
    mieDirection: number;
    sunIntensity: number;
  };
  visual: {
    altitudeKm: number;
    exposure: number;
  };
  quality: {
    primarySamples: number;
    secondarySamples: number;
  };
}

export interface GraticuleConfig {
  updateOrder: number;
  visual: {
    color: number;
    opacity: number;
    radius: number;
  };
  lod: Array<{
    maxDistance: number | null;
    latStep: number;
    lonStep: number;
  }>;
}

export interface PrecipitationConfig {
  updateOrder: number;
  geometry: {
    widthSegments: number;
    heightSegments: number;
  };
  visual: {
    altitudeKm: number;
    opacity: number;
    dayNightFactor: number;
  };
  depth: {
    polygonOffset: boolean;
    polygonOffsetFactor: number;
    polygonOffsetUnits: number;
  };
  palette: Array<{
    threshold: number | null;
    color: [number, number, number];
    alpha: number;
  }>;
  discardThreshold: number;
}

export interface PressureConfig {
  updateOrder: number;
  grid: {
    width: number;
    height: number;
    resolution: number;
  };
  isobars: {
    levels: number[];
    spacing: number;
    minValue: number;
    maxValue: number;
  };
  visual: {
    color: number;
    opacity: number;
    linewidth: number;
    depthTest: boolean;
    transparent: boolean;
  };
  earth: {
    radius: number;
  };
}

export interface TextConfig {
  updateOrder: number;
  font: {
    url: string;
    fallback: string;
  };
  size: {
    default: number;
    min: number;
    max: number;
    step: number;
  };
  color: {
    default: number;
    graticule: number;
    pressure: number;
  };
  outline: {
    enabled: boolean;
    width: number;
    color: number;
    opacity: number;
  };
  hotkeys: {
    increase: string[];
    decrease: string[];
    reset: string[];
  };
  performance: {
    characters: string;
    updateOnlyWhenChanged: boolean;
    frustumCulling: boolean;
    cullDotThreshold: number;
  };
  billboard: {
    enabled: boolean;
    sizeAttenuation: boolean;
  };
  positioning: {
    graticuleRadiusMultiplier: number;
    pressureRadiusMultiplier: number;
  };
}

export interface Wind10mConfig {
  updateOrder: number;
}
