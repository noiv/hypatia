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

  console.group('🔍 Browser Capability Check');

  // Browser info
  console.log('User Agent:', navigator.userAgent);
  console.log('Platform:', navigator.platform);

  // Check WebGL2 support
  console.log('\n📊 WebGL2 Check:');
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (!gl) {
    console.error('❌ WebGL2 not available');
    missing.push('WebGL2');
  } else {
    console.log('✅ WebGL2 available');
    console.log('   Vendor:', gl.getParameter(gl.VENDOR));
    console.log('   Renderer:', gl.getParameter(gl.RENDERER));
    console.log('   Version:', gl.getParameter(gl.VERSION));
  }

  // Check WebGPU support
  console.log('\n⚡ WebGPU Check:');
  console.log('   navigator.gpu exists:', !!navigator.gpu);

  if (!navigator.gpu) {
    console.error('❌ WebGPU not available');
    console.log('   Common causes:');
    console.log('   • Browser too old (need Chrome 113+, Safari 18+, Edge 113+)');
    console.log('   • Feature flag disabled');
    console.log('   • iOS/iPadOS < 26');
    console.log('   • macOS Safari < 18');
    missing.push('WebGPU');
  } else {
    console.log('✅ navigator.gpu exists');

    // Try to request adapter for detailed info
    navigator.gpu.requestAdapter().then((adapter: any) => {
      if (adapter) {
        console.log('✅ WebGPU adapter available');
        console.log('   Adapter info:', {
          vendor: adapter.info?.vendor,
          architecture: adapter.info?.architecture,
          device: adapter.info?.device,
          description: adapter.info?.description
        });
        console.log('   Features:', Array.from(adapter.features || []));
        console.log('   Limits:', adapter.limits);
      } else {
        console.error('❌ WebGPU adapter request returned null');
      }
    }).catch((error: Error) => {
      console.error('❌ WebGPU adapter request failed:', error);
    });
  }

  console.log('\n📋 Summary:');
  if (missing.length === 0) {
    console.log('✅ All required capabilities present');
  } else {
    console.error('❌ Missing capabilities:', missing.join(', '));
  }

  console.groupEnd();

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
