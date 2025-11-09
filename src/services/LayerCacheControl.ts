/**
 * Layer Cache Control
 *
 * Centralized service for managing progressive data loading across all weather layers.
 * Tracks timestamp loading state, manages download queue with priorities,
 * and emits events for UI updates.
 */

import type { LayerId } from '../visualization/ILayer';
import type { TimeStep } from '../config/types';
import { PriorityQueue, type Priority } from '../utils/PriorityQueue';
/**
 * Simple EventEmitter for browser
 */
class EventEmitter {
  private listeners: Map<string, Function[]> = new Map();

  on(event: string, callback: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  emit(event: string, ...args: any[]): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(...args);
      }
    }
  }

  removeListener(event: string, callback: Function): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index !== -1) {
        callbacks.splice(index, 1);
      }
    }
  }
}

/**
 * Loading state for a single timestamp
 */
export type TimestampStatus = 'empty' | 'loading' | 'loaded' | 'failed';

export interface TimestampState {
  status: TimestampStatus;
  data?: Uint16Array | { u: Uint16Array; v: Uint16Array }; // Wind has U+V components
  error?: Error;
}

/**
 * Download request for queue
 */
export interface DownloadRequest {
  layerId: LayerId;
  index: number;
  timeStep: TimeStep;
}

/**
 * Event payloads
 */
export interface TimestampEvent {
  layerId: LayerId;
  index: number;
  timeStep: TimeStep;
}

export interface TimestampLoadedEvent extends TimestampEvent {
  data: Uint16Array | { u: Uint16Array; v: Uint16Array };
}

export interface TimestampFailedEvent extends TimestampEvent {
  error: Error;
}

/**
 * Configuration for cache control
 */
export interface CacheControlConfig {
  maxRangeDays: number;  // Window size centered at current time
  maxConcurrentDownloads: number;  // Max parallel fetches
}

/**
 * Layer Cache Control Service
 */
export class LayerCacheControl extends EventEmitter {
  // Per-layer timestamp state
  private timestamps: Map<LayerId, Map<number, TimestampState>> = new Map();

  // Per-layer timestep definitions
  private timeSteps: Map<LayerId, TimeStep[]> = new Map();

  // Download queue with priority
  private queue: PriorityQueue<DownloadRequest>;

  // Active downloads (to limit concurrency)
  private activeDownloads: Set<string> = new Set(); // key: "layerId-index"

  // Configuration
  private config: CacheControlConfig;

  // Queue processing state
  private isProcessing: boolean = false;

  constructor(config: CacheControlConfig) {
    super();
    this.config = config;
    this.queue = new PriorityQueue<DownloadRequest>();
  }

  /**
   * Register timesteps for a layer
   */
  registerLayer(layerId: LayerId, timeSteps: TimeStep[]): void {
    this.timeSteps.set(layerId, timeSteps);

    // Initialize empty state for all timestamps
    const stateMap = new Map<number, TimestampState>();
    for (let i = 0; i < timeSteps.length; i++) {
      stateMap.set(i, { status: 'empty' });
    }
    this.timestamps.set(layerId, stateMap);

    console.log(`LayerCacheControl: Registered ${layerId} with ${timeSteps.length} timesteps`);
  }

  /**
   * Initialize layer - load adjacent ±1 timestamps first
   */
  async initializeLayer(
    layerId: LayerId,
    currentTime: Date,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<void> {
    const timeSteps = this.timeSteps.get(layerId);
    if (!timeSteps) {
      throw new Error(`Layer ${layerId} not registered`);
    }

    const currentIndex = this.timeToIndex(currentTime, timeSteps);

    console.log(`LayerCacheControl: Initializing ${layerId} at index ${currentIndex}`);

    // 1. Load ±1 immediately (critical priority)
    const adjacentIndices = [
      currentIndex - 1,
      currentIndex,
      currentIndex + 1
    ].filter(i => i >= 0 && i < timeSteps.length);

    let loaded = 0;
    for (const index of adjacentIndices) {
      await this.loadTimestamp(layerId, index, 'critical');
      loaded++;
      if (onProgress) {
        onProgress(loaded, adjacentIndices.length);
      }
    }

    // 2. Queue windowed range (background priority)
    const windowIndices = this.calculateWindowIndices(
      currentIndex,
      timeSteps.length,
      this.config.maxRangeDays
    );

    for (const index of windowIndices) {
      if (!this.isLoaded(layerId, index) && !this.isLoading(layerId, index)) {
        const timeStep = timeSteps[index];
        if (timeStep) {
          this.enqueue({ layerId, index, timeStep }, 'background');
        }
      }
    }

    // 3. Start background processing
    this.processQueue();
  }

  /**
   * Prioritize timestamps when time changes
   */
  prioritizeTimestamps(layerId: LayerId, currentTime: Date): void {
    const timeSteps = this.timeSteps.get(layerId);
    if (!timeSteps) return;

    const currentIndex = this.timeToIndex(currentTime, timeSteps);

    // Promote ±1 adjacent to high priority
    const adjacentIndices = [
      currentIndex - 1,
      currentIndex,
      currentIndex + 1
    ].filter(i => i >= 0 && i < timeSteps.length);

    for (const index of adjacentIndices) {
      if (!this.isLoaded(layerId, index) && !this.isLoading(layerId, index)) {
        const timeStep = timeSteps[index];
        if (timeStep) {
          // Check if already in queue
          const alreadyQueued = this.queue.contains(
            req => req.layerId === layerId && req.index === index
          );

          if (alreadyQueued) {
            // Promote existing item
            this.queue.promote(
              req => req.layerId === layerId && req.index === index,
              'high'
            );
          } else {
            // Add new high priority item
            this.enqueue({ layerId, index, timeStep }, 'high');
          }
        }
      }
    }

    // Continue processing queue
    this.processQueue();
  }

  /**
   * Load a single timestamp
   */
  private async loadTimestamp(
    layerId: LayerId,
    index: number,
    priority: Priority
  ): Promise<void> {
    const state = this.getState(layerId, index);
    if (state.status === 'loaded' || state.status === 'loading') {
      return; // Already loaded or in progress
    }

    const timeSteps = this.timeSteps.get(layerId);
    const timeStep = timeSteps?.[index];
    if (!timeStep) {
      throw new Error(`Invalid index ${index} for layer ${layerId}`);
    }

    // Mark as loading
    this.setState(layerId, index, { status: 'loading' });
    this.emit('timestampLoading', { layerId, index, timeStep });

    const downloadKey = `${layerId}-${index}`;
    this.activeDownloads.add(downloadKey);

    try {
      // Load based on layer type
      let data: Uint16Array | { u: Uint16Array; v: Uint16Array };

      if (layerId === 'wind10m' && 'uFilePath' in timeStep && 'vFilePath' in timeStep) {
        // Wind layer has U and V components
        const windTimeStep = timeStep as any; // Wind has different TimeStep structure
        const [u, v] = await Promise.all([
          this.fetchBinaryFile(windTimeStep.uFilePath as string),
          this.fetchBinaryFile(windTimeStep.vFilePath as string)
        ]);
        data = { u, v };
      } else if ('filePath' in timeStep) {
        // Single file layers
        const singleFileTimeStep = timeStep as any;
        data = await this.fetchBinaryFile(singleFileTimeStep.filePath as string);
      } else {
        throw new Error(`Invalid timeStep structure for ${layerId}`);
      }

      // Mark as loaded
      this.setState(layerId, index, { status: 'loaded', data });
      this.emit('timestampLoaded', { layerId, index, timeStep, data });

      console.log(`LayerCacheControl: Loaded ${layerId}[${index}] (${priority})`);
    } catch (error) {
      const err = error as Error;
      this.setState(layerId, index, { status: 'failed', error: err });
      this.emit('timestampFailed', { layerId, index, timeStep, error: err });

      console.error(`LayerCacheControl: Failed to load ${layerId}[${index}]:`, err);
    } finally {
      this.finishDownload(downloadKey);
    }
  }

  /**
   * Fetch binary file as Uint16Array (fp16)
   */
  private async fetchBinaryFile(path: string): Promise<Uint16Array> {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to load ${path}: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    return new Uint16Array(buffer);
  }

  /**
   * Enqueue download request
   */
  private enqueue(request: DownloadRequest, priority: Priority): void {
    this.queue.enqueue(request, priority);
  }

  /**
   * Remove item from active downloads and process queue
   */
  private finishDownload(downloadKey: string): void {
    this.activeDownloads.delete(downloadKey);
    this.processQueue();
  }

  /**
   * Process download queue
   */
  private processQueue(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;

    // Process in next tick to avoid blocking
    setTimeout(() => this.processQueueInternal(), 0);
  }

  private async processQueueInternal(): Promise<void> {
    while (!this.queue.isEmpty()) {
      // Check concurrency limit
      if (this.activeDownloads.size >= this.config.maxConcurrentDownloads) {
        // Wait a bit and retry
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }

      const request = this.queue.dequeue();
      if (!request) break;

      const { layerId, index } = request;

      // Skip if already loaded/loading
      const state = this.getState(layerId, index);
      if (state.status === 'loaded' || state.status === 'loading') {
        continue;
      }

      // Start loading (don't await - allow concurrent)
      const priority = this.queue.peekPriority() || 'background';
      this.loadTimestamp(layerId, index, priority).catch(err => {
        console.error(`Queue processing error for ${layerId}[${index}]:`, err);
      });
    }

    this.isProcessing = false;
  }

  /**
   * Calculate window indices centered at current index
   */
  private calculateWindowIndices(
    currentIndex: number,
    totalTimesteps: number,
    maxRangeDays: number
  ): number[] {
    // Assuming 6-hour timestep (4 steps per day)
    const stepsPerDay = 4;
    const windowSteps = maxRangeDays * stepsPerDay;
    const halfWindow = Math.floor(windowSteps / 2);

    const start = Math.max(0, currentIndex - halfWindow);
    const end = Math.min(totalTimesteps - 1, currentIndex + halfWindow);

    const indices: number[] = [];
    for (let i = start; i <= end; i++) {
      indices.push(i);
    }

    return indices;
  }

  /**
   * Convert Date to fractional timestep index
   */
  private timeToIndex(currentTime: Date, timeSteps: TimeStep[]): number {
    const currentMs = currentTime.getTime();

    for (let i = 0; i < timeSteps.length - 1; i++) {
      const step1 = this.parseTimeStep(timeSteps[i]!);
      const step2 = this.parseTimeStep(timeSteps[i + 1]!);

      if (currentMs >= step1.getTime() && currentMs <= step2.getTime()) {
        // Interpolate between i and i+1
        const total = step2.getTime() - step1.getTime();
        const elapsed = currentMs - step1.getTime();
        return i + (elapsed / total);
      }
    }

    // Out of range - clamp
    const firstStep = timeSteps[0];
    if (firstStep && currentMs < this.parseTimeStep(firstStep).getTime()) {
      return 0;
    }

    return timeSteps.length - 1;
  }

  /**
   * Parse TimeStep to Date
   */
  private parseTimeStep(step: TimeStep): Date {
    const year = parseInt(step.date.slice(0, 4));
    const month = parseInt(step.date.slice(4, 6)) - 1;
    const day = parseInt(step.date.slice(6, 8));
    const hour = parseInt(step.cycle.slice(0, 2));

    return new Date(Date.UTC(year, month, day, hour, 0, 0, 0));
  }

  /**
   * Get state for timestamp
   */
  private getState(layerId: LayerId, index: number): TimestampState {
    const layerStates = this.timestamps.get(layerId);
    return layerStates?.get(index) || { status: 'empty' };
  }

  /**
   * Set state for timestamp
   */
  private setState(layerId: LayerId, index: number, state: TimestampState): void {
    let layerStates = this.timestamps.get(layerId);
    if (!layerStates) {
      layerStates = new Map();
      this.timestamps.set(layerId, layerStates);
    }
    layerStates.set(index, state);
  }

  /**
   * Check if timestamp is loaded
   */
  isLoaded(layerId: LayerId, index: number): boolean {
    return this.getState(layerId, index).status === 'loaded';
  }

  /**
   * Check if timestamp is loading
   */
  isLoading(layerId: LayerId, index: number): boolean {
    return this.getState(layerId, index).status === 'loading';
  }

  /**
   * Get loaded timestamp indices (for progress visualization)
   */
  getLoadedIndices(layerId: LayerId): Set<number> {
    const result = new Set<number>();
    const layerStates = this.timestamps.get(layerId);

    if (layerStates) {
      for (const [index, state] of layerStates) {
        if (state.status === 'loaded') {
          result.add(index);
        }
      }
    }

    return result;
  }

  /**
   * Get currently loading index (if any)
   */
  getLoadingIndex(layerId: LayerId): number | null {
    const layerStates = this.timestamps.get(layerId);
    if (!layerStates) return null;

    for (const [index, state] of layerStates) {
      if (state.status === 'loading') {
        return index;
      }
    }
    return null;
  }

  /**
   * Get failed timestamp indices
   */
  getFailedIndices(layerId: LayerId): Set<number> {
    const result = new Set<number>();
    const layerStates = this.timestamps.get(layerId);

    if (layerStates) {
      for (const [index, state] of layerStates) {
        if (state.status === 'failed') {
          result.add(index);
        }
      }
    }

    return result;
  }

  /**
   * Get loaded data for timestamp
   */
  getData(layerId: LayerId, index: number): Uint16Array | { u: Uint16Array; v: Uint16Array } | undefined {
    return this.getState(layerId, index).data;
  }

  /**
   * Get total timestamp count for layer
   */
  getTimestepCount(layerId: LayerId): number {
    return this.timeSteps.get(layerId)?.length || 0;
  }

  /**
   * Clear cache for layer
   */
  clearLayer(layerId: LayerId): void {
    this.timestamps.delete(layerId);
    this.timeSteps.delete(layerId);

    // Remove from queue
    this.queue.removeWhere(req => req.layerId === layerId);

    console.log(`LayerCacheControl: Cleared ${layerId}`);
  }

  /**
   * Get cache statistics
   */
  getStats(layerId: LayerId): {
    total: number;
    loaded: number;
    loading: number;
    failed: number;
    empty: number;
  } {
    const layerStates = this.timestamps.get(layerId);
    const stats = {
      total: 0,
      loaded: 0,
      loading: 0,
      failed: 0,
      empty: 0
    };

    if (!layerStates) return stats;

    stats.total = layerStates.size;

    for (const state of layerStates.values()) {
      switch (state.status) {
        case 'loaded':
          stats.loaded++;
          break;
        case 'loading':
          stats.loading++;
          break;
        case 'failed':
          stats.failed++;
          break;
        case 'empty':
          stats.empty++;
          break;
      }
    }

    return stats;
  }
}

// Singleton instance (to be initialized in bootstrap)
let instance: LayerCacheControl | null = null;

export function initializeLayerCacheControl(config: CacheControlConfig): LayerCacheControl {
  instance = new LayerCacheControl(config);
  return instance;
}

export function getLayerCacheControl(): LayerCacheControl {
  if (!instance) {
    throw new Error('LayerCacheControl not initialized');
  }
  return instance;
}
