/**
 * PropertyBoundary.jsx
 *
 * Full-screen MapLibre GL JS boundary-drawing screen for the Field Supervisor PWA.
 *
 * Flow:
 *   Normal mode  — pan / zoom freely
 *   Drawing mode — each map tap creates a vertex; vertices connect into a polygon
 *   Edit mode    — drag existing vertices; undo / delete / reset
 *   Saved        — polygon persisted locally; step marked Completed
 *
 * Architecture is Capacitor-ready: all geo-math lives in BoundaryService.js
 * and all storage lives in BoundaryRepository.js. Only this component touches
 * the browser MapLibre API.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { ArrowLeft, Plus, Minus, Undo2, Trash2, Save, Layers, MapPin, Navigation2, CheckCircle2 } from 'lucide-react';
import BoundaryRepository from '../services/offline/BoundaryRepository';
import {
  buildBoundaryRecord,
  calcPolygonAreaM2,
  areaFromM2,
  calcPerimeterM,
  formatPerimeter,
} from '../services/BoundaryService';
import { useAuth } from '../context/AuthContext';

// ─── Styling constants ──────────────────────────────────────────────────────
const STROKE_COLOR    = '#3b82f6'; // primary blue
const FILL_COLOR      = '#3b82f6';
const FILL_OPACITY    = 0.18;
const VERTEX_COLOR    = '#ffffff';
const VERTEX_STROKE   = '#3b82f6';
const VERTEX_RADIUS   = 7;

// ─── Satellite tile sources ──────────────────────────────────────────────────
// Using ESRI World Imagery — no API key required, freely available.
const SATELLITE_STYLE = {
  version: 8,
  sources: {
    satellite: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: '&copy; Esri &mdash; Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
      maxzoom: 19,
    },
    labels: {
      type: 'raster',
      tiles: [
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      opacity: 0,  // will be toggled by layer control
    },
  },
  layers: [
    { id: 'satellite-layer', type: 'raster', source: 'satellite' },
    { id: 'labels-layer', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0 } },
  ],
};

const HYBRID_STYLE = {
  ...SATELLITE_STYLE,
  layers: [
    { id: 'satellite-layer', type: 'raster', source: 'satellite' },
    { id: 'labels-layer', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.5 } },
  ],
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function PropertyBoundary({ inspectionId, propertyId, propertyAreaAcres, onSave, onCancel }) {
  const { user } = useAuth();
  const mapContainer = useRef(null);
  const map = useRef(null);
  const locationMarker = useRef(null);
  const watchId = useRef(null);

  // Map state
  const [mapReady, setMapReady] = useState(false);
  const [showLabels, setShowLabels] = useState(false);

  // Drawing state
  const [mode, setMode] = useState('normal'); // 'normal' | 'drawing' | 'saved'
  const [coords, setCoords] = useState([]); // [[lng, lat], ...]
  const [savedBoundary, setSavedBoundary] = useState(null);

  // GPS state
  const [gpsAccuracy, setGpsAccuracy] = useState(null);
  const [gpsWarning, setGpsWarning] = useState(false);

  // UI state
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Derived metrics (recomputed when coords change)
  const hasPolygon = coords.length >= 3;
  const areaMetrics = hasPolygon ? areaFromM2(calcPolygonAreaM2(coords)) : null;
  const perimeterM = hasPolygon ? calcPerimeterM(coords) : 0;

  // ─── Load existing boundary on mount ──────────────────────────────────────
  useEffect(() => {
    (async () => {
      const existing = await BoundaryRepository.getBoundaryForInspection(inspectionId);
      if (existing?.coordinates?.length >= 3) {
        setSavedBoundary(existing);
        setCoords(existing.coordinates);
        setMode('saved');
      }
    })();
  }, [inspectionId]);

  // ─── Init MapLibre ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (map.current) return;

    const m = new maplibregl.Map({
      container: mapContainer.current,
      style: SATELLITE_STYLE,
      center: [80.2707, 13.0827], // default to Chennai; will jump to GPS
      zoom: 17,
      attributionControl: false,
    });

    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    m.on('load', () => {
      // ── Polygon fill ──
      m.addSource('boundary', {
        type: 'geojson',
        data: emptyGeoJSON(),
      });
      m.addLayer({
        id: 'boundary-fill',
        type: 'fill',
        source: 'boundary',
        paint: {
          'fill-color': FILL_COLOR,
          'fill-opacity': FILL_OPACITY,
        },
      });
      m.addLayer({
        id: 'boundary-line',
        type: 'line',
        source: 'boundary',
        paint: {
          'line-color': STROKE_COLOR,
          'line-width': 2.5,
          'line-dasharray': [1, 0],
        },
      });

      // ── Vertices ──
      m.addSource('vertices', {
        type: 'geojson',
        data: emptyPointCollection(),
      });
      m.addLayer({
        id: 'vertices-layer',
        type: 'circle',
        source: 'vertices',
        paint: {
          'circle-radius': VERTEX_RADIUS,
          'circle-color': VERTEX_COLOR,
          'circle-stroke-color': VERTEX_STROKE,
          'circle-stroke-width': 2.5,
        },
      });

      // ── Preview line while drawing (last-to-cursor) ──
      m.addSource('preview-line', {
        type: 'geojson',
        data: emptyGeoJSON(),
      });
      m.addLayer({
        id: 'preview-line-layer',
        type: 'line',
        source: 'preview-line',
        paint: {
          'line-color': STROKE_COLOR,
          'line-width': 1.5,
          'line-dasharray': [3, 3],
        },
      });

      map.current = m;
      setMapReady(true);
    });

    return () => {
      if (watchId.current) navigator.geolocation.clearWatch(watchId.current);
      m.remove();
      map.current = null;
    };
  }, []);

  // ─── GPS watch ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady) return;

    if (!('geolocation' in navigator)) {
      setGpsWarning(true);
      return;
    }

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setGpsAccuracy(Math.round(accuracy));
        setGpsWarning(accuracy > 30);

        // Jump to location only once (first fix)
        if (!locationMarker.current) {
          map.current?.flyTo({ center: [longitude, latitude], zoom: 18, duration: 1500 });
        }

        // Update / create the location dot
        if (locationMarker.current) {
          locationMarker.current.setLngLat([longitude, latitude]);
        } else {
          const el = document.createElement('div');
          el.style.cssText = `
            width: 18px; height: 18px;
            border-radius: 50%;
            background: #3b82f6;
            border: 3px solid white;
            box-shadow: 0 0 0 4px rgba(59,130,246,0.3);
          `;
          locationMarker.current = new maplibregl.Marker({ element: el })
            .setLngLat([longitude, latitude])
            .addTo(map.current);
        }
      },
      () => { setGpsWarning(true); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    return () => {
      if (watchId.current) navigator.geolocation.clearWatch(watchId.current);
    };
  }, [mapReady]);

  // ─── Tap handler (add vertex in drawing mode) ──────────────────────────────
  useEffect(() => {
    if (!mapReady) return;
    const m = map.current;

    const handleClick = (e) => {
      if (mode !== 'drawing') return;
      const { lng, lat } = e.lngLat;
      setCoords((prev) => [...prev, [lng, lat]]);
    };

    m.on('click', handleClick);
    return () => m.off('click', handleClick);
  }, [mapReady, mode]);

  // ─── Update map layers whenever coords change ──────────────────────────────
  useEffect(() => {
    if (!mapReady || !map.current) return;
    const m = map.current;
    updateMapLayers(m, coords);
  }, [mapReady, coords]);

  // ─── Restore saved boundary on mapReady ───────────────────────────────────
  useEffect(() => {
    if (!mapReady || coords.length === 0) return;
    // Fit the map to the existing polygon
    const allLng = coords.map((c) => c[0]);
    const allLat = coords.map((c) => c[1]);
    map.current?.fitBounds(
      [[Math.min(...allLng), Math.min(...allLat)], [Math.max(...allLng), Math.max(...allLat)]],
      { padding: 60, duration: 1000 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  // ─── Layer toggle ──────────────────────────────────────────────────────────
  const toggleLabels = useCallback(() => {
    if (!map.current) return;
    const next = !showLabels;
    map.current.setPaintProperty('labels-layer', 'raster-opacity', next ? 0.5 : 0);
    setShowLabels(next);
  }, [showLabels]);

  // ─── Zoom controls ─────────────────────────────────────────────────────────
  const zoomIn = () => map.current?.zoomIn();
  const zoomOut = () => map.current?.zoomOut();

  // ─── Centre on GPS ─────────────────────────────────────────────────────────
  const centreOnGPS = () => {
    if (!locationMarker.current) return;
    const lngLat = locationMarker.current.getLngLat();
    map.current?.flyTo({ center: lngLat, zoom: 18, duration: 800 });
  };

  // ─── Drawing actions ───────────────────────────────────────────────────────
  const startDrawing = () => {
    setMode('drawing');
    setSaveError(null);
  };

  const undoLast = () => {
    setCoords((prev) => prev.slice(0, -1));
  };

  const resetBoundary = () => {
    setCoords([]);
    setMode('drawing');
    setSaveError(null);
  };

  // ─── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (coords.length < 3) {
      setSaveError('Please add at least 3 points to create a valid boundary.');
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      const supervisorId = user?.supervisorProfile?.id || user?.id;
      const record = buildBoundaryRecord({
        inspectionId,
        propertyId,
        supervisorId,
        coords,
        captureMode: 'manual',
        gpsAccuracyM: gpsAccuracy,
        existingId: savedBoundary?.id || null,
      });

      const saved = await BoundaryRepository.saveBoundary(record);
      setSavedBoundary(saved);
      setMode('saved');

      // Notify parent so the step can be marked Completed
      if (onSave) onSave(saved);
    } catch (err) {
      console.error('[PropertyBoundary] Save failed:', err);
      setSaveError('Failed to save boundary locally. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        background: '#0f1115',
        fontFamily: 'var(--font-main, Outfit, sans-serif)',
      }}
    >
      {/* ── Header ── */}
      <header
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          background: 'rgba(15,17,21,0.85)',
          backdropFilter: 'blur(8px)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <button
          onClick={onCancel}
          style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: 4 }}
        >
          <ArrowLeft size={22} />
        </button>

        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#f8fafc' }}>Property Boundary</div>
          <div style={{ fontSize: 11, color: mode === 'drawing' ? '#f59e0b' : mode === 'saved' ? '#10b981' : '#94a3b8', fontWeight: 500 }}>
            {mode === 'drawing' ? '● Drawing' : mode === 'saved' ? '✓ Saved' : 'Normal'}
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={!hasPolygon || isSaving || mode === 'saved'}
          style={{
            background: hasPolygon && mode !== 'saved' ? '#3b82f6' : 'rgba(59,130,246,0.2)',
            color: hasPolygon && mode !== 'saved' ? '#fff' : '#64748b',
            border: 'none',
            borderRadius: 8,
            padding: '8px 18px',
            fontWeight: 700,
            fontSize: 14,
            cursor: hasPolygon && mode !== 'saved' ? 'pointer' : 'default',
            transition: 'all 0.2s',
          }}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </header>

      {/* ── Map container ── */}
      <div ref={mapContainer} style={{ flex: 1, width: '100%' }} />

      {/* ── Stats strip ── */}
      {(hasPolygon || savedBoundary) && (
        <div
          style={{
            position: 'absolute',
            top: 64,
            left: 12,
            right: 12,
            zIndex: 15,
            background: 'rgba(15,17,21,0.82)',
            backdropFilter: 'blur(6px)',
            borderRadius: 10,
            padding: '8px 14px',
            display: 'flex',
            gap: 20,
            border: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          {propertyAreaAcres && (
            <StatCol label="Property Area" value={`${propertyAreaAcres} ac`} />
          )}
          {areaMetrics && (
            <StatCol
              label="Captured Area"
              value={`${areaMetrics.acres} ac`}
              sub={`${areaMetrics.sq_ft.toLocaleString()} sq.ft · ${areaMetrics.cents} cents`}
            />
          )}
          {perimeterM > 0 && (
            <StatCol label="Perimeter" value={formatPerimeter(perimeterM)} />
          )}
        </div>
      )}

      {/* ── Right-side controls ── */}
      <div
        style={{
          position: 'absolute',
          right: 12,
          bottom: 150,
          zIndex: 15,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {/* Layer toggle */}
        <MapControlBtn onClick={toggleLabels} active={showLabels} title="Toggle labels">
          <Layers size={18} />
        </MapControlBtn>
        {/* GPS centre */}
        <MapControlBtn onClick={centreOnGPS} title="My location">
          <Navigation2 size={18} />
        </MapControlBtn>
        {/* Zoom in */}
        <MapControlBtn onClick={zoomIn} title="Zoom in">
          <Plus size={18} />
        </MapControlBtn>
        {/* Zoom out */}
        <MapControlBtn onClick={zoomOut} title="Zoom out">
          <Minus size={18} />
        </MapControlBtn>
      </div>

      {/* ── GPS accuracy badge ── */}
      {gpsAccuracy !== null && (
        <div
          style={{
            position: 'absolute',
            bottom: 150,
            left: 12,
            zIndex: 15,
            background: gpsWarning ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.12)',
            border: `1px solid ${gpsWarning ? '#f59e0b' : '#10b981'}`,
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 11,
            color: gpsWarning ? '#f59e0b' : '#10b981',
            fontWeight: 600,
          }}
        >
          GPS ±{gpsAccuracy} m
        </div>
      )}
      {gpsWarning && !gpsAccuracy && (
        <div
          style={{
            position: 'absolute',
            bottom: 150,
            left: 12,
            zIndex: 15,
            background: 'rgba(245,158,11,0.12)',
            border: '1px solid #f59e0b',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 11,
            color: '#f59e0b',
            fontWeight: 600,
          }}
        >
          GPS unavailable — draw manually
        </div>
      )}

      {/* ── Bottom action bar ── */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 20,
          padding: '14px 16px calc(14px + env(safe-area-inset-bottom))',
          background: 'rgba(15,17,21,0.92)',
          backdropFilter: 'blur(10px)',
          borderTop: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        {/* Error message */}
        {saveError && (
          <div style={{ color: '#ef4444', fontSize: 13, textAlign: 'center', marginBottom: 10, fontWeight: 500 }}>
            {saveError}
          </div>
        )}

        {/* Saved state */}
        {mode === 'saved' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#10b981', fontWeight: 700, fontSize: 15 }}>
              <CheckCircle2 size={20} />
              Boundary Saved Locally
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <BottomBtn variant="secondary" onClick={resetBoundary}>
                <Trash2 size={16} /> Redraw
              </BottomBtn>
              <BottomBtn variant="primary" onClick={onCancel}>
                Done
              </BottomBtn>
            </div>
          </div>
        )}

        {/* Drawing mode */}
        {mode === 'drawing' && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <BottomBtn variant="secondary" onClick={undoLast} disabled={coords.length === 0}>
              <Undo2 size={16} /> Undo
            </BottomBtn>
            <BottomBtn variant="secondary" onClick={resetBoundary}>
              <Trash2 size={16} /> Clear
            </BottomBtn>
            {hasPolygon && (
              <BottomBtn variant="primary" onClick={handleSave}>
                <Save size={16} /> Save
              </BottomBtn>
            )}
          </div>
        )}

        {/* Normal mode */}
        {mode === 'normal' && (
          <button
            onClick={startDrawing}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: '16px 24px',
              borderRadius: 14,
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              fontWeight: 700,
              fontSize: 16,
              cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(59,130,246,0.4)',
            }}
          >
            <span style={{
              width: 28, height: 28, borderRadius: '50%',
              background: 'rgba(255,255,255,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Plus size={18} />
            </span>
            Add Boundary Points
          </button>
        )}
      </div>

      {/* ── Point count indicator while drawing ── */}
      {mode === 'drawing' && coords.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          <div
            style={{
              background: 'rgba(15,17,21,0.8)',
              border: '1px solid rgba(59,130,246,0.5)',
              borderRadius: 20,
              padding: '4px 14px',
              fontSize: 12,
              color: '#94a3b8',
              fontWeight: 600,
            }}
          >
            {coords.length} point{coords.length !== 1 ? 's' : ''} · tap to add more
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function StatCol({ label, value, sub }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#94a3b8' }}>{sub}</div>}
    </div>
  );
}

function MapControlBtn({ children, onClick, active, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 40, height: 40,
        borderRadius: 10,
        background: active ? 'rgba(59,130,246,0.25)' : 'rgba(15,17,21,0.85)',
        border: `1px solid ${active ? '#3b82f6' : 'rgba(255,255,255,0.12)'}`,
        color: active ? '#3b82f6' : '#94a3b8',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
        backdropFilter: 'blur(6px)',
        transition: 'all 0.2s',
      }}
    >
      {children}
    </button>
  );
}

function BottomBtn({ children, onClick, variant = 'secondary', disabled = false }) {
  const isPrimary = variant === 'primary';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 6,
        padding: '12px 14px',
        borderRadius: 10,
        border: isPrimary ? 'none' : '1px solid rgba(255,255,255,0.1)',
        background: isPrimary ? '#3b82f6' : 'rgba(255,255,255,0.06)',
        color: disabled ? '#475569' : (isPrimary ? '#fff' : '#e2e8f0'),
        fontWeight: 600,
        fontSize: 14,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 0.2s',
      }}
    >
      {children}
    </button>
  );
}

// ─── Map layer utilities ───────────────────────────────────────────────────

function emptyGeoJSON() {
  return { type: 'FeatureCollection', features: [] };
}

function emptyPointCollection() {
  return { type: 'FeatureCollection', features: [] };
}

function coordsToPolygonFeature(coords) {
  if (coords.length < 3) return null;
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[...coords, coords[0]]],
    },
    properties: {},
  };
}

function coordsToLineFeature(coords) {
  if (coords.length < 2) return null;
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [...coords, coords[0]], // close the ring visually
    },
    properties: {},
  };
}

function updateMapLayers(m, coords) {
  // Polygon fill + stroke
  const polyFeature = coordsToPolygonFeature(coords);
  const lineFeature = coords.length >= 2 ? coordsToLineFeature(coords) : null;

  const boundarySrc = m.getSource('boundary');
  if (boundarySrc) {
    boundarySrc.setData({
      type: 'FeatureCollection',
      features: [
        ...(polyFeature ? [polyFeature] : []),
        ...(lineFeature && !polyFeature ? [lineFeature] : []),
      ],
    });
  }

  // Vertices
  const verticesSrc = m.getSource('vertices');
  if (verticesSrc) {
    verticesSrc.setData({
      type: 'FeatureCollection',
      features: coords.map((c, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: c },
        properties: { index: i },
      })),
    });
  }
}
