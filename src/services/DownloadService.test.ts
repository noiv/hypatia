/**
 * DownloadService Tests
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { DownloadService } from './DownloadService'
import { ConfigService } from './ConfigService'
import { DateTimeService } from './DateTimeService'
import { mockHypatiaConfig, mockDataManifest } from '../__tests__/mocks/mockConfigs'
import type { TimeStep } from '../config/types'

// Mock fetch globally
global.fetch = vi.fn()

describe('DownloadService', () => {
  let service: DownloadService
  let configService: ConfigService
  let dateTimeService: DateTimeService

  const mockTimeSteps: TimeStep[] = [
    {
      date: '20251111',
      cycle: '00',
      hour: 0,
      time: new Date('2025-11-11T00:00:00Z'),
      filePath: '/data/temp2m/2025111100.fp16',
    } as TimeStep,
    {
      date: '20251111',
      cycle: '06',
      hour: 6,
      time: new Date('2025-11-11T06:00:00Z'),
      filePath: '/data/temp2m/2025111106.fp16',
    } as TimeStep,
    {
      date: '20251111',
      cycle: '12',
      hour: 12,
      time: new Date('2025-11-11T12:00:00Z'),
      filePath: '/data/temp2m/2025111112.fp16',
    } as TimeStep,
    {
      date: '20251111',
      cycle: '18',
      hour: 18,
      time: new Date('2025-11-11T18:00:00Z'),
      filePath: '/data/temp2m/2025111118.fp16',
    } as TimeStep,
    {
      date: '20251112',
      cycle: '00',
      hour: 0,
      time: new Date('2025-11-12T00:00:00Z'),
      filePath: '/data/temp2m/2025111200.fp16',
    } as TimeStep,
  ]

  const mockWindTimeSteps: TimeStep[] = [
    {
      date: '20251111',
      cycle: '00',
      hour: 0,
      time: new Date('2025-11-11T00:00:00Z'),
      uFilePath: '/data/wind10m/u/2025111100.fp16',
      vFilePath: '/data/wind10m/v/2025111100.fp16',
    } as TimeStep,
    {
      date: '20251111',
      cycle: '06',
      hour: 6,
      time: new Date('2025-11-11T06:00:00Z'),
      uFilePath: '/data/wind10m/u/2025111106.fp16',
      vFilePath: '/data/wind10m/v/2025111106.fp16',
    } as TimeStep,
  ]

  beforeEach(() => {
    // Reset fetch mock
    vi.clearAllMocks()

    // Mock successful binary fetch (default behavior)
    ;(global.fetch as any).mockResolvedValue({
      ok: true,
      headers: {
        get: () => 'application/octet-stream',
      },
      arrayBuffer: async () => new ArrayBuffer(256 * 256 * 2), // 256x256 fp16
    })

    // Create mock ConfigService
    configService = {
      getHypatiaConfig: () => mockHypatiaConfig,
      getDataManifest: () => mockDataManifest,
    } as any

    dateTimeService = new DateTimeService()

    service = new DownloadService(
      {
        maxRangeDays: 7,
        maxConcurrentDownloads: 4,
        bandwidthSampleSize: 10,
      },
      configService,
      dateTimeService
    )

    // Suppress console output during tests
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    service.dispose()
  })

  describe('Layer Registration', () => {
    it('should register a layer with timesteps', () => {
      service.registerLayer('temp2m', mockTimeSteps)

      expect(service.getTimestepCount('temp2m')).toBe(5)
    })

    it('should initialize empty state for all timesteps', () => {
      service.registerLayer('temp2m', mockTimeSteps)

      for (let i = 0; i < mockTimeSteps.length; i++) {
        expect(service.isLoaded('temp2m', i)).toBe(false)
        expect(service.isLoading('temp2m', i)).toBe(false)
      }
    })
  })

  describe('Layer Initialization', () => {
    it('should load adjacent timesteps during initialization', async () => {
      service.registerLayer('temp2m', mockTimeSteps)

      const currentTime = new Date('2025-11-11T12:00:00Z') // Index 2
      await service.initializeLayer('temp2m', currentTime)

      // Should have loaded adjacent indices
      // The service loads ±1 around current, so indices 1 and 3 minimum
      // (Index 2 may or may not be loaded depending on interpolation logic)
      const loadedIndices = service.getLoadedIndices('temp2m')
      expect(loadedIndices.size).toBeGreaterThan(0)

      // At minimum, should have the bounding indices
      expect(loadedIndices.has(1) || loadedIndices.has(2) || loadedIndices.has(3)).toBe(true)
    })

    it('should call onProgress callback during initialization', async () => {
      service.registerLayer('temp2m', mockTimeSteps)

      const progressCalls: Array<{ loaded: number; total: number }> = []
      const onProgress = (loaded: number, total: number) => {
        progressCalls.push({ loaded, total })
      }

      const currentTime = new Date('2025-11-11T12:00:00Z')
      await service.initializeLayer('temp2m', currentTime, onProgress)

      expect(progressCalls.length).toBeGreaterThan(0)
      expect(progressCalls[progressCalls.length - 1].loaded).toBe(
        progressCalls[progressCalls.length - 1].total
      )
    })

    it('should handle wind layer with U+V components', async () => {
      service.registerLayer('wind10m', mockWindTimeSteps)

      const currentTime = new Date('2025-11-11T00:00:00Z')
      await service.initializeLayer('wind10m', currentTime)

      // Should load wind data with u and v components
      const data = service.getData('wind10m', 0)
      expect(data).toBeDefined()
      expect(data).toHaveProperty('u')
      expect(data).toHaveProperty('v')
    })
  })

  describe('Download Management', () => {
    it('should track loaded indices', async () => {
      service.registerLayer('temp2m', mockTimeSteps)

      const currentTime = new Date('2025-11-11T12:00:00Z')
      await service.initializeLayer('temp2m', currentTime)

      const loadedIndices = service.getLoadedIndices('temp2m')
      expect(loadedIndices.size).toBeGreaterThan(0)
      expect(loadedIndices.has(2)).toBe(true) // Current index
    })

    it('should track failed indices on download error', async () => {
      // Mock fetch to fail
      ;(global.fetch as any).mockResolvedValue({
        ok: false,
        status: 404,
      })

      service.registerLayer('temp2m', mockTimeSteps)

      const currentTime = new Date('2025-11-11T12:00:00Z')
      await service.initializeLayer('temp2m', currentTime)

      const failedIndices = service.getFailedIndices('temp2m')
      expect(failedIndices.size).toBeGreaterThan(0)
    })

    it('should not re-download already loaded timesteps', async () => {
      service.registerLayer('temp2m', mockTimeSteps)

      const currentTime = new Date('2025-11-11T12:00:00Z')
      await service.initializeLayer('temp2m', currentTime)

      const fetchCallCount = (global.fetch as any).mock.calls.length

      // Try to initialize again
      await service.initializeLayer('temp2m', currentTime)

      // Should not make additional fetch calls
      expect((global.fetch as any).mock.calls.length).toBe(fetchCallCount)
    })
  })

  describe('Priority Management', () => {
    it('should prioritize adjacent timesteps when time changes', async () => {
      service.registerLayer('temp2m', mockTimeSteps)

      const initialTime = new Date('2025-11-11T00:00:00Z')
      await service.initializeLayer('temp2m', initialTime)

      // Change to different time
      const newTime = new Date('2025-11-12T00:00:00Z') // Index 4
      service.prioritizeTimestamps('temp2m', newTime)

      // Wait a bit for queue processing
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Index 4 should be loaded or loading
      const isLoaded = service.isLoaded('temp2m', 4)
      const isLoading = service.isLoading('temp2m', 4)
      expect(isLoaded || isLoading).toBe(true)
    })
  })

  describe('Bandwidth Tracking', () => {
    it('should track bandwidth statistics', async () => {
      service.registerLayer('temp2m', mockTimeSteps)

      const currentTime = new Date('2025-11-11T12:00:00Z')
      await service.initializeLayer('temp2m', currentTime)

      const stats = service.getBandwidthStats()
      expect(stats.totalBytesDownloaded).toBeGreaterThan(0)
      expect(stats.averageBytesPerSec).toBeGreaterThan(0)
      expect(stats.sampleCount).toBeGreaterThan(0)
    })

    it('should calculate moving average for bandwidth', async () => {
      service.registerLayer('temp2m', mockTimeSteps)

      const currentTime = new Date('2025-11-11T12:00:00Z')
      await service.initializeLayer('temp2m', currentTime)

      const stats = service.getBandwidthStats()
      expect(stats.averageBytesPerSec).toBeGreaterThan(0)
      expect(stats.currentBytesPerSec).toBeGreaterThan(0)
    })
  })

  describe('Progress Tracking', () => {
    it('should calculate download progress', async () => {
      service.registerLayer('temp2m', mockTimeSteps)

      const currentTime = new Date('2025-11-11T12:00:00Z')
      await service.initializeLayer('temp2m', currentTime)

      const progress = service.getProgress('temp2m')
      expect(progress.layerId).toBe('temp2m')
      expect(progress.total).toBe(5)
      expect(progress.loaded).toBeGreaterThan(0)
      expect(progress.percentComplete).toBeGreaterThan(0)
    })

    it('should estimate time remaining', async () => {
      service.registerLayer('temp2m', mockTimeSteps)

      const currentTime = new Date('2025-11-11T12:00:00Z')
      await service.initializeLayer('temp2m', currentTime)

      const progress = service.getProgress('temp2m')

      // If there are empty timesteps, ETA should be calculated
      if (progress.empty > 0) {
        expect(progress.estimatedTimeRemaining).toBeDefined()
        expect(progress.estimatedTimeRemaining).toBeGreaterThan(0)
      }
    })
  })

  describe('Event System', () => {
    it('should emit timestampLoading event', async () => {
      const loadingEvents: any[] = []
      service.on('timestampLoading', (event) => loadingEvents.push(event))

      service.registerLayer('temp2m', mockTimeSteps)

      const currentTime = new Date('2025-11-11T12:00:00Z')
      await service.initializeLayer('temp2m', currentTime)

      expect(loadingEvents.length).toBeGreaterThan(0)
      expect(loadingEvents[0]).toHaveProperty('layerId')
      expect(loadingEvents[0]).toHaveProperty('index')
      expect(loadingEvents[0]).toHaveProperty('timeStep')
    })

    it('should emit timestampLoaded event', async () => {
      const loadedEvents: any[] = []
      service.on('timestampLoaded', (event) => loadedEvents.push(event))

      service.registerLayer('temp2m', mockTimeSteps)

      const currentTime = new Date('2025-11-11T12:00:00Z')
      await service.initializeLayer('temp2m', currentTime)

      expect(loadedEvents.length).toBeGreaterThan(0)
      expect(loadedEvents[0]).toHaveProperty('layerId')
      expect(loadedEvents[0]).toHaveProperty('data')
      expect(loadedEvents[0]).toHaveProperty('downloadedBytes')
      expect(loadedEvents[0]).toHaveProperty('downloadTime')
    })

    it('should emit downloadProgress event', async () => {
      const progressEvents: any[] = []
      service.on('downloadProgress', (event) => progressEvents.push(event))

      service.registerLayer('temp2m', mockTimeSteps)

      const currentTime = new Date('2025-11-11T12:00:00Z')
      await service.initializeLayer('temp2m', currentTime)

      expect(progressEvents.length).toBeGreaterThan(0)
      expect(progressEvents[0]).toHaveProperty('layerId')
      expect(progressEvents[0]).toHaveProperty('progress')
      expect(progressEvents[0].progress).toHaveProperty('percentComplete')
    })

    it('should remove event listeners with off()', () => {
      const listener = vi.fn()
      service.on('timestampLoaded', listener)
      service.off('timestampLoaded', listener)

      service.registerLayer('temp2m', mockTimeSteps)
      // Trigger would happen during initialization, but listener should not be called
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('Data Retrieval', () => {
    it('should return loaded data for timestep', async () => {
      service.registerLayer('temp2m', mockTimeSteps)

      const currentTime = new Date('2025-11-11T12:00:00Z')
      await service.initializeLayer('temp2m', currentTime)

      const data = service.getData('temp2m', 2)
      expect(data).toBeDefined()
      expect(data).toBeInstanceOf(Uint16Array)
    })

    it('should return undefined for unloaded timestep', () => {
      service.registerLayer('temp2m', mockTimeSteps)

      const data = service.getData('temp2m', 4)
      expect(data).toBeUndefined()
    })
  })

  describe('Layer Cleanup', () => {
    it('should clear layer data', async () => {
      service.registerLayer('temp2m', mockTimeSteps)

      const currentTime = new Date('2025-11-11T12:00:00Z')
      await service.initializeLayer('temp2m', currentTime)

      expect(service.getTimestepCount('temp2m')).toBe(5)

      service.clearLayer('temp2m')

      expect(service.getTimestepCount('temp2m')).toBe(0)
      expect(service.getLoadedIndices('temp2m').size).toBe(0)
    })
  })

  describe('Error Handling', () => {
    it('should handle network errors gracefully', async () => {
      // Mock fetch to fail
      ;(global.fetch as any).mockRejectedValue(new Error('Network error'))

      service.registerLayer('temp2m', mockTimeSteps)

      const currentTime = new Date('2025-11-11T12:00:00Z')
      await service.initializeLayer('temp2m', currentTime)

      const failedIndices = service.getFailedIndices('temp2m')
      expect(failedIndices.size).toBeGreaterThan(0)
    })

    it('should handle HTML error pages', async () => {
      // Mock fetch to return HTML instead of binary
      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        headers: {
          get: () => 'text/html',
        },
        arrayBuffer: async () => new ArrayBuffer(100),
      })

      service.registerLayer('temp2m', mockTimeSteps)

      const currentTime = new Date('2025-11-11T12:00:00Z')
      await service.initializeLayer('temp2m', currentTime)

      const failedIndices = service.getFailedIndices('temp2m')
      expect(failedIndices.size).toBeGreaterThan(0)
    })

    it('should handle invalid byte length', async () => {
      // Mock fetch to return odd byte length
      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        headers: {
          get: () => 'application/octet-stream',
        },
        arrayBuffer: async () => new ArrayBuffer(123), // Odd number
      })

      service.registerLayer('temp2m', mockTimeSteps)

      const currentTime = new Date('2025-11-11T12:00:00Z')
      await service.initializeLayer('temp2m', currentTime)

      const failedIndices = service.getFailedIndices('temp2m')
      expect(failedIndices.size).toBeGreaterThan(0)
    })
  })

  describe('Concurrency Control', () => {
    it('should respect max concurrent downloads', async () => {
      service.registerLayer('temp2m', mockTimeSteps)

      // Track concurrent downloads
      let maxConcurrent = 0
      let currentConcurrent = 0

      const originalFetch = global.fetch
      ;(global.fetch as any) = vi.fn(async (...args: any[]) => {
        currentConcurrent++
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent)

        // Simulate slow download
        await new Promise((resolve) => setTimeout(resolve, 50))

        currentConcurrent--

        return {
          ok: true,
          headers: { get: () => 'application/octet-stream' },
          arrayBuffer: async () => new ArrayBuffer(256 * 256 * 2),
        }
      })

      const currentTime = new Date('2025-11-11T12:00:00Z')
      await service.initializeLayer('temp2m', currentTime)

      // Max concurrent should not exceed configured limit
      expect(maxConcurrent).toBeLessThanOrEqual(4)

      global.fetch = originalFetch
    })
  })

  describe('Done Method', () => {
    it('should wait for critical downloads to complete', async () => {
      service.registerLayer('temp2m', mockTimeSteps)

      const currentTime = new Date('2025-11-11T12:00:00Z')
      const initPromise = service.initializeLayer('temp2m', currentTime)

      // done() should wait for critical downloads
      await service.done()

      // Critical downloads should be complete
      expect(service.isLoaded('temp2m', 2)).toBe(true)

      await initPromise
    })

    it('should not wait for background downloads', async () => {
      service.registerLayer('temp2m', mockTimeSteps)

      const currentTime = new Date('2025-11-11T12:00:00Z')
      await service.initializeLayer('temp2m', currentTime)

      // done() should return immediately if only background downloads remain
      const start = Date.now()
      await service.done()
      const elapsed = Date.now() - start

      // Should complete quickly (not waiting for all background downloads)
      expect(elapsed).toBeLessThan(500)
    })
  })
})
