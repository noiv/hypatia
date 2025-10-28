/**
 * Date formatting utilities
 */

/**
 * Format date for URL
 * @param date - Date object
 * @returns String like "2015-12-25:19:48"
 */
export function formatDateForUrl(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');

  return `${year}-${month}-${day}:${hours}:${minutes}`;
}

/**
 * Parse date from URL format
 * @param dt - String like "2015-12-25:19:48"
 * @returns Date object or null if invalid
 */
export function parseDateFromUrl(dt: string): Date | null {
  // Expected format: YYYY-MM-DD:HH:MM
  const match = dt.match(/^(\d{4})-(\d{2})-(\d{2}):(\d{2}):(\d{2})$/);

  if (!match) {
    return null;
  }

  const [, year, month, day, hours, minutes] = match;

  const date = new Date(Date.UTC(
    parseInt(year!),
    parseInt(month!) - 1,
    parseInt(day!),
    parseInt(hours!),
    parseInt(minutes!)
  ));

  // Validate date
  if (isNaN(date.getTime())) {
    return null;
  }

  return date;
}

/**
 * Format date for display
 * @param date - Date object
 * @returns Formatted string
 */
export function formatDateForDisplay(date: Date): string {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC'
  });
}
