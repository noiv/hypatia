/**
 * Temp Layer - Event-Driven Architecture
 *
 * Temperature at 2 meters above surface visualization layer.
 * Refactored to use DownloadService events instead of direct data loading.
 *
 * Key changes from temp2m.render-service.ts:
 * - No direct data loading (delegates to DownloadService)
 * - Listens to download events for texture updates
 * - Uses TextureService for efficient GPU uploads
 * - Maintains data availability state
 */

import * as THREE from 'three'
import { EARTH_RADIUS_UNITS } from '../../utils/constants'
import { TEMP_CONFIG } from '../../config'
import type { TimeStep } from '../../config/types'
import type { ILayer, LayerId } from '../ILayer'
import type { AnimationState } from '../../visualization/IAnimationState'
import type { DownloadService } from '../../services/DownloadService'
import type { TextureService } from '../../services/TextureService'
import type { DateTimeService } from '../../services/DateTimeService'

export class TempLayer implements ILayer {
  layerId: LayerId = 'temp'
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
  private lastSunDirection?: THREE.Vector3

  // Data constants
  private static readonly WIDTH = 1441
  private static readonly HEIGHT = 721
  private static readonly NO_DATA_SENTINEL = 0 // 0 Kelvin is impossible

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
    const radius = EARTH_RADIUS_UNITS * (1 + TEMP_CONFIG.visual.altitudeKm / 6371)
    const geometry = new THREE.SphereGeometry(
      radius,
      TEMP_CONFIG.geometry.widthSegments,
      TEMP_CONFIG.geometry.heightSegments
    )

    // Create shader material
    this.material = new THREE.ShaderMaterial({
      defines: {
        DEVELOPMENT: '', // Enable debug rendering
      },
      uniforms: {
        dataTexture: { value: this.dataTexture },
        timeIndex: { value: 0.0 },
        maxTimeIndex: { value: timeSteps.length - 1 },
        sunDirection: { value: new THREE.Vector3(0, 0, 0) },
        opacity: { value: TEMP_CONFIG.visual.opacity },
        dayNightSharpness: { value: TEMP_CONFIG.visual.dayNightSharpness },
        dayNightFactor: { value: TEMP_CONFIG.visual.dayNightFactor },
      },
      vertexShader: this.getVertexShader(),
      fragmentShader: this.getFragmentShader(),
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false,
      polygonOffset: TEMP_CONFIG.depth.polygonOffset,
      polygonOffsetFactor: TEMP_CONFIG.depth.polygonOffsetFactor,
      polygonOffsetUnits: TEMP_CONFIG.depth.polygonOffsetUnits,
    })

    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.name = 'TempLayer'
    this.mesh.renderOrder = 1
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
      console.log(`[temp2m] Timestamp ${index} loaded, updating texture`)

      // Extract Uint16Array from data (might be wrapped in object for wind)
      const layerData = data instanceof Uint16Array ? data : data.data
      if (!layerData) {
        console.error(`[temp2m] Invalid data format for index ${index}`)
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
    const totalSize = TempLayer.WIDTH * TempLayer.HEIGHT * depth
    const data = new Uint16Array(totalSize)
    data.fill(TempLayer.NO_DATA_SENTINEL)

    const texture = new THREE.Data3DTexture(
      data,
      TempLayer.WIDTH,
      TempLayer.HEIGHT,
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
   * Update layer based on animation state (called every frame)
   * Checks for time and sun direction changes
   */
  update(state: AnimationState): void {
    // Check time change
    if (!this.lastTime || state.time.getTime() !== this.lastTime.getTime()) {
      // Calculate time index from current time using DateTimeService
      const fractionalIndex = this.dateTimeService.timeToIndex(state.time, this.timeSteps)
      this.setTimeIndex(fractionalIndex)
      this.lastTime = state.time
    }

    // Check sun direction change
    if (!this.lastSunDirection || !this.lastSunDirection.equals(state.sunDirection)) {
      this.material.uniforms.sunDirection?.value.copy(state.sunDirection)
      this.lastSunDirection = state.sunDirection.clone()
    }
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
   * Update sun direction for day/night shading
   */
  protected updateSunDirection(direction: THREE.Vector3): void {
    if (this.material.uniforms.sunDirection) {
      this.material.uniforms.sunDirection.value.copy(direction)
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
    return TEMP_CONFIG
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
      varying vec3 vPosition;
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
        vPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `
  }

  private getFragmentShader(): string {
    return `
      uniform sampler3D dataTexture;
      uniform float timeIndex;
      uniform float maxTimeIndex;
      uniform vec3 sunDirection;
      uniform float opacity;
      uniform float dayNightSharpness;
      uniform float dayNightFactor;

      varying vec2 vUv;
      varying vec3 vPosition;
      varying vec3 vNormal;

      const float NODATA = -9999.0;
      const float NO_DATA_SENTINEL = 65504.0;
      const float NO_DATA_THRESHOLD = 60000.0;
      const float MIN_TEMP = -30.0;
      const float MAX_TEMP = 40.0;

      vec3 getTempColor(float tempC) {
        return
          tempC < -20.0 ? vec3(0.667, 0.400, 0.667) :
          tempC < -10.0 ? vec3(0.808, 0.608, 0.898) :
          tempC <   0.0 ? vec3(0.463, 0.808, 0.886) :
          tempC <  10.0 ? vec3(0.424, 0.937, 0.424) :
          tempC <  20.0 ? vec3(0.929, 0.976, 0.424) :
          tempC <  30.0 ? vec3(1.000, 0.733, 0.333) :
          tempC <  40.0 ? vec3(0.984, 0.396, 0.306) :
                          vec3(0.800, 0.251, 0.251);
      }

      void main() {
        #ifdef DEBUG_UV
          float u = vUv.x;
          vec3 color;
          if (u < 0.05 || u > 0.95) {
            color = vec3(1.0, 1.0, 0.0);
          } else {
            color = vec3(u, 0.0, 0.0);
          }
          gl_FragColor = vec4(color, opacity);
          return;
        #else
          float val1, val2, frac;

          if (timeIndex < 0.0 || timeIndex > maxTimeIndex) {
            #ifdef DEVELOPMENT
              gl_FragColor = vec4(1.0, 0.0, 0.0, 0.3);
            #else
              discard;
            #endif
            return;
          }

          float t1 = floor(timeIndex);
          float t2 = min(t1 + 1.0, maxTimeIndex);
          frac = fract(timeIndex);

          float z1 = (t1 + 0.5) / (maxTimeIndex + 1.0);
          float z2 = (t2 + 0.5) / (maxTimeIndex + 1.0);

          val1 = texture(dataTexture, vec3(vUv, z1)).r;
          val2 = texture(dataTexture, vec3(vUv, z2)).r;

          if (val1 == 0.0 || val2 == 0.0 || val1 == NODATA || val2 == NODATA) {
            #ifdef DEVELOPMENT
              gl_FragColor = vec4(0.2, 0.2, 0.2, 0.3);
            #else
              discard;
            #endif
            return;
          }

          float value = mix(val1, val2, frac);
          float tempC = value - 273.15;
          vec3 color = getTempColor(tempC);

          float sunLength = length(sunDirection);
          vec3 finalColor;

          if (sunLength > 0.01) {
            vec3 lightDir = normalize(sunDirection);
            float dotNL = dot(vNormal, lightDir);
            float dnZone = clamp(dotNL * dayNightSharpness, -1.0, 1.0);
            float lightMix = 0.5 + dnZone * dayNightFactor;
            finalColor = color * lightMix;
          } else {
            finalColor = color;
          }

          gl_FragColor = vec4(finalColor, opacity);
        #endif
      }
    `
  }
}
