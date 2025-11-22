/**
 * Global TypeScript declarations
 */

// Extend Window interface with custom properties
declare global {
  interface Window {
    // Currently no custom window properties
    // All debug properties have been removed
  }

  // Chrome-specific performance.memory API
  interface Performance {
    memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
  }

  // WebGPU types are provided by @webgpu/types package (included in tsconfig.json)
  // No need to declare them here

  // Extend Mithril with our custom method
  namespace m {
    function buildQueryString(obj: Record<string, string>): string;
  }

  // Stats.js library (loaded via script tag)
  class Stats {
    constructor();
    dom: HTMLElement;
    begin(): void;
    end(): void;
    update(): void;
    showPanel(panel: number): void;
  }

  // THREE.js renderer properties (internal API)
  namespace THREE {
    interface WebGLRenderer {
      properties: {
        // QC-OK: THREE.js internal - accepts any THREE.Object3D/Texture/Material
        get(object: any): {
          __webglTexture?: WebGLTexture;
          // QC-OK: THREE.js stores various internal WebGL properties dynamically
          [key: string]: any;
        };
      };
    }
  }
}

// Mithril custom query string builder
declare module 'mithril' {
  interface Static {
    buildQueryString(obj: Record<string, string>): string;
  }
}

export {};