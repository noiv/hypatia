/**
 * Physical constants for Earth and coordinate system
 */

// Earth's radius in meters (mean radius)
export const EARTH_RADIUS_METERS = 6371000;

// Earth's radius in our 3D coordinate system (units)
export const EARTH_RADIUS_UNITS = 1;

// Meters per unit in our coordinate system
export const METERS_PER_UNIT = EARTH_RADIUS_METERS / EARTH_RADIUS_UNITS;

/**
 * Convert altitude (meters above surface) to camera distance (units from origin)
 */
export function altitudeToDistance(altitudeMeters: number): number {
  return (altitudeMeters / METERS_PER_UNIT) + EARTH_RADIUS_UNITS;
}

/**
 * Convert camera distance (units from origin) to altitude (meters above surface)
 */
export function distanceToAltitude(distance: number): number {
  return (distance - EARTH_RADIUS_UNITS) * METERS_PER_UNIT;
}

/**
 * Format altitude for display
 */
export function formatAltitude(altitudeMeters: number): string {
  if (altitudeMeters >= 1000000) {
    return `${(altitudeMeters / 1000000).toFixed(1)}M km`;
  } else if (altitudeMeters >= 1000) {
    return `${(altitudeMeters / 1000).toFixed(1)} km`;
  } else {
    return `${altitudeMeters.toFixed(0)} m`;
  }
}
