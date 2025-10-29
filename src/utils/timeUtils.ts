/**
 * Time utility functions
 */

import { getDatasetRange } from '../manifest';

/**
 * Clamp time to available data range for a dataset
 * Returns the clamped time, or the original time if no range is available
 */
export function clampTimeToDataRange(time: Date, dataset: string = 'temp2m'): Date {
  const range = getDatasetRange(dataset);

  if (!range) {
    return time;
  }

  return new Date(Math.max(
    range.startTime.getTime(),
    Math.min(range.endTime.getTime(), time.getTime())
  ));
}
