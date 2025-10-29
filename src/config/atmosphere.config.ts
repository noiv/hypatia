/**
 * Atmospheric Scattering Configuration
 * Based on glsl-atmosphere by wwwtyro
 * https://github.com/wwwtyro/glsl-atmosphere
 */

export const ATMOSPHERE_CONFIG = {
  // Geometry configuration
  geometry: {
    widthSegments: 64,
    heightSegments: 32
  },

  // Physical parameters (Earth-like atmosphere)
  physical: {
    planetRadius: 6371e3,      // Earth radius in meters
    atmosphereRadius: 6471e3,  // Atmosphere extends 100km above surface

    // Rayleigh scattering (causes blue sky)
    rayleighCoefficient: [5.5e-6, 13.0e-6, 22.4e-6] as [number, number, number],
    rayleighScaleHeight: 8e3,   // 8km scale height

    // Mie scattering (causes sun halos and haze)
    mieCoefficient: 21e-6,
    mieScaleHeight: 1.2e3,      // 1.2km scale height
    mieDirection: 0.758,        // Preferred scattering direction

    // Sun parameters
    sunIntensity: 22.0
  },

  // Visual configuration
  visual: {
    altitudeKm: 0,  // Atmosphere starts at planet surface
    exposure: 1.0   // Exposure adjustment for final color
  },

  // Ray marching quality
  quality: {
    primarySamples: 16,   // iSteps - samples along view ray
    secondarySamples: 8   // jSteps - samples along light ray
  }
};
