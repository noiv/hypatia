/**
 * Locale Service
 *
 * Detects user's browser locale and determines:
 * - Language and region
 * - Unit preferences (metric vs imperial)
 * - Default geographic location based on country
 * - Timezone information
 */

import { COUNTRY_CENTROIDS, DEFAULT_LOCATION, type CountryLocation } from '../data/countryCentroids';

export interface UnitPreferences {
  temperature: 'C' | 'F';
  windSpeed: 'm/s' | 'mph' | 'km/h' | 'knots';
  pressure: 'hPa' | 'inHg' | 'mmHg';
  distance: 'km' | 'mi';
  precipitation: 'mm' | 'in';
}

export interface LocaleInfo {
  language: string;              // "en", "de", "ja"
  region: string;                // "US", "DE", "JP"
  locale: string;                // "en-US", "de-DE", "ja-JP"
  timezone: string;              // "America/New_York", "Europe/Berlin"
  languages: readonly string[];  // ["en-US", "en", "es"]
  units: UnitPreferences;
  defaultLocation: CountryLocation;
}

/**
 * Countries that use imperial units
 * US, Liberia, Myanmar (Fahrenheit for temperature)
 */
const IMPERIAL_COUNTRIES = new Set(['US', 'LR', 'MM']);

/**
 * Determine unit preferences based on region/country code
 */
function getUnitPreferences(region: string): UnitPreferences {
  // Imperial temperature users
  if (IMPERIAL_COUNTRIES.has(region)) {
    return {
      temperature: 'F',
      windSpeed: 'mph',
      pressure: 'hPa',     // Keep hPa even for US (aviation standard)
      distance: 'mi',
      precipitation: 'in'
    };
  }

  // UK: mostly metric but uses mph
  if (region === 'GB') {
    return {
      temperature: 'C',
      windSpeed: 'mph',
      pressure: 'hPa',
      distance: 'mi',      // UK uses miles
      precipitation: 'mm'
    };
  }

  // Everyone else: metric
  return {
    temperature: 'C',
    windSpeed: 'm/s',
    pressure: 'hPa',
    distance: 'km',
    precipitation: 'mm'
  };
}

/**
 * Get default location for a country/region code
 */
function getDefaultLocation(region: string): CountryLocation {
  const location = COUNTRY_CENTROIDS[region];
  if (location) {
    return location;
  }

  console.warn(`⚠️  No default location found for region: ${region}`);
  return DEFAULT_LOCATION;
}

/**
 * Detect user's locale from browser APIs
 */
export function detectLocale(): LocaleInfo {
  // Get primary language from browser
  const browserLocale = navigator.language || 'en-US';
  const browserLanguages = navigator.languages || [browserLocale];

  // Parse locale into language and region
  const [language, region] = browserLocale.split('-');

  // Get timezone
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Determine unit preferences
  const units = getUnitPreferences(region || 'US');

  // Get default location
  const defaultLocation = getDefaultLocation(region || 'US');

  return {
    language: language || 'en',
    region: region || 'US',
    locale: browserLocale,
    timezone,
    languages: browserLanguages,
    units,
    defaultLocation
  };
}

/**
 * Format locale info for logging
 */
export function formatLocaleInfo(info: LocaleInfo): string {
  return `Locale: ${info.locale} (${info.defaultLocation.name}) | Timezone: ${info.timezone}`;
}
