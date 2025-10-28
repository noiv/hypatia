/**
 * ECMWF Service
 *
 * Check for latest available IFS model run
 */

export interface ECMWFRun {
  date: string;      // YYYYMMDD
  cycle: string;     // 00z, 06z, 12z, 18z
  timestamp: string; // Full ISO timestamp
  dataDelay: number; // Hours since cycle time
}

const BASE_URL = 'https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com';
const CYCLES = ['00z', '06z', '12z', '18z'];

/**
 * Get latest available ECMWF IFS forecast run
 */
export async function getLatestRun(currentTime: Date): Promise<ECMWFRun | null> {
  console.log('🌍 Checking ECMWF for latest IFS model run...');

  // ECMWF data typically available 6-8 hours after cycle time
  const dataDelay = 7; // hours
  const checkTime = new Date(currentTime.getTime() - dataDelay * 3600000);

  // Try cycles in reverse chronological order
  const cyclesToCheck = getCyclesToCheck(checkTime, 3); // Check last 3 cycles

  for (const candidate of cyclesToCheck) {
    const available = await checkRunExists(candidate);

    if (available) {
      const actualDelay = (currentTime.getTime() - new Date(candidate.timestamp).getTime()) / 3600000;

      console.log(`✅ Latest ECMWF run found:`);
      console.log(`   Date: ${candidate.date}`);
      console.log(`   Cycle: ${candidate.cycle}`);
      console.log(`   Timestamp: ${candidate.timestamp}`);
      console.log(`   Data delay: ${actualDelay.toFixed(1)} hours`);

      return {
        ...candidate,
        dataDelay: actualDelay
      };
    }
  }

  console.warn('⚠️  No recent ECMWF data found');
  return null;
}

/**
 * Get list of cycles to check in reverse chronological order
 */
function getCyclesToCheck(fromTime: Date, count: number): ECMWFRun[] {
  const candidates: ECMWFRun[] = [];
  const checkTime = new Date(fromTime);

  while (candidates.length < count) {
    const cycleHour = Math.floor(checkTime.getUTCHours() / 6) * 6;
    const cycleTime = new Date(checkTime);
    cycleTime.setUTCHours(cycleHour, 0, 0, 0);

    const dateStr = formatDate(cycleTime);
    const cycle = `${cycleHour.toString().padStart(2, '0')}z`;

    candidates.push({
      date: dateStr,
      cycle,
      timestamp: cycleTime.toISOString(),
      dataDelay: 0
    });

    // Move back 6 hours for next candidate
    checkTime.setTime(checkTime.getTime() - 6 * 3600000);
  }

  return candidates;
}

/**
 * Check if a forecast run exists by checking the 0-hour GRIB file
 */
async function checkRunExists(run: ECMWFRun): Promise<boolean> {
  try {
    // Build the GRIB2 filename: YYYYMMDDHHMMSS-0h-oper-fc.grib2
    const cycleHour = run.cycle.replace('z', '').padStart(2, '0');
    const timestamp = `${run.date}${cycleHour}0000`;
    const filename = `${timestamp}-0h-oper-fc.grib2`;
    const url = `${BASE_URL}/${run.date}/${run.cycle}/ifs/0p25/oper/${filename}`;

    const response = await fetch(url, {
      method: 'HEAD', // HEAD request to check existence without downloading
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });

    return response.ok;
  } catch (error) {
    // Silently fail - expected for non-existent runs
    return false;
  }
}

/**
 * Format date as YYYYMMDD
 */
function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Format run info for display
 */
export function formatRunInfo(run: ECMWFRun): string {
  const date = `${run.date.substring(0, 4)}-${run.date.substring(4, 6)}-${run.date.substring(6, 8)}`;
  return `${date} ${run.cycle} (${run.dataDelay.toFixed(1)}h delay)`;
}
