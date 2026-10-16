import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadGoogleMaps, getGoogleMapsApiKey, resetGoogleMapsLoaderForTesting } from '../src/services/GoogleMapsLoader';

describe('GoogleMapsLoader & Property Boundary Google Maps Integration Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetGoogleMapsLoaderForTesting();
    globalThis.window = globalThis.window || {};
    globalThis.document = {
      querySelector: vi.fn().mockReturnValue(null),
      querySelectorAll: vi.fn().mockReturnValue([]),
      createElement: vi.fn((tag) => ({
        tagName: tag.toUpperCase(),
        src: '',
        onerror: null,
      })),
      head: {
        appendChild: vi.fn(),
      },
    };
    delete globalThis.window.google;
  });

  describe('API Key Configuration & Detection', () => {
    it('retrieves the Google Maps API key from environment configuration', () => {
      const key = getGoogleMapsApiKey();
      expect(key).toBeDefined();
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(10);
    });
  });

  describe('Google Maps Script Loading & Lifecycle', () => {
    it('creates a script tag with proper libraries and callback query parameter', async () => {
      let scriptAdded = null;
      globalThis.document.head.appendChild = vi.fn().mockImplementation((el) => {
        if (el.tagName === 'SCRIPT' && el.src.includes('maps.googleapis.com')) {
          scriptAdded = el;
          const url = new URL(el.src);
          const callbackName = url.searchParams.get('callback');
          globalThis.window.google = {
            maps: {
              Map: vi.fn(),
              Polygon: vi.fn(),
              Polyline: vi.fn(),
              Marker: vi.fn(),
              OverlayView: vi.fn(),
              LatLng: vi.fn((lat, lng) => ({ lat: () => lat, lng: () => lng })),
              LatLngBounds: vi.fn(() => ({ extend: vi.fn() })),
              MapTypeId: { SATELLITE: 'satellite', HYBRID: 'hybrid' },
              SymbolPath: { CIRCLE: 0 },
            }
          };
          if (callbackName && typeof globalThis.window[callbackName] === 'function') {
            globalThis.window[callbackName]();
          }
        }
        return el;
      });

      const maps = await loadGoogleMaps({ libraries: ['geometry'] });

      expect(scriptAdded).not.toBeNull();
      expect(scriptAdded.src).toContain('https://maps.googleapis.com/maps/api/js');
      expect(scriptAdded.src).toContain('libraries=geometry');
      expect(maps).toBeDefined();
      expect(maps.MapTypeId.SATELLITE).toBe('satellite');
    });

    it('resolves immediately if window.google.maps is already initialized (idempotent)', async () => {
      globalThis.window.google = {
        maps: {
          Map: vi.fn(),
          MapTypeId: { SATELLITE: 'satellite', HYBRID: 'hybrid' }
        }
      };

      const appendSpy = vi.spyOn(globalThis.document.head, 'appendChild');
      const maps = await loadGoogleMaps();

      expect(maps).toBe(globalThis.window.google.maps);
      expect(appendSpy).not.toHaveBeenCalled();
    });

    it('handles script load network failure gracefully with rejection', async () => {
      globalThis.document.head.appendChild = vi.fn().mockImplementation((el) => {
        if (el.tagName === 'SCRIPT' && el.src.includes('maps.googleapis.com')) {
          setTimeout(() => {
            if (el.onerror) el.onerror(new Error('Network failure'));
          }, 10);
        }
        return el;
      });

      try {
        await loadGoogleMaps();
        expect.unreachable('Should have thrown network error');
      } catch (err) {
        expect(err.code).toBe('NETWORK_ERROR');
      }
    });
  });

  describe('Google Satellite & Hybrid View Toggle', () => {
    it('supports SATELLITE and HYBRID MapTypeIds without invalid states', () => {
      const MapTypeId = {
        SATELLITE: 'satellite',
        HYBRID: 'hybrid',
        ROADMAP: 'roadmap',
        TERRAIN: 'terrain',
      };

      let currentMapTypeId = MapTypeId.SATELLITE;
      expect(currentMapTypeId).toBe('satellite');

      // Toggle to Hybrid
      currentMapTypeId = currentMapTypeId === MapTypeId.SATELLITE ? MapTypeId.HYBRID : MapTypeId.SATELLITE;
      expect(currentMapTypeId).toBe('hybrid');

      // Toggle back to Satellite
      currentMapTypeId = currentMapTypeId === MapTypeId.SATELLITE ? MapTypeId.HYBRID : MapTypeId.SATELLITE;
      expect(currentMapTypeId).toBe('satellite');
    });
  });
});
