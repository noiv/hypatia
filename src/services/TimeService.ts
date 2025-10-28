/**
 * Time Service
 *
 * Fetches accurate current time from time server
 */

interface TimeApiResponse {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  seconds: number;
  milliSeconds: number;
  dateTime: string;
  timeZone: string;
}

/**
 * Get current time from time server
 */
export async function getCurrentTime(): Promise<Date> {
  try {
    console.log('⏰ Fetching current time from time server...');

    const response = await fetch('https://timeapi.io/api/Time/current/zone?timeZone=UTC', {
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      throw new Error(`Time server returned ${response.status}`);
    }

    const data: TimeApiResponse = await response.json();
    const serverTime = new Date(data.dateTime);

    console.log(`✅ Time server: ${serverTime.toISOString()}`);
    console.log(`   Timezone: ${data.timeZone}`);

    return serverTime;
  } catch (error) {
    console.warn('⚠️  Failed to fetch time from server, using local time');
    console.warn(`   Error: ${error instanceof Error ? error.message : 'Unknown error'}`);

    // Fallback to local time
    const localTime = new Date();
    console.log(`   Using local time: ${localTime.toISOString()}`);
    return localTime;
  }
}

/**
 * Format time for display in header
 */
export function formatTimeForHeader(date: Date): {
  local: string;
  utc: string;
} {
  return {
    local: date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }),
    utc: date.toISOString().replace('T', ' ').substring(0, 19) + ' UTC'
  };
}
