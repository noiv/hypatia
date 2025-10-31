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
