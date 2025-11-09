/**
 * Priority Queue
 *
 * Generic priority queue implementation for download scheduling.
 * Items with higher priority values are dequeued first.
 */

export type Priority = 'critical' | 'high' | 'background';

const PRIORITY_VALUES: Record<Priority, number> = {
  critical: 3,
  high: 2,
  background: 1
};

interface QueueItem<T> {
  item: T;
  priority: Priority;
  insertOrder: number; // For stable sorting when priorities equal
}

export class PriorityQueue<T> {
  private items: QueueItem<T>[] = [];
  private insertCounter: number = 0;

  /**
   * Add item to queue with priority
   */
  enqueue(item: T, priority: Priority): void {
    this.items.push({
      item,
      priority,
      insertOrder: this.insertCounter++
    });

    // Sort by priority (descending), then by insertOrder (ascending)
    this.items.sort((a, b) => {
      const priorityDiff = PRIORITY_VALUES[b.priority] - PRIORITY_VALUES[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.insertOrder - b.insertOrder;
    });
  }

  /**
   * Remove and return highest priority item
   */
  dequeue(): T | undefined {
    const queueItem = this.items.shift();
    return queueItem?.item;
  }

  /**
   * Get highest priority item without removing
   */
  peek(): T | undefined {
    return this.items[0]?.item;
  }

  /**
   * Get priority of highest priority item
   */
  peekPriority(): Priority | undefined {
    return this.items[0]?.priority;
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.items.length === 0;
  }

  /**
   * Get queue size
   */
  size(): number {
    return this.items.length;
  }

  /**
   * Clear all items
   */
  clear(): void {
    this.items = [];
    this.insertCounter = 0;
  }

  /**
   * Remove all items matching predicate
   */
  removeWhere(predicate: (item: T) => boolean): number {
    const initialLength = this.items.length;
    this.items = this.items.filter(queueItem => !predicate(queueItem.item));
    return initialLength - this.items.length;
  }

  /**
   * Check if item exists in queue
   */
  contains(predicate: (item: T) => boolean): boolean {
    return this.items.some(queueItem => predicate(queueItem.item));
  }

  /**
   * Get all items (for debugging)
   */
  toArray(): T[] {
    return this.items.map(queueItem => queueItem.item);
  }

  /**
   * Promote existing items matching predicate to new priority
   */
  promote(predicate: (item: T) => boolean, newPriority: Priority): number {
    let promotedCount = 0;

    for (const queueItem of this.items) {
      if (predicate(queueItem.item)) {
        if (PRIORITY_VALUES[newPriority] > PRIORITY_VALUES[queueItem.priority]) {
          queueItem.priority = newPriority;
          promotedCount++;
        }
      }
    }

    if (promotedCount > 0) {
      // Re-sort after promotions
      this.items.sort((a, b) => {
        const priorityDiff = PRIORITY_VALUES[b.priority] - PRIORITY_VALUES[a.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return a.insertOrder - b.insertOrder;
      });
    }

    return promotedCount;
  }
}
