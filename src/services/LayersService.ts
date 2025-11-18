/**
 * Layers Service
 *
 * Centralized service for managing all visualization layers.
 * Coordinates layer lifecycle with DownloadService and provides single point of control.
 *
 * Responsibilities:
 * - Layer registration and lifecycle management
 * - Layer state management (disabled/loading/active)
 * - Visibility and opacity control
 * - Coordinate with DownloadService for data layers
 * - Update orchestration for all layers
 * - Memory management and cleanup
 */

import type { ILayer, LayerId } from '../visualization/ILayer'
import type { AnimationState } from '../visualization/AnimationState'
import type { DownloadService } from './DownloadService'
import type { ConfigService } from './ConfigService'
import type { DateTimeService } from './DateTimeService'
import { LayerState } from '../state/LayerState'

/**
 * Layer metadata
 */
export interface LayerMetadata {
  layer: ILayer
  isDataLayer: boolean // Does this layer require data loading?
  isVisible: boolean
  loadProgress?: number // 0-100 for data layers
}

/**
 * Layer toggle options
 */
export interface LayerToggleOptions {
  currentTime?: Date // For initializing data layers
  onProgress?: (loaded: number, total: number) => void
}

/**
 * Layers Service
 */
export class LayersService {
  // Layer registry (ILayer instances)
  private layers: Map<LayerId, LayerMetadata> = new Map()

  // Layer state (config-driven disabled/loading/active status)
  private layerState: LayerState

  // Services
  private downloadService: DownloadService
  private _configService: ConfigService
  private _dateTimeService: DateTimeService

  // Event listeners cleanup
  private eventCleanup: Array<() => void> = []

  constructor(
    downloadService: DownloadService,
    configService: ConfigService,
    dateTimeService: DateTimeService
  ) {
    this.downloadService = downloadService
    this._configService = configService
    this._dateTimeService = dateTimeService

    // Initialize layer state from config
    const layerConfigs = configService.getLayers()
    this.layerState = new LayerState(layerConfigs)

    console.log('[LayersService] Initialized')
  }

  /**
   * Get the layer state instance
   */
  getLayerState(): LayerState {
    return this.layerState
  }

  /**
   * Initialize layer state from URL parameters
   */
  initializeFromUrl(urlKeys: string[]): void {
    if (urlKeys.length > 0) {
      this.layerState.enableFromUrlKeys(urlKeys)
    } else {
      this.layerState.enableDefaults()
    }
  }

  /**
   * Register a layer (does not make it visible)
   */
  registerLayer(layerId: LayerId, layer: ILayer, isDataLayer: boolean = false): void {
    if (this.layers.has(layerId)) {
      console.warn(`[LayersService] Layer ${layerId} already registered, skipping`)
      return
    }

    const metadata: LayerMetadata = {
      layer,
      isDataLayer,
      isVisible: false
    };
    if (isDataLayer) {
      metadata.loadProgress = 0;
    }
    this.layers.set(layerId, metadata);

    // If it's a data layer, listen to download progress
    if (isDataLayer) {
      const progressListener = (event: any) => {
        if (event.layerId === layerId) {
          const metadata = this.layers.get(layerId)
          if (metadata) {
            metadata.loadProgress = event.progress.percentComplete
          }
        }
      }

      this.downloadService.on('downloadProgress', progressListener)

      // Store cleanup function
      this.eventCleanup.push(() => {
        this.downloadService.off('downloadProgress', progressListener)
      })
    }

    console.log(
      `[LayersService] Registered ${layerId} (${isDataLayer ? 'data layer' : 'render layer'})`
    )
  }

  /**
   * Toggle layer visibility (loads data if needed)
   */
  async toggle(
    layerId: LayerId,
    visible: boolean,
    options?: LayerToggleOptions
  ): Promise<void> {
    const metadata = this.layers.get(layerId)
    if (!metadata) {
      throw new Error(`Layer ${layerId} not registered`)
    }

    // If turning on and it's a data layer, ensure data is loaded
    if (visible && metadata.isDataLayer) {
      const currentTime = options?.currentTime || new Date()

      // Check if layer already initialized in DownloadService
      const timestepCount = this.downloadService.getTimestepCount(layerId)
      if (timestepCount === 0) {
        console.log(`[LayersService] Initializing data for ${layerId}`)

        // Need to register timesteps - this would normally be done by the layer itself
        // For now, we'll just log a warning
        console.warn(
          `[LayersService] Layer ${layerId} needs timesteps registered before toggle. This should be done during layer creation.`
        )
      } else {
        // Data already registered, just ensure critical timesteps are loaded
        await this.downloadService.initializeLayer(layerId, currentTime, options?.onProgress)
      }
    }

    // Update visibility
    metadata.isVisible = visible
    metadata.layer.setVisible(visible)

    console.log(`[LayersService] ${layerId} visibility: ${visible}`)
  }

  /**
   * Set layer opacity (if supported)
   */
  setOpacity(layerId: LayerId, opacity: number): void {
    const metadata = this.layers.get(layerId)
    if (!metadata) {
      throw new Error(`Layer ${layerId} not registered`)
    }

    if (metadata.layer.setOpacity) {
      metadata.layer.setOpacity(opacity)
    } else {
      console.warn(`[LayersService] Layer ${layerId} does not support opacity`)
    }
  }

  /**
   * Check if layer is visible
   */
  isVisible(layerId: LayerId): boolean {
    const metadata = this.layers.get(layerId)
    return metadata?.isVisible ?? false
  }

  /**
   * Check if layer is registered
   */
  hasLayer(layerId: LayerId): boolean {
    return this.layers.has(layerId)
  }

  /**
   * Get layer instance
   */
  getLayer(layerId: LayerId): ILayer | undefined {
    return this.layers.get(layerId)?.layer
  }

  /**
   * Get layer metadata
   */
  getMetadata(layerId: LayerId): LayerMetadata | undefined {
    return this.layers.get(layerId)
  }

  /**
   * Get all registered layer IDs
   */
  getAllLayerIds(): LayerId[] {
    return Array.from(this.layers.keys())
  }

  /**
   * Get all visible layer IDs
   */
  getVisibleLayerIds(): LayerId[] {
    const visible: LayerId[] = []
    for (const [layerId, metadata] of this.layers) {
      if (metadata.isVisible) {
        visible.push(layerId)
      }
    }
    return visible
  }

  /**
   * Get all data layer IDs
   */
  getDataLayerIds(): LayerId[] {
    const dataLayers: LayerId[] = []
    for (const [layerId, metadata] of this.layers) {
      if (metadata.isDataLayer) {
        dataLayers.push(layerId)
      }
    }
    return dataLayers
  }

  /**
   * Get load progress for a data layer
   */
  getLoadProgress(layerId: LayerId): number | undefined {
    return this.layers.get(layerId)?.loadProgress
  }

  /**
   * Update all visible layers
   */
  updateAll(state: AnimationState): void {
    // Get layers sorted by updateOrder
    const sortedLayers = Array.from(this.layers.entries())
      .filter(([_, metadata]) => metadata.isVisible)
      .map(([layerId, metadata]) => ({
        layerId,
        layer: metadata.layer,
        updateOrder: metadata.layer.getConfig().updateOrder,
      }))
      .sort((a, b) => a.updateOrder - b.updateOrder)

    // Update each visible layer
    for (const { layer } of sortedLayers) {
      layer.update(state)
    }
  }

  /**
   * Update a specific layer
   */
  updateLayer(layerId: LayerId, state: AnimationState): void {
    const metadata = this.layers.get(layerId)
    if (!metadata) {
      throw new Error(`Layer ${layerId} not registered`)
    }

    if (metadata.isVisible) {
      metadata.layer.update(state)
    }
  }

  /**
   * Prioritize downloads for visible data layers when time changes
   */
  prioritizeDownloads(currentTime: Date): void {
    for (const [layerId, metadata] of this.layers) {
      if (metadata.isDataLayer && metadata.isVisible) {
        this.downloadService.prioritizeTimestamps(layerId, currentTime)
      }
    }
  }

  /**
   * Get memory usage for all layers
   */
  getMemoryUsage(): number {
    let total = 0

    for (const [layerId, metadata] of this.layers) {
      if (metadata.isDataLayer) {
        const progress = this.downloadService.getProgress(layerId)
        // Estimate based on loaded timesteps (rough estimate)
        // Each timestep is roughly 256*256*2 bytes for fp16 data
        const bytesPerTimestep = 256 * 256 * 2
        total += progress.loaded * bytesPerTimestep
      }
    }

    return total
  }

  /**
   * Clear data for a layer
   */
  clearLayerData(layerId: LayerId): void {
    const metadata = this.layers.get(layerId)
    if (!metadata) {
      throw new Error(`Layer ${layerId} not registered`)
    }

    if (metadata.isDataLayer) {
      this.downloadService.clearLayer(layerId)
      metadata.loadProgress = 0
      console.log(`[LayersService] Cleared data for ${layerId}`)
    }
  }

  /**
   * Unregister a layer and clean up resources
   */
  unregisterLayer(layerId: LayerId): void {
    const metadata = this.layers.get(layerId)
    if (!metadata) {
      return
    }

    // Clear data if it's a data layer
    if (metadata.isDataLayer) {
      this.downloadService.clearLayer(layerId)
    }

    // Dispose layer resources
    metadata.layer.dispose()

    // Remove from registry
    this.layers.delete(layerId)

    console.log(`[LayersService] Unregistered ${layerId}`)
  }

  /**
   * Get statistics for all layers
   */
  getStats(): {
    total: number
    visible: number
    dataLayers: number
    memoryUsage: number
  } {
    let visible = 0
    let dataLayers = 0

    for (const metadata of this.layers.values()) {
      if (metadata.isVisible) visible++
      if (metadata.isDataLayer) dataLayers++
    }

    return {
      total: this.layers.size,
      visible,
      dataLayers,
      memoryUsage: this.getMemoryUsage(),
    }
  }

  /**
   * Dispose service and clean up all resources
   */
  dispose(): void {
    // Clean up event listeners
    for (const cleanup of this.eventCleanup) {
      cleanup()
    }
    this.eventCleanup = []

    // Dispose all layers
    for (const layerId of this.layers.keys()) {
      this.unregisterLayer(layerId)
    }

    this.layers.clear()

    console.log('[LayersService] Disposed')
  }
}
