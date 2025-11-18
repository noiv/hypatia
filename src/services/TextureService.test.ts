/**
 * TextureService Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TextureService } from './TextureService'
import { createMockRenderer, createMockTexture3D } from '../__tests__/utils/mockFactory'
import * as THREE from 'three'

describe('TextureService', () => {
  let service: TextureService
  let renderer: THREE.WebGLRenderer
  let mockGl: any

  beforeEach(() => {
    // Create mock WebGL2 context using the global mock class
    mockGl = new (global.WebGL2RenderingContext as any)()

    renderer = createMockRenderer()
    // Mock getContext to return our mock WebGL2 context instance
    renderer.getContext = vi.fn().mockReturnValue(mockGl)

    // Suppress console warnings during tests
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})

    service = new TextureService(renderer)
  })

  describe('GPU State Detection', () => {
    it('should detect texture not on GPU', () => {
      const texture = createMockTexture3D()

      // Mock properties without __webglTexture
      renderer.properties.get = vi.fn().mockReturnValue({})

      const isOnGPU = service.isTextureOnGPU(texture)
      expect(isOnGPU).toBe(false)
    })

    it('should detect texture on GPU', () => {
      const texture = createMockTexture3D()

      // Mock properties with __webglTexture
      renderer.properties.get = vi.fn().mockReturnValue({
        __webglTexture: { mock: 'texture' },
      })

      const isOnGPU = service.isTextureOnGPU(texture)
      expect(isOnGPU).toBe(true)
    })

    it('should report optimized updates available for WebGL2', () => {
      expect(service.isOptimizedUpdateAvailable()).toBe(true)
    })

    it('should report optimized updates unavailable for non-WebGL2', () => {
      // Create service with non-WebGL2 context
      const webgl1Renderer = createMockRenderer()
      webgl1Renderer.getContext = vi.fn().mockReturnValue({
        // WebGL1 context (not instanceof WebGL2RenderingContext)
      })

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const webgl1Service = new TextureService(webgl1Renderer)

      expect(webgl1Service.isOptimizedUpdateAvailable()).toBe(false)

      consoleSpy.mockRestore()
    })
  })

  describe('Texture Updates', () => {
    it('should use needsUpdate for initial upload', () => {
      const texture = createMockTexture3D()
      const sliceData = new Uint16Array(256 * 256)

      // Mock texture not on GPU
      renderer.properties.get = vi.fn().mockReturnValue({})

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      service.updateTextureSlice(texture, sliceData, 5)

      // Should set needsUpdate
      expect(texture.needsUpdate).toBe(true)

      // Should not call texSubImage3D
      expect(mockGl.texSubImage3D).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('should use texSubImage3D for subsequent updates', () => {
      const texture = createMockTexture3D()
      const sliceData = new Uint16Array(256 * 256)

      // Mock texture on GPU
      const mockWebGLTexture = { mock: 'texture' }
      renderer.properties.get = vi.fn().mockReturnValue({
        __webglTexture: mockWebGLTexture,
      })

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      service.updateTextureSlice(texture, sliceData, 5)

      // Should call bindTexture
      expect(mockGl.bindTexture).toHaveBeenCalledWith(mockGl.TEXTURE_3D, mockWebGLTexture)

      // Should call texSubImage3D
      expect(mockGl.texSubImage3D).toHaveBeenCalledWith(
        mockGl.TEXTURE_3D,
        0, // mip level
        0,
        0,
        5, // x, y, z offset (z = sliceIndex)
        256, // width
        256, // height
        1, // depth (single slice)
        mockGl.RED, // format
        mockGl.HALF_FLOAT, // type
        sliceData
      )

      consoleSpy.mockRestore()
    })

    it('should update texture data array', () => {
      const texture = createMockTexture3D()
      const sliceData = new Uint16Array(256 * 256).fill(42)

      // Mock texture not on GPU
      renderer.properties.get = vi.fn().mockReturnValue({})

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      service.updateTextureSlice(texture, sliceData, 2)

      // Check that data was updated
      const texData = texture.image.data as Uint16Array
      const sliceSize = 256 * 256
      const offset = 2 * sliceSize

      // Check a few values
      expect(texData[offset]).toBe(42)
      expect(texData[offset + 100]).toBe(42)
      expect(texData[offset + sliceSize - 1]).toBe(42)

      consoleSpy.mockRestore()
    })

    it('should fallback to needsUpdate for non-WebGL2', () => {
      const webgl1Renderer = createMockRenderer()
      webgl1Renderer.getContext = vi.fn().mockReturnValue({})

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const webgl1Service = new TextureService(webgl1Renderer)

      const texture = createMockTexture3D()
      const sliceData = new Uint16Array(256 * 256)

      // Mock texture on GPU (but WebGL2 not available)
      webgl1Renderer.properties.get = vi.fn().mockReturnValue({
        __webglTexture: { mock: 'texture' },
      })

      webgl1Service.updateTextureSlice(texture, sliceData, 5)

      // Should use needsUpdate fallback
      expect(texture.needsUpdate).toBe(true)
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Fallback update for slice 5')
      )

      consoleSpy.mockRestore()
      logSpy.mockRestore()
    })
  })

  describe('Format/Type Conversion', () => {
    it('should convert RedFormat correctly', () => {
      const format = service.getWebGLFormat(THREE.RedFormat)
      expect(format).toBe(mockGl.RED)
    })

    it('should convert RGFormat correctly', () => {
      const format = service.getWebGLFormat(THREE.RGFormat)
      expect(format).toBe(mockGl.RG)
    })

    it('should convert RGBFormat correctly', () => {
      const format = service.getWebGLFormat(THREE.RGBFormat)
      expect(format).toBe(mockGl.RGB)
    })

    it('should convert RGBAFormat correctly', () => {
      const format = service.getWebGLFormat(THREE.RGBAFormat)
      expect(format).toBe(mockGl.RGBA)
    })

    it('should convert HalfFloatType correctly', () => {
      const type = service.getWebGLType(THREE.HalfFloatType)
      expect(type).toBe(mockGl.HALF_FLOAT)
    })

    it('should convert FloatType correctly', () => {
      const type = service.getWebGLType(THREE.FloatType)
      expect(type).toBe(mockGl.FLOAT)
    })

    it('should convert UnsignedShortType correctly', () => {
      const type = service.getWebGLType(THREE.UnsignedShortType)
      expect(type).toBe(mockGl.UNSIGNED_SHORT)
    })

    it('should convert UnsignedByteType correctly', () => {
      const type = service.getWebGLType(THREE.UnsignedByteType)
      expect(type).toBe(mockGl.UNSIGNED_BYTE)
    })
  })

  describe('Memory Tracking', () => {
    it('should calculate texture memory size correctly', () => {
      const texture = createMockTexture3D()

      // Check the actual dimensions from the mock
      const width = texture.image.width
      const height = texture.image.height
      const depth = texture.image.depth

      // HalfFloat (2 bytes), RedFormat (1 component)
      const expectedSize = width * height * depth * 2 * 1
      const actualSize = service.getTextureMemorySize(texture)

      expect(actualSize).toBe(expectedSize)
    })

    it('should calculate size for RGBA FloatType', () => {
      const texture = createMockTexture3D()
      texture.type = THREE.FloatType
      texture.format = THREE.RGBAFormat

      // 256x256x60, Float (4 bytes), RGBA (4 components)
      const expectedSize = 256 * 256 * 60 * 4 * 4
      const actualSize = service.getTextureMemorySize(texture)

      expect(actualSize).toBe(expectedSize)
    })

    it('should format bytes correctly', () => {
      expect(service.formatMemorySize(1024)).toBe('1.00 KB')
      expect(service.formatMemorySize(1024 * 1024)).toBe('1.00 MB')
      expect(service.formatMemorySize(1024 * 1024 * 1024)).toBe('1.00 GB')
      expect(service.formatMemorySize(512)).toBe('512.00 B')
    })

    it('should format fractional sizes', () => {
      expect(service.formatMemorySize(1536)).toBe('1.50 KB') // 1.5 KB
      expect(service.formatMemorySize(2.5 * 1024 * 1024)).toBe('2.50 MB')
    })
  })

  describe('Texture Creation', () => {
    it('should create empty 3D texture with defaults', () => {
      const texture = service.createEmpty3DTexture(256, 256, 60)

      expect(texture.image.width).toBe(256)
      expect(texture.image.height).toBe(256)
      expect(texture.image.depth).toBe(60)
      expect(texture.type).toBe(THREE.HalfFloatType)
      expect(texture.format).toBe(THREE.RedFormat)
    })

    it('should create texture with custom type and format', () => {
      const texture = service.createEmpty3DTexture(128, 128, 30, {
        type: THREE.FloatType,
        format: THREE.RGBAFormat,
      })

      expect(texture.type).toBe(THREE.FloatType)
      expect(texture.format).toBe(THREE.RGBAFormat)
      expect(texture.image.data).toBeInstanceOf(Float32Array)
    })

    it('should fill texture with custom value', () => {
      const texture = service.createEmpty3DTexture(10, 10, 5, {
        fillValue: 42,
      })

      const data = texture.image.data as Uint16Array
      expect(data[0]).toBe(42)
      expect(data[100]).toBe(42)
      expect(data[data.length - 1]).toBe(42)
    })

    it('should create texture with zero fill by default', () => {
      const texture = service.createEmpty3DTexture(10, 10, 5)

      const data = texture.image.data as Uint16Array
      expect(data[0]).toBe(0)
      expect(data[100]).toBe(0)
    })

    it('should set texture parameters correctly', () => {
      const texture = service.createEmpty3DTexture(256, 256, 60)

      expect(texture.minFilter).toBe(THREE.LinearFilter)
      expect(texture.magFilter).toBe(THREE.LinearFilter)
      expect(texture.wrapS).toBe(THREE.RepeatWrapping)
      expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping)
    })
  })
})
