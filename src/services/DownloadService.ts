/**
 * Download Service
 *
 * Centralized service for managing progressive data loading with bandwidth awareness.
 * Extends and improves upon LayerCacheControl with better event API, bandwidth tracking,
 * and ETA calculations.
 *
 * Key features:
 * - Priority-based download queue (critical > high > normal > background)
 * - Bandwidth tracking with moving average for accurate ETAs
 * - Layer-agnostic download management
 * - Event-driven architecture for UI updates
 * - Concurrency control and resource management
 */

import type { LayerId } from '../layers/ILayer'
import type { TimeStep } from '../config/types'
import { PriorityQueue, type Priority } from '../utils/PriorityQueue'
import type { ConfigService } from './ConfigService'
import type { DateTimeService } from './DateTimeService'
import { UrlBuilder } from './UrlBuilder'

/**
 * Loading state for a single timestamp
 */
export type TimestampStatus = 'empty' | 'loading' | 'loaded' | 'failed'

export interface TimestampState {
  status: TimestampStatus
  data?: Uint16Array | { u: Uint16Array; v: Uint16Array }
  error?: Error
  downloadedBytes?: number
  downloadTime?: number // milliseconds
}

/**
 * Download request for queue
 */
export interface DownloadRequest {
  layerId: LayerId
  index: number
  timeStep: TimeStep
  priority: Priority
}

/**
 * Bandwidth statistics
 */
export interface BandwidthStats {
  currentBytesPerSec: number
  averageBytesPerSec: number
  totalBytesDownloaded: number
  totalDownloadTime: number
  sampleCount: number
}

/**
 * Download progress statistics
 */
export interface DownloadProgress {
  layerId: LayerId
  total: number
  loaded: number
  loading: number
  failed: number
  empty: number
  percentComplete: number
  estimatedTimeRemaining?: number // seconds
}

/**
 * Event payloads
 */
export interface TimestampEvent {
  layerId: LayerId
  index: number
  timeStep: TimeStep
}

export interface TimestampLoadedEvent extends TimestampEvent {
  data: Uint16Array | { u: Uint16Array; v: Uint16Array }
  priority: Priority
  downloadedBytes: number
  downloadTime: number
}

export interface TimestampFailedEvent extends TimestampEvent {
  error: Error
}

export interface DownloadProgressEvent {
  layerId: LayerId
  progress: DownloadProgress
}

/**
 * Event listener type
 */
type EventListener<T = any> = (event: T) => void

/**
 * Configuration for download service
 */
export interface DownloadServiceConfig {
  maxRangeDays: number // Window size centered at current time
  maxConcurrentDownloads: number // Max parallel fetches
  bandwidthSampleSize: number // Number of downloads to average for bandwidth
}

/**
 * Download Service
 */
export class DownloadService {
  // Per-layer timestamp state
  private timestamps: Map<LayerId, Map<number, TimestampState>> = new Map()

  // Per-layer timestep definitions
  private timeSteps: Map<LayerId, TimeStep[]> = new Map()

  // Download queue with priority
  private queue: PriorityQueue<DownloadRequest>

  // Active downloads (to limit concurrency)
  private activeDownloads: Set<string> = new Set() // key: "layerId-index"

  // Configuration
  private config: DownloadServiceConfig

  // Queue processing state
  private isProcessing: boolean = false

  // Event listeners
  private listeners: Map<string, Set<EventListener>> = new Map()

  // Bandwidth tracking
  private bandwidthSamples: Array<{ bytes: number; time: number }> = []
  private totalBytesDownloaded: number = 0
  private totalDownloadTime: number = 0

  // Services
  private configService: ConfigService
  private dateTimeService: DateTimeService
  private urlBuilder: UrlBuilder

  constructor(
    config: DownloadServiceConfig,
    configService: ConfigService,
    dateTimeService: DateTimeService,
    urlBuilder: UrlBuilder = new UrlBuilder()
  ) {
    this.config = config
    this.configService = configService
    this.dateTimeService = dateTimeService
    this.urlBuilder = urlBuilder
    this.queue = new PriorityQueue<DownloadRequest>()
  }

  /**
   * Register timesteps for a layer
   */
  registerLayer(layerId: LayerId, timeSteps: TimeStep[]): void {
    this.timeSteps.set(layerId, timeSteps)

    // Initialize empty state for all timestamps
    const stateMap = new Map<number, TimestampState>()
    for (let i = 0; i < timeSteps.length; i++) {
      stateMap.set(i, { status: 'empty' })
    }
    this.timestamps.set(layerId, stateMap)

    console.log(`[DownloadService] Registered ${layerId} with ${timeSteps.length} timesteps`)
  }

  /**
   * Initialize layer - load adjacent ±1 timestamps first
   * @param strategy - 'on-demand': only load critical ±1, 'aggressive': queue all timesteps
   */
  async initializeLayer(
    layerId: LayerId,
    currentTime: Date,
    onProgress?: (loaded: number, total: number) => void,
    strategy: 'aggressive' | 'on-demand' = 'on-demand'
  ): Promise<void> {
    const timeSteps = this.timeSteps.get(layerId)
    if (!timeSteps) {
      throw new Error(`Layer ${layerId} not registered`)
    }

    const currentIndex = this.dateTimeService.timeToIndex(currentTime, timeSteps)
    const adjacentIndices = this.dateTimeService.getAdjacentIndices(currentTime, timeSteps)

    console.log(`[DownloadService] Initializing ${layerId} at index ${currentIndex} (${strategy} mode)`)

    // 1. Load ±1 immediately (critical priority)
    let loaded = 0
    for (const index of adjacentIndices) {
      await this.loadTimestamp(layerId, index, 'critical')
      loaded++
      if (onProgress) {
        onProgress(loaded, adjacentIndices.length)
      }
    }

    // 2. If on-demand mode, stop here (only critical ±1 loaded)
    if (strategy === 'on-demand') {
      console.log(`[DownloadService] On-demand mode: loaded ${adjacentIndices.length} critical timesteps`)
      this.emitProgress(layerId)
      return
    }

    // 3. Aggressive mode: Queue all remaining timesteps (background priority)
    console.log(`[DownloadService] Aggressive mode: queueing all ${timeSteps.length} timesteps`)
    for (let index = 0; index < timeSteps.length; index++) {
      if (!this.isLoaded(layerId, index) && !this.isLoading(layerId, index)) {
        const timeStep = timeSteps[index]
        if (timeStep) {
          this.enqueue({ layerId, index, timeStep, priority: 'background' })
        }
      }
    }

    // 4. Start background processing
    this.processQueue()

    // Emit progress event
    this.emitProgress(layerId)
  }

  /**
   * Download all timesteps for a layer (aggressive mode)
   */
  downloadAllTimesteps(layerId: LayerId): void {
    const timeSteps = this.timeSteps.get(layerId)
    if (!timeSteps) {
      console.warn(`[DownloadService] Cannot download all timesteps: layer ${layerId} not registered`)
      return
    }

    console.log(`[DownloadService] Queueing all ${timeSteps.length} timesteps for ${layerId}`)

    // Queue all timesteps that aren't loaded or loading
    for (let index = 0; index < timeSteps.length; index++) {
      if (!this.isLoaded(layerId, index) && !this.isLoading(layerId, index)) {
        const timeStep = timeSteps[index]
        if (timeStep) {
          this.enqueue({ layerId, index, timeStep, priority: 'background' })
        }
      }
    }

    // Start processing
    this.processQueue()
  }

  /**
   * Prioritize timestamps when time changes
   */
  prioritizeTimestamps(layerId: LayerId, currentTime: Date): void {
    const timeSteps = this.timeSteps.get(layerId)
    if (!timeSteps) return

    const adjacentIndices = this.dateTimeService.getAdjacentIndices(currentTime, timeSteps)

    for (const index of adjacentIndices) {
      if (!this.isLoaded(layerId, index) && !this.isLoading(layerId, index)) {
        const timeStep = timeSteps[index]
        if (timeStep) {
          // Check if already in queue
          const alreadyQueued = this.queue.contains(
            (req) => req.layerId === layerId && req.index === index
          )

          if (alreadyQueued) {
            // Promote existing item
            this.queue.promote(
              (req) => req.layerId === layerId && req.index === index,
              'high'
            )
          } else {
            // Add new high priority item
            this.enqueue({ layerId, index, timeStep, priority: 'high' })
          }
        }
      }
    }

    // Continue processing queue
    this.processQueue()
  }

  /**
   * Load a single timestamp
   */
  private async loadTimestamp(
    layerId: LayerId,
    index: number,
    priority: Priority
  ): Promise<void> {
    const state = this.getState(layerId, index)
    if (state.status === 'loaded' || state.status === 'loading') {
      return // Already loaded or in progress
    }

    const timeSteps = this.timeSteps.get(layerId)
    const timeStep = timeSteps?.[index]
    if (!timeStep) {
      throw new Error(`Invalid index ${index} for layer ${layerId}`)
    }

    // Mark as loading
    this.setState(layerId, index, { status: 'loading' })
    this.emit('timestampLoading', { layerId, index, timeStep })

    const downloadKey = `${layerId}-${index}`
    this.activeDownloads.add(downloadKey)

    const startTime = performance.now()

    try {
      // Get layer config for URL construction
      const layer = this.configService.getLayerById(layerId)
      if (!layer) {
        throw new Error(`Layer not found: ${layerId}`)
      }
      const hypatiaConfig = this.configService.getHypatiaConfig()
      const urlConfig = {
        dataBaseUrl: hypatiaConfig.data.dataBaseUrl,
        dataFolder: layer.dataFolders[0] || layerId,
      }

      // Load based on layer type
      let data: Uint16Array | { u: Uint16Array; v: Uint16Array }
      let totalBytes = 0

      if (layerId === 'wind') {
        // Wind layer has U and V components
        const urls = this.urlBuilder.buildWindUrls(urlConfig, timeStep)
        const [u, v] = await Promise.all([
          this.fetchBinaryFile(urls.u),
          this.fetchBinaryFile(urls.v),
        ])
        data = { u, v }
        totalBytes = u.byteLength + v.byteLength
      } else {
        // Single file layers (temp, precipitation, pressure)
        const url = this.urlBuilder.buildDataUrl(urlConfig, timeStep)
        data = await this.fetchBinaryFile(url)
        totalBytes = data.byteLength
      }

      const downloadTime = performance.now() - startTime

      // Update bandwidth stats
      this.updateBandwidthStats(totalBytes, downloadTime)

      // Mark as loaded
      this.setState(layerId, index, {
        status: 'loaded',
        data,
        downloadedBytes: totalBytes,
        downloadTime,
      })

      this.emit('timestampLoaded', {
        layerId,
        index,
        timeStep,
        data,
        priority,
        downloadedBytes: totalBytes,
        downloadTime,
      })

      // Emit progress update
      this.emitProgress(layerId)

      // Only log critical loads during bootstrap
      if (priority === 'critical') {
        console.log(
          `[DownloadService] Loaded ${layerId}[${index}] (${(totalBytes / 1024).toFixed(1)}KB in ${downloadTime.toFixed(0)}ms)`
        )
      }
    } catch (error) {
      const err = error as Error
      this.setState(layerId, index, { status: 'failed', error: err })
      this.emit('timestampFailed', { layerId, index, timeStep, error: err })

      // Emit progress update
      this.emitProgress(layerId)

      console.error(`[DownloadService] Failed to load ${layerId}[${index}]:`, err)
    } finally {
      this.finishDownload(downloadKey)
    }
  }

  /**
   * Fetch binary file as Uint16Array (fp16)
   */
  private async fetchBinaryFile(path: string): Promise<Uint16Array> {
    const response = await fetch(path)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${path}`)
    }

    // Check content type to ensure we got binary data, not HTML error page
    const contentType = response.headers.get('content-type')
    if (contentType && contentType.includes('text/html')) {
      throw new Error(`Got HTML instead of binary data: ${path}`)
    }

    const buffer = await response.arrayBuffer()

    // Validate byte length is even (required for Uint16Array)
    if (buffer.byteLength % 2 !== 0) {
      throw new Error(`Invalid byte length (${buffer.byteLength}): ${path}`)
    }

    return new Uint16Array(buffer)
  }

  /**
   * Update bandwidth statistics
   */
  private updateBandwidthStats(bytes: number, timeMs: number): void {
    this.totalBytesDownloaded += bytes
    this.totalDownloadTime += timeMs

    // Add to samples (for moving average)
    this.bandwidthSamples.push({ bytes, time: timeMs })

    // Keep only recent samples
    if (this.bandwidthSamples.length > this.config.bandwidthSampleSize) {
      this.bandwidthSamples.shift()
    }
  }

  /**
   * Get bandwidth statistics
   */
  getBandwidthStats(): BandwidthStats {
    // Calculate average from recent samples
    let sampleBytes = 0
    let sampleTime = 0

    for (const sample of this.bandwidthSamples) {
      sampleBytes += sample.bytes
      sampleTime += sample.time
    }

    const averageBytesPerSec = sampleTime > 0 ? (sampleBytes / sampleTime) * 1000 : 0

    // Calculate current from last sample
    const lastSample = this.bandwidthSamples[this.bandwidthSamples.length - 1]
    const currentBytesPerSec = lastSample
      ? (lastSample.bytes / lastSample.time) * 1000
      : averageBytesPerSec

    return {
      currentBytesPerSec,
      averageBytesPerSec,
      totalBytesDownloaded: this.totalBytesDownloaded,
      totalDownloadTime: this.totalDownloadTime,
      sampleCount: this.bandwidthSamples.length,
    }
  }

  /**
   * Enqueue download request
   */
  private enqueue(request: DownloadRequest): void {
    this.queue.enqueue(request, request.priority)
  }

  /**
   * Remove item from active downloads and process queue
   */
  private finishDownload(downloadKey: string): void {
    this.activeDownloads.delete(downloadKey)
    this.processQueue()
  }

  /**
   * Process download queue
   */
  private processQueue(): void {
    if (this.isProcessing) return
    this.isProcessing = true

    // Process in next tick to avoid blocking
    setTimeout(() => this.processQueueInternal(), 0)
  }

  private async processQueueInternal(): Promise<void> {
    while (!this.queue.isEmpty()) {
      // Check concurrency limit
      if (this.activeDownloads.size >= this.config.maxConcurrentDownloads) {
        // Wait a bit and retry
        await new Promise((resolve) => setTimeout(resolve, 100))
        continue
      }

      const request = this.queue.dequeue()
      if (!request) break

      const { layerId, index, priority } = request

      // Skip if already loaded/loading
      const state = this.getState(layerId, index)
      if (state.status === 'loaded' || state.status === 'loading') {
        continue
      }

      // Start loading (don't await - allow concurrent)
      this.loadTimestamp(layerId, index, priority).catch((err) => {
        console.error(`Queue processing error for ${layerId}[${index}]:`, err)
      })
    }

    this.isProcessing = false
  }

  /**
   * Get state for timestamp
   */
  private getState(layerId: LayerId, index: number): TimestampState {
    const layerStates = this.timestamps.get(layerId)
    return layerStates?.get(index) || { status: 'empty' }
  }

  /**
   * Set state for timestamp
   */
  private setState(layerId: LayerId, index: number, state: TimestampState): void {
    let layerStates = this.timestamps.get(layerId)
    if (!layerStates) {
      layerStates = new Map()
      this.timestamps.set(layerId, layerStates)
    }
    layerStates.set(index, state)
  }

  /**
   * Check if timestamp is loaded
   */
  isLoaded(layerId: LayerId, index: number): boolean {
    return this.getState(layerId, index).status === 'loaded'
  }

  /**
   * Check if timestamp is loading
   */
  isLoading(layerId: LayerId, index: number): boolean {
    return this.getState(layerId, index).status === 'loading'
  }

  /**
   * Get loaded timestamp indices (for progress visualization)
   */
  getLoadedIndices(layerId: LayerId): Set<number> {
    const result = new Set<number>()
    const layerStates = this.timestamps.get(layerId)

    if (layerStates) {
      for (const [index, state] of layerStates) {
        if (state.status === 'loaded') {
          result.add(index)
        }
      }
    }

    return result
  }

  /**
   * Get currently loading index (if any)
   */
  getLoadingIndex(layerId: LayerId): number | null {
    const layerStates = this.timestamps.get(layerId)
    if (!layerStates) return null

    for (const [index, state] of layerStates) {
      if (state.status === 'loading') {
        return index
      }
    }
    return null
  }

  /**
   * Get failed timestamp indices
   */
  getFailedIndices(layerId: LayerId): Set<number> {
    const result = new Set<number>()
    const layerStates = this.timestamps.get(layerId)

    if (layerStates) {
      for (const [index, state] of layerStates) {
        if (state.status === 'failed') {
          result.add(index)
        }
      }
    }

    return result
  }

  /**
   * Get loaded data for timestamp
   */
  getData(
    layerId: LayerId,
    index: number
  ): Uint16Array | { u: Uint16Array; v: Uint16Array } | undefined {
    return this.getState(layerId, index).data
  }

  /**
   * Get total timestamp count for layer
   */
  getTimestepCount(layerId: LayerId): number {
    return this.timeSteps.get(layerId)?.length || 0
  }

  /**
   * Get download progress for layer
   */
  getProgress(layerId: LayerId): DownloadProgress {
    const layerStates = this.timestamps.get(layerId)
    const progress: DownloadProgress = {
      layerId,
      total: 0,
      loaded: 0,
      loading: 0,
      failed: 0,
      empty: 0,
      percentComplete: 0,
    }

    if (!layerStates) return progress

    progress.total = layerStates.size

    for (const state of layerStates.values()) {
      switch (state.status) {
        case 'loaded':
          progress.loaded++
          break
        case 'loading':
          progress.loading++
          break
        case 'failed':
          progress.failed++
          break
        case 'empty':
          progress.empty++
          break
      }
    }

    progress.percentComplete = progress.total > 0 ? (progress.loaded / progress.total) * 100 : 0

    // Calculate ETA if bandwidth data available
    const bandwidthStats = this.getBandwidthStats()
    if (bandwidthStats.averageBytesPerSec > 0 && progress.empty > 0) {
      // Estimate remaining bytes (assume average file size from loaded files)
      const loadedStates = Array.from(layerStates.values()).filter(
        (s) => s.status === 'loaded' && s.downloadedBytes
      )
      if (loadedStates.length > 0) {
        const avgBytes =
          loadedStates.reduce((sum, s) => sum + (s.downloadedBytes || 0), 0) / loadedStates.length
        const estimatedRemainingBytes = avgBytes * progress.empty
        progress.estimatedTimeRemaining = estimatedRemainingBytes / bandwidthStats.averageBytesPerSec
      }
    }

    return progress
  }

  /**
   * Emit progress event
   */
  private emitProgress(layerId: LayerId): void {
    const progress = this.getProgress(layerId)
    this.emit('downloadProgress', { layerId, progress })
  }

  /**
   * Wait for all critical downloads to complete
   */
  async done(): Promise<void> {
    // Wait while there are active downloads with critical/high priority
    while (this.activeDownloads.size > 0 || !this.queue.isEmpty()) {
      // Check if only background priority items remain
      const queuePriority = this.queue.peekPriority()
      if (this.activeDownloads.size === 0 && queuePriority === 'background') {
        break // Background downloads can continue in background
      }

      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  /**
   * Clear cache for layer
   */
  clearLayer(layerId: LayerId): void {
    this.timestamps.delete(layerId)
    this.timeSteps.delete(layerId)

    // Remove from queue
    this.queue.removeWhere((req) => req.layerId === layerId)

    console.log(`[DownloadService] Cleared ${layerId}`)
  }

  /**
   * Register event listener
   */
  on<T = any>(event: string, listener: EventListener<T>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(listener)
  }

  /**
   * Remove event listener
   */
  off<T = any>(event: string, listener: EventListener<T>): void {
    const listeners = this.listeners.get(event)
    if (listeners) {
      listeners.delete(listener)
    }
  }

  /**
   * Emit event
   */
  private emit<T = any>(event: string, data: T): void {
    const listeners = this.listeners.get(event)
    if (listeners) {
      for (const listener of listeners) {
        listener(data)
      }
    }
  }

  /**
   * Dispose service and cleanup
   */
  dispose(): void {
    this.listeners.clear()
    this.timestamps.clear()
    this.timeSteps.clear()
    this.activeDownloads.clear()
    this.bandwidthSamples = []
  }
}
