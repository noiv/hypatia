/**
 * Browser Capability Check
 *
 * Checks for required browser features before app initialization
 */

// Extend Navigator interface for WebGPU
declare global {
  interface Navigator {
    gpu?: any; // WebGPU API
  }
}

export interface CapabilityCheckResult {
  supported: boolean;
  missing: string[];
}

/**
 * Check if browser supports required features (WebGL2 and WebGPU)
 */
export function checkBrowserCapabilities(): CapabilityCheckResult {
  const missing: string[] = [];

  // Check WebGL2 support
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) {
    missing.push('WebGL2');
  }

  // Check WebGPU support
  if (!navigator.gpu) {
    missing.push('WebGPU');
  }

  return {
    supported: missing.length === 0,
    missing
  };
}

/**
 * Get help URLs for users to check their browser configuration
 */
export function getCapabilityHelpUrls(): { webgl: string; webgpu: string } {
  return {
    webgl: 'https://get.webgl.org/webgl2/',
    webgpu: 'https://github.com/gpuweb/gpuweb/wiki/Implementation-Status'
  };
}
