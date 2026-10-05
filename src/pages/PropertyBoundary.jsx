/**
 * PropertyBoundary.jsx — Leaflet implementation
 *
 * WHY LEAFLET INSTEAD OF MAPLIBRE:
 *   MapLibre GL JS (via `import * as`) has an ESM/Vite interop problem where
 *   map.on('click') silently fails on some mobile browsers because of how the
 *   canvas touch-action is configured versus what Vite's module bundler exports.
 *
 *   Leaflet's L.Map.on('click') fires reliably on both desktop mouse and mobile
 *   touch (it internally normalises touchend → click after debouncing pan gestures)
 *   and its layer primitives (L.circleMarker, L.polyline, L.polygon) are
 *   guaranteed to render at geographic coordinates.
 *
 * RENDERING PIPELINE (the only correct way):
 *   User tap
 *   → Leaflet 'click' event fires with {latlng: {lat, lng}}
 *   → addPoint([lng, lat]) called immediately
 *   → drawCoordsRef.current updated (avoids stale closure)
 *   → React coords state updated (triggers re-render for UI)
 *   → updateLeafletLayers(newCoords) called immediately (no re-render wait)
 *     → L.circleMarker added for each vertex
 *     → L.polyline drawn through all vertices (+ closing segment if ≥3)
 *     → L.polygon fill shown if ≥3 vertices
 *   → All layers move/scale correctly on pan and zoom (geographic coordinates)
 *
 * COORDINATE ORDER:
 *   GPS:          lat, lng  (standard geographic)
 *   Leaflet:      [lat, lng] for L.* primitives
 *   Internal state & GeoJSON: [lng, lat] (GeoJSON spec)
 *   Conversion:   L.LatLng.lat → stored as coord[1], .lng → coord[0]
 */

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  ArrowLeft, Plus, Minus, Undo2, Trash2, Save,
  Layers, Navigation2, CheckCircle2,
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

// ─── Tile layers ───────────────────────────────────────────────────────────────
const SATELLITE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const LABELS_URL    = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

// ─── Visual style constants ────────────────────────────────────────────────────
const C_PRIMARY = '#3b82f6';
const C_VERTEX  = '#ffffff';
const C_FILL_OP = 0.20;

// ─── Component ────────────────────────────────────────────────────────────────
export default function PropertyBoundary({
  inspectionId,
  propertyId,
  propertyAreaAcres,
  onSave,
  onCancel,
}) {
  const { user } = useAuth();

  // DOM
  const mapContainer = useRef(null);

  // Leaflet instances
  const mapRef        = useRef(null);   // L.Map
  const satLayer      = useRef(null);
  const labelLayer    = useRef(null);
  const gpsMarker     = useRef(null);
  const watchId       = useRef(null);

  // Boundary Leaflet layers – rebuilt on every coords change
  const layerGroup    = useRef(null);   // L.LayerGroup holding all boundary layers

  // State
  // drawCoordsRef always matches coords – used inside Leaflet callbacks to avoid stale closure
  const drawCoordsRef = useRef([]);
  const [coords, setCoords]                   = useState([]);
  const modeRef       = useRef('normal');      // 'normal' | 'drawing' | 'saved'
  const [mode, setMode]                       = useState('normal');
  const [savedBoundary, setSavedBoundary]     = useState(null);
  const [isSaving, setIsSaving]               = useState(false);
  const [saveError, setSaveError]             = useState(null);
  const [showLabels, setShowLabels]           = useState(false);
  const [gpsAccuracy, setGpsAccuracy]         = useState(null);
  const [gpsWarning, setGpsWarning]           = useState(false);

  const hasPolygon  = coords.length >= 3;
  const areaMetrics = hasPolygon ? areaFromM2(calcPolygonAreaM2(coords)) : null;
  const perimeterM  = hasPolygon ? Math.round(calcPerimeterM(coords)) : 0;

  // ─── Keep modeRef in sync ───────────────────────────────────────────────────
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // ─── Render boundary layers into Leaflet ────────────────────────────────────
  // Called every time coords changes — immediately, synchronously.
  // All Leaflet primitives work on [lat, lng] arrays.
  const updateLeafletLayers = (pts) => {
    const m = mapRef.current;
    if (!m) return;

    // Clear previous boundary layers
    if (layerGroup.current) {
      layerGroup.current.clearLayers();
    } else {
      layerGroup.current = L.layerGroup().addTo(m);
    }

    if (pts.length === 0) return;

    // Convert [lng, lat] → [lat, lng] for Leaflet
    const llPts = pts.map(c => [c[1], c[0]]);

    // 1. Polygon fill (only when ≥ 3 points)
    if (pts.length >= 3) {
      L.polygon(llPts, {
        color: C_PRIMARY,
        weight: 2.5,
        fillColor: C_PRIMARY,
        fillOpacity: C_FILL_OP,
        interactive: false,
      }).addTo(layerGroup.current);
    }

    // 2. Polyline through all vertices (closes the ring if ≥ 3)
    if (pts.length >= 2) {
      const linePoints = pts.length >= 3 ? [...llPts, llPts[0]] : llPts;
      L.polyline(linePoints, {
        color: C_PRIMARY,
        weight: 2.5,
        interactive: false,
      }).addTo(layerGroup.current);
    }

    // 3. Vertex circles — drawn LAST so they appear on top
    llPts.forEach((ll, i) => {
      L.circleMarker(ll, {
        radius: 8,
        color: C_PRIMARY,
        weight: 2.5,
        fillColor: C_VERTEX,
        fillOpacity: 1,
        interactive: false,
      }).addTo(layerGroup.current);
    });
  };

  // ─── Add a boundary point ───────────────────────────────────────────────────
  const addPoint = (latlng) => {
    // latlng from Leaflet event: {lat, lng}
    const newPt = [latlng.lng, latlng.lat]; // store as [lng, lat] (GeoJSON order)
    const next  = [...drawCoordsRef.current, newPt];
    drawCoordsRef.current = next;
    setCoords(next);           // update React state for UI
    updateLeafletLayers(next); // update Leaflet immediately (no re-render wait)
  };

  // ─── Undo / Reset ───────────────────────────────────────────────────────────
  const undoLast = () => {
    const next = drawCoordsRef.current.slice(0, -1);
    drawCoordsRef.current = next;
    setCoords(next);
    updateLeafletLayers(next);
  };

  const resetBoundary = () => {
    drawCoordsRef.current = [];
    setCoords([]);
    updateLeafletLayers([]);
    setMode('drawing');
    setSaveError(null);
  };

  // ─── Init Leaflet map (once) ────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current) return;

    // Leaflet needs the container to have a non-zero height before init.
    // Since our container is flex:1 inside a fixed-position root, it should
    // already have height by the time this effect runs (after first paint).
    const m = L.map(mapContainer.current, {
      center: [13.0827, 80.2707],
      zoom: 17,
      zoomControl: false,         // we have our own buttons
      attributionControl: true,
    });

    // Satellite base layer
    satLayer.current = L.tileLayer(SATELLITE_URL, {
      attribution: '© Esri',
      maxZoom: 19,
    }).addTo(m);

    // OSM labels layer (starts hidden)
    labelLayer.current = L.tileLayer(LABELS_URL, {
      attribution: '© OSM',
      maxZoom: 19,
      opacity: 0,
    }).addTo(m);

    // Boundary layer group
    layerGroup.current = L.layerGroup().addTo(m);

    // ── MAP CLICK → add boundary point ──────────────────────────────────────
    m.on('click', (e) => {
      if (modeRef.current !== 'drawing') return;
      // e.latlng is Leaflet's LatLng object with .lat and .lng
      addPoint(e.latlng);
    });

    mapRef.current = m;

    // ── GPS watch ──────────────────────────────────────────────────────────
    if ('geolocation' in navigator) {
      watchId.current = navigator.geolocation.watchPosition(
        ({ coords: pos }) => {
          const { latitude, longitude, accuracy } = pos;
          setGpsAccuracy(Math.round(accuracy));
          setGpsWarning(accuracy > 30);

          if (!gpsMarker.current) {
            // First GPS fix — fly to it
            m.setView([latitude, longitude], 18, { animate: true });

            // Custom GPS dot
            const icon = L.divIcon({
              className: '',
              html: `<div style="
                width:20px;height:20px;border-radius:50%;
                background:${C_PRIMARY};border:3px solid white;
                box-shadow:0 0 0 6px rgba(59,130,246,0.25);
                pointer-events:none;
              "></div>`,
              iconSize: [20, 20],
              iconAnchor: [10, 10],
            });
            gpsMarker.current = L.marker([latitude, longitude], { icon, interactive: false }).addTo(m);
          } else {
            gpsMarker.current.setLatLng([latitude, longitude]);
          }
        },
        () => setGpsWarning(true),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
      );
    } else {
      setGpsWarning(true);
    }

    return () => {
      if (watchId.current) navigator.geolocation.clearWatch(watchId.current);
      m.remove();
      mapRef.current    = null;
      layerGroup.current = null;
      gpsMarker.current  = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Load existing boundary from IndexedDB ────────────────────────────────
  useEffect(() => {
    (async () => {
      const existing = await BoundaryRepository.getBoundaryForInspection(inspectionId);
      if (existing?.coordinates?.length >= 3) {
        setSavedBoundary(existing);
        drawCoordsRef.current = existing.coordinates;
        setCoords(existing.coordinates);
        setMode('saved');

        // Wait for Leaflet to be ready
        const tryRender = () => {
          if (mapRef.current) {
            updateLeafletLayers(existing.coordinates);
            // Fit map to polygon
            const llPts = existing.coordinates.map(c => [c[1], c[0]]);
            mapRef.current.fitBounds(L.latLngBounds(llPts), { padding: [60, 60] });
          } else {
            setTimeout(tryRender, 100);
          }
        };
        tryRender();
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectionId]);

  // ─── Layer / control helpers ─────────────────────────────────────────────
  const toggleLabels = () => {
    const next = !showLabels;
    labelLayer.current?.setOpacity(next ? 0.45 : 0);
    setShowLabels(next);
  };
  const zoomIn  = () => mapRef.current?.zoomIn();
  const zoomOut = () => mapRef.current?.zoomOut();
  const centreGPS = () => {
    if (gpsMarker.current && mapRef.current) {
      mapRef.current.setView(gpsMarker.current.getLatLng(), 18, { animate: true });
    }
  };

  // ─── Save ────────────────────────────────────────────────────────────────
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
        inspectionId, propertyId, supervisorId,
        coords: pts, captureMode: 'manual', gpsAccuracyM: gpsAccuracy,
        existingId: savedBoundary?.id || null,
      });
      const saved = await BoundaryRepository.saveBoundary(record);
      setSavedBoundary(saved);
      setMode('saved');
      // Polygon remains visible — layers unchanged
      updateLeafletLayers(pts);
      if (onSave) onSave(saved);
    } catch (err) {
      console.error('[PropertyBoundary] save error:', err);
      setSaveError('Failed to save boundary. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={S.root}>
      {/* Header */}
      <header style={S.header}>
        <button style={S.iconBtn} onClick={onCancel}><ArrowLeft size={22}/></button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={S.title}>Property Boundary</div>
          <div style={{ fontSize: 11, fontWeight: 600, color: mode === 'drawing' ? '#f59e0b' : mode === 'saved' ? '#10b981' : '#94a3b8' }}>
            {mode === 'drawing' ? '● Drawing Mode — tap map to add points' : mode === 'saved' ? '✓ Saved' : 'Tap + to begin'}
          </div>
        </div>
        <button
          style={{ ...S.saveBtn, background: (hasPolygon && mode !== 'saved') ? C_PRIMARY : 'rgba(59,130,246,0.15)', color: (hasPolygon && mode !== 'saved') ? '#fff' : '#475569', cursor: (hasPolygon && mode !== 'saved') ? 'pointer' : 'default' }}
          onClick={handleSave}
          disabled={!hasPolygon || isSaving || mode === 'saved'}
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </header>

      {/* Map — must have explicit pixel height so Leaflet can render */}
      <div
        ref={mapContainer}
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          // cursor shows drawing state
          cursor: mode === 'drawing' ? 'crosshair' : 'grab',
        }}
      />

      {/* Stats strip */}
      {hasPolygon && (
        <div style={S.stats}>
          {propertyAreaAcres && <StatCol label="Planned Area" value={`${propertyAreaAcres} ac`}/>}
          <StatCol label="Captured Area" value={`${areaMetrics.acres} ac`} sub={`${areaMetrics.sq_ft.toLocaleString()} sq.ft · ${areaMetrics.cents} cents`}/>
          <StatCol label="Perimeter" value={formatPerimeter(perimeterM)}/>
        </div>
      )}

      {/* Right controls */}
      <div style={S.rightControls}>
        <MapBtn title="Labels" active={showLabels} onClick={toggleLabels}><Layers size={17}/></MapBtn>
        <MapBtn title="My location" onClick={centreGPS}><Navigation2 size={17}/></MapBtn>
        <MapBtn title="Zoom in" onClick={zoomIn}><Plus size={17}/></MapBtn>
        <MapBtn title="Zoom out" onClick={zoomOut}><Minus size={17}/></MapBtn>
      </div>

      {/* GPS badge */}
      {gpsAccuracy !== null && (
        <div style={{ ...S.gpsBadge, borderColor: gpsWarning ? '#f59e0b' : '#10b981', color: gpsWarning ? '#f59e0b' : '#10b981', background: gpsWarning ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.1)' }}>
          GPS ±{gpsAccuracy} m
        </div>
      )}

      {/* Bottom bar */}
      <div style={S.bottomBar}>
        {saveError && <div style={S.error}>{saveError}</div>}

        {mode === 'saved' && (
          <>
            <div style={S.savedMsg}><CheckCircle2 size={20} color="#10b981"/><span>Boundary Saved Locally</span></div>
            <div style={S.row}>
              <Btn onClick={resetBoundary}><Trash2 size={15}/> Redraw</Btn>
              <Btn primary onClick={onCancel}>Done</Btn>
            </div>
          </>
        )}

        {mode === 'drawing' && (
          <>
            <div style={S.row}>
              <Btn onClick={undoLast} disabled={coords.length === 0}><Undo2 size={15}/> Undo</Btn>
              <Btn onClick={resetBoundary}><Trash2 size={15}/> Clear</Btn>
              {hasPolygon && <Btn primary onClick={handleSave}><Save size={15}/> Save</Btn>}
            </div>
            {coords.length > 0 && (
              <div style={S.pointCount}>{coords.length} point{coords.length !== 1 ? 's' : ''} — tap map to add more</div>
            )}
          </>
        )}

        {mode === 'normal' && (
          <button style={S.addBtn} onClick={() => { setMode('drawing'); setSaveError(null); }}>
            <span style={S.plusCircle}><Plus size={20}/></span>
            Add Boundary Points
          </button>
        )}
      </div>
    </div>
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
    <button onClick={onClick} title={title} style={{ width: 40, height: 40, borderRadius: 10, background: active ? 'rgba(59,130,246,0.25)' : 'rgba(15,17,21,0.82)', border: `1px solid ${active ? '#3b82f6' : 'rgba(255,255,255,0.1)'}`, color: active ? '#3b82f6' : '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', backdropFilter: 'blur(6px)' }}>
      {children}
    </button>
  );
}

function Btn({ children, onClick, primary, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '12px 14px', borderRadius: 10, border: primary ? 'none' : '1px solid rgba(255,255,255,0.1)', background: primary ? '#3b82f6' : 'rgba(255,255,255,0.06)', color: disabled ? '#475569' : (primary ? '#fff' : '#e2e8f0'), fontWeight: 600, fontSize: 14, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      {children}
    </button>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  root:         { position: 'fixed', inset: 0, zIndex: 200, background: '#0f1115', fontFamily: 'var(--font-main, Outfit, sans-serif)' },
  header:       { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'rgba(15,17,21,0.88)', backdropFilter: 'blur(10px)', borderBottom: '1px solid rgba(255,255,255,0.07)' },
  title:        { fontWeight: 700, fontSize: 16, color: '#f8fafc' },
  iconBtn:      { background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', zIndex: 600 },
  saveBtn:      { border: 'none', borderRadius: 8, padding: '8px 18px', fontWeight: 700, fontSize: 14, zIndex: 600 },
  stats:        { position: 'absolute', top: 64, left: 10, right: 10, zIndex: 400, background: 'rgba(15,17,21,0.84)', backdropFilter: 'blur(6px)', borderRadius: 10, padding: '8px 14px', display: 'flex', gap: 20, border: '1px solid rgba(255,255,255,0.06)', pointerEvents: 'none' },
  rightControls:{ position: 'absolute', right: 10, bottom: 160, zIndex: 400, display: 'flex', flexDirection: 'column', gap: 8 },
  gpsBadge:     { position: 'absolute', bottom: 160, left: 10, zIndex: 400, border: '1px solid', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, pointerEvents: 'none' },
  bottomBar:    { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 500, padding: '14px 14px calc(14px + env(safe-area-inset-bottom))', background: 'rgba(15,17,21,0.92)', backdropFilter: 'blur(10px)', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', gap: 10 },
  savedMsg:     { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#10b981', fontWeight: 700, fontSize: 15 },
  error:        { color: '#ef4444', fontSize: 13, textAlign: 'center', fontWeight: 500 },
  row:          { display: 'flex', gap: 10 },
  addBtn:       { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '16px 24px', borderRadius: 14, background: '#3b82f6', color: '#fff', border: 'none', fontWeight: 700, fontSize: 16, cursor: 'pointer', boxShadow: '0 4px 20px rgba(59,130,246,0.4)' },
  plusCircle:   { width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  pointCount:   { textAlign: 'center', fontSize: 12, color: '#94a3b8', fontWeight: 500 },
};
