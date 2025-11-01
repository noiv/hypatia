import * as THREE from 'three';
import { EARTH_RADIUS_UNITS } from '../utils/constants';
import { PRATESFC_CONFIG } from '../config/pratesfc.config';
import { TimeSeriesLayer } from './TimeSeriesLayer';
import type { TimeStep } from '../services/Temp2mService';
import type { DataService } from '../services/DataService';

export class PratesfcLayer extends TimeSeriesLayer {
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  private constructor(dataTexture: THREE.Data3DTexture, timeSteps: TimeStep[], timeStepCount: number) {
    super(timeSteps);

    // Use SphereGeometry
    const radius = EARTH_RADIUS_UNITS * (1 + PRATESFC_CONFIG.visual.altitudeKm / 6371);
    const geometry = new THREE.SphereGeometry(
      radius,
      PRATESFC_CONFIG.geometry.widthSegments,
      PRATESFC_CONFIG.geometry.heightSegments
    );

    // Create shader material
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        dataTexture: { value: dataTexture },
        timeIndex: { value: 0.0 },
        maxTimeIndex: { value: timeStepCount - 1 },
        opacity: { value: PRATESFC_CONFIG.visual.opacity }
      },
      vertexShader: this.getVertexShader(),
      fragmentShader: this.getFragmentShader(),
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false,
      // Render on top of temperature layer
      polygonOffset: PRATESFC_CONFIG.depth.polygonOffset,
      polygonOffsetFactor: PRATESFC_CONFIG.depth.polygonOffsetFactor,
      polygonOffsetUnits: PRATESFC_CONFIG.depth.polygonOffsetUnits
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'PratesfcLayer';
    this.mesh.renderOrder = 2; // Render after temp2m (renderOrder 1)
  }

  /**
   * Factory method to create PratesfcLayer with data loading
   */
  static async create(dataService: DataService): Promise<PratesfcLayer> {
    const layerData = await dataService.loadLayer('precipitation');
    return new PratesfcLayer(layerData.texture, layerData.timeSteps, layerData.timeSteps.length);
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

  private getVertexShader(): string {
    return `
      varying vec2 vUv;
      varying vec3 vNormal;

      void main() {
        vNormal = normalize(position);

        // Calculate UVs from spherical coordinates
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
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;
  }

  private getFragmentShader(): string {
    return `
      uniform sampler3D dataTexture;
      uniform float timeIndex;
      uniform float maxTimeIndex;
      uniform float opacity;

      varying vec2 vUv;
      varying vec3 vNormal;

      const float DISCARD_THRESHOLD = ${PRATESFC_CONFIG.discardThreshold.toExponential()};

      // Legacy precipitation color palette (from hypatia.arctic.io)
      vec4 getPrateColor(float rate) {
        // rate is in kg/m²/s (equals mm/s)
        // Palette uses blue shades with varying alpha
        return
          rate < 0.0004 ? vec4(0.04, 0.24, 0.59, 0.30) :
          rate < 0.0007 ? vec4(0.11, 0.30, 0.62, 0.40) :
          rate < 0.0013 ? vec4(0.18, 0.36, 0.66, 0.50) :
          rate < 0.0024 ? vec4(0.25, 0.43, 0.70, 0.60) :
          rate < 0.0042 ? vec4(0.32, 0.49, 0.74, 0.70) :
          rate < 0.0076 ? vec4(0.39, 0.55, 0.77, 0.80) :
          rate < 0.0136 ? vec4(0.47, 0.62, 0.81, 0.90) :
                          vec4(1.00, 1.00, 1.00, 1.00);  // white for heavy rain
      }

      void main() {
        // Clamp time index
        float t = clamp(timeIndex, 0.0, maxTimeIndex);

        // Calculate Z coordinate (depth in 3D texture)
        float z1 = floor(t);
        float z2 = min(z1 + 1.0, maxTimeIndex);
        float mix_factor = fract(t);

        // Sample both time steps
        vec3 uvw1 = vec3(vUv.x, vUv.y, (z1 + 0.5) / (maxTimeIndex + 1.0));
        vec3 uvw2 = vec3(vUv.x, vUv.y, (z2 + 0.5) / (maxTimeIndex + 1.0));

        float rate1 = texture(dataTexture, uvw1).r;
        float rate2 = texture(dataTexture, uvw2).r;

        // Interpolate precipitation rate
        float rate = mix(rate1, rate2, mix_factor);

        // Discard if below threshold (no precipitation)
        if (rate <= DISCARD_THRESHOLD) {
          discard;
        }

        // Get color from palette
        vec4 color = getPrateColor(rate);

        // Apply opacity
        color.a *= opacity;

        gl_FragColor = color;
      }
    `;
  }
}
