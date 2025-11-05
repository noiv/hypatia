/**
 * Temperature layer configuration
 * Based on legacy hypatia.arctic.io implementation
 */

export interface Temp2mConfig {
  /** Layer update order (lower = earlier) */
  updateOrder: number;
  /** Temperature range in Celsius */
  tempRange: {
    min: number;
    max: number;
  };
  /** Color palette: temperature (°C) -> RGB color */
  palette: Array<{
    temp: number;
    color: [number, number, number]; // RGB 0-1
    hex: string; // For reference
  }>;
  /** Visual settings */
  visual: {
    opacity: number;
    altitudeKm: number;
    /** Day/night shading strength (0-1) */
    dayNightFactor: number;
    /** Day/night transition sharpness */
    dayNightSharpness: number;
  };
  /** Depth rendering settings (prevents z-fighting) */
  depth: {
    /** Enable polygon offset to prevent z-fighting with Earth surface */
    polygonOffset: boolean;
    /** Polygon offset factor (negative = render in front) */
    polygonOffsetFactor: number;
    /** Polygon offset units (negative = render in front) */
    polygonOffsetUnits: number;
  };
  /** Geometry settings */
  geometry: {
    widthSegments: number;
    heightSegments: number;
  };
}

/**
 * Default temperature layer configuration
 * Color palette matches legacy cfg.assets.js tmp2m configuration
 */
export const TEMP2M_CONFIG: Temp2mConfig = {
  updateOrder: 4,
  tempRange: {
    min: -30,
    max: 40,
  },
  palette: [
    { temp: -30, color: [0.667, 0.400, 0.667], hex: '#aa66aa' }, // violet dark
    { temp: -20, color: [0.808, 0.608, 0.898], hex: '#ce9be5' }, // violet
    { temp: -10, color: [0.463, 0.808, 0.886], hex: '#76cee2' }, // blue
    { temp:   0, color: [0.424, 0.937, 0.424], hex: '#6cef6c' }, // green
    { temp:  10, color: [0.929, 0.976, 0.424], hex: '#edf96c' }, // yellow
    { temp:  20, color: [1.000, 0.733, 0.333], hex: '#ffbb55' }, // orange
    { temp:  30, color: [0.984, 0.396, 0.306], hex: '#fb654e' }, // red
    { temp:  40, color: [0.800, 0.251, 0.251], hex: '#cc4040' }, // dark red
  ],
  visual: {
    opacity: 0.8,
    altitudeKm: 2.0, // Meteorologically correct: 2m temperature at surface level
    dayNightFactor: 0.3,
    dayNightSharpness: 8.0,
  },
  depth: {
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  },
  geometry: {
    widthSegments: 180, // Longitude divisions (matches 0.5° data resolution × 2)
    heightSegments: 90, // Latitude divisions (matches 0.5° data resolution × 2)
  },
};
