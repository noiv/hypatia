/**
 * Coordinate conversion utilities
 *
 * Handles conversions between:
 * - Geographic coordinates (latitude, longitude)
 * - Cartesian 3D coordinates (x, y, z)
 */

import * as THREE from 'three';

/**
 * Convert lat/lon to Cartesian coordinates on unit sphere
 * Coordinate system: +Z axis is 0° lon, +X axis is 90°E, +Y axis is North Pole
 * @param lat - Latitude in degrees (-90 to 90)
 * @param lon - Longitude in degrees (-180 to 180)
 * @param radius - Sphere radius (default 1)
 * @returns 3D position vector
 */
export function latLonToCartesian(lat: number, lon: number, radius: number = 1): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);  // Angle from north pole
  const theta = lon * (Math.PI / 180);       // Longitude angle

  const x = radius * Math.sin(phi) * Math.sin(theta);
  const z = radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);

  return new THREE.Vector3(x, y, z);
}

/**
 * Convert Cartesian coordinates to lat/lon
 * @param position - 3D position vector
 * @returns Object with lat and lon in degrees
 */
export function cartesianToLatLon(position: THREE.Vector3): { lat: number; lon: number } {
  const normalized = position.clone().normalize();

  const lat = 90 - (Math.acos(normalized.y) * 180 / Math.PI);

  // Convert to longitude: +Z axis is 0°, +X axis is 90°E, -Z axis is 180°, -X axis is 90°W
  const lon = Math.atan2(normalized.x, normalized.z) * 180 / Math.PI;

  return { lat, lon };
}

/**
 * Format lat/lon for display
 * @param lat - Latitude in degrees
 * @param lon - Longitude in degrees
 * @returns Formatted string like "36.012°N, 180.400°W"
 */
export function formatLatLon(lat: number, lon: number): string {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';

  return `${Math.abs(lat).toFixed(3)}°${latDir}, ${Math.abs(lon).toFixed(3)}°${lonDir}`;
}

/**
 * Format lat/lon for URL (compact)
 * @param lat - Latitude in degrees
 * @param lon - Longitude in degrees
 * @returns Formatted string like "36.012,-180.4"
 */
export function formatLatLonForUrl(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

/**
 * Parse lat/lon from URL format
 * @param ll - String like "36.012,-180.4"
 * @returns Object with lat and lon, or null if invalid
 */
export function parseLatLonFromUrl(ll: string): { lat: number; lon: number } | null {
  const parts = ll.split(',');
  if (parts.length !== 2) {
    return null;
  }

  const lat = parseFloat(parts[0]!);
  const lon = parseFloat(parts[1]!);

  if (isNaN(lat) || isNaN(lon)) {
    return null;
  }

  // Validate ranges
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return null;
  }

  return { lat, lon };
}
