/**
 * ECMWF Discovery Service
 *
 * Discovers the latest available ECMWF forecast run from their S3 bucket
 */

export interface ECMWFRunInfo {
  date: string;     // YYYYMMDD format
  cycle: string;    // "00z", "06z", "12z", or "18z"
  timestamp: Date;  // Full UTC timestamp
}

const S3_BUCKET_URL = 'https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com';

/**
 * Get the latest available ECMWF forecast run
 * Checks today and yesterday for available cycles
 */
export async function getLatestECMWFRun(): Promise<ECMWFRunInfo> {
  const today = new Date();

  // Try today first, then yesterday
  for (let daysBack = 0; daysBack <= 1; daysBack++) {
    const checkDate = new Date(today);
    checkDate.setUTCDate(checkDate.getUTCDate() - daysBack);
    const dateStr = checkDate.toISOString().slice(0, 10).replace(/-/g, '');

    try {
      const cycles = await getAvailableCycles(dateStr);

      if (cycles.length > 0) {
        // Return the most recent cycle
        const latestCycle = cycles[cycles.length - 1];
        const timestamp = parseRunTimestamp(dateStr, latestCycle);

        return {
          date: dateStr,
          cycle: latestCycle,
          timestamp
        };
      }
    } catch (error) {
      console.error(`❌ Failed to check ${dateStr}:`, error);
    }
  }

  throw new Error('No ECMWF runs found for today or yesterday');
}

/**
 * Get available cycles for a specific date
 */
async function getAvailableCycles(dateStr: string): Promise<string[]> {
  const url = `${S3_BUCKET_URL}/?prefix=${dateStr}/&delimiter=/&max-keys=10`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(5000)
  });

  if (!response.ok) {
    throw new Error(`S3 query failed: ${response.status}`);
  }

  const xml = await response.text();

  // Parse XML to extract cycles from CommonPrefixes
  // Format: <Prefix>20251029/00z/</Prefix>
  const cycles: string[] = [];
  const regex = /<Prefix>(\d{8})\/(\d{2}z)\//g;
  let match;

  while ((match = regex.exec(xml)) !== null) {
    cycles.push(match[2]); // Extract "00z", "06z", etc.
  }

  // Sort cycles chronologically
  return cycles.sort();
}

/**
 * Parse run date and cycle into a UTC timestamp
 */
function parseRunTimestamp(dateStr: string, cycle: string): Date {
  const year = parseInt(dateStr.substring(0, 4));
  const month = parseInt(dateStr.substring(4, 6)) - 1; // JS months are 0-indexed
  const day = parseInt(dateStr.substring(6, 8));
  const hour = parseInt(cycle.substring(0, 2));

  return new Date(Date.UTC(year, month, day, hour, 0, 0, 0));
}

/**
 * Check if a specific run exists
 */
export async function checkRunExists(dateStr: string, cycle: string): Promise<boolean> {
  try {
    const cycles = await getAvailableCycles(dateStr);
    return cycles.includes(cycle);
  } catch (error) {
    console.warn(`Failed to check run ${dateStr}/${cycle}:`, error);
    return false;
  }
}
