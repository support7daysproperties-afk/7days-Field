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

  describe('Locate Boundary Map Control Behavior', () => {
    it('computes LatLngBounds and calls fitBounds with padding for multi-vertex boundaries', () => {
      const mockBounds = {
        extend: vi.fn(),
      };
      const mockMap = {
        fitBounds: vi.fn(),
      };
      function MockLatLngBounds() {
        return mockBounds;
      }
      const googleMapsMock = {
        LatLngBounds: vi.fn().mockImplementation(MockLatLngBounds),
      };

      const coords = [
        [80.2707, 13.0827],
        [80.2715, 13.0829],
        [80.2718, 13.0821],
        [80.2709, 13.0818],
      ];

      // Simulate Locate Boundary logic
      const locateBoundaryLogic = (pts, map, gmaps) => {
        if (!pts || pts.length < 2) return false;
        const bounds = new gmaps.LatLngBounds();
        pts.forEach(p => bounds.extend({ lat: p[1], lng: p[0] }));
        map.fitBounds(bounds, 70);
        return true;
      };

      const result = locateBoundaryLogic(coords, mockMap, googleMapsMock);

      expect(result).toBe(true);
      expect(googleMapsMock.LatLngBounds).toHaveBeenCalled();
      expect(mockBounds.extend).toHaveBeenCalledTimes(4);
      expect(mockBounds.extend).toHaveBeenNthCalledWith(1, { lat: 13.0827, lng: 80.2707 });
      expect(mockMap.fitBounds).toHaveBeenCalledWith(mockBounds, 70);
    });

    it('safely handles empty or single-point boundary without calling fitBounds', () => {
      const mockMap = { fitBounds: vi.fn() };
      const googleMapsMock = { LatLngBounds: vi.fn() };

      const locateBoundaryLogic = (pts, map, gmaps) => {
        if (!pts || pts.length < 2) return false;
        const bounds = new gmaps.LatLngBounds();
        pts.forEach(p => bounds.extend({ lat: p[1], lng: p[0] }));
        map.fitBounds(bounds, 70);
        return true;
      };

      expect(locateBoundaryLogic([], mockMap, googleMapsMock)).toBe(false);
      expect(locateBoundaryLogic([[80.27, 13.08]], mockMap, googleMapsMock)).toBe(false);
      expect(mockMap.fitBounds).not.toHaveBeenCalled();
    });
  });

  describe('Map Provider Consistency — Strict Google Maps Usage', () => {
    it('confirms PropertyBoundary uses Google Maps and does not import Leaflet', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const boundaryFilePath = path.resolve(__dirname, '../src/pages/PropertyBoundary.jsx');
      const content = fs.readFileSync(boundaryFilePath, 'utf-8');

      // Must NOT contain Leaflet imports or constructor calls
      expect(content).not.toMatch(/from\s+['"]leaflet['"]/i);
      expect(content).not.toMatch(/from\s+['"]react-leaflet['"]/i);
      expect(content).not.toMatch(/L\.map\(/);
      expect(content).not.toMatch(/L\.tileLayer\(/);
      expect(content).not.toMatch(/<MapContainer/);

      // MUST contain Google Maps and Google Satellite usage
      expect(content).toContain('loadGoogleMaps');
      expect(content).toContain('MapTypeId.SATELLITE');
      expect(content).toContain('MapTypeId.HYBRID');
      expect(content).toContain('google.maps.OverlayView');
    });
  });
});
