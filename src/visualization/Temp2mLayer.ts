import * as THREE from 'three';
import { EARTH_RADIUS_UNITS } from '../utils/constants';

export class Temp2mLayer {
  public mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private timeStepCount: number;
  private isLSM: boolean;

  constructor(dataTexture: THREE.Data3DTexture, timeStepCount: number, isLSM: boolean = false) {
    this.timeStepCount = timeStepCount;
    this.isLSM = isLSM;

    // Use SphereGeometry for better vertex distribution
    // This avoids triangles spanning across the dateline
    const radius = EARTH_RADIUS_UNITS * 1.002; // 2km above surface
    const geometry = new THREE.SphereGeometry(
      radius,
      128, // widthSegments - high resolution for smooth dateline
      64   // heightSegments
    );

    // Create shader material
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        dataTexture: { value: dataTexture },
        timeIndex: { value: 0.0 },
        maxTimeIndex: { value: timeStepCount - 1 },
        sunDirection: { value: new THREE.Vector3(1, 0, 0) },
        opacity: { value: 0.8 }
      },
      vertexShader: this.getVertexShader(),
      fragmentShader: this.getFragmentShader(),
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false,
      defines: {
        ...(isLSM ? { LSM_MODE: true } : {}),
        // DEBUG_UV: true // Temporary debug mode - disabled
      }
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'Temp2mLayer';
    this.mesh.renderOrder = 1; // Render after Earth

    console.log('Temp2mLayer created with Data3DTexture');
  }

  /**
   * Update time index for interpolation
   */
  setTimeIndex(index: number) {
    this.material.uniforms.timeIndex.value = index;
  }

  /**
   * Set sun direction for day/night shading
   */
  setSunDirection(direction: THREE.Vector3) {
    this.material.uniforms.sunDirection.value.copy(direction);
  }

  /**
   * Set opacity
   */
  setOpacity(opacity: number) {
    this.material.uniforms.opacity.value = opacity;
  }

  /**
   * Show/hide layer
   */
  setVisible(visible: boolean) {
    this.mesh.visible = visible;
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

      varying vec2 vUv;
      varying vec3 vPosition;
      varying vec3 vNormal;

      const float NODATA = -9999.0;
      const float MIN_TEMP = -30.0;
      const float MAX_TEMP = 40.0;
      const float TEMP_RANGE = 70.0;

      // Temperature color palette (meteorological standard)
      vec3 getTempColor(float tempC) {
        // Normalized 0-1 across -30 to +40
        float t = (tempC - MIN_TEMP) / TEMP_RANGE;

        // Multi-stop gradient
        if (t < 0.14) { // -30 to -20
          return mix(vec3(0.3, 0.0, 0.5), vec3(0.0, 0.0, 1.0), t / 0.14);
        } else if (t < 0.28) { // -20 to -10
          return mix(vec3(0.0, 0.0, 1.0), vec3(0.0, 0.5, 1.0), (t - 0.14) / 0.14);
        } else if (t < 0.42) { // -10 to 0
          return mix(vec3(0.0, 0.5, 1.0), vec3(0.0, 1.0, 1.0), (t - 0.28) / 0.14);
        } else if (t < 0.57) { // 0 to 10
          return mix(vec3(0.0, 1.0, 1.0), vec3(0.0, 1.0, 0.0), (t - 0.42) / 0.15);
        } else if (t < 0.71) { // 10 to 20
          return mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 1.0, 0.0), (t - 0.57) / 0.14);
        } else if (t < 0.85) { // 20 to 30
          return mix(vec3(1.0, 1.0, 0.0), vec3(1.0, 0.5, 0.0), (t - 0.71) / 0.14);
        } else { // 30 to 40
          return mix(vec3(1.0, 0.5, 0.0), vec3(1.0, 0.0, 0.0), (t - 0.85) / 0.15);
        }
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
        // Normal rendering mode (LSM or temp data)

        float val1, val2, frac;

        #ifdef LSM_MODE
          // For LSM, always use the first (and only) layer
          val1 = texture(dataTexture, vec3(vUv, 0.5)).r;
          val2 = val1; // No interpolation needed for LSM
          frac = 0.0;
        #else
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
        #endif

        // Check for no data
        if (val1 == NODATA || val2 == NODATA) {
          // No data - green in dev
          #ifdef DEVELOPMENT
            gl_FragColor = vec4(0.0, 1.0, 0.0, 0.2);
          #else
            discard;
          #endif
          return;
        }

        // Interpolate between time steps
        float value = mix(val1, val2, frac);

        vec3 color;

        #ifdef LSM_MODE
          // Land-sea mask mode: 0=ocean (blue), 1=land (green)
          if (value < 0.5) {
            color = vec3(0.0, 0.3, 0.8); // Ocean blue
          } else {
            color = vec3(0.2, 0.8, 0.2); // Land green
          }
        #else
          // Convert from Kelvin to Celsius
          float tempC = value - 273.15;
          // Get color from palette
          color = getTempColor(tempC);
        #endif

        // Calculate sun lighting for day/night
        vec3 lightDir = normalize(sunDirection);
        float dotNL = dot(vNormal, lightDir);

        // Sharpen day/night transition
        float dnSharpness = 4.0;
        float dnZone = clamp(dotNL * dnSharpness, -1.0, 1.0);

        // Dim night side
        float dnFactor = 0.3;
        float lightMix = 0.5 + dnZone * dnFactor;

        // Apply lighting to color
        vec3 finalColor = color * lightMix;

        gl_FragColor = vec4(finalColor, opacity);
        #endif
      }
    `;
  }

  /**
   * Clean up resources
   */
  dispose() {
    if (this.mesh.geometry) {
      this.mesh.geometry.dispose();
    }
    if (this.material) {
      this.material.dispose();
    }
  }
}
