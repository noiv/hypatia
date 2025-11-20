/**
 * App Service
 *
 * Central application service for high-level operations.
 * Refactored from AppLogicService to use new LayersService architecture.
 *
 * Responsibilities:
 * - Layer toggle operations (delegates to LayersService)
 * - URL state synchronization
 * - Reference state navigation
 * - Fullscreen management
 */

import type { AppStateService } from './AppStateService'
import type { Scene } from '../visualization/scene'
import type { LayersService } from './LayersService'
import { debouncedUpdateUrlState } from './UrlService'
import type { LayerId } from '../layers/ILayer'

export class AppService {
  constructor(
    private stateService: AppStateService,
    private getScene: () => Scene | undefined,
    private layersService: LayersService,
    private isBootstrapping: () => boolean
  ) {}

  /**
   * Handle layer toggle (uses LayersService for clean delegation)
   */
  async handleLayerToggle(layerId: LayerId): Promise<void> {
    try {
      // Check if layer is registered - if not, create it first
      if (!this.layersService.hasLayer(layerId)) {
        console.log(`[AppService] Layer ${layerId} not registered, creating it`)
        const currentTime = this.stateService.getCurrentTime()
        await this.layersService.createLayers([layerId], currentTime)
      }

      // Get current visibility
      const isVisible = this.layersService.isVisible(layerId)

      // Toggle visibility using LayersService
      const currentTime = this.stateService.getCurrentTime()
      const downloadMode = this.stateService.getDownloadMode()

      await this.layersService.toggle(layerId, !isVisible, {
        currentTime,
        downloadMode,
      })

      console.log(`[AppService] Toggled ${layerId}: ${!isVisible} (${downloadMode} mode)`)
    } catch (error) {
      console.error(`[AppService] Layer toggle failed:`, error)
    }
  }

  /**
   * Update URL with current application state
   */
  updateUrl(): void {
    // Don't update URL during bootstrap - preserve URL parameters from page load
    if (this.isBootstrapping()) {
      return
    }

    const scene = this.getScene()
    const state = this.stateService.get()

    // Get visible layers from LayersService
    const visibleLayerIds = this.layersService.getVisibleLayerIds()

    // Add 'text' to layers if enabled and not already present
    // Note: LayerId now equals urlKey, no conversion needed
    const layers: LayerId[] =
      state.textEnabled && !visibleLayerIds.includes('text')
        ? [...visibleLayerIds, 'text']
        : visibleLayerIds

    debouncedUpdateUrlState(
      {
        time: state.currentTime,
        camera: scene!.getCameraState(),
        layers,
      },
      100
    )
  }

  /**
   * Navigate to reference state (fixed time and position)
   */
  handleReferenceClick(): void {
    const scene = this.getScene()

    // Reference state: 2x Earth radius altitude, looking at lat=0 lon=0
    const referenceTime = new Date('2025-10-29T12:00:00Z')
    const referenceAltitude = 12742000 // 2x Earth radius in meters
    const referenceDistance = referenceAltitude / 6371000 + 1 // Convert to THREE.js units

    const referencePosition = {
      x: 0,
      y: 0,
      z: referenceDistance,
    }

    // Update state
    this.stateService.setCurrentTime(referenceTime)

    if (scene) {
      scene.updateTime(referenceTime)
      scene.setCameraState(referencePosition, referenceDistance)
    }

    // Update URL
    this.updateUrl()
  }

  /**
   * Toggle fullscreen mode
   */
  handleFullscreenToggle(): void {
    this.stateService.toggleFullscreen()

    if (this.stateService.isFullscreen()) {
      document.documentElement.requestFullscreen()
    } else {
      // Only exit fullscreen if document is actually in fullscreen mode
      if (document.fullscreenElement) {
        document.exitFullscreen()
      }
    }

    // Update URL
    this.updateUrl()
  }

  /**
   * Toggle fullscreen mode
   */
  async toggleFullscreen(): Promise<void> {
    try {
      if (!document.fullscreenElement) {
        // Enter fullscreen
        await document.documentElement.requestFullscreen()
        console.log('[AppService] Entered fullscreen')
      } else {
        // Exit fullscreen
        await document.exitFullscreen()
        console.log('[AppService] Exited fullscreen')
      }
    } catch (error) {
      console.error('[AppService] Fullscreen toggle failed:', error)
    }
  }

  /**
   * Check if currently in fullscreen
   */
  isFullscreen(): boolean {
    return !!document.fullscreenElement
  }

  /**
   * Get layer statistics
   */
  getLayerStats() {
    return this.layersService.getStats()
  }

}
