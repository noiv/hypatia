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
   * Wind data is stored in separate folders with files named without component suffix:
   * - U component: /data/wind10m_u/20251109_00z.bin
   * - V component: /data/wind10m_v/20251109_00z.bin
   *
   * Example:
   * - timestep: { date: "20251109", cycle: "00z" }
   * - config: { dataBaseUrl: "/data", dataFolder: "wind10m" }
   * - Returns: {
   *     u: "/data/wind10m_u/20251109_00z.bin",
   *     v: "/data/wind10m_v/20251109_00z.bin"
   *   }
   */
  buildWindUrls(config: LayerUrlConfig, timestep: TimeStep): { u: string; v: string } {
    const filename = `${timestep.date}_${timestep.cycle}.bin`;
    return {
      u: `${config.dataBaseUrl}/${config.dataFolder}_u/${filename}`,
      v: `${config.dataBaseUrl}/${config.dataFolder}_v/${filename}`,
    };
  }
}
