/**
 * Configuration Module
 *
 * Central export point for all configuration-related functionality
 */

import earthData from '../layers/earth/earth.config.json';
import tempData from '../layers/temp/temp.config.json';
import sunData from '../layers/sun/sun.config.json';
import atmosphereData from '../layers/sun/atmosphere.config.json';
import graticuleData from '../layers/graticule/graticule.config.json';
import rainData from '../layers/rain/rain.config.json';
import pressureData from '../layers/pressure/pressure.config.json';
import textData from '../layers/text/text.config.json';
import windData from '../layers/wind/wind.config.json';

import type {
  EarthConfig,
  Temp2mConfig,
  SunConfig,
  AtmosphereConfig,
  GraticuleConfig,
  PrecipitationConfig,
  PressureConfig,
  TextConfig,
  Wind10mConfig
} from './types';

// Export typed configuration constants
export const EARTH_CONFIG = earthData as EarthConfig;
export const TEMP_CONFIG = tempData as Temp2mConfig;
export const SUN_CONFIG = sunData as SunConfig;
export const ATMOSPHERE_CONFIG = atmosphereData as AtmosphereConfig;
export const GRATICULE_CONFIG = graticuleData as GraticuleConfig;
export const RAIN_CONFIG = rainData as PrecipitationConfig;
export const PRESSURE_CONFIG = pressureData as PressureConfig;
export const TEXT_CONFIG = textData as TextConfig;
export const WIND_CONFIG = windData as Wind10mConfig;

// Export config loader
export { configLoader } from './loader';

// Export types
export type {
  HypatiaConfig,
  ParamsConfig,
  LayersConfig,
  Layer,
  LayerVisualization,
  LayerUI,
  LayerGroup,
  ParamInfo,
  DataManifest,
  DatasetInfo,
  EarthConfig,
  Temp2mConfig,
  AtmosphereConfig,
  GraticuleConfig,
  PrecipitationConfig,
  PressureConfig,
  TextConfig,
  Wind10mConfig
} from './types';
