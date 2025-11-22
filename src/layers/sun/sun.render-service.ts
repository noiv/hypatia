import * as THREE from 'three';
import { EARTH_RADIUS_UNITS } from '../../utils/constants';
import { ATMOSPHERE_CONFIG } from '../../config';
import type { ILayer, LayerId } from '../ILayer';
import type { AnimationState } from '../../visualization/IAnimationState';

// Sun configuration constants
const SUN_CONFIG = {
  // Astronomical constants
  AXIAL_TILT_DEGREES: 23.45,
  SOLSTICE_OFFSET_DAYS: 10,
  DEGREES_PER_HOUR: 15,
  MS_PER_DAY: 86400000,

  // Visual appearance
  TEXTURE_PATH: '/textures/lensflare/lensflare0.png',
  DISTANCE_FROM_EARTH: 500,
  MAIN_SPRITE_SCALE: 15,
  MAIN_SPRITE_RENDER_ORDER: 999,
  GLOW_SPRITE_BASE_RENDER_ORDER: 1000,

  // Glow layers (scale, color, opacity)
  GLOW_LAYERS: [
    { scale: 20, color: 0xffffff, opacity: 1.0 },   // Large outer glow
    { scale: 12, color: 0xffffff, opacity: 0.9 },   // Medium glow
    { scale: 8,  color: 0xffffcc, opacity: 0.8 },   // Warm inner glow
    { scale: 4,  color: 0xffffee, opacity: 0.9 }    // Bright core
  ] as const,

  // Lighting
  LIGHT_INTENSITY: 2
} as const;

/**
 * Calculate sun position for given time
 * Returns unit vector pointing toward sun from Earth center
 */
function calculateSunPosition(time: Date): THREE.Vector3 {
  // Get day of year (1-365/366) - UTC only
  const startOfYear = new Date(Date.UTC(time.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((time.getTime() - startOfYear.getTime()) / SUN_CONFIG.MS_PER_DAY) + 1;
  const daysInYear = isLeapYear(time.getUTCFullYear()) ? 366 : 365;

  // Calculate solar declination (tilt of Earth's axis)
  const declination = -SUN_CONFIG.AXIAL_TILT_DEGREES * Math.cos(
    2 * Math.PI * (dayOfYear + SUN_CONFIG.SOLSTICE_OFFSET_DAYS) / daysInYear
  );
  const declinationRad = (declination * Math.PI) / 180;

  // Calculate hour angle (Earth's rotation)
  const hours = time.getUTCHours() + time.getUTCMinutes() / 60 + time.getUTCSeconds() / 3600;
  const hourAngle = (hours - 12) * SUN_CONFIG.DEGREES_PER_HOUR;
  const hourAngleRad = (hourAngle * Math.PI) / 180;

  // Convert to Cartesian coordinates
  // Sun at (0,0,0) at solar noon on equator
  // Negate hourAngle so sun moves westward as time advances (Earth rotates east)
  const x = Math.cos(declinationRad) * Math.sin(-hourAngleRad);
  const y = Math.sin(declinationRad);
  const z = Math.cos(declinationRad) * Math.cos(-hourAngleRad);

  return new THREE.Vector3(x, y, z).normalize();
}

/**
 * Check if year is leap year
 */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

/**
 * Sun - Camera-facing sprite with lighting
 * Layered sprites create bright glow effect
 */
class Sun {
  public sprite: THREE.Sprite;
  private light: THREE.DirectionalLight;
  private group: THREE.Group;
  private glowSprites: THREE.Sprite[] = [];

  constructor() {
    const textureLoader = new THREE.TextureLoader();
    this.group = new THREE.Group();
    this.group.name = 'SunGroup';

    // Create main sun sprite (always faces camera)
    const sunTexture = textureLoader.load(SUN_CONFIG.TEXTURE_PATH);
    const spriteMaterial = new THREE.SpriteMaterial({
      map: sunTexture,
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true
    });

    this.sprite = new THREE.Sprite(spriteMaterial);
    this.sprite.scale.set(SUN_CONFIG.MAIN_SPRITE_SCALE, SUN_CONFIG.MAIN_SPRITE_SCALE, 1);
    this.sprite.name = 'Sun';
    this.sprite.renderOrder = SUN_CONFIG.MAIN_SPRITE_RENDER_ORDER;
    this.group.add(this.sprite);

    // Add layered glow sprites for bright effect (all at same position)
    for (const layer of SUN_CONFIG.GLOW_LAYERS) {
      this.createGlowSprite(textureLoader, layer.scale, layer.color, layer.opacity);
    }

    // Directional light for illumination
    this.light = new THREE.DirectionalLight(0xffffff, SUN_CONFIG.LIGHT_INTENSITY);

    // Initial position (will be set by updatePosition)
  }

  private createGlowSprite(loader: THREE.TextureLoader, scale: number, color: number, opacity: number) {
    const texture = loader.load(SUN_CONFIG.TEXTURE_PATH);
    const material = new THREE.SpriteMaterial({
      map: texture,
      color: new THREE.Color(color),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      opacity: opacity
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(scale, scale, 1);
    sprite.renderOrder = SUN_CONFIG.GLOW_SPRITE_BASE_RENDER_ORDER + this.glowSprites.length;

    this.glowSprites.push(sprite);
    this.group.add(sprite);
  }

  getGroup(): THREE.Group {
    return this.group;
  }

  /**
   * Get the directional light
   */
  getLight(): THREE.DirectionalLight {
    return this.light;
  }

  /**
   * Get sun direction as a normalized vector
   */
  getDirection(): THREE.Vector3 {
    return this.sprite.position.clone().normalize();
  }

  /**
   * Update sun position based on time
   * Sun rotates around Earth (geocentric view)
   */
  updatePosition(time: Date) {
    const pos = calculateSunPosition(time);

    // Position sun at very large distance
    const sunPos = new THREE.Vector3(
      pos.x * SUN_CONFIG.DISTANCE_FROM_EARTH,
      pos.y * SUN_CONFIG.DISTANCE_FROM_EARTH,
      pos.z * SUN_CONFIG.DISTANCE_FROM_EARTH
    );

    this.sprite.position.copy(sunPos);

    // Position all glow sprites at same location
    for (const glow of this.glowSprites) {
      glow.position.copy(sunPos);
    }

    // Update light position to match sun
    this.light.position.copy(sunPos);

    // Light points toward Earth (origin)
    this.light.target.position.set(0, 0, 0);
  }

  /**
   * Clean up resources
   */
  dispose() {
    // Dispose glow sprites
    for (const glow of this.glowSprites) {
      if (glow.material.map) {
        glow.material.map.dispose();
      }
      glow.material.dispose();
    }

    // Dispose main sprite
    if (this.sprite.material) {
      const material = this.sprite.material as THREE.SpriteMaterial;
      if (material.map) {
        material.map.dispose();
      }
      material.dispose();
    }

    this.light.dispose();
  }
}

/**
 * SunRenderService - Sun positioning and lighting
 *
 * Manages the sun sphere and directional light.
 * Atmosphere shader is disabled (not ready yet).
 */
export class SunRenderService implements ILayer {
  private sun: Sun;
  private group: THREE.Group;
  private lastTime?: Date;
  private lastCameraPosition?: THREE.Vector3;

  // Atmosphere mesh (disabled - shader not ready)
  private atmosphereMesh?: THREE.Mesh;
  private atmosphereMaterial?: THREE.ShaderMaterial;

  private constructor(_layerId: LayerId, sun: Sun, enableAtmosphere: boolean = false) {
    this.sun = sun;

    // Create group containing sun and light
    this.group = new THREE.Group();
    this.group.name = 'SunRenderService';
    this.group.visible = false; // Start hidden by default, will be shown if in URL
    this.group.add(this.sun.getGroup());
    this.group.add(this.sun.getLight());
    this.group.add(this.sun.getLight().target);

    // Atmosphere shader - disabled by default (not ready)
    if (enableAtmosphere) {
      const { physical, geometry: geometryConfig, visual } = ATMOSPHERE_CONFIG;

      // Calculate atmosphere radius in scene units
      const radius = EARTH_RADIUS_UNITS * (physical.atmosphereRadius / physical.planetRadius);

      const geometry = new THREE.SphereGeometry(
        radius,
        geometryConfig.widthSegments,
        geometryConfig.heightSegments
      );

      // Create shader material with atmospheric scattering
      this.atmosphereMaterial = new THREE.ShaderMaterial({
        uniforms: {
          sunPosition: { value: new THREE.Vector3(0, 0, 1) },
          viewPosition: { value: new THREE.Vector3(0, 0, 10) },
          planetRadius: { value: EARTH_RADIUS_UNITS },
          atmosphereRadius: { value: radius },
          rayleighCoefficient: { value: new THREE.Vector3(physical.rayleighCoefficient.r, physical.rayleighCoefficient.g, physical.rayleighCoefficient.b) },
          mieCoefficient: { value: physical.mieCoefficient },
          rayleighScaleHeight: { value: physical.rayleighScaleHeight / physical.planetRadius * EARTH_RADIUS_UNITS },
          mieScaleHeight: { value: physical.mieScaleHeight / physical.planetRadius * EARTH_RADIUS_UNITS },
          mieDirection: { value: physical.mieDirection },
          sunIntensity: { value: physical.sunIntensity },
          exposure: { value: visual.exposure }
        },
        vertexShader: this.getVertexShader(),
        fragmentShader: this.getFragmentShader(),
        transparent: true,
        side: THREE.FrontSide, // Changed from BackSide to render outer surface
        depthWrite: false,
        depthTest: true, // Ensure depth testing is enabled
        blending: THREE.AdditiveBlending
      });

      this.atmosphereMesh = new THREE.Mesh(geometry, this.atmosphereMaterial);
      this.atmosphereMesh.name = 'atmosphere';
      this.atmosphereMesh.renderOrder = -1; // Render before Earth (which has default 0)
      this.atmosphereMesh.position.set(0, 0, 0); // Center at Earth's position
      this.group.add(this.atmosphereMesh);
    }
  }

  /**
   * Factory method to create SunRenderService
   * @param currentTime - Initial time for sun position
   * @param enableAtmosphere - Enable atmosphere shader (default: false, not ready)
   */
  static async create(layerId: LayerId, currentTime: Date, enableAtmosphere: boolean = false): Promise<SunRenderService> {
    const sun = new Sun();
    sun.updatePosition(currentTime);
    const layer = new SunRenderService(layerId, sun, enableAtmosphere);
    layer.setSunPosition(sun.getGroup().position);
    return layer;
  }

  // ILayer interface implementation

  /**
   * Update layer based on animation state
   */
  update(state: AnimationState): void {
    // Check time change
    if (!this.lastTime || state.time.getTime() !== this.lastTime.getTime()) {
      this.sun.updatePosition(state.time);
      this.setSunPosition(this.sun.sprite.position);
      this.lastTime = state.time;
    }

    // Check camera position change for atmosphere shader
    if (this.atmosphereMaterial && (!this.lastCameraPosition || !this.lastCameraPosition.equals(state.camera.position))) {
      if (this.atmosphereMaterial.uniforms.viewPosition) {
        this.atmosphereMaterial.uniforms.viewPosition.value.copy(state.camera.position);
      }
      this.lastCameraPosition = state.camera.position.clone();
    }
  }

  /**
   * Set layer visibility
   */
  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /**
   * Get the THREE.js object to add to scene
   */
  getSceneObject(): THREE.Object3D {
    return this.group;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.atmosphereMesh?.geometry) {
      this.atmosphereMesh.geometry.dispose();
    }
    if (this.atmosphereMaterial) {
      this.atmosphereMaterial.dispose();
    }
    this.sun.dispose();
  }

  /**
   * Get layer configuration
   */
  getConfig() {
    return ATMOSPHERE_CONFIG;
  }

  /**
   * Update sun position for atmospheric scattering (if atmosphere enabled)
   */
  setSunPosition(position: THREE.Vector3) {
    if (this.atmosphereMaterial?.uniforms.sunPosition) {
      this.atmosphereMaterial.uniforms.sunPosition.value.copy(position);
    }
  }


  /**
   * Get the directional light for scene lighting
   */
  getLight(): THREE.DirectionalLight {
    return this.sun.getLight();
  }

  /**
   * Get sun direction as normalized vector
   */
  getSunDirection(): THREE.Vector3 {
    return this.sun.getDirection();
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
        rim = pow(rim, 2.0); // Adjusted falloff for better visibility

        // Sun direction influence (brighter on sun-facing side)
        vec3 sunDir = normalize(sunPosition);
        float sunDot = dot(surfaceNormal, sunDir);

        // Sharp transition from day to night
        // sunDot > 0: day side (facing sun)
        // sunDot < 0: night side (facing away)
        float dayFactor = max(0.0, sunDot); // 0 on night side, up to 1 on day side

        // Add slight twilight zone for realism
        float twilightWidth = 0.2;
        float twilight = smoothstep(-twilightWidth, twilightWidth, sunDot);

        // Combine day factor with rim effect
        // Day side: full rim effect * day brightness
        // Night side: much dimmer or invisible
        float atmosphereIntensity = rim * twilight;

        // Blue atmospheric color with sun-based tinting
        vec3 dayColor = vec3(0.4, 0.6, 1.0); // Blue sky color
        vec3 sunsetColor = vec3(1.0, 0.6, 0.3); // Orange/red for terminator

        // Mix colors based on sun angle
        float sunsetFactor = (1.0 - abs(sunDot)) * twilight; // Stronger at terminator
        vec3 atmosphereColor = mix(dayColor, sunsetColor, sunsetFactor * 0.5);

        // Final alpha: combine rim effect with sun illumination
        float finalAlpha = atmosphereIntensity * 0.8; // Max 80% opacity

        gl_FragColor = vec4(atmosphereColor * twilight, finalAlpha);
      }
    `;
  }
}
