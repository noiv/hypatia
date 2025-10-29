/**
 * URL State Management
 *
 * Manages application state in URL search params for shareability and persistence
 * Format: ?dt=2015-12-25:19:48&alt=12742000&ll=36.012,-180.4&layers=temp2m
 * - dt: datetime in UTC (YYYY-MM-DD:HH:MM)
 * - alt: altitude above surface in meters
 * - ll: latitude,longitude of camera look direction
 * - layers: comma-separated list of active layers (optional)
 */

import { formatDateForUrl, parseDateFromUrl } from './dateFormat';
import { cartesianToLatLon, latLonToCartesian, formatLatLonForUrl, parseLatLonFromUrl } from './coordinates';
import { altitudeToDistance, distanceToAltitude } from './constants';
import * as THREE from 'three';

export interface AppUrlState {
  time: Date;
  cameraPosition: { x: number; y: number; z: number };
  cameraDistance: number;
  layers?: string[];
}

/**
 * Parse URL search params to get application state
 */
export function parseUrlState(): AppUrlState | null {
  const search = window.location.search.substring(1);
  if (!search) {
    return null;
  }

  const params = new URLSearchParams(search);

  const dtStr = params.get('dt');
  const altStr = params.get('alt');
  const llStr = params.get('ll');
  const layersStr = params.get('layers');

  // dt, alt, ll parameters required for valid state
  if (!dtStr || !altStr || !llStr) {
    return null;
  }

  // Parse datetime
  const time = parseDateFromUrl(dtStr);
  if (!time) {
    return null;
  }

  // Parse altitude and convert to camera distance
  const altitudeMeters = parseFloat(altStr);
  if (isNaN(altitudeMeters)) {
    return null;
  }
  const cameraDistance = altitudeToDistance(altitudeMeters);

  // Parse lat/lon
  const latLon = parseLatLonFromUrl(llStr);
  if (!latLon) {
    return null;
  }

  // Convert lat/lon to camera position at specified distance
  const cameraPositionVec = latLonToCartesian(latLon.lat, latLon.lon, cameraDistance);
  const cameraPosition = {
    x: cameraPositionVec.x,
    y: cameraPositionVec.y,
    z: cameraPositionVec.z
  };

  // Parse layers (optional)
  const layers = layersStr ? layersStr.split(',').map(l => l.trim()).filter(l => l.length > 0) : undefined;

  return { time, cameraPosition, cameraDistance, layers };
}

/**
 * Update URL search params with current application state
 * Uses History API to avoid encoding colons and commas
 */
export function updateUrlState(state: AppUrlState): void {
  // Format datetime
  const dt = formatDateForUrl(state.time);

  // Convert camera position to lat/lon
  const cameraVec = new THREE.Vector3(
    state.cameraPosition.x,
    state.cameraPosition.y,
    state.cameraPosition.z
  );
  const { lat, lon } = cartesianToLatLon(cameraVec);
  const ll = formatLatLonForUrl(lat, lon);

  // Convert camera distance to altitude in meters
  const altitudeMeters = distanceToAltitude(state.cameraDistance);
  const alt = Math.round(altitudeMeters).toString();

  // Build URL manually to avoid encoding colons and commas
  let url = `?dt=${dt}&alt=${alt}&ll=${ll}`;

  // Add layers if present
  if (state.layers && state.layers.length > 0) {
    url += `&layers=${state.layers.join(',')}`;
  }

  // Use replaceState to avoid creating history entries for every update
  window.history.replaceState(null, '', url);
}

/**
 * Debounced URL update to avoid excessive history entries
 */
let updateTimeout: number | null = null;

export function debouncedUpdateUrlState(state: AppUrlState, delay: number = 500): void {
  if (updateTimeout !== null) {
    clearTimeout(updateTimeout);
  }

  updateTimeout = window.setTimeout(() => {
    updateUrlState(state);
    updateTimeout = null;
  }, delay);
}
