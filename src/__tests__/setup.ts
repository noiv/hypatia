/**
 * Vitest setup file
 * Runs before all tests
 */

import { vi } from 'vitest'

// Mock WebGL2RenderingContext for testing
class MockWebGL2RenderingContext {
  // WebGL2 constants
  RED = 0x1903
  RG = 0x8227
  RGB = 0x1907
  RGBA = 0x1908
  HALF_FLOAT = 0x140B
  FLOAT = 0x1406
  UNSIGNED_SHORT = 0x1403
  UNSIGNED_BYTE = 0x1401
  TEXTURE_3D = 0x806f

  // Mock methods
  getParameter = vi.fn()
  getExtension = vi.fn()
  createTexture = vi.fn()
  bindTexture = vi.fn()
  texImage3D = vi.fn()
  texSubImage3D = vi.fn()
}

// Make WebGL2RenderingContext available globally
global.WebGL2RenderingContext = MockWebGL2RenderingContext as any

// Mock global objects that may not be available in test environment
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}))

// Mock WebGL context if needed
HTMLCanvasElement.prototype.getContext = vi.fn().mockImplementation((contextType) => {
  if (contextType === 'webgl2') {
    return new MockWebGL2RenderingContext()
  }
  return null
})

// Mock fetch for testing download services
global.fetch = vi.fn()

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks()
})
