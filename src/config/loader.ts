/**
 * Configuration Loader
 *
 * Loads and validates configuration files at runtime
 */

import type { HypatiaConfig, ParamsConfig, LayersConfig, Layer } from './types';

class ConfigLoader {
  private hypatiaConfig: HypatiaConfig | null = null;
  private paramsConfig: ParamsConfig | null = null;
  private layersConfig: LayersConfig | null = null;

  /**
   * Load all configuration files
   */
  async loadAll(): Promise<void> {
    await Promise.all([
      this.loadHypatiaConfig(),
      this.loadParamsConfig(),
      this.loadLayersConfig()
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
   * Check if all configs are loaded
   */
  isReady(): boolean {
    return this.hypatiaConfig !== null &&
           this.paramsConfig !== null &&
           this.layersConfig !== null;
  }
}

// Export singleton instance
export const configLoader = new ConfigLoader();
