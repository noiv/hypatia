import * as THREE from 'three';
import { EARTH_RADIUS_UNITS } from '../utils/constants';
import { EARTH_CONFIG } from '../config';
import type { ILayer, LayerId } from './ILayer';
import type { AnimationState } from './AnimationState';
import { getLayerCacheControl } from '../services/LayerCacheControl';

/**
 * Earth - Earth mesh with basemap textures and day/night lighting
 */
class Earth {
  public mesh: THREE.Mesh;
  private textures: THREE.Texture[] = [];
  private materials: THREE.ShaderMaterial[] = [];

  constructor(preloadedImages?: Map<string, HTMLImageElement>) {
    // Create box geometry with segments (like old implementation)
    const segments = EARTH_CONFIG.geometry.segments;
    const geometry = new THREE.BoxGeometry(1, 1, 1, segments, segments, segments);

    // Normalize vertices to create sphere from cube (like old implementation)
    const positionAttr = geometry.attributes.position;
    if (positionAttr) {
      for (let i = 0; i < positionAttr.count; i++) {
        const x = positionAttr.getX(i);
        const y = positionAttr.getY(i);
        const z = positionAttr.getZ(i);

        const vector = new THREE.Vector3(x, y, z);
        vector.normalize().multiplyScalar(EARTH_RADIUS_UNITS);

        positionAttr.setXYZ(i, vector.x, vector.y, vector.z);
      }

      positionAttr.needsUpdate = true;
    }
    geometry.computeVertexNormals();

    // Shaders for blending between basemaps with lighting
    const vertexShader = `
      varying vec2 vUv;
      varying vec3 vPosition;

      void main() {
        vUv = uv;
        vPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      uniform float blend;
      uniform sampler2D texA;
      uniform sampler2D texB;
      uniform vec3 sunDirection;
      uniform float dayNightSharpness;
      uniform float dayNightFactor;

      varying vec2 vUv;
      varying vec3 vPosition;

      void main() {
        vec3 colorA = texture2D(texA, vUv).rgb;
        vec3 colorB = texture2D(texB, vUv).rgb;

        // Blend textures
        vec3 baseColor = mix(colorA, colorB, blend);

        // Check if sun is enabled (non-zero direction)
        float sunLength = length(sunDirection);

        vec3 color;
        if (sunLength > 0.01) {
          // Sun enabled - apply day/night lighting
          vec3 normal = normalize(vPosition);
          vec3 lightDir = normalize(sunDirection);
          float dotNL = dot(normal, lightDir);

          // Sharpen day/night transition (from config)
          float dnZone = clamp(dotNL * dayNightSharpness, -1.0, 1.0);

          // Dim night side (from config)
          float lightMix = 0.5 + dnZone * dayNightFactor;

          color = baseColor * lightMix;
        } else {
          // Sun disabled - flat lighting
          color = baseColor;
        }

        gl_FragColor = vec4(color, 1.0);
      }
    `;

    // Load textures for 6 cube faces
    const faceNames = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
    const basemapA = EARTH_CONFIG.basemaps.sets[0];
    const basemapB = EARTH_CONFIG.basemaps.sets[1];
    if (!basemapA || !basemapB) {
      throw new Error('Earth basemaps not configured');
    }

    // Create 6 shader materials (one per face) with blending
    this.materials = faceNames.map(face => {
      let texA: THREE.Texture;
      let texB: THREE.Texture;

      if (preloadedImages) {
        // Use preloaded images
        const imgA = preloadedImages.get(`${basemapA.path}/${face}.png`);
        const imgB = preloadedImages.get(`${basemapB.path}/${face}.png`);

        if (imgA && imgB) {
          texA = new THREE.Texture(imgA);
          texA.needsUpdate = true;
          texB = new THREE.Texture(imgB);
          texB.needsUpdate = true;
        } else {
          // Fallback to loader if preloaded images not found
          console.warn(`Preloaded image not found for ${face}, using loader`);
          const loader = new THREE.TextureLoader();
          texA = loader.load(`${basemapA.path}/${face}.png`);
          texB = loader.load(`${basemapB.path}/${face}.png`);
        }
      } else {
        // Fallback to loader if no preloaded images provided
        const loader = new THREE.TextureLoader();

        const cacheControl = getLayerCacheControl();

        texA = loader.load(
          `${basemapA.path}/${face}.png`,
          () => {
            // Emit fileLoadUpdate event when basemap loads
            cacheControl.emit('fileLoadUpdate', {
              layerId: 'earth',
              fileName: `${basemapA.name}/${face}.png`
            });
          }
        );

        texB = loader.load(
          `${basemapB.path}/${face}.png`,
          () => {
            // Emit fileLoadUpdate event when basemap loads
            cacheControl.emit('fileLoadUpdate', {
              layerId: 'earth',
              fileName: `${basemapB.name}/${face}.png`
            });
          }
        );
      }

      this.textures.push(texA, texB);

      return new THREE.ShaderMaterial({
        uniforms: {
          blend: { value: 0.0 },
          texA: { value: texA },
          texB: { value: texB },
          sunDirection: { value: new THREE.Vector3(0, 0, 0) }, // Default: no sun (flat lighting)
          dayNightSharpness: { value: EARTH_CONFIG.visual.dayNightSharpness },
          dayNightFactor: { value: EARTH_CONFIG.visual.dayNightFactor }
        },
        vertexShader,
        fragmentShader,
        side: THREE.FrontSide
      });
    });

    this.mesh = new THREE.Mesh(geometry, this.materials);
    this.mesh.name = 'Earth';
  }

  /**
   * Set blend factor between basemap A and B (0.0 = A, 1.0 = B)
   */
  setBlend(blend: number) {
    this.materials.forEach(mat => {
      if (mat.uniforms.blend) {
        mat.uniforms.blend.value = blend;
      }
    });
  }

  /**
   * Set sun direction for lighting calculation
   */
  setSunDirection(direction: THREE.Vector3) {
    this.materials.forEach(mat => {
      if (mat.uniforms.sunDirection) {
        mat.uniforms.sunDirection.value.copy(direction);
      }
    });
  }

  /**
   * Clean up resources
   */
  dispose() {
    if (this.mesh.geometry) {
      this.mesh.geometry.dispose();
    }

    if (Array.isArray(this.mesh.material)) {
      this.mesh.material.forEach(mat => mat.dispose());
    } else {
      this.mesh.material.dispose();
    }

    this.textures.forEach(tex => tex.dispose());
  }
}

/**
 * EarthRenderService - Earth basemap with lighting
 *
 * Provides polymorphic layer interface for the Earth basemap
 */
export class EarthRenderService implements ILayer {
  private earth: Earth;
  private lastSunDirection?: THREE.Vector3;

  private constructor(_layerId: LayerId, earth: Earth) {
    this.earth = earth;
  }

  /**
   * Factory method to create EarthRenderService
   */
  static async create(layerId: LayerId, preloadedImages?: Map<string, HTMLImageElement>): Promise<EarthRenderService> {
    const earth = new Earth(preloadedImages);
    return new EarthRenderService(layerId, earth);
  }

  // ILayer interface implementation

  /**
   * Update layer based on animation state
   */
  update(state: AnimationState): void {
    // Check sun direction change
    if (!this.lastSunDirection || !this.lastSunDirection.equals(state.sunDirection)) {
      this.earth.setSunDirection(state.sunDirection);
      this.lastSunDirection = state.sunDirection.clone();
    }
    // Earth doesn't need time or distance updates
  }

  /**
   * Set layer visibility
   */
  setVisible(visible: boolean): void {
    this.earth.mesh.visible = visible;
  }

  /**
   * Get the THREE.js object to add to scene
   */
  getSceneObject(): THREE.Object3D {
    return this.earth.mesh;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.earth.dispose();
  }

  /**
   * Get layer configuration
   */
  getConfig() {
    return EARTH_CONFIG;
  }

  /**
   * Set basemap blend (0.0 = first basemap, 1.0 = second basemap)
   */
  setBlend(blend: number): void {
    this.earth.setBlend(blend);
  }
}
