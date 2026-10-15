export class LocationService {
  /**
   * Captures the current device position with fallback strategy:
   * 1. Try high-accuracy GPS (satellite/hardware GNSS) with a reasonable timeout.
   * 2. If high accuracy times out or fails (very common indoors or in Chrome on laptops/desktops),
   *    fall back to network/cell-tower/WiFi location (enableHighAccuracy: false) with maximumAge cache.
   * 3. Normalizes and returns clean position object with coords and root coordinates for compatibility.
   */
  async getCurrentPosition(options = {}) {
    if (!navigator.geolocation) {
      const err = new Error('Geolocation is not supported by your browser (or requires HTTPS / localhost).');
      err.code = 0;
      throw err;
    }

    // First attempt: High accuracy
    try {
      return await this._queryPosition({
        enableHighAccuracy: options.enableHighAccuracy ?? true,
        timeout: options.timeout ?? 8000,
        maximumAge: options.maximumAge ?? 5000,
      });
    } catch (firstErr) {
      // If user explicitly denied permission (code 1), don't retry, rethrow immediately
      if (firstErr.code === 1) {
        throw firstErr;
      }

      // If high accuracy timed out (code 3) or position unavailable (code 2),
      // retry with low accuracy (WiFi/cellular network triangulation) and larger timeout
      try {
        return await this._queryPosition({
          enableHighAccuracy: false,
          timeout: 12000,
          maximumAge: 60000, // accept cached location up to 1 minute old
        });
      } catch (fallbackErr) {
        throw fallbackErr;
      }
    }
  }

  _queryPosition(geoOptions) {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            altitude: position.coords.altitude,
            accuracy: position.coords.accuracy,
            heading: position.coords.heading,
            speed: position.coords.speed,
            timestamp: position.timestamp,
          };

          // Provide both root properties and coords property so callers can use either pos.latitude or pos.coords.latitude
          resolve({
            ...coords,
            coords,
          });
        },
        (error) => {
          reject(error);
        },
        geoOptions
      );
    });
  }
}

export const locationService = new LocationService();
