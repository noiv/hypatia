/**
 * ECMWF Service
 *
 * Check for latest available IFS model run
 */

import { getLatestECMWFRun as discoverLatestRun } from './ECMWFDiscoveryService';

export interface ECMWFRun {
  date: string;      // YYYYMMDD
  cycle: string;     // 00z, 06z, 12z, 18z
  timestamp: string; // Full ISO timestamp
  dataDelay: number; // Hours since cycle time
}

/**
 * Get latest available ECMWF IFS forecast run
 * Uses S3 bucket discovery to find the most recent run
 */
export async function getLatestRun(currentTime: Date): Promise<ECMWFRun | null> {
  try {
    const runInfo = await discoverLatestRun();
    const actualDelay = (currentTime.getTime() - runInfo.timestamp.getTime()) / 3600000;

    console.log(`✅ Latest ECMWF run: ${runInfo.date} ${runInfo.cycle} (${actualDelay.toFixed(1)}h delay)`);

    return {
      date: runInfo.date,
      cycle: runInfo.cycle,
      timestamp: runInfo.timestamp.toISOString(),
      dataDelay: actualDelay
    };
  } catch (error) {
    console.error('❌ Failed to discover ECMWF run:', error);
    return null;
  }
}

/**
 * Format run info for display
 */
export function formatRunInfo(run: ECMWFRun): string {
  const date = `${run.date.substring(0, 4)}-${run.date.substring(4, 6)}-${run.date.substring(6, 8)}`;
  return `${date} ${run.cycle} (${run.dataDelay.toFixed(1)}h delay)`;
}
