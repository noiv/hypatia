/**
 * URL Sanitization with Progressive Parameter Filling
 *
 * Fills in missing URL parameters using fallback chain:
 * - ll (lat/lon): URL → Locale centroid → Timezone → Geolocation → (0,0)
 * - alt: URL → config default (19113000)
 * - dt: URL → current time
 * - layers: URL → config default (earth,sun,graticule)
 */

import * as THREE from 'three';
import { parsePartialUrlState, updateUrlState, type AppUrlState } from './urlState';
import { configLoader } from '../config';
import { EARTH_RADIUS_METERS } from './constants';
import { latLonToCartesian, cartesianToLatLon } from './coordinates';
import type { BootstrapState } from '../services/AppBootstrapService';

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
 * Get default time (current browser time snapped to nearest valid cycle)
 * Note: Does NOT clamp to any range - app only cares about maxRangeDays window
 */
function getDefaultTime(): Date {
  // Find the most recent model run (00z, 06z, 12z, or 18z)
  const now = new Date();
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
function getDefaultCameraPosition(bootstrapState: BootstrapState | null): { lat: number; lon: number } {
  // Try locale-based centroid
  if (bootstrapState?.localeInfo?.defaultLocation) {
    const { lat, lon } = bootstrapState.localeInfo.defaultLocation;
    return { lat, lon };
  }

  // Try geolocation
  if (bootstrapState?.userLocation) {
    const { latitude, longitude } = bootstrapState.userLocation;
    return { lat: latitude, lon: longitude };
  }

  // Fallback to (0,0)
  return { lat: 0, lon: 0 };
}

/**
 * Sanitize and fill missing URL parameters
 * Returns complete state with all parameters filled
 */
export function sanitizeUrl(bootstrapState: BootstrapState | null = null, forceBootstrapCamera: boolean = false): AppUrlState {
  const partial = parsePartialUrlState();
  const changes: string[] = [];

  // Get defaults from config
  const hypatiaConfig = configLoader.getHypatiaConfig();
  const defaultAltitude = hypatiaConfig.visualization.defaultAltitude;
  const defaultLayers = hypatiaConfig.visualization.defaultLayers;

  // Fill in time
  const time = partial.time || getDefaultTime();
  if (!partial.time) {
    changes.push(`dt: (empty) → ${time.toISOString()}`);
  }

  // Fill in camera position
  let camera: { x: number; y: number; z: number; distance: number };

  // Use bootstrap position if: no camera in URL, OR forceBootstrapCamera flag is set
  const shouldUseBootstrapDefault = !partial.camera || forceBootstrapCamera;

  if (shouldUseBootstrapDefault) {
    const { lat, lon } = getDefaultCameraPosition(bootstrapState);
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

/**
 * Validate and clamp URL parameters to acceptable ranges
 */
export function validateUrlState(state: AppUrlState): AppUrlState {
  const ALTITUDE_BOUNDS = {
    min: 1000,
    max: EARTH_RADIUS_METERS * 10
  };

  let needsUpdate = false;
  const validatedState = { ...state };

  // Validate altitude
  const currentAltitude = distanceToAltitude(state.camera.distance);
  if (currentAltitude < ALTITUDE_BOUNDS.min) {
    validatedState.camera = {
      ...state.camera,
      distance: altitudeToDistance(ALTITUDE_BOUNDS.min)
    };
    needsUpdate = true;
  } else if (currentAltitude > ALTITUDE_BOUNDS.max) {
    validatedState.camera = {
      ...state.camera,
      distance: altitudeToDistance(ALTITUDE_BOUNDS.max)
    };
    needsUpdate = true;
  }

  // Note: NO time validation - app only cares about maxRangeDays window
  // If data doesn't exist for the requested time, it will show as missing

  // Validate camera position
  const posVec = new THREE.Vector3(
    state.camera.x,
    state.camera.y,
    state.camera.z
  );
  const { lat, lon } = cartesianToLatLon(posVec);

  if (isNaN(lat) || isNaN(lon)) {
    let defaultAltitude = 19113000;
    try {
      const hypatiaConfig = configLoader.getHypatiaConfig();
      defaultAltitude = hypatiaConfig.visualization.defaultAltitude || defaultAltitude;
    } catch (e) {
      // Config not loaded yet
    }
    const distance = altitudeToDistance(defaultAltitude);
    const defaultPos = latLonToCartesian(0, 0, distance);
    validatedState.camera = {
      x: defaultPos.x,
      y: defaultPos.y,
      z: defaultPos.z,
      distance
    };
    needsUpdate = true;
  }

  if (needsUpdate) {
    updateUrlState(validatedState);
  }

  return validatedState;
}
