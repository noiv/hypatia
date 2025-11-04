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
 * Get default time (current model run analysis time)
 */
function getDefaultTime(): Date {
  const range = configLoader.getDatasetRange('temp2m');
  if (!range) {
    return new Date();
  }

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

  // Clamp to available data range
  if (latestRunDate < range.startTime) {
    return range.startTime;
  } else if (latestRunDate > range.endTime) {
    return range.endTime;
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
    console.log(`📍 Using locale default location: ${lat.toFixed(2)}°, ${lon.toFixed(2)}°`);
    return { lat, lon };
  }

  // Try geolocation
  if (bootstrapState?.userLocation) {
    const { latitude, longitude } = bootstrapState.userLocation;
    console.log(`📍 Using geolocation: ${latitude.toFixed(2)}°, ${longitude.toFixed(2)}°`);
    return { lat: latitude, lon: longitude };
  }

  // Fallback to (0,0)
  console.log('📍 Using fallback location: 0°, 0°');
  return { lat: 0, lon: 0 };
}

/**
 * Sanitize and fill missing URL parameters
 * Returns complete state with all parameters filled
 */
export function sanitizeUrl(bootstrapState: BootstrapState | null = null, forceBootstrapCamera: boolean = false): AppUrlState {
  const partial = parsePartialUrlState();

  // Get defaults (with fallback if config not loaded yet)
  let defaultAltitude = 19113000;
  let defaultLayers = ['earth', 'sun', 'graticule'];

  try {
    const hypatiaConfig = configLoader.getHypatiaConfig();
    defaultAltitude = hypatiaConfig.visualization.defaultAltitude || defaultAltitude;
    defaultLayers = hypatiaConfig.visualization.defaultLayers || defaultLayers;
  } catch (e) {
    // Config not loaded yet, use hardcoded defaults
  }

  // Fill in time
  const time = partial.time || getDefaultTime();

  // Fill in camera position
  let camera = partial.camera;

  // Use bootstrap position if: no camera in URL, OR forceBootstrapCamera flag is set
  const shouldUseBootstrapDefault = !camera || forceBootstrapCamera;

  if (shouldUseBootstrapDefault) {
    const { lat, lon } = getDefaultCameraPosition(bootstrapState);
    const distance = camera?.distance || altitudeToDistance(defaultAltitude);
    const position = latLonToCartesian(lat, lon, distance);
    camera = {
      x: position.x,
      y: position.y,
      z: position.z,
      distance
    };
  }

  // Fill in layers
  const layers = partial.layers || defaultLayers;

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
    console.log(`📍 Altitude ${currentAltitude}m below minimum, clamping to ${ALTITUDE_BOUNDS.min}m`);
    validatedState.camera = {
      ...state.camera,
      distance: altitudeToDistance(ALTITUDE_BOUNDS.min)
    };
    needsUpdate = true;
  } else if (currentAltitude > ALTITUDE_BOUNDS.max) {
    console.log(`📍 Altitude ${currentAltitude}m above maximum, clamping to ${ALTITUDE_BOUNDS.max}m`);
    validatedState.camera = {
      ...state.camera,
      distance: altitudeToDistance(ALTITUDE_BOUNDS.max)
    };
    needsUpdate = true;
  }

  // Validate time against data range
  const dataRange = configLoader.getDatasetRange('temp2m');
  if (dataRange) {
    const SIGNIFICANT_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

    if (state.time < dataRange.startTime) {
      const timeDiff = dataRange.startTime.getTime() - state.time.getTime();
      if (timeDiff > SIGNIFICANT_THRESHOLD_MS) {
        console.log(`📍 Time significantly before data range, using default`);
        validatedState.time = getDefaultTime();
      } else {
        console.log(`📍 Time slightly before data range, clamping to start`);
        validatedState.time = dataRange.startTime;
      }
      needsUpdate = true;
    } else if (state.time > dataRange.endTime) {
      const timeDiff = state.time.getTime() - dataRange.endTime.getTime();
      if (timeDiff > SIGNIFICANT_THRESHOLD_MS) {
        console.log(`📍 Time significantly after data range, using default`);
        validatedState.time = getDefaultTime();
      } else {
        console.log(`📍 Time slightly after data range, clamping to end`);
        validatedState.time = dataRange.endTime;
      }
      needsUpdate = true;
    }
  }

  // Validate camera position
  const posVec = new THREE.Vector3(
    state.camera.x,
    state.camera.y,
    state.camera.z
  );
  const { lat, lon } = cartesianToLatLon(posVec);

  if (isNaN(lat) || isNaN(lon)) {
    console.log('📍 Invalid camera position, using default');
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
    console.log('📍 URL validated, updating address bar');
    updateUrlState(validatedState);
  }

  return validatedState;
}
