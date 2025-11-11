import * as THREE from 'three';

/**
 * Generic texture updater using WebGL2's texSubImage3D for optimal performance
 * Handles partial texture updates without re-uploading entire 120MB textures
 *
 * Performance: Updates only changed slices (2MB) instead of full texture (120MB)
 * This provides ~60x improvement in GPU bandwidth usage
 */
export class TextureUpdater {
  private renderer: THREE.WebGLRenderer;
  private gl: WebGL2RenderingContext | null;
  private textureStates = new WeakMap<THREE.Data3DTexture, boolean>();

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    const context = renderer.getContext();

    if (context instanceof WebGL2RenderingContext) {
      this.gl = context;
    } else {
      this.gl = null;
      console.warn('[TextureUpdater] WebGL2 not available, falling back to needsUpdate');
    }
  }

  /**
   * Update a single slice of a 3D texture efficiently
   * @param texture - The Data3DTexture to update
   * @param sliceData - The data for this slice (Uint16Array for fp16 data)
   * @param sliceIndex - The z-index of the slice to update
   */
  updateTextureSlice(
    texture: THREE.Data3DTexture,
    sliceData: Uint16Array | Float32Array,
    sliceIndex: number
  ): void {
    // Check if texture has been uploaded to GPU
    const properties = this.renderer.properties.get(texture);
    const hasWebGLTexture = properties.__webglTexture !== undefined && properties.__webglTexture !== null;

    if (!hasWebGLTexture) {
      // Texture not yet on GPU - update JS array and use needsUpdate
      const texData = texture.image.data as Uint16Array;
      const sliceSize = texture.image.width * texture.image.height;
      const offset = sliceIndex * sliceSize;
      texData.set(sliceData, offset);

      // Mark for initial upload
      texture.needsUpdate = true;

      // Track that we've seen this texture (for logging)
      if (!this.textureStates.get(texture)) {
        this.textureStates.set(texture, true);
        console.log(`[TextureUpdater] Initial upload batch for texture (starting with slice ${sliceIndex})`);
      } else {
        console.log(`[TextureUpdater] Pre-render update for slice ${sliceIndex} (texture not yet on GPU)`);
      }
      return;
    }

    // Subsequent updates - use texSubImage3D for efficiency if available
    if (!this.gl) {
      // Fallback for non-WebGL2
      const texData = texture.image.data as Uint16Array;
      const sliceSize = texture.image.width * texture.image.height;
      const offset = sliceIndex * sliceSize;
      texData.set(sliceData, offset);
      texture.needsUpdate = true;
      console.log(`[TextureUpdater] Fallback update for slice ${sliceIndex} (no WebGL2)`);
      return;
    }

    // Update JS array (for consistency and potential CPU-side reads)
    const texData = texture.image.data as Uint16Array;
    const sliceSize = texture.image.width * texture.image.height;
    const offset = sliceIndex * sliceSize;
    texData.set(sliceData, offset);

    // Direct GPU update using texSubImage3D
    this.gl.bindTexture(this.gl.TEXTURE_3D, properties.__webglTexture);

    // Determine format and type from texture configuration
    const format = this.getWebGLFormat(texture.format);
    const type = this.getWebGLType(texture.type);

    // Update only the specific slice (z-axis)
    this.gl.texSubImage3D(
      this.gl.TEXTURE_3D,
      0, // mip level
      0, 0, sliceIndex, // x, y, z offset
      texture.image.width,
      texture.image.height,
      1, // update single slice depth
      format,
      type,
      sliceData
    );

    // No need for needsUpdate - we directly updated GPU memory
    console.log(`[TextureUpdater] Updated slice ${sliceIndex} via texSubImage3D`);
  }

  /**
   * Convert THREE.js pixel format to WebGL format constant
   */
  private getWebGLFormat(threeFormat: THREE.PixelFormat): number {
    if (!this.gl) return 0;

    switch (threeFormat) {
      case THREE.RedFormat: return this.gl.RED;
      case THREE.RGFormat: return this.gl.RG;
      case THREE.RGBFormat: return this.gl.RGB;
      case THREE.RGBAFormat: return this.gl.RGBA;
      default: return this.gl.RED;
    }
  }

  /**
   * Convert THREE.js texture data type to WebGL type constant
   */
  private getWebGLType(threeType: THREE.TextureDataType): number {
    if (!this.gl) return 0;

    switch (threeType) {
      case THREE.HalfFloatType: return this.gl.HALF_FLOAT;
      case THREE.FloatType: return this.gl.FLOAT;
      case THREE.UnsignedShortType: return this.gl.UNSIGNED_SHORT;
      case THREE.UnsignedByteType: return this.gl.UNSIGNED_BYTE;
      default: return this.gl.UNSIGNED_BYTE;
    }
  }

  /**
   * Check if WebGL2 and texSubImage3D are available
   */
  isOptimizedUpdateAvailable(): boolean {
    return this.gl !== null;
  }
}
