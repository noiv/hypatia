import * as THREE from 'three';
import { EARTH_RADIUS_UNITS } from '../utils/constants';
import { ATMOSPHERE_CONFIG } from '../config/atmosphere.config';

export class AtmosphereLayer {
  public mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor() {
    // Calculate atmosphere radius in scene units
    const radius = EARTH_RADIUS_UNITS * (ATMOSPHERE_CONFIG.physical.atmosphereRadius / ATMOSPHERE_CONFIG.physical.planetRadius);

    const geometry = new THREE.SphereGeometry(
      radius,
      ATMOSPHERE_CONFIG.geometry.widthSegments,
      ATMOSPHERE_CONFIG.geometry.heightSegments
    );

    // Create shader material with atmospheric scattering
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        sunPosition: { value: new THREE.Vector3(0, 0, 1) },
        viewPosition: { value: new THREE.Vector3(0, 0, 10) },
        planetRadius: { value: EARTH_RADIUS_UNITS },
        atmosphereRadius: { value: radius },
        rayleighCoefficient: { value: new THREE.Vector3(...ATMOSPHERE_CONFIG.physical.rayleighCoefficient) },
        mieCoefficient: { value: ATMOSPHERE_CONFIG.physical.mieCoefficient },
        rayleighScaleHeight: { value: ATMOSPHERE_CONFIG.physical.rayleighScaleHeight / ATMOSPHERE_CONFIG.physical.planetRadius * EARTH_RADIUS_UNITS },
        mieScaleHeight: { value: ATMOSPHERE_CONFIG.physical.mieScaleHeight / ATMOSPHERE_CONFIG.physical.planetRadius * EARTH_RADIUS_UNITS },
        mieDirection: { value: ATMOSPHERE_CONFIG.physical.mieDirection },
        sunIntensity: { value: ATMOSPHERE_CONFIG.physical.sunIntensity },
        exposure: { value: ATMOSPHERE_CONFIG.visual.exposure }
      },
      vertexShader: this.getVertexShader(),
      fragmentShader: this.getFragmentShader(),
      transparent: true,
      side: THREE.BackSide,   // Render from inside (camera sees inner faces)
      depthWrite: false,      // Don't write to depth buffer
      blending: THREE.AdditiveBlending
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'atmosphere';
  }

  /**
   * Update sun position for atmospheric scattering
   */
  setSunPosition(position: THREE.Vector3) {
    this.material.uniforms.sunPosition.value.copy(position);
  }

  /**
   * Update camera position for ray origin
   */
  setCameraPosition(position: THREE.Vector3) {
    this.material.uniforms.viewPosition.value.copy(position);
  }

  /**
   * Set visibility
   */
  setVisible(visible: boolean) {
    this.mesh.visible = visible;
  }

  private getVertexShader(): string {
    return `
      varying vec3 vPosition;
      varying vec3 vWorldPosition;

      void main() {
        vPosition = position;
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;
  }

  private getFragmentShader(): string {
    const iSteps = ATMOSPHERE_CONFIG.quality.primarySamples;
    const jSteps = ATMOSPHERE_CONFIG.quality.secondarySamples;

    return `
      #define PI 3.141592
      #define iSteps ${iSteps}
      #define jSteps ${jSteps}

      varying vec3 vPosition;
      varying vec3 vWorldPosition;

      uniform vec3 sunPosition;
      uniform vec3 viewPosition;
      uniform float planetRadius;
      uniform float atmosphereRadius;
      uniform vec3 rayleighCoefficient;
      uniform float mieCoefficient;
      uniform float rayleighScaleHeight;
      uniform float mieScaleHeight;
      uniform float mieDirection;
      uniform float sunIntensity;
      uniform float exposure;

      // Ray-sphere intersection
      vec2 raySphereIntersection(vec3 r0, vec3 rd, float sr) {
        float a = dot(rd, rd);
        float b = 2.0 * dot(rd, r0);
        float c = dot(r0, r0) - (sr * sr);
        float d = (b*b) - 4.0*a*c;
        if (d < 0.0) return vec2(1e5, -1e5);
        return vec2(
          (-b - sqrt(d)) / (2.0*a),
          (-b + sqrt(d)) / (2.0*a)
        );
      }

      // Atmospheric scattering calculation
      vec3 atmosphere(vec3 r, vec3 r0, vec3 pSun, float iSun, float rPlanet, float rAtmos, vec3 kRlh, float kMie, float shRlh, float shMie, float g) {
        // Normalize directions
        pSun = normalize(pSun);
        r = normalize(r);

        // Calculate ray-atmosphere intersection
        vec2 p = raySphereIntersection(r0, r, rAtmos);
        if (p.x > p.y) return vec3(0.0);

        // Don't render atmosphere behind planet
        p.y = min(p.y, raySphereIntersection(r0, r, rPlanet).x);
        float iStepSize = (p.y - p.x) / float(iSteps);

        // Initialize ray marching
        float iTime = 0.0;
        vec3 totalRlh = vec3(0.0);
        vec3 totalMie = vec3(0.0);
        float iOdRlh = 0.0;
        float iOdMie = 0.0;

        // Calculate scattering phase functions
        float mu = dot(r, pSun);
        float mumu = mu * mu;
        float gg = g * g;
        float pRlh = 3.0 / (16.0 * PI) * (1.0 + mumu);
        float pMie = 3.0 / (8.0 * PI) * ((1.0 - gg) * (mumu + 1.0)) / (pow(1.0 + gg - 2.0 * mu * g, 1.5) * (2.0 + gg));

        // Primary ray samples
        for (int i = 0; i < iSteps; i++) {
          vec3 iPos = r0 + r * (iTime + iStepSize * 0.5);
          float iHeight = length(iPos) - rPlanet;

          // Optical depth for this step
          float odStepRlh = exp(-iHeight / shRlh) * iStepSize;
          float odStepMie = exp(-iHeight / shMie) * iStepSize;

          iOdRlh += odStepRlh;
          iOdMie += odStepMie;

          // Secondary ray (towards sun)
          float jStepSize = raySphereIntersection(iPos, pSun, rAtmos).y / float(jSteps);
          float jTime = 0.0;
          float jOdRlh = 0.0;
          float jOdMie = 0.0;

          for (int j = 0; j < jSteps; j++) {
            vec3 jPos = iPos + pSun * (jTime + jStepSize * 0.5);
            float jHeight = length(jPos) - rPlanet;

            jOdRlh += exp(-jHeight / shRlh) * jStepSize;
            jOdMie += exp(-jHeight / shMie) * jStepSize;

            jTime += jStepSize;
          }

          // Calculate attenuation
          vec3 attn = exp(-(kMie * (iOdMie + jOdMie) + kRlh * (iOdRlh + jOdRlh)));

          // Accumulate scattering
          totalRlh += odStepRlh * attn;
          totalMie += odStepMie * attn;

          iTime += iStepSize;
        }

        // Final color
        return iSun * (pRlh * kRlh * totalRlh + pMie * kMie * totalMie);
      }

      void main() {
        // Calculate view direction and position relative to planet center
        vec3 viewDir = normalize(viewPosition - vWorldPosition);
        vec3 surfaceNormal = normalize(vWorldPosition);

        // Calculate fresnel-like falloff (more visible at edges)
        float rim = 1.0 - abs(dot(viewDir, surfaceNormal));
        rim = pow(rim, 3.0); // Sharper falloff

        // Sun direction influence (brighter on sun-facing side)
        vec3 sunDir = normalize(sunPosition);
        float sunDot = dot(surfaceNormal, sunDir);
        float sunInfluence = max(0.0, sunDot * 0.5 + 0.5); // 0.5 to 1.0 range

        // Blue atmospheric color, modulated by sun
        vec3 atmosphereColor = vec3(0.4, 0.6, 1.0) * (0.5 + sunInfluence * 0.5);

        gl_FragColor = vec4(atmosphereColor, rim * 0.6);
      }
    `;
  }
}
