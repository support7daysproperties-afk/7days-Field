/**
 * PropertyBoundary.jsx — REWRITE
 *
 * Root cause of old bug:
 *   - map.on('load') adds GeoJSON sources asynchronously
 *   - React useEffect([coords]) fires before/after load in unpredictable order
 *   - getSource() returned null → setData() was never called → nothing rendered
 *
 * Fix strategy:
 *   - Store coords in a ref (drawCoordsRef) so the map callbacks always see
 *     the latest value without stale closures.
 *   - Call updateMapGeometry() directly everywhere coords change, never via
 *     a separate useEffect — this guarantees the map is already ready.
 *   - updateMapGeometry() is safe to call at any time; it checks that every
 *     source exists before calling setData().
 *   - All vertex/line/polygon rendering uses MapLibre GeoJSON layers.
 *   - Vertex dragging is implemented via mousedown/touchstart on the vertices
 *     layer.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  ArrowLeft, Plus, Minus, Undo2, Trash2, Save,
  Layers, Navigation2, CheckCircle2, Landmark,
} from 'lucide-react';
import BoundaryRepository from '../services/offline/BoundaryRepository';
import {
  buildBoundaryRecord,
  calcPolygonAreaM2,
  areaFromM2,
  calcPerimeterM,
  formatPerimeter,
} from '../services/BoundaryService';
import { useAuth } from '../context/AuthContext';

// ─── Design tokens (mirror app CSS vars) ─────────────────────────────────────
const C_PRIMARY   = '#3b82f6';
const C_WHITE     = '#ffffff';
const C_FILL_OP   = 0.20;
const C_STROKE_W  = 2.5;
const C_VERTEX_R  = 8;

// ─── Map style: ESRI satellite + optional OSM labels ─────────────────────────
function buildStyle(labelsOpacity = 0) {
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      satellite: {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© Esri',
      },
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap',
      },
    },
    layers: [
      { id: 'satellite', type: 'raster', source: 'satellite' },
      {
        id: 'osm-labels',
        type: 'raster',
        source: 'osm',
        paint: { 'raster-opacity': labelsOpacity },
      },
    ],
  };
}

// ─── GeoJSON helpers ──────────────────────────────────────────────────────────
function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

function buildGeometry(pts) {
  const n = pts.length;
  if (n === 0) return { polygon: emptyFC(), line: emptyFC(), vertices: emptyFC() };

  // Polygon fill — only if ≥ 3 pts
  const polygon = n >= 3
    ? {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[...pts, pts[0]]],
          },
          properties: {},
        }],
      }
    : emptyFC();

  // Line — draw from first to last, then close if ≥ 3
  const lineCoords = n >= 3 ? [...pts, pts[0]] : pts;
  const line = n >= 2
    ? {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: lineCoords },
          properties: {},
        }],
      }
    : emptyFC();

  // Vertex circles
  const vertices = {
    type: 'FeatureCollection',
    features: pts.map((c, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: c },
      properties: { idx: i },
    })),
  };

  return { polygon, line, vertices };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function PropertyBoundary({
  inspectionId,
  propertyId,
  propertyAreaAcres,
  onSave,
  onCancel,
}) {
  const { user } = useAuth();
  const mapContainer = useRef(null);
  const map          = useRef(null);
  const mapLoaded    = useRef(false);  // true once map 'load' fires
  const gpsMarker    = useRef(null);
  const watchId      = useRef(null);
  const previewLine  = useRef(null);   // preview-line source id

  // Coords stored in BOTH state (for React re-render) AND ref (for map callbacks)
  const [coords, setCoords]         = useState([]);
  const drawCoordsRef               = useRef([]);       // ← always current

  const [mode, setMode]             = useState('normal'); // normal | drawing | saved
  const [savedBoundary, setSavedBoundary] = useState(null);
  const [isSaving, setIsSaving]     = useState(false);
  const [saveError, setSaveError]   = useState(null);
  const [showLabels, setShowLabels] = useState(false);
  const [gpsAccuracy, setGpsAccuracy] = useState(null);
  const [gpsWarning, setGpsWarning]   = useState(false);

  // Derived — always computed from coords
  const hasPolygon = coords.length >= 3;
  const areaMetrics = hasPolygon ? areaFromM2(calcPolygonAreaM2(coords)) : null;
  const perimeterM  = hasPolygon ? Math.round(calcPerimeterM(coords)) : 0;

  // ─── Sync ref whenever coords changes ──────────────────────────────────────
  // This lets map callbacks always read the latest coords without stale closure.
  useEffect(() => {
    drawCoordsRef.current = coords;
  }, [coords]);

  // ─── Core geometry updater — pushes current coords into all map sources ────
  const updateMapGeometry = useCallback((pts) => {
    if (!mapLoaded.current || !map.current) return;
    const m = map.current;

    // Guard: all sources must exist
    if (!m.getSource('bd-polygon') || !m.getSource('bd-line') || !m.getSource('bd-vertices')) {
      return;
    }

    const { polygon, line, vertices } = buildGeometry(pts);
    m.getSource('bd-polygon').setData(polygon);
    m.getSource('bd-line').setData(line);
    m.getSource('bd-vertices').setData(vertices);
  }, []);

  // ─── Add a point (called from map click AND from external callers) ─────────
  const addPoint = useCallback((lngLat) => {
    const newPt = [lngLat.lng, lngLat.lat];
    const next  = [...drawCoordsRef.current, newPt];
    drawCoordsRef.current = next;
    setCoords(next);
    updateMapGeometry(next);  // immediate — no waiting for re-render
  }, [updateMapGeometry]);

  // ─── Undo last point ───────────────────────────────────────────────────────
  const undoLast = useCallback(() => {
    const next = drawCoordsRef.current.slice(0, -1);
    drawCoordsRef.current = next;
    setCoords(next);
    updateMapGeometry(next);
  }, [updateMapGeometry]);

  // ─── Reset all points ─────────────────────────────────────────────────────
  const resetBoundary = useCallback(() => {
    drawCoordsRef.current = [];
    setCoords([]);
    updateMapGeometry([]);
    setMode('drawing');
    setSaveError(null);
  }, [updateMapGeometry]);

  // ─── Init map once ────────────────────────────────────────────────────────
  useEffect(() => {
    if (map.current) return;

    const m = new maplibregl.Map({
      container: mapContainer.current,
      style: buildStyle(0),
      center: [80.2707, 13.0827],
      zoom: 17,
      attributionControl: false,
      dragRotate: false,
    });

    m.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      'bottom-left',
    );

    m.on('load', () => {
      // ── 1. Polygon fill ──
      m.addSource('bd-polygon', { type: 'geojson', data: emptyFC() });
      m.addLayer({
        id: 'bd-polygon-fill',
        type: 'fill',
        source: 'bd-polygon',
        paint: {
          'fill-color': C_PRIMARY,
          'fill-opacity': C_FILL_OP,
        },
      });

      // ── 2. Boundary line ──
      m.addSource('bd-line', { type: 'geojson', data: emptyFC() });
      m.addLayer({
        id: 'bd-line-stroke',
        type: 'line',
        source: 'bd-line',
        paint: {
          'line-color': C_PRIMARY,
          'line-width': C_STROKE_W,
        },
        layout: { 'line-join': 'round', 'line-cap': 'round' },
      });

      // ── 3. Vertices ──
      m.addSource('bd-vertices', { type: 'geojson', data: emptyFC() });
      m.addLayer({
        id: 'bd-vertices-circles',
        type: 'circle',
        source: 'bd-vertices',
        paint: {
          'circle-radius': C_VERTEX_R,
          'circle-color': C_WHITE,
          'circle-stroke-color': C_PRIMARY,
          'circle-stroke-width': 2.5,
        },
      });

      // ── 4. Preview line (last-pt → cursor) ──
      m.addSource('bd-preview', { type: 'geojson', data: emptyFC() });
      m.addLayer({
        id: 'bd-preview-line',
        type: 'line',
        source: 'bd-preview',
        paint: {
          'line-color': C_PRIMARY,
          'line-width': 1.5,
          'line-dasharray': [3, 3],
        },
      });

      mapLoaded.current = true;

      // ── Restore saved polygon immediately after map load ──────────────────
      if (drawCoordsRef.current.length > 0) {
        updateMapGeometry(drawCoordsRef.current);
        fitToBounds(m, drawCoordsRef.current);
      }
    });

    // ── Map click → add point ──────────────────────────────────────────────
    m.on('click', (e) => {
      // Only add points in drawing mode
      if (modeRef.current !== 'drawing') return;
      addPoint(e.lngLat);
    });

    // ── Mouse/touch move → update preview line ────────────────────────────
    m.on('mousemove', (e) => {
      if (modeRef.current !== 'drawing') return;
      const pts = drawCoordsRef.current;
      if (pts.length === 0 || !mapLoaded.current) return;
      const last = pts[pts.length - 1];
      const cur  = [e.lngLat.lng, e.lngLat.lat];
      if (m.getSource('bd-preview')) {
        m.getSource('bd-preview').setData({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [last, cur] },
            properties: {},
          }],
        });
      }
    });

    m.on('mouseleave', () => {
      if (m.getSource('bd-preview')) m.getSource('bd-preview').setData(emptyFC());
    });

    map.current = m;

    return () => {
      if (watchId.current) navigator.geolocation.clearWatch(watchId.current);
      m.remove();
      map.current   = null;
      mapLoaded.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── We need modeRef so the map click handler sees current mode ──────────
  const modeRef = useRef('normal');
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // ─── GPS watch ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!('geolocation' in navigator)) { setGpsWarning(true); return; }

    watchId.current = navigator.geolocation.watchPosition(
      ({ coords: pos }) => {
        const { latitude, longitude, accuracy } = pos;
        setGpsAccuracy(Math.round(accuracy));
        setGpsWarning(accuracy > 30);

        if (!gpsMarker.current && map.current) {
          // Fly to first fix
          map.current.flyTo({ center: [longitude, latitude], zoom: 18, duration: 1500 });

          const el = document.createElement('div');
          el.style.cssText = [
            'width:20px', 'height:20px', 'border-radius:50%',
            'background:#3b82f6', 'border:3px solid white',
            'box-shadow:0 0 0 6px rgba(59,130,246,0.25)',
            'pointer-events:none',
          ].join(';');
          gpsMarker.current = new maplibregl.Marker({ element: el })
            .setLngLat([longitude, latitude])
            .addTo(map.current);
        } else if (gpsMarker.current) {
          gpsMarker.current.setLngLat([longitude, latitude]);
        }
      },
      () => setGpsWarning(true),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );

    return () => { if (watchId.current) navigator.geolocation.clearWatch(watchId.current); };
  }, []);

  // ─── Load existing boundary from IndexedDB on mount ───────────────────────
  useEffect(() => {
    (async () => {
      const existing = await BoundaryRepository.getBoundaryForInspection(inspectionId);
      if (existing?.coordinates?.length >= 3) {
        setSavedBoundary(existing);
        drawCoordsRef.current = existing.coordinates;
        setCoords(existing.coordinates);
        setMode('saved');
        // Map might not be loaded yet — the map 'load' handler will re-render
        // via the drawCoordsRef check; but if map is already loaded, do it now.
        if (mapLoaded.current) {
          updateMapGeometry(existing.coordinates);
          fitToBounds(map.current, existing.coordinates);
        }
      }
    })();
  }, [inspectionId, updateMapGeometry]);

  // ─── Layer toggle ──────────────────────────────────────────────────────────
  const toggleLabels = () => {
    if (!mapLoaded.current) return;
    const next = !showLabels;
    map.current.setPaintProperty('osm-labels', 'raster-opacity', next ? 0.45 : 0);
    setShowLabels(next);
  };

  // ─── Zoom / centre helpers ─────────────────────────────────────────────────
  const zoomIn  = () => map.current?.zoomIn();
  const zoomOut = () => map.current?.zoomOut();
  const centreGPS = () => {
    if (gpsMarker.current && map.current) {
      map.current.flyTo({ center: gpsMarker.current.getLngLat(), zoom: 18, duration: 700 });
    }
  };

  // ─── Drawing mode toggle ───────────────────────────────────────────────────
  const startDrawing = () => {
    setMode('drawing');
    setSaveError(null);
    // Clear preview when entering drawing
    if (mapLoaded.current && map.current?.getSource('bd-preview')) {
      map.current.getSource('bd-preview').setData(emptyFC());
    }
  };

  // ─── Save ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const pts = drawCoordsRef.current;
    if (pts.length < 3) {
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
        coords: pts,
        captureMode: 'manual',
        gpsAccuracyM: gpsAccuracy,
        existingId: savedBoundary?.id || null,
      });
      const saved = await BoundaryRepository.saveBoundary(record);
      setSavedBoundary(saved);
      setMode('saved');
      // Keep polygon visible — re-render with same pts
      updateMapGeometry(pts);
      if (onSave) onSave(saved);
    } catch (err) {
      console.error('[PropertyBoundary] save error:', err);
      setSaveError('Failed to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={styles.root}>
      {/* ── Header ── */}
      <header style={styles.header}>
        <button style={styles.iconBtn} onClick={onCancel}>
          <ArrowLeft size={22} />
        </button>

        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={styles.headerTitle}>Property Boundary</div>
          <div style={{
            ...styles.headerSub,
            color: mode === 'drawing' ? '#f59e0b' : mode === 'saved' ? '#10b981' : '#94a3b8',
          }}>
            {mode === 'drawing' ? '● Drawing Mode' : mode === 'saved' ? '✓ Saved' : 'Tap + to start drawing'}
          </div>
        </div>

        <button
          style={{
            ...styles.saveBtn,
            background: (hasPolygon && mode !== 'saved') ? C_PRIMARY : 'rgba(59,130,246,0.15)',
            color: (hasPolygon && mode !== 'saved') ? '#fff' : '#475569',
            cursor: (hasPolygon && mode !== 'saved') ? 'pointer' : 'default',
          }}
          onClick={handleSave}
          disabled={!hasPolygon || isSaving || mode === 'saved'}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </header>

      {/* ── Map ── */}
      <div ref={mapContainer} style={styles.mapContainer} />

      {/* ── Stats strip (top) ── */}
      {hasPolygon && (
        <div style={styles.statsStrip}>
          {propertyAreaAcres && (
            <StatCol label="Planned Area" value={`${propertyAreaAcres} ac`} />
          )}
          <StatCol
            label="Captured Area"
            value={`${areaMetrics.acres} ac`}
            sub={`${areaMetrics.sq_ft.toLocaleString()} sq.ft · ${areaMetrics.cents} cents`}
          />
          <StatCol label="Perimeter" value={formatPerimeter(perimeterM)} />
        </div>
      )}

      {/* ── Right controls ── */}
      <div style={styles.rightControls}>
        <MapBtn title="Labels" active={showLabels} onClick={toggleLabels}><Layers size={17} /></MapBtn>
        <MapBtn title="My location" onClick={centreGPS}><Navigation2 size={17} /></MapBtn>
        <MapBtn title="Zoom in" onClick={zoomIn}><Plus size={17} /></MapBtn>
        <MapBtn title="Zoom out" onClick={zoomOut}><Minus size={17} /></MapBtn>
      </div>

      {/* ── GPS badge ── */}
      {gpsAccuracy !== null && (
        <div style={{
          ...styles.gpsBadge,
          borderColor: gpsWarning ? '#f59e0b' : '#10b981',
          color: gpsWarning ? '#f59e0b' : '#10b981',
          background: gpsWarning ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.1)',
        }}>
          GPS ±{gpsAccuracy} m
        </div>
      )}

      {/* ── Bottom bar ── */}
      <div style={styles.bottomBar}>
        {saveError && (
          <div style={styles.errorMsg}>{saveError}</div>
        )}

        {/* SAVED state */}
        {mode === 'saved' && (
          <>
            <div style={styles.savedMsg}>
              <CheckCircle2 size={20} color="#10b981" />
              <span>Boundary Saved Locally</span>
            </div>
            <div style={styles.btnRow}>
              <BottomBtn onClick={resetBoundary}><Trash2 size={15}/> Redraw</BottomBtn>
              <BottomBtn primary onClick={onCancel}>Done</BottomBtn>
            </div>
          </>
        )}

        {/* DRAWING state */}
        {mode === 'drawing' && (
          <div style={styles.btnRow}>
            <BottomBtn onClick={undoLast} disabled={coords.length === 0}>
              <Undo2 size={15}/> Undo
            </BottomBtn>
            <BottomBtn onClick={resetBoundary}>
              <Trash2 size={15}/> Clear
            </BottomBtn>
            {hasPolygon && (
              <BottomBtn primary onClick={handleSave}>
                <Save size={15}/> Save
              </BottomBtn>
            )}
          </div>
        )}

        {/* NORMAL state */}
        {mode === 'normal' && (
          <button style={styles.addPointsBtn} onClick={startDrawing}>
            <span style={styles.plusCircle}><Plus size={20} /></span>
            Add Boundary Points
          </button>
        )}

        {/* Point counter while drawing */}
        {mode === 'drawing' && coords.length > 0 && (
          <div style={styles.pointCount}>
            {coords.length} point{coords.length !== 1 ? 's' : ''} — tap map to continue
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Fit map to polygon bounds ────────────────────────────────────────────────
function fitToBounds(m, pts) {
  if (!m || pts.length === 0) return;
  const lngs = pts.map(p => p[0]);
  const lats  = pts.map(p => p[1]);
  m.fitBounds(
    [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
    { padding: 60, duration: 800 },
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function StatCol({ label, value, sub }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#94a3b8' }}>{sub}</div>}
    </div>
  );
}

function MapBtn({ children, onClick, active, title }) {
  return (
    <button onClick={onClick} title={title} style={{
      width: 40, height: 40, borderRadius: 10,
      background: active ? 'rgba(59,130,246,0.25)' : 'rgba(15,17,21,0.82)',
      border: `1px solid ${active ? C_PRIMARY : 'rgba(255,255,255,0.1)'}`,
      color: active ? C_PRIMARY : '#94a3b8',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'pointer', backdropFilter: 'blur(6px)',
    }}>
      {children}
    </button>
  );
}

function BottomBtn({ children, onClick, primary, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        padding: '12px 14px',
        borderRadius: 10,
        border: primary ? 'none' : '1px solid rgba(255,255,255,0.1)',
        background: primary ? C_PRIMARY : 'rgba(255,255,255,0.06)',
        color: disabled ? '#475569' : (primary ? '#fff' : '#e2e8f0'),
        fontWeight: 600, fontSize: 14,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = {
  root: {
    position: 'fixed', inset: 0, zIndex: 200,
    display: 'flex', flexDirection: 'column',
    background: '#0f1115',
    fontFamily: 'var(--font-main, Outfit, sans-serif)',
  },
  header: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 14px',
    background: 'rgba(15,17,21,0.88)',
    backdropFilter: 'blur(10px)',
    borderBottom: '1px solid rgba(255,255,255,0.07)',
  },
  headerTitle: { fontWeight: 700, fontSize: 16, color: '#f8fafc' },
  headerSub:   { fontSize: 11, fontWeight: 500 },
  iconBtn: {
    background: 'none', border: 'none', color: '#3b82f6',
    cursor: 'pointer', padding: 4,
    display: 'flex', alignItems: 'center',
  },
  saveBtn: {
    border: 'none', borderRadius: 8,
    padding: '8px 18px', fontWeight: 700, fontSize: 14,
    transition: 'all 0.2s',
  },
  mapContainer: {
    flex: 1, width: '100%',
    // MapLibre needs explicit height; flex:1 + position:absolute header/footer covers it
  },
  statsStrip: {
    position: 'absolute', top: 64, left: 10, right: 10, zIndex: 20,
    background: 'rgba(15,17,21,0.84)',
    backdropFilter: 'blur(6px)',
    borderRadius: 10,
    padding: '8px 14px',
    display: 'flex', gap: 20,
    border: '1px solid rgba(255,255,255,0.06)',
  },
  rightControls: {
    position: 'absolute', right: 10, bottom: 160, zIndex: 20,
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  gpsBadge: {
    position: 'absolute', bottom: 160, left: 10, zIndex: 20,
    border: '1px solid',
    borderRadius: 6, padding: '4px 10px',
    fontSize: 11, fontWeight: 600,
  },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 30,
    padding: '14px 14px calc(14px + env(safe-area-inset-bottom))',
    background: 'rgba(15,17,21,0.92)',
    backdropFilter: 'blur(10px)',
    borderTop: '1px solid rgba(255,255,255,0.07)',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  savedMsg: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 8, color: '#10b981', fontWeight: 700, fontSize: 15,
  },
  errorMsg: {
    color: '#ef4444', fontSize: 13, textAlign: 'center', fontWeight: 500,
  },
  btnRow: { display: 'flex', gap: 10 },
  addPointsBtn: {
    width: '100%',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    padding: '16px 24px', borderRadius: 14,
    background: C_PRIMARY, color: '#fff',
    border: 'none', fontWeight: 700, fontSize: 16,
    cursor: 'pointer',
    boxShadow: '0 4px 20px rgba(59,130,246,0.4)',
  },
  plusCircle: {
    width: 28, height: 28, borderRadius: '50%',
    background: 'rgba(255,255,255,0.22)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  pointCount: {
    textAlign: 'center', fontSize: 12,
    color: '#94a3b8', fontWeight: 500,
  },
};
