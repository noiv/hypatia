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
    dataDirectory: string;
    updateIntervalMs: number;
    defaultResolution: string;
  };
  visualization: {
    defaultCenter: [number, number];
    defaultZoom: number;
    maxZoom: number;
    minZoom: number;
  };
  performance: {
    workerCount: number;
    cacheStrategy: string;
    preloadCritical: boolean;
  };
  features: {
    enableGeolocation: boolean;
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
// Data Service Types
// ============================================================================

/**
 * Timestep metadata for a data file
 * Used by all layer types
 */
export interface TimeStep {
  date: string;    // YYYYMMDD
  cycle: string;   // 00z, 06z, 12z, 18z
  filePath: string;
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
