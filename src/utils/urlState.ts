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

import { cartesianToLatLon, latLonToCartesian, formatLatLonForUrl, parseLatLonFromUrl } from './coordinates';
import { altitudeToDistance, distanceToAltitude } from './constants';
import * as THREE from 'three';

/**
 * Format date for URL
 * @param date - Date object
 * @returns String like "2015-12-25:19:48"
 */
function formatDateForUrl(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');

  return `${year}-${month}-${day}:${hours}:${minutes}`;
}

/**
 * Parse date from URL format
 * @param dt - String like "2015-12-25:19:48" (no seconds)
 * @returns Date object or null if invalid
 */
function parseDateFromUrl(dt: string): Date | null {
  // Expected format: YYYY-MM-DD:HH:MM (no seconds)
  const match = dt.match(/^(\d{4})-(\d{2})-(\d{2}):(\d{2}):(\d{2})$/);

  if (!match) {
    return null;
  }

  const [, year, month, day, hours, minutes] = match;

  const date = new Date(Date.UTC(
    parseInt(year!),
    parseInt(month!) - 1,
    parseInt(day!),
    parseInt(hours!),
    parseInt(minutes!),
    0  // seconds always 0
  ));

  // Validate date
  if (isNaN(date.getTime())) {
    return null;
  }

  return date;
}

export interface AppUrlState {
  time: Date;
  camera: { x: number; y: number; z: number; distance: number };
  layers: string[];
}

export interface PartialUrlState {
  time?: Date;
  camera?: { x: number; y: number; z: number; distance: number };
  layers?: string[];
}

/**
 * Parse URL search params to get application state
 * Returns full state if all params present, null if URL empty
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
  const camera = {
    x: cameraPositionVec.x,
    y: cameraPositionVec.y,
    z: cameraPositionVec.z,
    distance: cameraDistance
  };

  // Parse layers (optional) - default to empty array when not present
  const layers = layersStr ? layersStr.split(',').map(l => l.trim()).filter(l => l.length > 0) : [];

  return { time, camera, layers };
}

/**
 * Parse partial URL state (returns what's available)
 */
export function parsePartialUrlState(): PartialUrlState {
  const search = window.location.search.substring(1);
  if (!search) {
    return {};
  }

  const params = new URLSearchParams(search);
  const partial: PartialUrlState = {};

  // Parse time if present
  const dtStr = params.get('dt');
  if (dtStr) {
    const time = parseDateFromUrl(dtStr);
    if (time) {
      partial.time = time;
    }
  }

  // Parse altitude and lat/lon if both present
  const altStr = params.get('alt');
  const llStr = params.get('ll');
  if (altStr && llStr) {
    const altitudeMeters = parseFloat(altStr);
    const latLon = parseLatLonFromUrl(llStr);

    if (!isNaN(altitudeMeters) && latLon) {
      const cameraDistance = altitudeToDistance(altitudeMeters);
      const cameraPositionVec = latLonToCartesian(latLon.lat, latLon.lon, cameraDistance);
      partial.camera = {
        x: cameraPositionVec.x,
        y: cameraPositionVec.y,
        z: cameraPositionVec.z,
        distance: cameraDistance
      };
    }
  }

  // Parse layers if present
  const layersStr = params.get('layers');
  if (layersStr) {
    partial.layers = layersStr.split(',').map(l => l.trim()).filter(l => l.length > 0);
  }

  return partial;
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
    state.camera.x,
    state.camera.y,
    state.camera.z
  );
  const { lat, lon } = cartesianToLatLon(cameraVec);
  const ll = formatLatLonForUrl(lat, lon);

  // Convert camera distance to altitude in meters
  const altitudeMeters = distanceToAltitude(state.camera.distance);
  const alt = Math.round(altitudeMeters).toString();

  // Build URL manually to avoid encoding colons and commas
  let search = `?dt=${dt}&alt=${alt}&ll=${ll}`;

  // Add layers if present
  if (state.layers && state.layers.length > 0) {
    search += `&layers=${state.layers.join(',')}`;
  }

  // Use absolute URL to prevent browser from encoding
  const url = `${window.location.origin}${window.location.pathname}${search}`;

  // Use replaceState to avoid creating history entries for every update
  window.history.replaceState(null, '', url);
}

/**
 * Debounced URL update to avoid excessive history entries
 */
let updateTimeout: number | null = null;

export function debouncedUpdateUrlState(state: AppUrlState, delay: number = 100): void {
  if (updateTimeout !== null) {
    clearTimeout(updateTimeout);
  }

  updateTimeout = window.setTimeout(() => {
    updateUrlState(state);
    updateTimeout = null;
  }, delay);
}
