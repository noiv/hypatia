/**
 * Time utility functions
 */

import { configLoader } from '../config';

/**
 * Clamp time to available data range for a dataset
 * Returns the clamped time, or the original time if no range is available
 */
export function clampTimeToDataRange(time: Date, dataset: string = 'temp2m'): Date {
  // Clamp to maxRangeDays window, not dataset range
  // Must match slider range calculation
  const hypatiaConfig = configLoader.getHypatiaConfig();
  const maxRangeDays = hypatiaConfig.data.maxRangeDays;
  const daysBack = Math.floor(maxRangeDays / 2);

  const now = new Date();
  const startTime = new Date(now);
  startTime.setUTCDate(startTime.getUTCDate() - daysBack);
  startTime.setUTCHours(0, 0, 0, 0);

  const endTime = new Date(startTime);
  endTime.setUTCDate(endTime.getUTCDate() + maxRangeDays);
  endTime.setUTCHours(endTime.getUTCHours() - 6); // Back to 18z of last day

  return new Date(Math.max(
    startTime.getTime(),
    Math.min(endTime.getTime(), time.getTime())
  ));
}
