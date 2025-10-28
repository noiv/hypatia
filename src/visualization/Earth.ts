import * as THREE from 'three';
import { EARTH_RADIUS_UNITS } from '../utils/constants';

export class Earth {
  public mesh: THREE.Mesh;
  private textures: THREE.Texture[] = [];
  private materials: THREE.ShaderMaterial[] = [];

  constructor() {
    // Create box geometry with segments (like old implementation)
    const geometry = new THREE.BoxGeometry(1, 1, 1, 16, 16, 16);

    // Normalize vertices to create sphere from cube (like old implementation)
    const positionAttr = geometry.attributes.position;
    for (let i = 0; i < positionAttr.count; i++) {
      const x = positionAttr.getX(i);
      const y = positionAttr.getY(i);
      const z = positionAttr.getZ(i);

      const vector = new THREE.Vector3(x, y, z);
      vector.normalize().multiplyScalar(EARTH_RADIUS_UNITS);

      positionAttr.setXYZ(i, vector.x, vector.y, vector.z);
    }

    positionAttr.needsUpdate = true;
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

      varying vec2 vUv;
      varying vec3 vPosition;

      void main() {
        vec3 colorA = texture2D(texA, vUv).rgb;
        vec3 colorB = texture2D(texB, vUv).rgb;

        // Blend textures
        vec3 baseColor = mix(colorA, colorB, blend);

        // Calculate normal from position (smooth across sphere)
        // Since Earth is centered at origin, normal = normalize(position)
        vec3 normal = normalize(vPosition);
        vec3 lightDir = normalize(sunDirection);
        float diffuse = max(dot(normal, lightDir), 0.0);

        // Add ambient light so night side isn't completely black
        float ambient = 0.15;
        float lightIntensity = ambient + diffuse * (1.0 - ambient);

        vec3 color = baseColor * lightIntensity;

        gl_FragColor = vec4(color, 1.0);
      }
    `;

    // Load textures for 6 cube faces
    const loader = new THREE.TextureLoader();
    const faceNames = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

    // Create 6 shader materials (one per face) with blending
    this.materials = faceNames.map(face => {
      const texA = loader.load(`/images/rtopo2/${face}.png`);
      const texB = loader.load(`/images/basemaps/gmlc/${face}.png`);

      this.textures.push(texA, texB);

      return new THREE.ShaderMaterial({
        uniforms: {
          blend: { value: 0.0 },
          texA: { value: texA },
          texB: { value: texB },
          sunDirection: { value: new THREE.Vector3(1, 0, 0) }
        },
        vertexShader,
        fragmentShader,
        side: THREE.FrontSide
      });
    });

    this.mesh = new THREE.Mesh(geometry, this.materials);
    this.mesh.name = 'Earth';

    console.log('Earth created with ShaderMaterial blending');
  }

  /**
   * Set blend factor between basemap A and B (0.0 = A, 1.0 = B)
   */
  setBlend(blend: number) {
    this.materials.forEach(mat => {
      mat.uniforms.blend.value = blend;
    });
  }

  /**
   * Set sun direction for lighting calculation
   */
  setSunDirection(direction: THREE.Vector3) {
    this.materials.forEach(mat => {
      mat.uniforms.sunDirection.value.copy(direction);
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
