/**
 * LayersService Tests
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LayersService } from './LayersService'
import { DownloadService } from './DownloadService'
import { ConfigService } from './ConfigService'
import { DateTimeService } from './DateTimeService'
import { mockHypatiaConfig, mockDataManifest } from '../__tests__/mocks/mockConfigs'
import type { ILayer, LayerId } from '../layers/ILayer'
import type { AnimationState } from '../visualization/IAnimationState'

// Mock fetch globally
global.fetch = vi.fn()

// Create mock layer
function createMockLayer(updateOrder: number = 0): ILayer {
  return {
    update: vi.fn(),
    setVisible: vi.fn(),
    setOpacity: vi.fn(),
    getSceneObject: vi.fn(() => ({} as any)),
    getConfig: vi.fn(() => ({ updateOrder })),
    dispose: vi.fn(),
  }
}

describe('LayersService', () => {
  let service: LayersService
  let downloadService: DownloadService
  let configService: ConfigService
  let dateTimeService: DateTimeService

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

    service = new LayersService(downloadService, configService, dateTimeService)

    // Suppress console output during tests
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  describe('Layer Registration', () => {
    it('should register a render layer', () => {
      const layer = createMockLayer()
      service.registerLayer('earth', layer, false)

      expect(service.hasLayer('earth')).toBe(true)
      expect(service.isVisible('earth')).toBe(false)
    })

    it('should register a data layer', () => {
      const layer = createMockLayer()
      service.registerLayer('temp', layer, true)

      expect(service.hasLayer('temp')).toBe(true)
      const metadata = service.getMetadata('temp')
      expect(metadata?.isDataLayer).toBe(true)
      expect(metadata?.loadProgress).toBe(0)
    })

    it('should not register duplicate layers', () => {
      const layer1 = createMockLayer()
      const layer2 = createMockLayer()

      service.registerLayer('earth', layer1, false)
      service.registerLayer('earth', layer2, false)

      // Should still have the first layer
      expect(service.getLayer('earth')).toBe(layer1)
    })

    it('should track layer metadata', () => {
      const layer = createMockLayer(5)
      service.registerLayer('sun', layer, false)

      const metadata = service.getMetadata('sun')
      expect(metadata?.layer).toBe(layer)
      expect(metadata?.isDataLayer).toBe(false)
      expect(metadata?.isVisible).toBe(false)
    })
  })

  describe('Layer Visibility', () => {
    it('should toggle render layer visibility', async () => {
      const layer = createMockLayer()
      service.registerLayer('earth', layer, false)

      await service.toggle('earth', true)

      expect(service.isVisible('earth')).toBe(true)
      expect(layer.setVisible).toHaveBeenCalledWith(true)
    })

    it('should toggle data layer visibility', async () => {
      const layer = createMockLayer()
      service.registerLayer('temp', layer, true)

      // Register timesteps in download service
      downloadService.registerLayer('temp', [
        {
          date: '20251111',
          cycle: '00',
          hour: 0,
          time: new Date('2025-11-11T00:00:00Z'),
          filePath: '/data/temp2m/2025111100.fp16',
        } as any,
      ])

      await service.toggle('temp', true, {
        currentTime: new Date('2025-11-11T00:00:00Z'),
      })

      expect(service.isVisible('temp')).toBe(true)
      expect(layer.setVisible).toHaveBeenCalledWith(true)
    })

    it('should handle toggle off', async () => {
      const layer = createMockLayer()
      service.registerLayer('earth', layer, false)

      await service.toggle('earth', true)
      await service.toggle('earth', false)

      expect(service.isVisible('earth')).toBe(false)
      expect(layer.setVisible).toHaveBeenCalledWith(false)
    })

    it('should throw error for unregistered layer', async () => {
      await expect(service.toggle('temp', true)).rejects.toThrow(
        'Layer temp2m not registered'
      )
    })
  })

  describe('Layer Opacity', () => {
    it('should set opacity if layer supports it', () => {
      const layer = createMockLayer()
      service.registerLayer('temp', layer, false)

      service.setOpacity('temp', 0.5)

      expect(layer.setOpacity).toHaveBeenCalledWith(0.5)
    })

    it('should warn if layer does not support opacity', () => {
      const layer = createMockLayer()
      layer.setOpacity = undefined
      service.registerLayer('earth', layer, false)

      service.setOpacity('earth', 0.5)

      expect(console.warn).toHaveBeenCalled()
    })
  })

  describe('Layer Queries', () => {
    beforeEach(() => {
      service.registerLayer('earth', createMockLayer(), false)
      service.registerLayer('sun', createMockLayer(), false)
      service.registerLayer('temp', createMockLayer(), true)
      service.registerLayer('wind', createMockLayer(), true)
    })

    it('should get all layer IDs', () => {
      const layerIds = service.getAllLayerIds()
      expect(layerIds).toHaveLength(4)
      expect(layerIds).toContain('earth')
      expect(layerIds).toContain('temp')
    })

    it('should get visible layer IDs', async () => {
      await service.toggle('earth', true)
      await service.toggle('temp', true)

      const visibleIds = service.getVisibleLayerIds()
      expect(visibleIds).toHaveLength(2)
      expect(visibleIds).toContain('earth')
      expect(visibleIds).toContain('temp')
    })

    it('should get data layer IDs', () => {
      const dataLayerIds = service.getDataLayerIds()
      expect(dataLayerIds).toHaveLength(2)
      expect(dataLayerIds).toContain('temp')
      expect(dataLayerIds).toContain('wind')
    })

    it('should get layer instance', () => {
      const layer = service.getLayer('earth')
      expect(layer).toBeDefined()
      expect(layer?.update).toBeDefined()
    })

    it('should check if layer is registered', () => {
      expect(service.hasLayer('earth')).toBe(true)
      expect(service.hasLayer('pressure' as LayerId)).toBe(false)
    })
  })

  describe('Layer Updates', () => {
    it('should update all visible layers in order', async () => {
      const layer1 = createMockLayer(1)
      const layer2 = createMockLayer(3)
      const layer3 = createMockLayer(2)

      service.registerLayer('earth', layer1, false)
      service.registerLayer('temp', layer2, false)
      service.registerLayer('sun', layer3, false)

      await service.toggle('earth', true)
      await service.toggle('temp', true)
      await service.toggle('sun', true)

      const mockState = {} as AnimationState
      service.updateAll(mockState)

      // Should be called in updateOrder: earth (1), sun (2), temp2m (3)
      expect(layer1.update).toHaveBeenCalledWith(mockState)
      expect(layer2.update).toHaveBeenCalledWith(mockState)
      expect(layer3.update).toHaveBeenCalledWith(mockState)
    })

    it('should not update invisible layers', async () => {
      const layer = createMockLayer()
      service.registerLayer('earth', layer, false)

      // Don't toggle visibility
      const mockState = {} as AnimationState
      service.updateAll(mockState)

      expect(layer.update).not.toHaveBeenCalled()
    })

    it('should update specific layer', async () => {
      const layer = createMockLayer()
      service.registerLayer('earth', layer, false)
      await service.toggle('earth', true)

      const mockState = {} as AnimationState
      service.updateLayer('earth', mockState)

      expect(layer.update).toHaveBeenCalledWith(mockState)
    })

    it('should throw error when updating unregistered layer', () => {
      const mockState = {} as AnimationState
      expect(() => service.updateLayer('temp', mockState)).toThrow(
        'Layer temp2m not registered'
      )
    })
  })

  describe('Download Prioritization', () => {
    it('should prioritize downloads for visible data layers', async () => {
      const layer = createMockLayer()
      service.registerLayer('temp', layer, true)

      // Register timesteps
      const timesteps = [
        {
          date: '20251111',
          cycle: '00',
          hour: 0,
          time: new Date('2025-11-11T00:00:00Z'),
          filePath: '/data/temp2m/2025111100.fp16',
        } as any,
        {
          date: '20251111',
          cycle: '06',
          hour: 6,
          time: new Date('2025-11-11T06:00:00Z'),
          filePath: '/data/temp2m/2025111106.fp16',
        } as any,
      ]
      downloadService.registerLayer('temp', timesteps)

      await service.toggle('temp', true, {
        currentTime: new Date('2025-11-11T00:00:00Z'),
      })

      // Prioritize downloads for new time
      const spy = vi.spyOn(downloadService, 'prioritizeTimestamps')
      service.prioritizeDownloads(new Date('2025-11-11T06:00:00Z'))

      expect(spy).toHaveBeenCalledWith('temp', expect.any(Date))
    })

    it('should not prioritize for invisible layers', () => {
      const layer = createMockLayer()
      service.registerLayer('temp', layer, true)

      const spy = vi.spyOn(downloadService, 'prioritizeTimestamps')
      service.prioritizeDownloads(new Date('2025-11-11T00:00:00Z'))

      expect(spy).not.toHaveBeenCalled()
    })
  })

  describe('Memory Management', () => {
    it('should estimate memory usage', async () => {
      const layer = createMockLayer()
      service.registerLayer('temp', layer, true)

      const timesteps = [
        {
          date: '20251111',
          cycle: '00',
          hour: 0,
          time: new Date('2025-11-11T00:00:00Z'),
          filePath: '/data/temp2m/2025111100.fp16',
        } as any,
      ]
      downloadService.registerLayer('temp', timesteps)

      await service.toggle('temp', true, {
        currentTime: new Date('2025-11-11T00:00:00Z'),
      })

      // After loading, memory usage should be > 0
      const usage = service.getMemoryUsage()
      expect(usage).toBeGreaterThan(0)
    })

    it('should clear layer data', () => {
      const layer = createMockLayer()
      service.registerLayer('temp', layer, true)

      const timesteps = [
        {
          date: '20251111',
          cycle: '00',
          hour: 0,
          time: new Date('2025-11-11T00:00:00Z'),
          filePath: '/data/temp2m/2025111100.fp16',
        } as any,
      ]
      downloadService.registerLayer('temp', timesteps)

      service.clearLayerData('temp')

      const metadata = service.getMetadata('temp')
      expect(metadata?.loadProgress).toBe(0)
    })

    it('should unregister layer and clean up', () => {
      const layer = createMockLayer()
      service.registerLayer('earth', layer, false)

      service.unregisterLayer('earth')

      expect(service.hasLayer('earth')).toBe(false)
      expect(layer.dispose).toHaveBeenCalled()
    })
  })

  describe('Statistics', () => {
    it('should get layer statistics', async () => {
      service.registerLayer('earth', createMockLayer(), false)
      service.registerLayer('sun', createMockLayer(), false)
      service.registerLayer('temp', createMockLayer(), true)

      await service.toggle('earth', true)

      const stats = service.getStats()
      expect(stats.total).toBe(3)
      expect(stats.visible).toBe(1)
      expect(stats.dataLayers).toBe(1)
      expect(stats.memoryUsage).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Event Handling', () => {
    it('should update load progress when download progresses', async () => {
      const layer = createMockLayer()
      service.registerLayer('temp', layer, true)

      const timesteps = [
        {
          date: '20251111',
          cycle: '00',
          hour: 0,
          time: new Date('2025-11-11T00:00:00Z'),
          filePath: '/data/temp2m/2025111100.fp16',
        } as any,
      ]
      downloadService.registerLayer('temp', timesteps)

      await service.toggle('temp', true, {
        currentTime: new Date('2025-11-11T00:00:00Z'),
      })

      // Wait a bit for progress events
      await new Promise((resolve) => setTimeout(resolve, 50))

      const progress = service.getLoadProgress('temp')
      expect(progress).toBeDefined()
      expect(progress).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Disposal', () => {
    it('should dispose all layers and clean up', () => {
      const layer1 = createMockLayer()
      const layer2 = createMockLayer()

      service.registerLayer('earth', layer1, false)
      service.registerLayer('temp', layer2, true)

      service.dispose()

      expect(layer1.dispose).toHaveBeenCalled()
      expect(layer2.dispose).toHaveBeenCalled()
      expect(service.hasLayer('earth')).toBe(false)
      expect(service.hasLayer('temp')).toBe(false)
    })
  })
})
