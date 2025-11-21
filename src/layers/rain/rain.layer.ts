/**
 * Rain Layer - Event-Driven Architecture
 *
 * Precipitation rate visualization layer.
 * Refactored to use DownloadService events instead of direct data loading.
 *
 * Key changes from precipitation.render-service.ts:
 * - No direct data loading (delegates to DownloadService)
 * - Listens to download events for texture updates
 * - Uses TextureService for efficient GPU uploads
 * - Maintains data availability state
 */

import * as THREE from 'three'
import { EARTH_RADIUS_UNITS } from '../../utils/constants'
import { RAIN_CONFIG } from '../../config'
import type { TimeStep } from '../../config/types'
import type { ILayer, LayerId } from '../ILayer'
import type { AnimationState } from '../../visualization/IAnimationState'
import type { DownloadService } from '../../services/DownloadService'
import type { TextureService } from '../../services/TextureService'
import type { DateTimeService } from '../../services/DateTimeService'

export class RainLayer implements ILayer {
  layerId: LayerId = 'rain'
  timeSteps: TimeStep[] = []
  private mesh: THREE.Mesh
  private material: THREE.ShaderMaterial
  private dataTexture: THREE.Data3DTexture
  private userRequestedVisible: boolean = true

  // Event-driven state
  private timestepAvailable: boolean[] = []
  private downloadService: DownloadService
  private textureService: TextureService
  private dateTimeService: DateTimeService

  // Cached state for comparison
  private lastTime?: Date

  // Data constants
  private static readonly WIDTH = 1441
  private static readonly HEIGHT = 721
  private static readonly NO_DATA_SENTINEL = 65504 // Max finite fp16

  // Event cleanup
  private eventCleanup: Array<() => void> = []

  constructor(
    layerId: LayerId,
    timeSteps: TimeStep[],
    downloadService: DownloadService,
    textureService: TextureService,
    dateTimeService: DateTimeService
  ) {
    this.layerId = layerId
    this.timeSteps = timeSteps
    this.downloadService = downloadService
    this.textureService = textureService
    this.dateTimeService = dateTimeService

    // Initialize availability tracking
    this.timestepAvailable = new Array(timeSteps.length).fill(false)

    // Create empty texture upfront
    this.dataTexture = this.createEmptyTexture(timeSteps.length)

    // Create geometry
    const radius = EARTH_RADIUS_UNITS * (1 + RAIN_CONFIG.visual.altitudeKm / 6371)
    const geometry = new THREE.SphereGeometry(
      radius,
      RAIN_CONFIG.geometry.widthSegments,
      RAIN_CONFIG.geometry.heightSegments
    )

    // Create shader material
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        dataTexture: { value: this.dataTexture },
        timeIndex: { value: 0.0 },
        maxTimeIndex: { value: timeSteps.length - 1 },
        opacity: { value: RAIN_CONFIG.visual.opacity },
      },
      vertexShader: this.getVertexShader(),
      fragmentShader: this.getFragmentShader(),
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false,
      polygonOffset: RAIN_CONFIG.depth.polygonOffset,
      polygonOffsetFactor: RAIN_CONFIG.depth.polygonOffsetFactor,
      polygonOffsetUnits: RAIN_CONFIG.depth.polygonOffsetUnits,
    })

    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.name = 'RainLayer'
    this.mesh.renderOrder = 2 // Render after temp2m
    this.mesh.visible = false // Initially hidden until data loads

    // Set up event listeners for download events
    this.setupDownloadListeners()
  }

  /**
   * Set up event listeners for DownloadService
   */
  private setupDownloadListeners(): void {
    const onTimestampLoaded = (event: any) => {
      if (event.layerId !== this.layerId) return

      const { index, data } = event
      console.log(`[precipitation] Timestamp ${index} loaded, updating texture`)

      // Extract Uint16Array from data
      const layerData = data instanceof Uint16Array ? data : data.data
      if (!layerData) {
        console.error(`[precipitation] Invalid data format for index ${index}`)
        return
      }

      // Update texture slice using TextureService
      this.textureService.updateTextureSlice(this.dataTexture, layerData, index)

      // Mark as available
      this.timestepAvailable[index] = true

      // Re-check visibility with current time index
      if (this.material.uniforms.timeIndex) {
        this.setTimeIndex(this.material.uniforms.timeIndex.value)
      }
    }

    // Register listener
    this.downloadService.on('timestampLoaded', onTimestampLoaded)

    // Store cleanup function
    this.eventCleanup.push(() => {
      this.downloadService.off('timestampLoaded', onTimestampLoaded)
    })
  }

  /**
   * Create empty 3D texture filled with NO_DATA sentinel
   */
  private createEmptyTexture(depth: number): THREE.Data3DTexture {
    const totalSize = RainLayer.WIDTH * RainLayer.HEIGHT * depth
    const data = new Uint16Array(totalSize)
    data.fill(RainLayer.NO_DATA_SENTINEL)

    const texture = new THREE.Data3DTexture(
      data,
      RainLayer.WIDTH,
      RainLayer.HEIGHT,
      depth
    )
    texture.format = THREE.RedFormat
    texture.type = THREE.HalfFloatType
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping

    return texture
  }

  /**
   * Update time index for interpolation
   * Only shows layer if data is loaded for required indices
   */
  setTimeIndex(index: number): void {
    if (this.material.uniforms.timeIndex) {
      this.material.uniforms.timeIndex.value = index
    }

    // Check if data is loaded for interpolation (floor and ceil indices)
    const idx1 = Math.floor(index)
    const idx2 = Math.min(idx1 + 1, this.timeSteps.length - 1)

    const data1 = this.timestepAvailable[idx1] || false
    const data2 = this.timestepAvailable[idx2] || false
    const hasData = data1 && data2

    // Only visible if user wants it visible AND data is available
    const shouldBeVisible = this.userRequestedVisible && hasData

    if (this.mesh.visible !== shouldBeVisible) {
      this.mesh.visible = shouldBeVisible
    }
  }

  /**
   * Set layer opacity
   */
  setOpacity(opacity: number): void {
    if (this.material.uniforms.opacity) {
      this.material.uniforms.opacity.value = opacity
    }
  }

  /**
   * Update layer based on animation state (called every frame)
   * Checks for time changes
   */
  update(state: AnimationState): void {
    // Check time change
    if (!this.lastTime || state.time.getTime() !== this.lastTime.getTime()) {
      // Calculate time index from current time using DateTimeService
      const fractionalIndex = this.dateTimeService.timeToIndex(state.time, this.timeSteps)
      this.setTimeIndex(fractionalIndex)
      this.lastTime = state.time
    }
  }

  /**
   * Set user visibility preference
   * Actual visibility depends on data availability
   */
  setVisible(visible: boolean): void {
    this.userRequestedVisible = visible
    // Re-evaluate visibility based on current time index
    if (this.material.uniforms.timeIndex) {
      this.setTimeIndex(this.material.uniforms.timeIndex.value)
    }
  }

  /**
   * Get THREE.js scene object
   */
  getSceneObject(): THREE.Object3D {
    return this.mesh
  }

  /**
   * Get layer configuration
   */
  getConfig() {
    return RAIN_CONFIG
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    // Clean up event listeners
    for (const cleanup of this.eventCleanup) {
      cleanup()
    }
    this.eventCleanup = []

    // Dispose THREE.js resources
    if (this.mesh.geometry) {
      this.mesh.geometry.dispose()
    }
    if (this.material) {
      this.material.dispose()
    }
    if (this.dataTexture) {
      this.dataTexture.dispose()
    }
  }

  // Shaders (unchanged from original)

  private getVertexShader(): string {
    return `
      varying vec2 vUv;
      varying vec3 vNormal;

      void main() {
        vNormal = normalize(position);

        float lon = atan(vNormal.z, vNormal.x);
        float lat = asin(vNormal.y);

        const float PI = 3.14159265;
        const float TWO_PI = 6.28318530718;

        float u = ((lon - 1.57079632) + PI) / TWO_PI;
        u = 1.0 - u;

        float v = 1.0 - ((lat + 1.57079632) / 3.14159265);

        vUv = vec2(u, v);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `
  }

  private getFragmentShader(): string {
    return `
      uniform sampler3D dataTexture;
      uniform float timeIndex;
      uniform float maxTimeIndex;
      uniform float opacity;

      varying vec2 vUv;
      varying vec3 vNormal;

      const float DISCARD_THRESHOLD = ${RAIN_CONFIG.discardThreshold.toExponential()};
      const float NO_DATA_SENTINEL = 65504.0;

      vec4 getPrateColor(float rate) {
        return
          rate < 0.0004 ? vec4(0.04, 0.24, 0.59, 0.30) :
          rate < 0.0007 ? vec4(0.11, 0.30, 0.62, 0.40) :
          rate < 0.0013 ? vec4(0.18, 0.36, 0.66, 0.50) :
          rate < 0.0024 ? vec4(0.25, 0.43, 0.70, 0.60) :
          rate < 0.0042 ? vec4(0.32, 0.49, 0.74, 0.70) :
          rate < 0.0076 ? vec4(0.39, 0.55, 0.77, 0.80) :
          rate < 0.0136 ? vec4(0.47, 0.62, 0.81, 0.90) :
                          vec4(1.00, 1.00, 1.00, 1.00);
      }

      void main() {
        float t = clamp(timeIndex, 0.0, maxTimeIndex);

        float z1 = floor(t);
        float z2 = min(z1 + 1.0, maxTimeIndex);
        float mix_factor = fract(t);

        vec3 uvw1 = vec3(vUv.x, vUv.y, (z1 + 0.5) / (maxTimeIndex + 1.0));
        vec3 uvw2 = vec3(vUv.x, vUv.y, (z2 + 0.5) / (maxTimeIndex + 1.0));

        float rate1 = texture(dataTexture, uvw1).r;
        float rate2 = texture(dataTexture, uvw2).r;

        if (rate1 > 60000.0 || rate2 > 60000.0) {
          #ifdef DEVELOPMENT
            gl_FragColor = vec4(0.3, 0.3, 0.3, 0.3);
          #else
            discard;
          #endif
          return;
        }

        float rate = mix(rate1, rate2, mix_factor);

        if (rate <= DISCARD_THRESHOLD) {
          discard;
        }

        vec4 color = getPrateColor(rate);
        color.a *= opacity;

        gl_FragColor = color;
      }
    `
  }
}
