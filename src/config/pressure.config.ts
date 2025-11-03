/**
 * Pressure Layer Configuration (MSL - Mean Sea Level Pressure)
 * Renders isobar contours using marching squares algorithm in Web Worker
 */

export const PRESSURE_CONFIG = {
  // Data grid dimensions (2° resolution with wrapping column)
  grid: {
    width: 181,   // 180 + 1 wrapping column for dateline continuity
    height: 91,   // 90° latitude coverage (pole to pole)
    resolution: 2 // degrees
  },

  // Isobar levels (hPa) - Extended range to cover extreme weather
  // Historical extremes: 870 hPa (Typhoon Tip 1979) to 1094 hPa (Mongolia 2020)
  isobars: {
    levels: [
      960, 964, 968, 972, 976, 980, 984, 988, 992, 996,
      1000, 1004, 1008, 1012, 1016, 1020, 1024, 1028, 1032, 1036, 1040
    ],
    spacing: 4,  // hPa between levels
    minValue: 960,  // Captures major hurricanes (Cat 3-5)
    maxValue: 1040  // Captures strong winter highs
  },

  // Visual rendering configuration
  visual: {
    color: 0xffffff,       // White contour lines
    opacity: 0.85,         // 85% opacity for subtle visibility
    linewidth: 2,          // Thicker lines for visibility
    depthTest: true,       // Enable depth testing for proper layering
    transparent: true      // Enable alpha blending
  },

  // Earth radius for cartesian coordinate conversion
  earth: {
    radius: 1.0  // Normalized radius (matches other layers)
  }
} as const;

// Type for isobar level array
export type IsobarLevels = typeof PRESSURE_CONFIG.isobars.levels;
