/**
 * Cache Loading Strategies
 *
 * Defines the order in which timestamps should be loaded into cache.
 * All strategies ensure current ± 1 are loaded first (priority load).
 */

export type CacheStrategyType = 'future-first' | 'spiral-out';

export interface CacheStrategy {
  /**
   * Get the order in which to load timestamps
   * @param currentIndex - Current timestamp index (0-based)
   * @param totalTimestamps - Total number of timestamps
   * @returns Array of indices in load order (excludes current±1, those are always first)
   */
  getLoadOrder(currentIndex: number, totalTimestamps: number): number[];
}

/**
 * Future-first strategy: Load future timestamps before past
 * Priority: current±1, then +2,+3,+4..., then -2,-3,-4...
 *
 * Best for weather forecasting where users care most about future data.
 */
class FutureFirstStrategy implements CacheStrategy {
  getLoadOrder(currentIndex: number, totalTimestamps: number): number[] {
    const order: number[] = [];

    // Load future: current+2, current+3, ..., end
    for (let i = currentIndex + 2; i < totalTimestamps; i++) {
      order.push(i);
    }

    // Then load past: current-2, current-3, ..., start
    for (let i = currentIndex - 2; i >= 0; i--) {
      order.push(i);
    }

    return order;
  }
}

/**
 * Spiral-out strategy: Alternate between future and past
 * Priority: current±1, then +2,-2,+3,-3,+4,-4...
 *
 * Best for exploring data bidirectionally from current position.
 */
class SpiralOutStrategy implements CacheStrategy {
  getLoadOrder(currentIndex: number, totalTimestamps: number): number[] {
    const order: number[] = [];
    let offset = 2;

    while (true) {
      const hasForward = currentIndex + offset < totalTimestamps;
      const hasBackward = currentIndex - offset >= 0;

      if (!hasForward && !hasBackward) {
        break;
      }

      if (hasForward) {
        order.push(currentIndex + offset);
      }
      if (hasBackward) {
        order.push(currentIndex - offset);
      }

      offset++;
    }

    return order;
  }
}

// Strategy registry
const strategies: Record<CacheStrategyType, CacheStrategy> = {
  'future-first': new FutureFirstStrategy(),
  'spiral-out': new SpiralOutStrategy()
};

/**
 * Get cache strategy by name
 */
export function getCacheStrategy(type: CacheStrategyType): CacheStrategy {
  return strategies[type];
}
