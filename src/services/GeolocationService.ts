/**
 * Geolocation Service
 *
 * Gets user's current location
 */

export interface UserLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
}

/**
 * Get user's current location
 */
export async function getUserLocation(): Promise<UserLocation | null> {
  console.log('📍 Requesting user location...');

  // Check if geolocation is supported
  if (!('geolocation' in navigator)) {
    console.warn('⚠️  Geolocation not supported by browser');
    return null;
  }

  try {
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 5000,
        maximumAge: 0
      });
    });

    const location: UserLocation = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy
    };

    console.log(`✅ User location: ${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`);
    console.log(`   Accuracy: ${Math.round(location.accuracy)} meters`);

    return location;
  } catch (error) {
    if (error instanceof GeolocationPositionError) {
      switch (error.code) {
        case error.PERMISSION_DENIED:
          console.warn('⚠️  Location permission denied by user');
          break;
        case error.POSITION_UNAVAILABLE:
          console.warn('⚠️  Location information unavailable');
          break;
        case error.TIMEOUT:
          console.warn('⚠️  Location request timed out');
          break;
      }
    } else {
      console.warn('⚠️  Failed to get location:', error);
    }
    return null;
  }
}
