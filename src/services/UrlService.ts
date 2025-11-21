/**
 * URL Service
 *
 * Manages bidirectional synchronization between application state and URL.
 * Handles parsing, updating, sanitization, and validation of URL parameters.
 *
 * URL Format: ?dt=2015-12-25:19:48&alt=12742000&ll=36.012,-180.4&layers=temp2m
 * - dt: datetime in UTC (YYYY-MM-DD:HH:MM)
 * - alt: altitude above surface in meters
 * - ll: latitude,longitude of camera look direction
 * - layers: comma-separated list of active layers (optional)
 */

import * as THREE from 'three';
import { cartesianToLatLon, latLonToCartesian, formatLatLonForUrl, parseLatLonFromUrl } from '../utils/coordinates';
import { altitudeToDistance, distanceToAltitude } from '../utils/constants';
import type { ConfigService } from './ConfigService';
import type { LocaleInfo } from './LocaleService';
import type { LayerId } from '../layers/ILayer';

/**
 * Geolocation API coordinates result
 */
export interface GeolocationCoordinates {
  latitude: number;
  longitude: number;
}

/**
 * Complete application state from URL (validated and sanitized)
 */
export interface AppUrlState {
  time: Date;
  camera: { x: number; y: number; z: number; distance: number };
  layers: LayerId[];  // Validated layer IDs only
}

/**
 * Partial URL state (unvalidated, optional fields)
 * Same as AppUrlState but layers are raw strings from URL, not yet validated
 * Internal type - not part of public API
 */
type PartialUrlState = Partial<Omit<AppUrlState, 'layers'>> & { layers?: string[] };

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
function getDefaultCameraPosition(
  localeInfo?: LocaleInfo,
  userLocation?: GeolocationCoordinates
): { lat: number; lon: number } {
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
 * Parse URL search params to get complete application state
 * Returns full state if all required params present, null otherwise
 *
 * Note: layers are NOT validated here (returns string[])
 * Use sanitizeUrlState() for validated LayerId[]
 */
export function parseUrlState(): (Omit<AppUrlState, 'layers'> & { layers: string[] }) | null {
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
 * Unlike parseUrlState(), this doesn't require all params to be present
 * Internal helper for sanitizeUrlState() - not part of public API
 */
function parsePartialUrlState(): PartialUrlState {
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

/**
 * Sanitize and fill missing URL parameters with smart defaults
 *
 * Uses fallback chain:
 * - ll (lat/lon): URL → Locale centroid → Geolocation → (0,0)
 * - alt: URL → config default
 * - dt: URL → current time (nearest model run or exact UTC)
 * - layers: URL → config default
 *
 * Returns complete state with all parameters filled and updates the URL
 */
export function sanitizeUrlState(
  configService: ConfigService,
  localeInfo?: LocaleInfo,
  userLocation?: GeolocationCoordinates,
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
    changes.push('dt');
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
    changes.push('camera');
  } else {
    camera = partial.camera!;
  }

  // Fill in layers (validate and filter invalid layer IDs)
  let layers: LayerId[];
  if (partial.layers) {
    // Get valid layer IDs from hypatia config (includes both data and render-only layers)
    const validLayerIds = new Set(hypatiaConfig.layers.all);

    // Filter to only valid layer IDs
    const validLayers = partial.layers.filter((layer): layer is LayerId =>
      validLayerIds.has(layer as LayerId)
    );

    // Log if any invalid layers were filtered out
    const invalidLayers = partial.layers.filter(layer => !validLayerIds.has(layer as LayerId));
    if (invalidLayers.length > 0) {
      console.warn(`UrlService: Filtered out invalid layer IDs: ${invalidLayers.join(', ')}`);
    }

    // Use valid layers or fall back to defaults if none are valid
    layers = validLayers.length > 0 ? validLayers : defaultLayers as LayerId[];
  } else {
    layers = defaultLayers as LayerId[];
    changes.push('layers');
  }

  // Log changes if any
  if (changes.length > 0) {
    console.log('UrlService.sanitized:', changes.join(', '));
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
