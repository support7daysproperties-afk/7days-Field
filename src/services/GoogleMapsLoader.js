/**
 * GoogleMapsLoader.js
 *
 * Singleton loader for Google Maps JavaScript API with:
 * - Idempotent script injection (avoids multiple loader conflicts)
 * - Promise-based loading with authentication & error callbacks
 * - Geocoding, Geometry, and Marker libraries support
 */

let loadPromise = null;

export function resetGoogleMapsLoaderForTesting() {
  loadPromise = null;
}

export function getGoogleMapsApiKey() {
  return import.meta.env.VITE_GOOGLE_MAPS_API_KEY || import.meta.env.VITE_GOOGLE_API_KEY || '';
}

export function loadGoogleMaps({
  libraries = ['geometry'],
} = {}) {
  // If already loaded on window, resolve immediately
  if (window.google && window.google.maps) {
    return Promise.resolve(window.google.maps);
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = new Promise((resolve, reject) => {
    const apiKey = getGoogleMapsApiKey();
    if (!apiKey) {
      const err = new Error(
        'Google Maps API key is missing. Please set VITE_GOOGLE_MAPS_API_KEY in your .env file.'
      );
      err.code = 'MISSING_API_KEY';
      reject(err);
      loadPromise = null;
      return;
    }

    const callbackName = `__initGoogleMaps_${Date.now()}`;
    window[callbackName] = () => {
      delete window[callbackName];
      resolve(window.google.maps);
    };

    // Google Maps authentication failure hook
    window.gm_authFailure = () => {
      console.error('[GoogleMapsLoader] Authentication failure reported by Google Maps Platform.');
      const authErr = new Error('Google Maps authentication failed. Please verify your API key and referrer restrictions.');
      authErr.code = 'AUTH_FAILURE';
      reject(authErr);
    };

    const existingScript = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => {
        if (window.google?.maps) resolve(window.google.maps);
      });
      existingScript.addEventListener('error', (e) => {
        loadPromise = null;
        const err = new Error('Failed to load Google Maps script.');
        err.code = 'NETWORK_ERROR';
        reject(err);
      });
      return;
    }

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.async = true;
    script.defer = true;
    const libs = libraries.join(',');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=${libs}&callback=${callbackName}`;

    script.onerror = (e) => {
      delete window[callbackName];
      loadPromise = null;
      const netErr = new Error('Network error loading Google Maps JavaScript API. Please check your internet connection.');
      netErr.code = 'NETWORK_ERROR';
      reject(netErr);
    };

    document.head.appendChild(script);
  });

  return loadPromise;
}
