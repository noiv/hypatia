/**
 * Precipitation Rate Surface Layer Configuration
 * Uses legacy color palette from hypatia.arctic.io
 */

export const PRECIPITATION_CONFIG = {
  // Geometry configuration
  geometry: {
    widthSegments: 180,
    heightSegments: 90
  },

  // Visual configuration
  visual: {
    altitudeKm: 11,  // Slightly above temp2m layer (10km)
    opacity: 1.0,
    dayNightFactor: 0.0  // No day/night shading for precipitation
  },

  // Depth rendering (z-fighting prevention)
  depth: {
    polygonOffset: true,
    polygonOffsetFactor: -2.0,  // More negative than temp2m (-1.0) to render on top
    polygonOffsetUnits: -2.0
  },

  // Color palette (from legacy precipitation layer)
  // Values in kg/m²/s (equals mm/s)
  // Colors are blue shades with varying alpha for precipitation intensity
  palette: [
    { threshold: 0.0004, color: [0.04, 0.24, 0.59], alpha: 0.55 },  // Light blue, boosted alpha
    { threshold: 0.0007, color: [0.11, 0.30, 0.62], alpha: 0.65 },
    { threshold: 0.0013, color: [0.18, 0.36, 0.66], alpha: 0.75 },
    { threshold: 0.0024, color: [0.25, 0.43, 0.70], alpha: 0.80 },
    { threshold: 0.0042, color: [0.32, 0.49, 0.74], alpha: 0.85 },
    { threshold: 0.0076, color: [0.39, 0.55, 0.77], alpha: 0.90 },
    { threshold: 0.0136, color: [0.47, 0.62, 0.81], alpha: 0.95 },
    { threshold: Infinity, color: [1.00, 1.00, 1.00], alpha: 1.00 }  // White for heavy rain
  ],

  // Discard threshold (no rendering below this value)
  discardThreshold: 0.00005
};
