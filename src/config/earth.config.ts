/**
 * Earth basemap configuration
 */

export interface EarthConfig {
  /** Layer update order (lower = earlier) */
  updateOrder: number;
  /** Geometry settings for cubed sphere */
  geometry: {
    /** Segments per box edge (creates cubed sphere when normalized) */
    segments: number;
  };
  /** Visual settings */
  visual: {
    /** Day/night shading strength (0-1) */
    dayNightFactor: number;
    /** Day/night transition sharpness */
    dayNightSharpness: number;
  };
  /** Basemap texture paths */
  basemaps: {
    /** Array of basemap sets with paths to 6 cube faces */
    sets: Array<{
      name: string;
      path: string;
    }>;
  };
}

/**
 * Default Earth basemap configuration
 */
export const EARTH_CONFIG: EarthConfig = {
  updateOrder: 1,
  geometry: {
    segments: 16, // 16×16×16 cubed sphere
  },
  visual: {
    dayNightFactor: 0.3,
    dayNightSharpness: 8.0,
  },
  basemaps: {
    sets: [
      {
        name: 'rtopo2',
        path: '/images/basemaps/rtopo2',
      },
      {
        name: 'marble',
        path: '/images/basemaps/marble',
      },
      // {
      //   name: 'gmlc',
      //   path: '/images/basemaps/gmlc',
      // },
    ],
  },
};
