import * as THREE from 'three';

/**
 * Calculate sun position for given time
 * Returns unit vector pointing toward sun from Earth center
 */
export function calculateSunPosition(time: Date): THREE.Vector3 {
  // Get day of year (1-365/366) - UTC only
  const startOfYear = new Date(Date.UTC(time.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((time.getTime() - startOfYear.getTime()) / 86400000) + 1;
  const daysInYear = isLeapYear(time.getUTCFullYear()) ? 366 : 365;

  // Calculate solar declination (tilt of Earth's axis)
  // -23.45° at winter solstice, +23.45° at summer solstice
  const declination = -23.45 * Math.cos(2 * Math.PI * (dayOfYear + 10) / daysInYear);
  const declinationRad = (declination * Math.PI) / 180;

  // Calculate hour angle (Earth's rotation)
  // 0° at solar noon, 360° in 24 hours
  const hours = time.getUTCHours() + time.getUTCMinutes() / 60 + time.getUTCSeconds() / 3600;
  const hourAngle = (hours - 12) * 15; // 15° per hour
  const hourAngleRad = (hourAngle * Math.PI) / 180;

  // Convert to Cartesian coordinates
  // Sun at (0,0,0) at solar noon on equator
  // Negate hourAngle so sun moves westward as time advances (Earth rotates east)
  const x = Math.cos(declinationRad) * Math.sin(-hourAngleRad);
  const y = Math.sin(declinationRad);
  const z = Math.cos(declinationRad) * Math.cos(-hourAngleRad);

  return new THREE.Vector3(x, y, z).normalize();
}

/**
 * Check if year is leap year
 */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

/**
 * Format date for display
 */
export function formatDateTime(date: Date): string {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

/**
 * Get timestep filename components
 */
export function getTimestepInfo(date: Date): {
  date: string;
  cycle: string;
  forecast: string;
} {
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const hour = date.getUTCHours();

  // Determine which 6-hour cycle this belongs to
  const cycleHour = Math.floor(hour / 6) * 6;
  const cycle = `${cycleHour.toString().padStart(2, '0')}z`;

  // Forecast offset from cycle start
  const forecastHours = hour - cycleHour;
  const forecast = `${forecastHours}h`;

  return { date: dateStr, cycle, forecast };
}
