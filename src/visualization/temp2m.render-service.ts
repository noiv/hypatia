import * as THREE from 'three';
import { EARTH_RADIUS_UNITS } from '../utils/constants';
import { TEMP2M_CONFIG } from '../config';
import { TimeSeriesLayer } from './render-service.base';
import type { TimeStep } from '../layers/temp2m.data-service';
import type { DataService } from '../services/DataService';
import type { LayerId } from './ILayer';

export class Temp2mRenderService extends TimeSeriesLayer {
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  private constructor(layerId: LayerId, dataTexture: THREE.Data3DTexture, timeSteps: TimeStep[], timeStepCount: number) {
    super(layerId, timeSteps);

    // Use SphereGeometry for better vertex distribution
    // This avoids triangles spanning across the dateline
    const radius = EARTH_RADIUS_UNITS * (1 + TEMP2M_CONFIG.visual.altitudeKm / 6371); // altitude above surface
    const geometry = new THREE.SphereGeometry(
      radius,
      TEMP2M_CONFIG.geometry.widthSegments,
      TEMP2M_CONFIG.geometry.heightSegments
    );

    // Create shader material
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        dataTexture: { value: dataTexture },
        timeIndex: { value: 0.0 },
        maxTimeIndex: { value: timeStepCount - 1 },
        sunDirection: { value: new THREE.Vector3(0, 0, 0) }, // Default: no sun (flat lighting)
        opacity: { value: TEMP2M_CONFIG.visual.opacity },
        dayNightSharpness: { value: TEMP2M_CONFIG.visual.dayNightSharpness },
        dayNightFactor: { value: TEMP2M_CONFIG.visual.dayNightFactor }
      },
      vertexShader: this.getVertexShader(),
      fragmentShader: this.getFragmentShader(),
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false,
      // Use polygon offset to avoid z-fighting with Earth surface (from config)
      polygonOffset: TEMP2M_CONFIG.depth.polygonOffset,
      polygonOffsetFactor: TEMP2M_CONFIG.depth.polygonOffsetFactor,
      polygonOffsetUnits: TEMP2M_CONFIG.depth.polygonOffsetUnits
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'Temp2mRenderService';
    this.mesh.renderOrder = 1; // Render after Earth
  }

  /**
   * Factory method to create Temp2mRenderService with data loading
   */
  static async create(layerId: LayerId, dataService: DataService): Promise<Temp2mRenderService> {
    const layerData = await dataService.loadLayer('temp2m');
    return new Temp2mRenderService(layerId, layerData.texture, layerData.timeSteps, layerData.timeSteps.length);
  }

  // ILayer interface implementation

  /**
   * Get THREE.js object for scene
   */
  getSceneObject(): THREE.Object3D {
    return this.mesh;
  }

  /**
   * Update time index for interpolation
   */
  setTimeIndex(index: number) {
    if (this.material.uniforms.timeIndex) {
      this.material.uniforms.timeIndex.value = index;
    }
  }

  /**
   * Update sun direction for day/night shading
   */
  protected updateSunDirection(direction: THREE.Vector3) {
    if (this.material.uniforms.sunDirection) {
      this.material.uniforms.sunDirection.value.copy(direction);
    }
  }

  /**
   * Set opacity
   */
  setOpacity(opacity: number) {
    if (this.material.uniforms.opacity) {
      this.material.uniforms.opacity.value = opacity;
    }
  }

  /**
   * Show/hide layer (ILayer interface)
   */
  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  /**
   * Clean up resources (ILayer interface)
   */
  dispose(): void {
    if (this.mesh.geometry) {
      this.mesh.geometry.dispose();
    }
    if (this.material) {
      this.material.dispose();
    }
  }

  /**
   * Get layer configuration
   */
  getConfig() {
    return TEMP2M_CONFIG;
  }

  private getVertexShader(): string {
    return `
      // Use SphereGeometry's built-in UV coordinates (already declared by Three.js)
      varying vec2 vUv;
      varying vec3 vPosition;
      varying vec3 vNormal;

      void main() {
        vNormal = normalize(position);

        // Calculate UVs from spherical coordinates
        // SphereGeometry has uniform vertex distribution, avoiding displacement issues
        float lon = atan(vNormal.z, vNormal.x);
        float lat = asin(vNormal.y);

        const float PI = 3.14159265;
        const float TWO_PI = 6.28318530718;

        // Rotate 90 degrees west and normalize to 0-1
        float u = ((lon - 1.57079632) + PI) / TWO_PI;
        u = 1.0 - u; // Mirror horizontally for correct orientation

        // Latitude: north pole (y=1) -> V=0, south pole (y=-1) -> V=1
        float v = 1.0 - ((lat + 1.57079632) / 3.14159265);

        vUv = vec2(u, v);
        vPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;
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

      const float NODATA = -9999.0; // Legacy NODATA
      const float NO_DATA_SENTINEL = 65504.0; // 0xFFFF in fp16 - progressive loading sentinel
      const float MIN_TEMP = -30.0;
      const float MAX_TEMP = 40.0;

      // Temperature color palette - discrete bands (legacy behavior)
      // Colors from TEMP2M_CONFIG.palette
      vec3 getTempColor(float tempC) {
        // Discrete color bands - no interpolation
        // Returns single color for each temperature range
        return
          tempC < -20.0 ? vec3(0.667, 0.400, 0.667) : // #aa66aa violet dark
          tempC < -10.0 ? vec3(0.808, 0.608, 0.898) : // #ce9be5 violet
          tempC <   0.0 ? vec3(0.463, 0.808, 0.886) : // #76cee2 blue
          tempC <  10.0 ? vec3(0.424, 0.937, 0.424) : // #6cef6c green
          tempC <  20.0 ? vec3(0.929, 0.976, 0.424) : // #edf96c yellow
          tempC <  30.0 ? vec3(1.000, 0.733, 0.333) : // #ffbb55 orange
          tempC <  40.0 ? vec3(0.984, 0.396, 0.306) : // #fb654e red
                          vec3(0.800, 0.251, 0.251);  // #cc4040 dark red
      }

      void main() {
        #ifdef DEBUG_UV
          // Visualize U coordinate as color
          // Red channel: U coordinate (0=black, 1=red)
          // Green channel: show discontinuities
          float u = vUv.x;

          // Highlight areas near 0.0 and 1.0
          vec3 color;
          if (u < 0.05 || u > 0.95) {
            // Near boundaries - yellow
            color = vec3(1.0, 1.0, 0.0);
          } else {
            // Gradient from black to red
            color = vec3(u, 0.0, 0.0);
          }

          gl_FragColor = vec4(color, opacity);
          return;
        #else
        // Normal rendering mode

        float val1, val2, frac;

        // Check if time is out of range
        if (timeIndex < 0.0 || timeIndex > maxTimeIndex) {
          // No data - red in dev, transparent in prod
          #ifdef DEVELOPMENT
            gl_FragColor = vec4(1.0, 0.0, 0.0, 0.2);
          #else
            discard;
          #endif
          return;
        }

        // Get the two adjacent time indices for interpolation
        float t1 = floor(timeIndex);
        float t2 = min(t1 + 1.0, maxTimeIndex);
        frac = fract(timeIndex);

        // Sample the 3D texture at both time steps
        // Note: vUv is already calculated as spherical coordinates in vertex shader
        float z1 = (t1 + 0.5) / (maxTimeIndex + 1.0); // Center of voxel
        float z2 = (t2 + 0.5) / (maxTimeIndex + 1.0);

        val1 = texture(dataTexture, vec3(vUv, z1)).r;
        val2 = texture(dataTexture, vec3(vUv, z2)).r;

        // Check for no data (legacy NODATA or progressive loading sentinel)
        if (val1 == NODATA || val2 == NODATA || val1 > 60000.0 || val2 > 60000.0) {
          // No data loaded yet - show visual indicator in dev, transparent in prod
          #ifdef DEVELOPMENT
            // Semi-transparent gray pattern to indicate unloaded data
            gl_FragColor = vec4(0.2, 0.2, 0.2, 0.3);
          #else
            discard;
          #endif
          return;
        }

        // Interpolate between time steps
        float value = mix(val1, val2, frac);

        // Convert from Kelvin to Celsius
        float tempC = value - 273.15;
        // Get color from palette
        vec3 color = getTempColor(tempC);

        // Check if sun is enabled (non-zero direction)
        float sunLength = length(sunDirection);

        vec3 finalColor;
        if (sunLength > 0.01) {
          // Sun enabled - apply day/night lighting
          vec3 lightDir = normalize(sunDirection);
          float dotNL = dot(vNormal, lightDir);

          // Sharpen day/night transition (from config)
          float dnZone = clamp(dotNL * dayNightSharpness, -1.0, 1.0);

          // Dim night side (from config)
          float lightMix = 0.5 + dnZone * dayNightFactor;

          // Apply lighting to color
          finalColor = color * lightMix;
        } else {
          // Sun disabled - flat lighting
          finalColor = color;
        }

        gl_FragColor = vec4(finalColor, opacity);
        #endif
      }
    `;
  }

}
