/**
 * Resource Manager
 *
 * Handles loading of resources with progress tracking
 */

import { RESOURCE_MANIFEST } from '../manifest';

export interface LoadProgress {
  loaded: number;
  total: number;
  percentage: number;
  currentFile: string;
}

export type ProgressCallback = (progress: LoadProgress) => void;

/**
 * Preload images and return them as a map
 */
export async function preloadImages(
  priority: keyof typeof RESOURCE_MANIFEST,
  onProgress?: ProgressCallback
): Promise<Map<string, HTMLImageElement>> {
  const resources = RESOURCE_MANIFEST[priority];
  const images = new Map<string, HTMLImageElement>();

  const total = resources.reduce((sum, r) => sum + r.size, 0);
  let loaded = 0;

  for (const resource of resources) {
    try {
      const img = await loadImage(resource.path);
      images.set(resource.path, img);

      loaded += resource.size;

      if (onProgress) {
        onProgress({
          loaded,
          total,
          percentage: (loaded / total) * 100,
          currentFile: resource.path
        });
      }
    } catch (error) {
      console.error(`❌ Failed to load ${resource.path}:`, error);
      // Continue loading other resources even if one fails
    }
  }

  console.log(`✅ Preloaded ${images.size}/${resources.length} ${priority} resources (${(total / 1024 / 1024).toFixed(2)} MB)`);

  return images;
}

/**
 * Load a single image
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));

    img.src = url;
  });
}

/**
 * Get total size for a priority level
 */
export function getTotalSize(priority: keyof typeof RESOURCE_MANIFEST): number {
  return RESOURCE_MANIFEST[priority].reduce((sum, r) => sum + r.size, 0);
}
