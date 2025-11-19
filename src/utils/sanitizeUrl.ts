/**
 * URL Sanitization with Progressive Parameter Filling
 *
 * Fills in missing URL parameters using fallback chain:
 * - ll (lat/lon): URL → Locale centroid → Timezone → Geolocation → (0,0)
 * - alt: URL → config default (19113000)
 * - dt: URL → current time
 * - layers: URL → config default (earth,sun,graticule)
 */

import { parsePartialUrlState, updateUrlState, type AppUrlState } from './urlState';
import type { ConfigService } from '../services/ConfigService';
import { EARTH_RADIUS_METERS } from './constants';
import { latLonToCartesian } from './coordinates';

/**
 * Altitude conversion helpers
 */
function altitudeToDistance(altitudeMeters: number): number {
  const EARTH_RADIUS_UNITS = 1;
  const METERS_PER_UNIT = EARTH_RADIUS_METERS / EARTH_RADIUS_UNITS;
  return (altitudeMeters / METERS_PER_UNIT) + EARTH_RADIUS_UNITS;
}

function distanceToAltitude(distance: number): number {
  const EARTH_RADIUS_UNITS = 1;
  const METERS_PER_UNIT = EARTH_RADIUS_METERS / EARTH_RADIUS_UNITS;
  return (distance - EARTH_RADIUS_UNITS) * METERS_PER_UNIT;
}

/**
 * Get default time
 * @param mode - 'nearest-run': snap to nearest model run (00z, 06z, 12z, 18z)
 *               'current-utc': use exact current UTC time
 */
function getDefaultTime(mode: 'nearest-run' | 'current-utc' = 'nearest-run'): Date {
  const now = new Date();

  if (mode === 'current-utc') {
    return now;
  }

  // Find the most recent model run (00z, 06z, 12z, or 18z)
  const currentHourUTC = now.getUTCHours();
  const latestRunDate = new Date(now);
  latestRunDate.setUTCMinutes(0, 0, 0);

  if (currentHourUTC >= 18) {
    latestRunDate.setUTCHours(18);
  } else if (currentHourUTC >= 12) {
    latestRunDate.setUTCHours(12);
  } else if (currentHourUTC >= 6) {
    latestRunDate.setUTCHours(6);
  } else {
    latestRunDate.setUTCHours(0);
  }

  return latestRunDate;
}

/**
 * Get default camera position using fallback chain:
 * URL → Locale centroid → Geolocation → (0,0)
 */
function getDefaultCameraPosition(localeInfo?: any, userLocation?: any): { lat: number; lon: number } {
  // Try locale-based centroid
  if (localeInfo?.defaultLocation) {
    const { lat, lon } = localeInfo.defaultLocation;
    return { lat, lon };
  }

  // Try geolocation
  if (userLocation) {
    const { latitude, longitude } = userLocation;
    return { lat: latitude, lon: longitude };
  }

  // Fallback to (0,0)
  return { lat: 0, lon: 0 };
}

/**
 * Sanitize and fill missing URL parameters
 * Returns complete state with all parameters filled
 */
export function sanitizeUrl(
  configService: ConfigService,
  localeInfo?: any,
  userLocation?: any,
  forceBootstrapCamera: boolean = false
): AppUrlState {
  const partial = parsePartialUrlState();
  const changes: string[] = [];

  // Get defaults from config
  const hypatiaConfig = configService.getHypatiaConfig();
  const defaultAltitude = hypatiaConfig.visualization.defaultAltitude;
  const defaultLayers = hypatiaConfig.visualization.defaultLayers;
  const defaultTimeMode = hypatiaConfig.bootstrap.defaultTime;

  // Fill in time
  const time = partial.time || getDefaultTime(defaultTimeMode);
  if (!partial.time) {
    changes.push(`dt: (empty) → ${time.toISOString()}`);
  }

  // Fill in camera position
  let camera: { x: number; y: number; z: number; distance: number };

  // Use bootstrap position if: no camera in URL, OR forceBootstrapCamera flag is set
  const shouldUseBootstrapDefault = !partial.camera || forceBootstrapCamera;

  if (shouldUseBootstrapDefault) {
    const { lat, lon } = getDefaultCameraPosition(localeInfo, userLocation);
    const distance = partial.camera?.distance || altitudeToDistance(defaultAltitude);
    const position = latLonToCartesian(lat, lon, distance);
    camera = {
      x: position.x,
      y: position.y,
      z: position.z,
      distance
    };
    const altitude = distanceToAltitude(distance);
    changes.push(`camera: (empty) → lat=${lat.toFixed(2)}, lon=${lon.toFixed(2)}, alt=${altitude.toFixed(0)}m`);
  } else {
    camera = partial.camera!;
  }

  // Fill in layers
  const layers = partial.layers || defaultLayers;
  if (!partial.layers) {
    changes.push(`layers: (empty) → [${layers.join(', ')}]`);
  }

  // Log changes if any
  if (changes.length > 0) {
    console.log('sanitizeUrl filled missing params:', changes.join(' | '));
  }

  const completeState: AppUrlState = {
    time,
    camera,
    layers
  };

  // Update URL with complete state
  updateUrlState(completeState);

  return completeState;
}
