/**
 * Performance Memory API Type Definitions
 *
 * Non-standard API available in Chrome, Edge, and other Chromium-based browsers.
 * Also supported in Safari.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Performance/memory
 */

interface MemoryInfo {
  /**
   * Maximum size of the heap, in bytes, available to the context
   */
  readonly jsHeapSizeLimit: number;

  /**
   * Total allocated heap size, in bytes
   */
  readonly totalJSHeapSize: number;

  /**
   * Currently active segment of the heap, in bytes
   */
  readonly usedJSHeapSize: number;
}

/**
 * Extend the global Performance interface to include the memory property
 */
interface Performance {
  /**
   * Memory usage information (non-standard, Chrome/Edge/Safari)
   * Available when Privacy settings allow it
   */
  readonly memory?: MemoryInfo;
}
