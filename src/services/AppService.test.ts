/**
 * AppService Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AppService } from './AppService'
import { LayersService } from './LayersService'
import { DownloadService } from './DownloadService'
import { ConfigService } from './ConfigService'
import { DateTimeService } from './DateTimeService'
import { mockHypatiaConfig, mockDataManifest } from '../__tests__/mocks/mockConfigs'
import type { ILayer, LayerId } from '../visualization/ILayer'

// Mock fetch globally
global.fetch = vi.fn()

// Mock document.fullscreenElement
Object.defineProperty(document, 'fullscreenElement', {
  writable: true,
  value: null,
})

// Mock fullscreen API
document.documentElement.requestFullscreen = vi.fn().mockResolvedValue(undefined)
document.exitFullscreen = vi.fn().mockResolvedValue(undefined)

// Create mock layer
function createMockLayer(): ILayer {
  return {
    update: vi.fn(),
    setVisible: vi.fn(),
    setOpacity: vi.fn(),
    getSceneObject: vi.fn(() => ({} as any)),
    getConfig: vi.fn(() => ({ updateOrder: 0 })),
    dispose: vi.fn(),
  }
}

describe('AppService', () => {
  let service: AppService
  let layersService: LayersService
  let downloadService: DownloadService
  let configService: ConfigService
  let dateTimeService: DateTimeService
  let mockStateService: any
  let mockSceneService: any
  let mockScene: any
  let isBootstrapping: () => boolean

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks()

    // Mock fetch for binary data
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      headers: {
        get: () => 'application/octet-stream',
      },
      arrayBuffer: async () => new ArrayBuffer(256 * 256 * 2),
    })

    // Create mock ConfigService
    configService = {
      getHypatiaConfig: () => mockHypatiaConfig,
      getDataManifest: () => mockDataManifest,
      getLayers: () => [],
    } as any

    dateTimeService = new DateTimeService()

    downloadService = new DownloadService(
      {
        maxRangeDays: 7,
        maxConcurrentDownloads: 4,
        bandwidthSampleSize: 10,
      },
      configService,
      dateTimeService
    )

    layersService = new LayersService(downloadService, configService, dateTimeService)

    // Mock AppStateService
    mockStateService = {
      getCurrentTime: vi.fn(() => new Date('2025-11-11T12:00:00Z')),
      setCurrentTime: vi.fn(),
      get: vi.fn(() => ({
        currentTime: new Date('2025-11-11T12:00:00Z'),
        textEnabled: false,
      })),
    }

    // Create a single mock scene instance that persists
    mockScene = {
      getCameraState: vi.fn(() => ({ x: 0, y: 0, z: 3 })),
      setCameraState: vi.fn(),
      updateTime: vi.fn(),
    }

    // Mock SceneLifecycleService - return same scene instance
    mockSceneService = {
      getScene: vi.fn(() => mockScene),
    }

    // Mock isBootstrapping
    isBootstrapping = vi.fn(() => false)

    service = new AppService(
      mockStateService,
      mockSceneService,
      layersService,
      configService,
      isBootstrapping
    )

    // Suppress console output during tests
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  describe('Layer Toggle', () => {
    it('should toggle layer visibility using LayersService', async () => {
      const layer = createMockLayer()
      layersService.registerLayer('earth', layer, false)

      await service.handleLayerToggle('earth')

      expect(layersService.isVisible('earth')).toBe(true)
      expect(layer.setVisible).toHaveBeenCalledWith(true)
    })

    it('should toggle layer off if already visible', async () => {
      const layer = createMockLayer()
      layersService.registerLayer('earth', layer, false)

      // Turn on first
      await service.handleLayerToggle('earth')
      expect(layersService.isVisible('earth')).toBe(true)

      // Turn off
      await service.handleLayerToggle('earth')
      expect(layersService.isVisible('earth')).toBe(false)
    })

    it('should warn if layer is not registered', async () => {
      await service.handleLayerToggle('temp2m')

      expect(console.warn).toHaveBeenCalled()
    })

    it('should handle errors gracefully', async () => {
      const layer = createMockLayer()
      layersService.registerLayer('earth', layer, false)

      // Make toggle throw error
      vi.spyOn(layersService, 'toggle').mockRejectedValue(new Error('Toggle failed'))

      await service.handleLayerToggle('earth')

      expect(console.error).toHaveBeenCalled()
    })
  })

  describe('URL Synchronization', () => {
    it('should update URL with visible layers', () => {
      const layer = createMockLayer()
      layersService.registerLayer('earth', layer, false)

      // Just verify it doesn't throw - URL state is tested elsewhere
      expect(() => service.updateUrl()).not.toThrow()
    })

    it('should not update URL during bootstrap', () => {
      ;(isBootstrapping as any).mockReturnValue(true)

      // Just verify it doesn't throw during bootstrap
      expect(() => service.updateUrl()).not.toThrow()
    })

    it('should include text layer if enabled', () => {
      mockStateService.get.mockReturnValue({
        currentTime: new Date('2025-11-11T12:00:00Z'),
        textEnabled: true,
      })

      // Just verify it doesn't throw with text enabled
      expect(() => service.updateUrl()).not.toThrow()
    })
  })

  describe('Reference Navigation', () => {
    it('should navigate to reference state', () => {
      service.handleReferenceClick()

      expect(mockStateService.setCurrentTime).toHaveBeenCalled()
      expect(mockScene.updateTime).toHaveBeenCalled()
      expect(mockScene.setCameraState).toHaveBeenCalled()
    })

    it('should use correct reference time', () => {
      service.handleReferenceClick()

      expect(mockStateService.setCurrentTime).toHaveBeenCalledWith(
        new Date('2025-10-29T12:00:00Z')
      )
    })

    it('should use correct reference position', () => {
      service.handleReferenceClick()

      expect(mockScene.setCameraState).toHaveBeenCalledWith(
        { x: 0, y: 0, z: expect.any(Number) },
        expect.any(Number)
      )
    })
  })

  describe('Fullscreen', () => {
    it('should enter fullscreen when not in fullscreen', async () => {
      ;(document.fullscreenElement as any) = null

      await service.toggleFullscreen()

      expect(document.documentElement.requestFullscreen).toHaveBeenCalled()
    })

    it('should exit fullscreen when in fullscreen', async () => {
      ;(document.fullscreenElement as any) = document.documentElement

      await service.toggleFullscreen()

      expect(document.exitFullscreen).toHaveBeenCalled()
    })

    it('should report fullscreen state', () => {
      ;(document.fullscreenElement as any) = null
      expect(service.isFullscreen()).toBe(false)

      ;(document.fullscreenElement as any) = document.documentElement
      expect(service.isFullscreen()).toBe(true)
    })

    it('should handle fullscreen errors gracefully', async () => {
      ;(document.fullscreenElement as any) = null
      ;(document.documentElement.requestFullscreen as any).mockRejectedValue(
        new Error('Fullscreen denied')
      )

      await service.toggleFullscreen()

      expect(console.error).toHaveBeenCalled()
    })
  })

  describe('Layer Statistics', () => {
    it('should get layer statistics from LayersService', () => {
      const layer1 = createMockLayer()
      const layer2 = createMockLayer()

      layersService.registerLayer('earth', layer1, false)
      layersService.registerLayer('temp2m', layer2, true)

      const stats = service.getLayerStats()

      expect(stats.total).toBe(2)
      expect(stats.dataLayers).toBe(1)
    })
  })

  describe('URL Key Mapping', () => {
    it('should convert layer IDs to URL keys', () => {
      // This tests the private method indirectly through updateUrl
      const layer = createMockLayer()
      layersService.registerLayer('temp2m', layer, false)

      // Just verify updateUrl works with data layers
      expect(() => service.updateUrl()).not.toThrow()
    })
  })
})
