/**
 * Graticule (Lat/Lon Grid) Configuration
 */

export const GRATICULE_CONFIG = {
  // Layer update order (lower = earlier)
  updateOrder: 3,

  // Visual configuration
  visual: {
    color: 0x444444,
    opacity: 0.3,
    radius: 1.01, // Higher above Earth surface to avoid z-fighting
  },

  // LOD (Level of Detail) configuration
  // Distance thresholds for different grid densities
  lod: [
    { maxDistance: 1.5, latStep: 10, lonStep: 10 },   // Close: every 10°
    { maxDistance: 3.0, latStep: 15, lonStep: 15 },   // Medium: every 15°
    { maxDistance: 6.0, latStep: 30, lonStep: 30 },   // Far: every 30°
    { maxDistance: Infinity, latStep: 45, lonStep: 45 } // Very far: every 45°
  ]
} as const;
