/**
 * Configuration Loader
 *
 * Loads and validates configuration files at runtime
 */

import type { HypatiaConfig, ParamsConfig, LayersConfig, Layer, DataManifest, DatasetInfo } from './types';

class ConfigLoader {
  private hypatiaConfig: HypatiaConfig | null = null;
  private paramsConfig: ParamsConfig | null = null;
  private layersConfig: LayersConfig | null = null;
  private dataManifest: DataManifest | null = null;

  /**
   * Load all configuration files
   */
  async loadAll(): Promise<void> {
    // Load hypatia config first (needed for dataBaseUrl)
    await this.loadHypatiaConfig();

    // Load rest in parallel
    await Promise.all([
      this.loadParamsConfig(),
      this.loadLayersConfig(),
      this.loadDataManifest()
    ]);
  }

  /**
   * Load main application config
   */
  async loadHypatiaConfig(): Promise<HypatiaConfig> {
    if (this.hypatiaConfig) return this.hypatiaConfig;

    const response = await fetch('/config/hypatia.config.json');
    if (!response.ok) {
      throw new Error(`Failed to load hypatia.config.json: ${response.statusText}`);
    }

    const config: HypatiaConfig = await response.json();
    this.hypatiaConfig = config;
    return config;
  }

  /**
   * Load ECMWF parameters catalog
   */
  async loadParamsConfig(): Promise<ParamsConfig> {
    if (this.paramsConfig) return this.paramsConfig;

    const response = await fetch('/config/params-config.json');
    if (!response.ok) {
      throw new Error(`Failed to load params-config.json: ${response.statusText}`);
    }

    const config: ParamsConfig = await response.json();
    this.paramsConfig = config;
    return config;
  }

  /**
   * Load layer definitions
   */
  async loadLayersConfig(): Promise<LayersConfig> {
    if (this.layersConfig) return this.layersConfig;

    const response = await fetch('/config/layer-config.json');
    if (!response.ok) {
      throw new Error(`Failed to load layer-config.json: ${response.statusText}`);
    }

    const config: LayersConfig = await response.json();
    this.layersConfig = config;
    return config;
  }

  /**
   * Get hypatia config (must be loaded first)
   */
  getHypatiaConfig(): HypatiaConfig {
    if (!this.hypatiaConfig) {
      throw new Error('Hypatia config not loaded. Call loadAll() first.');
    }
    return this.hypatiaConfig;
  }

  /**
   * Get params config (must be loaded first)
   */
  getParamsConfig(): ParamsConfig {
    if (!this.paramsConfig) {
      throw new Error('Params config not loaded. Call loadAll() first.');
    }
    return this.paramsConfig;
  }

  /**
   * Get layers config (must be loaded first)
   */
  getLayersConfig(): LayersConfig {
    if (!this.layersConfig) {
      throw new Error('Layers config not loaded. Call loadAll() first.');
    }
    return this.layersConfig;
  }

  /**
   * Get all layers sorted by group and order
   */
  getLayers(): Layer[] {
    const config = this.getLayersConfig();
    return [...config.layers].sort((a, b) => {
      const groupA = config.groups[a.ui.group];
      const groupB = config.groups[b.ui.group];

      if (!groupA || !groupB) {
        return 0;
      }

      if (groupA.order !== groupB.order) {
        return groupA.order - groupB.order;
      }

      return a.ui.order - b.ui.order;
    });
  }

  /**
   * Get layer by ID
   */
  getLayerById(id: string): Layer | undefined {
    const config = this.getLayersConfig();
    return config.layers.find(layer => layer.id === id);
  }

  /**
   * Get layer by URL key
   */
  getLayerByUrlKey(urlKey: string): Layer | undefined {
    const config = this.getLayersConfig();
    return config.layers.find(layer => layer.urlKey === urlKey);
  }

  /**
   * Convert layer ID to URL key
   * For weather data layers (temp2m, wind10m, etc.), returns the urlKey from config
   * For base layers (earth, sun, graticule, text), returns the ID as-is
   */
  layerIdToUrlKey(layerId: string): string {
    const layer = this.getLayerById(layerId);
    return layer ? layer.urlKey : layerId;
  }

  /**
   * Convert URL key to layer ID
   * For weather data layers (temp -> temp2m, etc.), returns the layer ID from config
   * For base layers (earth, sun, graticule, text), returns the key as-is
   */
  urlKeyToLayerId(urlKey: string): string {
    // If config not loaded yet, return urlKey as-is
    if (!this.layersConfig) {
      return urlKey;
    }
    const layer = this.getLayerByUrlKey(urlKey);
    return layer ? layer.id : urlKey;
  }

  /**
   * Get all enabled-by-default layers
   */
  getDefaultLayers(): Layer[] {
    const config = this.getLayersConfig();
    return config.layers.filter(layer => layer.ui.defaultEnabled);
  }

  /**
   * Get parameter info by code
   */
  getParamInfo(paramCode: string) {
    const config = this.getParamsConfig();
    return config.parameters[paramCode];
  }

  /**
   * Load data manifest
   */
  async loadDataManifest(): Promise<DataManifest> {
    if (this.dataManifest) return this.dataManifest;

    const dataBaseUrl = this.getDataBaseUrl();
    const manifestUrl = `${dataBaseUrl}/manifest.json`;

    const response = await fetch(manifestUrl);
    if (!response.ok) {
      throw new Error(`Failed to load manifest from ${manifestUrl}: ${response.statusText}`);
    }

    const manifest: DataManifest = await response.json();
    this.dataManifest = manifest;
    return manifest;
  }

  /**
   * Get data manifest (must be loaded first)
   */
  getDataManifest(): DataManifest {
    if (!this.dataManifest) {
      throw new Error('Data manifest not loaded. Call loadAll() first.');
    }
    return this.dataManifest;
  }

  /**
   * Get dataset info by parameter name
   */
  getDatasetInfo(paramName: string): DatasetInfo | undefined {
    if (!this.dataManifest) {
      return undefined;
    }
    return this.dataManifest.datasets[paramName];
  }

  /**
   * Get data base URL from hypatia config
   */
  getDataBaseUrl(): string {
    const config = this.getHypatiaConfig();
    return config.data.dataBaseUrl;
  }

  /**
   * Get dataset time range (start and end times)
   * Parses compact manifest format "20251026_00z-20251108_06z"
   */
  getDatasetRange(paramName: string): { startTime: Date; endTime: Date } | null {
    const datasetInfo = this.getDatasetInfo(paramName);
    if (!datasetInfo) {
      return null;
    }

    // Parse range: "20251026_00z-20251108_06z"
    const [startStr, endStr] = datasetInfo.range.split('-');
    if (!startStr || !endStr) {
      return null;
    }

    const startTime = this.parseTimestamp(startStr);
    const endTime = this.parseTimestamp(endStr);

    return { startTime, endTime };
  }

  /**
   * Parse timestamp like "20251030_00z" into Date
   */
  private parseTimestamp(timestamp: string): Date {
    const parts = timestamp.split('_');
    if (parts.length !== 2) {
      throw new Error(`Invalid timestamp format: ${timestamp}`);
    }

    const dateStr = parts[0];
    const cycleStr = parts[1];

    if (!dateStr || !cycleStr) {
      throw new Error(`Invalid timestamp format: ${timestamp}`);
    }

    const year = parseInt(dateStr.slice(0, 4));
    const month = parseInt(dateStr.slice(4, 6)) - 1;
    const day = parseInt(dateStr.slice(6, 8));
    const hour = parseInt(cycleStr.slice(0, 2));

    return new Date(Date.UTC(year, month, day, hour, 0, 0, 0));
  }

  /**
   * Check if all configs are loaded
   */
  isReady(): boolean {
    return this.hypatiaConfig !== null &&
           this.paramsConfig !== null &&
           this.layersConfig !== null &&
           this.dataManifest !== null;
  }
}

// Export singleton instance
export const configLoader = new ConfigLoader();
