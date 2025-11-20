/**
 * URL Builder Service
 *
 * Responsible for constructing data file URLs from timesteps and layer configuration.
 * Encapsulates all knowledge about data file path structure.
 *
 * Separation of concerns:
 * - DateTimeService: Pure time calculations
 * - UrlBuilder: URL/path construction
 * - DownloadService: Network fetching
 */

import type { TimeStep } from '../config/types';

export interface LayerUrlConfig {
  dataBaseUrl: string;
  dataFolder: string;
}

export class UrlBuilder {
  /**
   * Build data URL for a single-file layer (temp, precipitation, pressure)
   *
   * Example:
   * - timestep: { date: "20251109", cycle: "00z" }
   * - config: { dataBaseUrl: "/data", dataFolder: "temp2m" }
   * - Returns: "/data/temp2m/20251109_00z.bin"
   */
  buildDataUrl(config: LayerUrlConfig, timestep: TimeStep): string {
    return `${config.dataBaseUrl}/${config.dataFolder}/${timestep.date}_${timestep.cycle}.bin`;
  }

  /**
   * Build data URLs for dual-file layers (wind U/V components)
   *
   * Example:
   * - timestep: { date: "20251109", cycle: "00z" }
   * - config: { dataBaseUrl: "/data", dataFolder: "wind10m" }
   * - Returns: {
   *     u: "/data/wind10m/20251109_00z_u.bin",
   *     v: "/data/wind10m/20251109_00z_v.bin"
   *   }
   */
  buildWindUrls(config: LayerUrlConfig, timestep: TimeStep): { u: string; v: string } {
    const base = `${config.dataBaseUrl}/${config.dataFolder}/${timestep.date}_${timestep.cycle}`;
    return {
      u: `${base}_u.bin`,
      v: `${base}_v.bin`,
    };
  }
}
