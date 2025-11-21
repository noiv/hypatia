/**
 * Configuration Service
 *
 * Centralized service for loading and accessing all configuration.
 * Replaces the singleton configLoader and getUserOptions functionality.
 * Consolidates functionality from config/loader.ts and services/UserOptionsService.ts.
 */

import type {
  HypatiaConfig,
  ParamsConfig,
  LayersConfig,
  Layer,
  DataManifest,
  DatasetInfo,
} from '../config/types'

export interface UserOptions {
  timeServer: {
    enabled: boolean
    comment?: string
  }
  atmosphere: {
    enabled: boolean
    comment?: string
  }
}

const DEFAULT_USER_OPTIONS: UserOptions = {
  timeServer: {
    enabled: false,
  },
  atmosphere: {
    enabled: false,
  },
}

export class ConfigService {
  private hypatiaConfig: HypatiaConfig | null = null
  private paramsConfig: ParamsConfig | null = null
  private layersConfig: LayersConfig | null = null
  private dataManifest: DataManifest | null = null
  private userOptions: UserOptions | null = null

  // ============================================================================
  // Configuration Loading
  // ============================================================================

  /**
   * Load all configuration files
   */
  async loadAll(): Promise<void> {
    // Load hypatia config first (needed for dataBaseUrl)
    await this.loadHypatiaConfig()

    // Load rest in parallel
    await Promise.all([
      this.loadParamsConfig(),
      this.loadLayersConfig(),
      this.loadDataManifest(),
      this.loadUserOptions(),
    ])
  }

  /**
   * Load main application config
   */
  async loadHypatiaConfig(): Promise<HypatiaConfig> {
    if (this.hypatiaConfig) return this.hypatiaConfig

    const response = await fetch('/config/hypatia.config.json')
    if (!response.ok) {
      throw new Error(`Failed to load hypatia.config.json: ${response.statusText}`)
    }

    const config: HypatiaConfig = await response.json()
    this.hypatiaConfig = config

    // Log build version info
    console.log(
      `%cBuild: v${config.build.version} (${config.build.hash}) - ${config.build.timestamp}`,
      'font-weight: 800; color: darkorange'
    )

    // Log data window configuration
    const maxRangeDays = config.data.maxRangeDays
    const currentTime = new Date()
    const halfWindow = Math.floor(maxRangeDays / 2)
    const startDate = new Date(currentTime)
    startDate.setDate(startDate.getDate() - halfWindow)
    const startDateStr = startDate.toISOString().substring(0, 10)
    console.log(`ConfigService: Data window: ${startDateStr} + ${maxRangeDays} days`)

    return config
  }

  /**
   * Load ECMWF parameters catalog
   */
  async loadParamsConfig(): Promise<ParamsConfig> {
    if (this.paramsConfig) return this.paramsConfig

    const response = await fetch('/config/params-config.json')
    if (!response.ok) {
      throw new Error(`Failed to load params-config.json: ${response.statusText}`)
    }

    const config: ParamsConfig = await response.json()
    this.paramsConfig = config
    return config
  }

  /**
   * Load layer definitions
   */
  async loadLayersConfig(): Promise<LayersConfig> {
    if (this.layersConfig) return this.layersConfig

    const response = await fetch('/config/layer-config.json')
    if (!response.ok) {
      throw new Error(`Failed to load layer-config.json: ${response.statusText}`)
    }

    const config: LayersConfig = await response.json()
    this.layersConfig = config
    return config
  }

  /**
   * Load data manifest
   */
  async loadDataManifest(): Promise<DataManifest> {
    if (this.dataManifest) return this.dataManifest

    const dataBaseUrl = this.getDataBaseUrl()
    const manifestUrl = `${dataBaseUrl}/manifest.json`

    const response = await fetch(manifestUrl)
    if (!response.ok) {
      throw new Error(`Failed to load manifest from ${manifestUrl}: ${response.statusText}`)
    }

    const manifest: DataManifest = await response.json()
    this.dataManifest = manifest
    return manifest
  }

  /**
   * Load user options from user.options.json
   */
  async loadUserOptions(): Promise<UserOptions> {
    if (this.userOptions) return this.userOptions

    try {
      const response = await fetch('/config/user.options.json')
      if (!response.ok) {
        throw new Error(`Failed to load user options: ${response.statusText}`)
      }

      const options: UserOptions = await response.json()
      this.userOptions = options
      console.log('ConfigService: User options loaded:', options)
      return options
    } catch (error) {
      console.warn('ConfigService: Failed to load user options, using defaults:', error)
      this.userOptions = DEFAULT_USER_OPTIONS
      return DEFAULT_USER_OPTIONS
    }
  }

  // ============================================================================
  // Configuration Access
  // ============================================================================

  /**
   * Get hypatia config (must be loaded first)
   */
  getHypatiaConfig(): HypatiaConfig {
    if (!this.hypatiaConfig) {
      throw new Error('Hypatia config not loaded. Call loadAll() first.')
    }
    return this.hypatiaConfig
  }

  /**
   * Get params config (must be loaded first)
   */
  getParamsConfig(): ParamsConfig {
    if (!this.paramsConfig) {
      throw new Error('Params config not loaded. Call loadAll() first.')
    }
    return this.paramsConfig
  }

  /**
   * Get layers config (must be loaded first)
   */
  getLayersConfig(): LayersConfig {
    if (!this.layersConfig) {
      throw new Error('Layers config not loaded. Call loadAll() first.')
    }
    return this.layersConfig
  }

  /**
   * Get data manifest (must be loaded first)
   */
  getDataManifest(): DataManifest {
    if (!this.dataManifest) {
      throw new Error('Data manifest not loaded. Call loadAll() first.')
    }
    return this.dataManifest
  }

  /**
   * Get user options (must be loaded first)
   */
  getUserOptions(): UserOptions {
    if (!this.userOptions) {
      throw new Error('User options not loaded. Call loadAll() first.')
    }
    return this.userOptions
  }

  /**
   * Update a user option at runtime
   */
  setUserOption(key: string, value: any): void {
    if (!this.userOptions) {
      throw new Error('User options not loaded. Call loadAll() first.')
    }

    // Simple deep set for nested properties
    const keys = key.split('.')
    let current: any = this.userOptions

    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i]!
      if (!(k in current)) {
        current[k] = {}
      }
      current = current[k]
    }

    const lastKey = keys[keys.length - 1]!
    current[lastKey] = value
  }

  // ============================================================================
  // Layer Queries
  // ============================================================================

  /**
   * Get all layers sorted by group and order
   */
  getLayers(): Layer[] {
    const config = this.getLayersConfig()
    return [...config.layers].sort((a, b) => {
      const groupA = config.groups[a.ui.group]
      const groupB = config.groups[b.ui.group]

      if (!groupA || !groupB) {
        return 0
      }

      if (groupA.order !== groupB.order) {
        return groupA.order - groupB.order
      }

      return a.ui.order - b.ui.order
    })
  }

  /**
   * Get layer by ID
   */
  getLayerById(id: string): Layer | undefined {
    const config = this.getLayersConfig()
    return config.layers.find((layer) => layer.id === id)
  }

  /**
   * Get layer by URL key
   */
  getLayerByUrlKey(urlKey: string): Layer | undefined {
    const config = this.getLayersConfig()
    return config.layers.find((layer) => layer.urlKey === urlKey)
  }

  /**
   * Convert layer ID to URL key
   */
  layerIdToUrlKey(layerId: string): string {
    const layer = this.getLayerById(layerId)
    return layer ? layer.urlKey : layerId
  }

  /**
   * Convert URL key to layer ID
   */
  urlKeyToLayerId(urlKey: string): string {
    if (!this.layersConfig) {
      return urlKey
    }
    const layer = this.getLayerByUrlKey(urlKey)
    return layer ? layer.id : urlKey
  }

  /**
   * Get all enabled-by-default layers
   */
  getDefaultLayers(): Layer[] {
    const config = this.getLayersConfig()
    return config.layers.filter((layer) => layer.ui.defaultEnabled)
  }

  /**
   * Get non-data layer IDs (layers without ECMWF parameters)
   * These are render-only layers: cubemaps + decoration
   */
  getNonDataLayers(): string[] {
    const config = this.getHypatiaConfig()
    return [...config.layers.cubemaps, ...config.layers.decoration]
  }

  // ============================================================================
  // Parameter Queries
  // ============================================================================

  /**
   * Get parameter info by code
   */
  getParamInfo(paramCode: string) {
    const config = this.getParamsConfig()
    return config.parameters[paramCode]
  }

  // ============================================================================
  // Dataset Queries
  // ============================================================================

  /**
   * Get dataset info by parameter name
   */
  getDatasetInfo(paramName: string): DatasetInfo | undefined {
    if (!this.dataManifest) {
      return undefined
    }
    return this.dataManifest.datasets[paramName]
  }

  /**
   * Get data base URL from hypatia config
   */
  getDataBaseUrl(): string {
    const config = this.getHypatiaConfig()
    return config.data.dataBaseUrl
  }

  /**
   * Get dataset time range (start and end times)
   * Parses compact manifest format "20251026_00z-20251108_06z"
   */
  getDatasetRange(paramName: string): { startTime: Date; endTime: Date } | null {
    const datasetInfo = this.getDatasetInfo(paramName)
    if (!datasetInfo) {
      return null
    }

    // Parse range: "20251026_00z-20251108_06z"
    const [startStr, endStr] = datasetInfo.range.split('-')
    if (!startStr || !endStr) {
      return null
    }

    const startTime = this.parseTimestamp(startStr)
    const endTime = this.parseTimestamp(endStr)

    return { startTime, endTime }
  }

  /**
   * Parse timestamp like "20251030_00z" into Date
   */
  private parseTimestamp(timestamp: string): Date {
    const parts = timestamp.split('_')
    if (parts.length !== 2) {
      throw new Error(`Invalid timestamp format: ${timestamp}`)
    }

    const dateStr = parts[0]
    const cycleStr = parts[1]

    if (!dateStr || !cycleStr) {
      throw new Error(`Invalid timestamp format: ${timestamp}`)
    }

    const year = parseInt(dateStr.slice(0, 4))
    const month = parseInt(dateStr.slice(4, 6)) - 1
    const day = parseInt(dateStr.slice(6, 8))
    const hour = parseInt(cycleStr.slice(0, 2))

    return new Date(Date.UTC(year, month, day, hour, 0, 0, 0))
  }

  // ============================================================================
  // Status Checks
  // ============================================================================

  /**
   * Check if all configs are loaded
   */
  isReady(): boolean {
    return (
      this.hypatiaConfig !== null &&
      this.paramsConfig !== null &&
      this.layersConfig !== null &&
      this.dataManifest !== null &&
      this.userOptions !== null
    )
  }
}
