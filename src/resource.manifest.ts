/**
 * Resource manifest for preloading images and other assets
 *
 * Priority levels:
 * - critical: Must be loaded before app starts
 * - high: Should be loaded early
 * - lazy: Can be loaded on demand
 */

export interface Resource {
  path: string;
  size: number;  // Size in bytes
}

export interface ResourceManifest {
  critical: Resource[];
  high: Resource[];
  lazy: Resource[];
}

/**
 * Resource manifest
 *
 * TODO: Generate this automatically from build process
 * For now, manually configured
 */
export const RESOURCE_MANIFEST: ResourceManifest = {
  critical: [],
  high: [],
  lazy: []
};
