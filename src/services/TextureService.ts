/**
 * Texture Service
 *
 * Wrapper service for efficient WebGL texture operations.
 * Extends and improves upon TextureUpdater with better API and helper methods.
 *
 * Key features:
 * - Efficient texSubImage3D updates for 3D textures (60x bandwidth improvement)
 * - GPU upload detection
 * - Format/type conversion helpers
 * - Memory tracking
 */

import * as THREE from 'three'

export class TextureService {
  private renderer: THREE.WebGLRenderer
  private gl: WebGL2RenderingContext | null
  private textureStates = new WeakMap<THREE.Data3DTexture, boolean>()

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer
    const context = renderer.getContext()

    if (context instanceof WebGL2RenderingContext) {
      this.gl = context
    } else {
      this.gl = null
      console.warn('[TextureService] WebGL2 not available, falling back to needsUpdate')
    }
  }

  // ============================================================================
  // Texture Updates
  // ============================================================================

  /**
   * Update a single slice of a 3D texture efficiently
   *
   * Uses texSubImage3D for ~60x bandwidth improvement over full texture upload.
   *
   * @param texture - The Data3DTexture to update
   * @param sliceData - The data for this slice (Uint16Array for fp16, Float32Array for fp32)
   * @param sliceIndex - The z-index of the slice to update
   */
  updateTextureSlice(
    texture: THREE.Data3DTexture,
    sliceData: Uint16Array | Float32Array,
    sliceIndex: number
  ): void {
    // Check if texture has been uploaded to GPU
    const hasWebGLTexture = this.isTextureOnGPU(texture)

    if (!hasWebGLTexture) {
      // Texture not yet on GPU - update JS array and use needsUpdate
      this.updateTextureData(texture, sliceData, sliceIndex)
      texture.needsUpdate = true

      // Track that we've seen this texture
      if (!this.textureStates.get(texture)) {
        this.textureStates.set(texture, true)
        console.log(
          `[TextureService] Initial upload batch for texture (starting with slice ${sliceIndex})`
        )
      } else {
        console.log(
          `[TextureService] Pre-render update for slice ${sliceIndex} (texture not yet on GPU)`
        )
      }
      return
    }

    // Subsequent updates - use texSubImage3D for efficiency if available
    if (!this.gl) {
      // Fallback for non-WebGL2
      this.updateTextureData(texture, sliceData, sliceIndex)
      texture.needsUpdate = true
      console.log(`[TextureService] Fallback update for slice ${sliceIndex} (no WebGL2)`)
      return
    }

    // Update JS array (for consistency and potential CPU-side reads)
    this.updateTextureData(texture, sliceData, sliceIndex)

    // Direct GPU update using texSubImage3D
    const properties = this.renderer.properties.get(texture) as any
    this.gl.bindTexture(this.gl.TEXTURE_3D, properties.__webglTexture)

    // Determine format and type from texture configuration
    const format = this.getWebGLFormat(texture.format)
    const type = this.getWebGLType(texture.type)

    // Update only the specific slice (z-axis)
    this.gl.texSubImage3D(
      this.gl.TEXTURE_3D,
      0, // mip level
      0,
      0,
      sliceIndex, // x, y, z offset
      texture.image.width,
      texture.image.height,
      1, // update single slice depth
      format,
      type,
      sliceData
    )

    // No need for needsUpdate - we directly updated GPU memory
    console.log(`[TextureService] Updated slice ${sliceIndex} via texSubImage3D`)
  }

  /**
   * Update texture data array (CPU-side)
   *
   * @param texture - Texture to update
   * @param sliceData - Data for the slice
   * @param sliceIndex - Index of the slice
   */
  private updateTextureData(
    texture: THREE.Data3DTexture,
    sliceData: Uint16Array | Float32Array,
    sliceIndex: number
  ): void {
    // QC-OK: WebGL texture data can be Uint16Array or Float32Array, TypeScript types are incomplete
    const texData = texture.image.data as unknown as Uint16Array | Float32Array
    const sliceSize = texture.image.width * texture.image.height
    const offset = sliceIndex * sliceSize
    texData.set(sliceData, offset)
  }

  // ============================================================================
  // GPU State Detection
  // ============================================================================

  /**
   * Check if texture has been uploaded to GPU
   *
   * @param texture - Texture to check
   * @returns true if texture is on GPU
   */
  isTextureOnGPU(texture: THREE.Data3DTexture): boolean {
    const properties = this.renderer.properties.get(texture) as any
    return properties.__webglTexture !== undefined && properties.__webglTexture !== null
  }

  /**
   * Check if WebGL2 and texSubImage3D are available
   *
   * @returns true if optimized updates are available
   */
  isOptimizedUpdateAvailable(): boolean {
    return this.gl !== null
  }

  // ============================================================================
  // Format/Type Conversion
  // ============================================================================

  /**
   * Convert THREE.js pixel format to WebGL format constant
   *
   * @param threeFormat - THREE.js format
   * @returns WebGL format constant
   */
  getWebGLFormat(threeFormat: THREE.AnyPixelFormat): number {
    if (!this.gl) return 0

    switch (threeFormat) {
      case THREE.RedFormat:
        return this.gl.RED
      case THREE.RGFormat:
        return this.gl.RG
      case THREE.RGBFormat:
        return this.gl.RGB
      case THREE.RGBAFormat:
        return this.gl.RGBA
      default:
        return this.gl.RED
    }
  }

  /**
   * Convert THREE.js texture data type to WebGL type constant
   *
   * @param threeType - THREE.js type
   * @returns WebGL type constant
   */
  getWebGLType(threeType: THREE.TextureDataType): number {
    if (!this.gl) return 0

    switch (threeType) {
      case THREE.HalfFloatType:
        return this.gl.HALF_FLOAT
      case THREE.FloatType:
        return this.gl.FLOAT
      case THREE.UnsignedShortType:
        return this.gl.UNSIGNED_SHORT
      case THREE.UnsignedByteType:
        return this.gl.UNSIGNED_BYTE
      default:
        return this.gl.UNSIGNED_BYTE
    }
  }

  // ============================================================================
  // Memory Tracking Helpers
  // ============================================================================

  /**
   * Calculate texture memory size in bytes
   *
   * @param texture - Texture to measure
   * @returns Size in bytes
   */
  getTextureMemorySize(texture: THREE.Data3DTexture): number {
    const { width, height, depth } = texture.image
    const bytesPerPixel = this.getBytesPerPixel(texture.type, texture.format)
    return width * height * depth * bytesPerPixel
  }

  /**
   * Get bytes per pixel for given type and format
   *
   * @param type - Texture data type
   * @param format - Pixel format
   * @returns Bytes per pixel
   */
  private getBytesPerPixel(type: THREE.TextureDataType, format: THREE.AnyPixelFormat): number {
    // Determine bytes per component
    let bytesPerComponent = 1 // Default: UNSIGNED_BYTE
    switch (type) {
      case THREE.HalfFloatType:
        bytesPerComponent = 2
        break
      case THREE.FloatType:
        bytesPerComponent = 4
        break
      case THREE.UnsignedShortType:
        bytesPerComponent = 2
        break
      case THREE.UnsignedByteType:
        bytesPerComponent = 1
        break
    }

    // Determine number of components
    let components = 1
    switch (format) {
      case THREE.RedFormat:
        components = 1
        break
      case THREE.RGFormat:
        components = 2
        break
      case THREE.RGBFormat:
        components = 3
        break
      case THREE.RGBAFormat:
        components = 4
        break
    }

    return bytesPerComponent * components
  }

  /**
   * Format memory size as human-readable string
   *
   * @param bytes - Size in bytes
   * @returns Formatted string (e.g., "120 MB")
   */
  formatMemorySize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB']
    let size = bytes
    let unitIndex = 0

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024
      unitIndex++
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`
  }

  // ============================================================================
  // Texture Creation Helpers
  // ============================================================================

  /**
   * Create empty 3D texture with specified dimensions and format
   *
   * @param width - Texture width
   * @param height - Texture height
   * @param depth - Texture depth (number of slices)
   * @param options - Texture options
   * @returns Created texture
   */
  createEmpty3DTexture(
    width: number,
    height: number,
    depth: number,
    options: {
      type?: THREE.TextureDataType
      format?: THREE.PixelFormat
      fillValue?: number
    } = {}
  ): THREE.Data3DTexture {
    const type = options.type ?? THREE.HalfFloatType
    const format = options.format ?? THREE.RedFormat
    const fillValue = options.fillValue ?? 0

    // Create data array
    const size = width * height * depth
    const data =
      type === THREE.HalfFloatType || type === THREE.UnsignedShortType
        ? new Uint16Array(size)
        : new Float32Array(size)

    // Fill with specified value
    if (fillValue !== 0) {
      data.fill(fillValue)
    }

    // Create texture
    const texture = new THREE.Data3DTexture(data, width, height, depth)
    texture.format = format
    texture.type = type
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping

    return texture
  }
}
