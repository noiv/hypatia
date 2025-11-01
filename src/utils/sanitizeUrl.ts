/**
 * URL Sanitization
 *
 * Validates and corrects URL parameters to ensure they fall within valid bounds.
 * If parameters are missing or out of bounds, replaces them with defaults.
 */

import * as THREE from 'three';
import { parseUrlState, updateUrlState, type AppUrlState } from './urlState';
import { getDatasetRange } from '../manifest';
import { EARTH_RADIUS_METERS } from './constants';
import { latLonToCartesian, cartesianToLatLon } from './coordinates';

/**
 * Default URL state values
 */
export const DEFAULT_URL_STATE = {
  // Default altitude: 3x Earth radius (good global view)
  altitude: EARTH_RADIUS_METERS * 3,

  // Default camera position: looking at lat=0, lon=0 (null island)
  latitude: 0,
  longitude: 0,

  // Default time: most recent analysis (t+0) from latest model run
  getDefaultTime: (): Date => {
    const range = getDatasetRange('temp2m');
    if (!range) {
      // Fallback if no data available
      return new Date();
    }

    // Find the most recent model run (00z, 06z, 12z, or 18z)
    // ECMWF runs 4 times per day at 00z, 06z, 12z, and 18z UTC
    const now = new Date();
    const currentHourUTC = now.getUTCHours();

    // Determine the most recent run time
    const latestRunDate = new Date(now);
    latestRunDate.setUTCMinutes(0, 0, 0);

    if (currentHourUTC >= 18) {
      // If it's past 18z, use today's 18z run
      latestRunDate.setUTCHours(18);
    } else if (currentHourUTC >= 12) {
      // If it's past 12z, use today's 12z run
      latestRunDate.setUTCHours(12);
    } else if (currentHourUTC >= 6) {
      // If it's past 06z, use today's 06z run
      latestRunDate.setUTCHours(6);
    } else {
      // If it's before 06z, use today's 00z run
      latestRunDate.setUTCHours(0);
    }

    // Make sure this run time exists in our data range
    if (latestRunDate < range.startTime) {
      // If calculated run is before our data, use first available
      return range.startTime;
    } else if (latestRunDate > range.endTime) {
      // If calculated run is after our data, use last available
      return range.endTime;
    }

    // Return the analysis time (t+0) of the latest run
    return latestRunDate;
  }
};

/**
 * Valid altitude range (meters above surface)
 */
const ALTITUDE_BOUNDS = {
  min: 1000, // 1 km minimum
  max: EARTH_RADIUS_METERS * 10 // 10x Earth radius maximum
};

/**
 * Sanitize URL parameters and update URL if needed
 * Returns the sanitized state
 */
export function sanitizeUrl(): AppUrlState {
  const urlState = parseUrlState();
  let needsUpdate = false;

  // If no URL state at all, use defaults
  if (!urlState) {
    console.log('📍 No URL state found, using defaults');
    const distance = altitudeToDistance(DEFAULT_URL_STATE.altitude);
    const defaultPos = latLonToCartesian(
      DEFAULT_URL_STATE.latitude,
      DEFAULT_URL_STATE.longitude,
      distance
    );

    const defaultState: AppUrlState = {
      time: DEFAULT_URL_STATE.getDefaultTime(),
      camera: {
        x: defaultPos.x,
        y: defaultPos.y,
        z: defaultPos.z,
        distance
      },
      layers: []
    };

    // Update URL with defaults
    updateUrlState(defaultState);
    return defaultState;
  }

  // Sanitize altitude
  const currentAltitude = distanceToAltitude(urlState.camera.distance);
  let sanitizedAltitude = currentAltitude;

  if (currentAltitude < ALTITUDE_BOUNDS.min) {
    console.log(`📍 Altitude ${currentAltitude}m below minimum, clamping to ${ALTITUDE_BOUNDS.min}m`);
    sanitizedAltitude = ALTITUDE_BOUNDS.min;
    needsUpdate = true;
  } else if (currentAltitude > ALTITUDE_BOUNDS.max) {
    console.log(`📍 Altitude ${currentAltitude}m above maximum, clamping to ${ALTITUDE_BOUNDS.max}m`);
    sanitizedAltitude = ALTITUDE_BOUNDS.max;
    needsUpdate = true;
  }

  // Sanitize time
  const dataRange = getDatasetRange('temp2m');
  let sanitizedTime = urlState.time;

  if (dataRange) {
    // Define "significantly out of range" as more than 7 days outside data range
    const SIGNIFICANT_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

    if (urlState.time < dataRange.startTime) {
      const timeDiff = dataRange.startTime.getTime() - urlState.time.getTime();

      if (timeDiff > SIGNIFICANT_THRESHOLD_MS) {
        // Significantly out of range - use default (most recent analysis)
        console.log(`📍 Time ${urlState.time.toISOString()} significantly before data range, using default`);
        sanitizedTime = DEFAULT_URL_STATE.getDefaultTime();
      } else {
        // Slightly out of range - clamp to edge
        console.log(`📍 Time ${urlState.time.toISOString()} slightly before data range, clamping to start`);
        sanitizedTime = dataRange.startTime;
      }
      needsUpdate = true;
    } else if (urlState.time > dataRange.endTime) {
      const timeDiff = urlState.time.getTime() - dataRange.endTime.getTime();

      if (timeDiff > SIGNIFICANT_THRESHOLD_MS) {
        // Significantly out of range - use default (most recent analysis)
        console.log(`📍 Time ${urlState.time.toISOString()} significantly after data range, using default`);
        sanitizedTime = DEFAULT_URL_STATE.getDefaultTime();
      } else {
        // Slightly out of range - clamp to edge
        console.log(`📍 Time ${urlState.time.toISOString()} slightly after data range, clamping to end`);
        sanitizedTime = dataRange.endTime;
      }
      needsUpdate = true;
    }
  }

  // Sanitize lat/lon (they're already clamped by cartesianToLatLon, but we validate)
  // Latitude: -90 to 90, Longitude: -180 to 180
  const posVec = new THREE.Vector3(
    urlState.camera.x,
    urlState.camera.y,
    urlState.camera.z
  );
  const { lat, lon } = cartesianToLatLon(posVec);

  if (isNaN(lat) || isNaN(lon)) {
    console.log('📍 Invalid camera position, using default');
    const distance = altitudeToDistance(sanitizedAltitude);
    const defaultPos = latLonToCartesian(
      DEFAULT_URL_STATE.latitude,
      DEFAULT_URL_STATE.longitude,
      distance
    );
    urlState.camera = {
      x: defaultPos.x,
      y: defaultPos.y,
      z: defaultPos.z,
      distance
    };
    needsUpdate = true;
  }

  // Create sanitized state
  const sanitizedState: AppUrlState = {
    time: sanitizedTime,
    camera: {
      x: urlState.camera.x,
      y: urlState.camera.y,
      z: urlState.camera.z,
      distance: altitudeToDistance(sanitizedAltitude)
    },
    layers: urlState.layers
  };

  // Update URL if anything changed
  if (needsUpdate) {
    console.log('📍 URL sanitized, updating address bar');
    updateUrlState(sanitizedState);
  }

  return sanitizedState;
}

// Helper functions

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
