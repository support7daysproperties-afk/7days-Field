/**
 * PropertyBoundary.jsx — Crosshair / Target-based boundary marking
 *
 * INTERACTION MODEL (DJI SmartFarm style):
 *   1. Satellite map opens with fixed crosshair at center
 *   2. User PANS/ZOOMS the map freely — no points created from panning
 *   3. User aligns property corner under the fixed crosshair
 *   4. User presses "+ Add Point" → map.getCenter() → new vertex
 *   5. Vertex immediately rendered, line connects to previous vertex
 *   6. User pans to next corner → "Add Point" → repeat
 *   7. "Complete Boundary" closes the polygon with fill
 *   8. Edit mode: draggable vertices + midpoint insertion
 *   9. Save → BoundaryRepository (IndexedDB, offline-first)
 *  10. Reopening restores exact polygon
 *
 * MAP LIBRARY: Leaflet
 *   - L.circleMarker for vertices
 *   - L.polyline for open boundary line (drawing)
 *   - L.polygon for closed filled boundary (completed)
 *   - L.marker (draggable) for vertex editing
 *   - L.circleMarker (interactive) for midpoint insertion
 *   - map.getCenter() for crosshair coordinate
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { toPng } from 'html-to-image';
import {
  ArrowLeft, Plus, Minus, Navigation2, Layers,
  Undo2, Trash2, Save, CheckCircle2, Check,
  MapPin, Edit3, X,
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

// ── Tile URLs ──────────────────────────────────────────────────────────────────
const ESRI_SAT  = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

// ── Visual constants ───────────────────────────────────────────────────────────
const C_BLUE    = '#3b82f6';
const C_WHITE   = '#ffffff';
const C_FILL_OP = 0.18;
const C_LINE_W  = 2.5;
const V_RADIUS  = 7;   // vertex radius px
const MID_RADIUS= 5;   // midpoint radius px

// ── Helpers ────────────────────────────────────────────────────────────────────
// Convert our stored [lng, lat] → Leaflet [lat, lng]
const ll = (c) => [c[1], c[0]];
const llAll = (cs) => cs.map(ll);

function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

// ── Component ──────────────────────────────────────────────────────────────────
export default function PropertyBoundary({
  inspectionId,
  propertyId,
  propertyAreaAcres,
  onSave,
  onCancel,
}) {
  const { user } = useAuth();

  // DOM
  const mapEl = useRef(null);

  // Leaflet instances
  const mapRef       = useRef(null);
  const satLayerRef  = useRef(null);
  const osmLayerRef  = useRef(null);
  const gpsMarkerRef = useRef(null);
  const gpsWatchRef  = useRef(null);
  const layerGrp     = useRef(null);   // all boundary layers live here

  // Coords: stored as [lng, lat] pairs (GeoJSON order)
  // drawCoordsRef stays in sync with coords; used inside Leaflet callbacks to avoid stale closure
  const drawCoordsRef = useRef([]);
  const [coords, setCoords]             = useState([]);

  // mode: 'drawing' | 'completed' | 'saved' | 'editing'
  const modeRef = useRef('drawing');
  const [mode, setMode]                 = useState('drawing');

  const [savedBoundary, setSavedBoundary] = useState(null);
  const [isSaving, setIsSaving]           = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [saveError, setSaveError]         = useState(null);
  const [showLabels, setShowLabels]       = useState(false);
  const [gpsAccuracy, setGpsAccuracy]     = useState(null);
  const [gpsWarning, setGpsWarning]       = useState(false);
  const [toast, setToast]                 = useState('');   // temporary feedback
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Derived metrics
  const hasPolygon  = coords.length >= 3;
  const areaMetrics = hasPolygon ? areaFromM2(calcPolygonAreaM2(coords)) : null;
  const perimeterM  = hasPolygon ? Math.round(calcPerimeterM(coords)) : 0;

  // ── Keep modeRef in sync ──────────────────────────────────────────────────────
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // ── Toast helper ──────────────────────────────────────────────────────────────
  const showToast = useCallback((msg, duration = 1800) => {
    setToast(msg);
    setTimeout(() => setToast(''), duration);
  }, []);

  // ── Leaflet layer rebuild ─────────────────────────────────────────────────────
  // Called synchronously after every state change. Never waits for React re-render.
  const renderLayers = useCallback((pts, currentMode) => {
    const m = mapRef.current;
    if (!m) return;

    // Clear existing boundary layers
    if (layerGrp.current) {
      layerGrp.current.clearLayers();
    } else {
      layerGrp.current = L.layerGroup().addTo(m);
    }

    if (pts.length === 0) return;

    const llPts = llAll(pts);
    const isCompleted = currentMode === 'completed' || currentMode === 'saved' || currentMode === 'editing';

    // 1. Polygon fill (only when completed)
    if (isCompleted && pts.length >= 3) {
      L.polygon(llPts, {
        color: C_BLUE,
        weight: C_LINE_W,
        fillColor: C_BLUE,
        fillOpacity: C_FILL_OP,
        interactive: false,
      }).addTo(layerGrp.current);
    }

    // 2. Open polyline during drawing OR closed outline during completed
    if (pts.length >= 2) {
      const lineCoords = isCompleted && pts.length >= 3 ? [...llPts, llPts[0]] : llPts;
      L.polyline(lineCoords, {
        color: C_BLUE,
        weight: C_LINE_W,
        interactive: false,
      }).addTo(layerGrp.current);
    }

    // 3. Vertices
    if (currentMode === 'editing') {
      // Draggable marker vertices
      pts.forEach((c, idx) => {
        const icon = L.divIcon({
          className: '',
          html: `<div style="
            width:${V_RADIUS * 2}px;height:${V_RADIUS * 2}px;
            border-radius:50%;background:${C_WHITE};
            border:2.5px solid ${C_BLUE};
            box-sizing:border-box;cursor:move;
            box-shadow:0 1px 4px rgba(0,0,0,0.4);
          "></div>`,
          iconSize: [V_RADIUS * 2, V_RADIUS * 2],
          iconAnchor: [V_RADIUS, V_RADIUS],
        });
        const marker = L.marker(ll(c), { icon, draggable: true, zIndexOffset: 500 });
        marker.on('drag', (e) => {
          const pos = e.target.getLatLng();
          const next = [...drawCoordsRef.current];
          next[idx] = [pos.lng, pos.lat];
          drawCoordsRef.current = next;
          setCoords([...next]);
          renderLayers(next, 'editing');
        });
        marker.addTo(layerGrp.current);
      });

      // Midpoint markers for inserting a new vertex between two existing ones
      if (pts.length >= 2) {
        pts.forEach((c, idx) => {
          const nextIdx = (idx + 1) % pts.length;
          const c2 = pts[nextIdx];
          const midLng = (c[0] + c2[0]) / 2;
          const midLat = (c[1] + c2[1]) / 2;

          const mid = L.circleMarker([midLat, midLng], {
            radius: MID_RADIUS,
            color: C_BLUE,
            weight: 2,
            fillColor: C_WHITE,
            fillOpacity: 0.85,
            interactive: true,
            className: 'mid-handle',
          });
          mid.on('click', () => {
            // Insert new vertex AFTER idx
            const insertAt = idx + 1;
            const next = [
              ...drawCoordsRef.current.slice(0, insertAt),
              [midLng, midLat],
              ...drawCoordsRef.current.slice(insertAt),
            ];
            drawCoordsRef.current = next;
            setCoords([...next]);
            renderLayers(next, 'editing');
            showToast(`Point inserted`);
          });
          mid.addTo(layerGrp.current);
        });
      }
    } else {
      // Static vertex circles
      llPts.forEach((latlng, idx) => {
        L.circleMarker(latlng, {
          radius: V_RADIUS,
          color: C_BLUE,
          weight: 2.5,
          fillColor: C_WHITE,
          fillOpacity: 1,
          interactive: false,
        }).addTo(layerGrp.current);
      });
    }
  }, [showToast]);

  // ── Set coords + update layers atomically ─────────────────────────────────────
  const applyCoords = useCallback((next, currentMode) => {
    drawCoordsRef.current = next;
    setCoords([...next]);
    renderLayers(next, currentMode ?? modeRef.current);
  }, [renderLayers]);

  // ── Add Point (reads crosshair = map center) ──────────────────────────────────
  const addPoint = useCallback(() => {
    if (!mapRef.current) return;
    const center = mapRef.current.getCenter(); // geographic center under crosshair
    const newPt  = [center.lng, center.lat];   // GeoJSON order
    const next   = [...drawCoordsRef.current, newPt];
    applyCoords(next, 'drawing');
    showToast(`Point ${next.length} added`);
  }, [applyCoords, showToast]);

  // ── Undo ──────────────────────────────────────────────────────────────────────
  const undoLast = useCallback(() => {
    if (drawCoordsRef.current.length === 0) return;
    const next = drawCoordsRef.current.slice(0, -1);
    applyCoords(next, 'drawing');
    setMode('drawing');
    showToast('Last point removed');
  }, [applyCoords, showToast]);

  // ── Complete boundary ─────────────────────────────────────────────────────────
  const completeBoundary = useCallback(() => {
    if (drawCoordsRef.current.length < 3) return;
    setMode('completed');
    renderLayers(drawCoordsRef.current, 'completed');
  }, [renderLayers]);

  // ── Clear ─────────────────────────────────────────────────────────────────────
  const clearBoundary = useCallback(() => {
    drawCoordsRef.current = [];
    setCoords([]);
    setMode('drawing');
    setSaveError(null);
    setShowClearConfirm(false);
    renderLayers([], 'drawing');
    showToast('Boundary cleared');
  }, [renderLayers, showToast]);

  // ── Edit mode ─────────────────────────────────────────────────────────────────
  const enterEditMode = useCallback(() => {
    setMode('editing');
    renderLayers(drawCoordsRef.current, 'editing');
  }, [renderLayers]);

  const finishEditing = useCallback(() => {
    setMode('completed');
    renderLayers(drawCoordsRef.current, 'completed');
  }, [renderLayers]);

  // ── Delete vertex (in edit mode) ─────────────────────────────────────────────
  const deleteVertex = useCallback((idx) => {
    const next = drawCoordsRef.current.filter((_, i) => i !== idx);
    applyCoords(next, next.length >= 3 ? 'editing' : 'drawing');
    if (next.length < 3) setMode('drawing');
    showToast('Point deleted');
  }, [applyCoords, showToast]);

  // ── Save ──────────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const pts = drawCoordsRef.current;
    if (pts.length < 3) {
      setSaveError('At least 3 points required.');
      return;
    }
    setIsSaving(true);
    setSnapshotLoading(true);
    setSaveError(null);
    try {
      const supervisorId = user?.supervisorProfile?.id || user?.id;

      // Ensure map is fitted to boundary before snapshot
      if (mapRef.current) {
        const llPts = llAll(pts);
        mapRef.current.fitBounds(L.latLngBounds(llPts), { padding: [50, 50], animate: false });
        // Wait for tiles to load
        await new Promise(r => setTimeout(r, 800));
      }

      // Generate snapshot image
      let snapshotDataUrl = null;
      try {
        if (mapEl.current) {
          snapshotDataUrl = await toPng(mapEl.current, {
            cacheBust: true,
            filter: (node) => {
              if (node?.classList?.contains('leaflet-control-container')) return false;
              return true;
            }
          });
        }
      } catch (err) {
        console.error('[PropertyBoundary] snapshot error:', err);
        // Continue saving even if snapshot fails
      }

      const record = buildBoundaryRecord({
        inspectionId, propertyId, supervisorId,
        coords: pts, captureMode: 'manual',
        gpsAccuracyM: gpsAccuracy,
        existingId: savedBoundary?.id || null,
        snapshotImage: snapshotDataUrl,
      });
      const saved = await BoundaryRepository.saveBoundary(record);
      setSavedBoundary(saved);
      setMode('saved');
      renderLayers(pts, 'saved'); // keep polygon visible
      if (onSave) onSave(saved);
    } catch (err) {
      console.error('[PropertyBoundary] save error:', err);
      setSaveError('Save failed. Boundary is still in memory.');
    } finally {
      setIsSaving(false);
      setSnapshotLoading(false);
    }
  }, [gpsAccuracy, inspectionId, onSave, propertyId, renderLayers, savedBoundary, user]);

  // ── Init Leaflet ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current) return;

    const m = L.map(mapEl.current, {
      center: [13.0827, 80.2707],
      zoom: 17,
      zoomControl: false,
      attributionControl: true,
      // Important: do NOT add click handler for drawing — only "Add Point" button does
    });

    satLayerRef.current = L.tileLayer(ESRI_SAT, {
      attribution: '© Esri',
      maxZoom: 22,
      crossOrigin: true,
    }).addTo(m);

    osmLayerRef.current = L.tileLayer(OSM_TILES, {
      attribution: '© OSM',
      maxZoom: 19,
      opacity: 0,
      crossOrigin: true,
    }).addTo(m);

    layerGrp.current = L.layerGroup().addTo(m);

    // ── GPS watch ──────────────────────────────────────────────────────────────
    if ('geolocation' in navigator) {
      gpsWatchRef.current = navigator.geolocation.watchPosition(
        ({ coords: pos }) => {
          const { latitude, longitude, accuracy } = pos;
          setGpsAccuracy(Math.round(accuracy));
          setGpsWarning(accuracy > 30);

          if (!gpsMarkerRef.current) {
            m.setView([latitude, longitude], 18, { animate: true });
            const gpsIcon = L.divIcon({
              className: '',
              html: `<div style="
                width:18px;height:18px;border-radius:50%;
                background:#3b82f6;border:3px solid white;
                box-shadow:0 0 0 6px rgba(59,130,246,0.22);
                pointer-events:none;
              "></div>`,
              iconSize: [18, 18],
              iconAnchor: [9, 9],
            });
            gpsMarkerRef.current = L.marker([latitude, longitude], {
              icon: gpsIcon,
              interactive: false,
              zIndexOffset: 800,
            }).addTo(m);
          } else {
            gpsMarkerRef.current.setLatLng([latitude, longitude]);
          }
        },
        () => setGpsWarning(true),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
      );
    } else {
      setGpsWarning(true);
    }

    mapRef.current = m;

    return () => {
      if (gpsWatchRef.current) navigator.geolocation.clearWatch(gpsWatchRef.current);
      m.remove();
      mapRef.current = null;
      layerGrp.current = null;
      gpsMarkerRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load existing boundary from IndexedDB ─────────────────────────────────────
  useEffect(() => {
    (async () => {
      const existing = await BoundaryRepository.getBoundaryForInspection(inspectionId);
      if (existing?.coordinates?.length >= 3) {
        setSavedBoundary(existing);
        drawCoordsRef.current = existing.coordinates;
        setCoords(existing.coordinates);
        setMode('saved');

        const tryRender = () => {
          if (mapRef.current) {
            renderLayers(existing.coordinates, 'saved');
            const llPts = llAll(existing.coordinates);
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

  // ── Map helpers ───────────────────────────────────────────────────────────────
  const zoomIn  = () => mapRef.current?.zoomIn();
  const zoomOut = () => mapRef.current?.zoomOut();

  const goToGPS = () => {
    if (gpsMarkerRef.current && mapRef.current) {
      mapRef.current.setView(gpsMarkerRef.current.getLatLng(), 18, { animate: true });
    }
  };

  const toggleLabels = () => {
    const next = !showLabels;
    osmLayerRef.current?.setOpacity(next ? 0.45 : 0);
    setShowLabels(next);
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  const isDrawing   = mode === 'drawing';
  const isCompleted = mode === 'completed';
  const isSaved     = mode === 'saved';
  const isEditing   = mode === 'editing';

  return (
    <div style={S.root}>
      {/* ── Header ── */}
      <header style={S.header}>
        <button style={S.iconBtn} onClick={onCancel} aria-label="Back">
          <ArrowLeft size={22} />
        </button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={S.headerTitle}>Property Boundary</div>
          <div style={{
            fontSize: 11, fontWeight: 600,
            color: isEditing ? '#f59e0b' : isCompleted ? '#10b981' : isSaved ? '#10b981' : '#94a3b8',
          }}>
            {isEditing   ? '✎ Editing — drag vertices'
             : isCompleted ? '✓ Boundary complete'
             : isSaved    ? '✓ Saved locally'
             : coords.length === 0
               ? 'Pan map · align crosshair · Add Point'
               : `${coords.length} point${coords.length !== 1 ? 's' : ''} — keep adding`}
          </div>
        </div>
        {/* Save button in header (compact) */}
        {(isCompleted || isEditing) && (
          <button
            style={{ ...S.headerSaveBtn, opacity: isSaving ? 0.6 : 1 }}
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? '…' : <Check size={18} />}
          </button>
        )}
        {(isSaved) && (
          <div style={{ ...S.headerSaveBtn, background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>
            <Check size={18} />
          </div>
        )}
        {(!isCompleted && !isEditing && !isSaved) && <div style={{ width: 40 }} />}
      </header>

      {/* ── Map ── */}
      <div
        ref={mapEl}
        style={{
          position: 'absolute', inset: 0,
          cursor: isEditing ? 'default' : 'grab',
        }}
      />

      {/* ── Fixed crosshair (only while drawing or adding points) ── */}
      {(isDrawing || isCompleted) && (
        <div style={S.crosshairWrap} aria-hidden="true">
          <svg width="48" height="48" viewBox="0 0 48 48" style={{ display: 'block' }}>
            {/* Outer circle */}
            <circle cx="24" cy="24" r="10" fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth="3"/>
            <circle cx="24" cy="24" r="10" fill="none" stroke={C_WHITE} strokeWidth="2"/>
            {/* Cross lines */}
            {/* top */}
            <line x1="24" y1="4"  x2="24" y2="12" stroke="rgba(0,0,0,0.5)" strokeWidth="3"/>
            <line x1="24" y1="4"  x2="24" y2="12" stroke={C_WHITE} strokeWidth="2"/>
            {/* bottom */}
            <line x1="24" y1="36" x2="24" y2="44" stroke="rgba(0,0,0,0.5)" strokeWidth="3"/>
            <line x1="24" y1="36" x2="24" y2="44" stroke={C_WHITE} strokeWidth="2"/>
            {/* left */}
            <line x1="4"  y1="24" x2="12" y2="24" stroke="rgba(0,0,0,0.5)" strokeWidth="3"/>
            <line x1="4"  y1="24" x2="12" y2="24" stroke={C_WHITE} strokeWidth="2"/>
            {/* right */}
            <line x1="36" y1="24" x2="44" y2="24" stroke="rgba(0,0,0,0.5)" strokeWidth="3"/>
            <line x1="36" y1="24" x2="44" y2="24" stroke={C_WHITE} strokeWidth="2"/>
            {/* Center dot */}
            <circle cx="24" cy="24" r="2.5" fill={C_WHITE} stroke="rgba(0,0,0,0.4)" strokeWidth="1"/>
          </svg>
        </div>
      )}

      {/* ── Stats panel ── */}
      {coords.length > 0 && (
        <div style={S.stats}>
          <StatItem label="Points" value={coords.length} />
          {propertyAreaAcres && <StatItem label="Planned" value={`${propertyAreaAcres} ac`}/>}
          {areaMetrics && <StatItem label="Area" value={`${areaMetrics.acres} ac`} sub={`${areaMetrics.sq_ft.toLocaleString()} ft² · ${areaMetrics.cents}¢`}/>}
          {perimeterM > 0 && <StatItem label="Perimeter" value={formatPerimeter(perimeterM)}/>}
        </div>
      )}

      {/* ── Right controls ── */}
      <div style={S.rightControls}>
        <MapBtn title="Labels" active={showLabels} onClick={toggleLabels}><Layers size={16}/></MapBtn>
        <MapBtn title="My location" onClick={goToGPS}><Navigation2 size={16}/></MapBtn>
        <MapBtn title="Zoom in"  onClick={zoomIn}><Plus size={16}/></MapBtn>
        <MapBtn title="Zoom out" onClick={zoomOut}><Minus size={16}/></MapBtn>
      </div>

      {/* ── GPS badge ── */}
      {gpsAccuracy !== null && (
        <div style={{ ...S.gpsBadge, borderColor: gpsWarning ? '#f59e0b' : '#10b981', color: gpsWarning ? '#f59e0b' : '#10b981', background: gpsWarning ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.1)' }}>
          GPS ±{gpsAccuracy}m
        </div>
      )}

      {/* ── Toast ── */}
      {toast !== '' && (
        <div style={S.toast}>{toast}</div>
      )}

      {/* ── Clear confirm overlay ── */}
      {showClearConfirm && (
        <div style={S.confirmOverlay}>
          <div style={S.confirmBox}>
            <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700 }}>Clear Boundary?</h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: '#94a3b8' }}>
              {savedBoundary
                ? 'This will remove the saved boundary from this screen. The local record will remain until you save a new boundary.'
                : 'All boundary points will be removed.'}
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <Btn onClick={() => setShowClearConfirm(false)}>Cancel</Btn>
              <Btn danger onClick={clearBoundary}>Clear</Btn>
            </div>
          </div>
        </div>
      )}

      {/* ── Snapshot Loading Overlay ── */}
      {snapshotLoading && (
        <div style={S.loadingOverlay}>
          <div style={S.loadingBox}>
            <div style={S.spinner} />
            <div style={{ marginTop: 16, fontWeight: 600, fontSize: 15 }}>Generating boundary map…</div>
          </div>
        </div>
      )}

      {/* ── Saved Full-Screen Overlay ── */}
      {isSaved && !snapshotLoading && (
        <div style={S.savedOverlay}>
          <div style={S.savedContent}>
            <div style={S.savedHeader}>
              <h2 style={{ margin: 0, fontSize: 18 }}>Property Boundary Map</h2>
            </div>
            
            <div style={S.snapshotContainer}>
              {savedBoundary?.snapshot_image ? (
                <img src={savedBoundary.snapshot_image} style={S.snapshotImage} alt="Boundary map snapshot" />
              ) : (
                <div style={S.snapshotPlaceholder}>
                  <div style={{ marginBottom: 12 }}>Map preview couldn't be generated.</div>
                  <Btn onClick={handleSave}>Retry Map Preview</Btn>
                </div>
              )}
            </div>

            <div style={S.savedSuccess}>
              <CheckCircle2 size={24} color="#10b981" style={{ flexShrink: 0 }} />
              <div style={{ fontWeight: 700, fontSize: 18, color: '#10b981' }}>Property Boundary Captured</div>
            </div>

            <div style={S.savedStats}>
              <div style={S.statRow}>
                <span style={S.statLabel}>Area</span>
                <span style={S.statValue}>{savedBoundary?.area_acres} acres</span>
              </div>
              <div style={S.statRow}>
                <span style={S.statLabel}>Perimeter</span>
                <span style={S.statValue}>{savedBoundary?.perimeter_m} m</span>
              </div>
              <div style={S.statRow}>
                <span style={S.statLabel}>Method</span>
                <span style={S.statValue}>{savedBoundary?.capture_mode === 'manual' ? 'Manual' : savedBoundary?.capture_mode}</span>
              </div>
              <div style={S.statRow}>
                <span style={S.statLabel}>Points</span>
                <span style={S.statValue}>{savedBoundary?.coordinates?.length}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 'auto' }}>
              <Btn onClick={enterEditMode}><Edit3 size={16}/> Edit Boundary</Btn>
              <Btn primary onClick={onCancel}>Done</Btn>
            </div>
          </div>
        </div>
      )}

      {/* ── Bottom panel ── */}
      {(!isSaved || snapshotLoading) && (
      <div style={S.bottomBar}>
        {saveError && <div style={S.error}>{saveError}</div>}

        {/* DRAWING */}
        {isDrawing && (
          <>
            <div style={S.row}>
              <Btn
                disabled={coords.length === 0}
                onClick={undoLast}
              >
                <Undo2 size={15}/> Undo
              </Btn>
              <Btn
                disabled={coords.length === 0}
                onClick={() => setShowClearConfirm(true)}
              >
                <Trash2 size={15}/> Clear
              </Btn>
            </div>
            {/* Add Point — primary action */}
            <button style={S.addPointBtn} onClick={addPoint}>
              <span style={S.plusCircle}><Plus size={20}/></span>
              Add Point
            </button>
            {/* Complete — available at 3+ points */}
            {coords.length >= 3 && (
              <button style={S.completeBtn} onClick={completeBoundary}>
                <Check size={16}/> Complete Boundary
              </button>
            )}
          </>
        )}

        {/* COMPLETED */}
        {isCompleted && (
          <>
            <div style={S.row}>
              <Btn onClick={() => { setMode('drawing'); renderLayers(drawCoordsRef.current, 'drawing'); }}>
                <Plus size={15}/> Add More
              </Btn>
              <Btn onClick={enterEditMode}>
                <Edit3 size={15}/> Edit
              </Btn>
              <Btn onClick={() => setShowClearConfirm(true)}>
                <Trash2 size={15}/>
              </Btn>
            </div>
            <button style={S.saveBtn} onClick={handleSave} disabled={isSaving}>
              <Save size={16}/> {isSaving ? 'Saving…' : 'Save Boundary'}
            </button>
          </>
        )}

        {/* EDITING */}
        {isEditing && (
          <>
            <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
              Drag vertices to adjust · Tap midpoint marker to insert
            </div>
            {/* Vertex list for delete */}
            {coords.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {coords.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => deleteVertex(idx)}
                    style={{ padding: '4px 8px', borderRadius: 6, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', fontSize: 12, cursor: 'pointer' }}
                  >
                    ✕ P{idx + 1}
                  </button>
                ))}
              </div>
            )}
            <div style={S.row}>
              <Btn onClick={finishEditing}>
                <Check size={15}/> Done Editing
              </Btn>
              <Btn primary onClick={handleSave} disabled={isSaving}>
                <Save size={15}/> {isSaving ? 'Saving…' : 'Save'}
              </Btn>
            </div>
          </>
        )}
      </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function StatItem({ label, value, sub }) {
  return (
    <div style={{ minWidth: 60 }}>
      <div style={{ fontSize: 9, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc', lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: '#94a3b8' }}>{sub}</div>}
    </div>
  );
}

function MapBtn({ children, onClick, active, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 38, height: 38, borderRadius: 9,
        background: active ? 'rgba(59,130,246,0.22)' : 'rgba(15,17,21,0.82)',
        border: `1px solid ${active ? '#3b82f6' : 'rgba(255,255,255,0.1)'}`,
        color: active ? '#3b82f6' : '#94a3b8',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', backdropFilter: 'blur(6px)',
      }}
    >
      {children}
    </button>
  );
}

function Btn({ children, onClick, primary, danger, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        padding: '11px 12px',
        borderRadius: 10,
        border: 'none',
        background: primary  ? '#3b82f6'
                  : danger   ? 'rgba(239,68,68,0.12)'
                  :            'rgba(255,255,255,0.07)',
        color: primary ? '#fff' : danger ? '#ef4444' : disabled ? '#475569' : '#e2e8f0',
        fontWeight: 600, fontSize: 14,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const S = {
  root: {
    position: 'fixed', inset: 0, zIndex: 200,
    background: '#0f1115',
    fontFamily: 'var(--font-main, Outfit, sans-serif)',
  },
  header: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 500,
    display: 'flex', alignItems: 'center', padding: '10px 12px',
    background: 'rgba(15,17,21,0.90)', backdropFilter: 'blur(10px)',
    borderBottom: '1px solid rgba(255,255,255,0.07)',
    gap: 8,
  },
  headerTitle: { fontWeight: 700, fontSize: 15, color: '#f8fafc' },
  iconBtn: {
    background: 'none', border: 'none', color: '#3b82f6',
    cursor: 'pointer', padding: 6, display: 'flex', alignItems: 'center', borderRadius: 8,
  },
  headerSaveBtn: {
    width: 36, height: 36, borderRadius: 8,
    background: 'rgba(59,130,246,0.15)', color: '#3b82f6',
    border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  crosshairWrap: {
    position: 'absolute',
    top: '50%', left: '50%',
    transform: 'translate(-50%, -50%)',
    zIndex: 400,
    pointerEvents: 'none',
    filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.5))',
  },
  stats: {
    position: 'absolute', top: 62, left: 10, right: 60, zIndex: 400,
    background: 'rgba(15,17,21,0.86)', backdropFilter: 'blur(6px)',
    borderRadius: 10, padding: '7px 12px',
    display: 'flex', gap: 14, flexWrap: 'wrap',
    border: '1px solid rgba(255,255,255,0.06)',
    pointerEvents: 'none',
  },
  rightControls: {
    position: 'absolute', right: 10, bottom: 200, zIndex: 400,
    display: 'flex', flexDirection: 'column', gap: 7,
  },
  gpsBadge: {
    position: 'absolute', bottom: 200, left: 10, zIndex: 400,
    border: '1px solid', borderRadius: 6, padding: '3px 8px',
    fontSize: 11, fontWeight: 600, pointerEvents: 'none',
  },
  toast: {
    position: 'absolute',
    bottom: 200, left: '50%', transform: 'translateX(-50%)',
    zIndex: 450,
    background: 'rgba(59,130,246,0.9)', color: '#fff',
    borderRadius: 20, padding: '6px 18px',
    fontSize: 13, fontWeight: 600,
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
  },
  confirmOverlay: {
    position: 'absolute', inset: 0, zIndex: 600,
    background: 'rgba(0,0,0,0.65)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 20,
  },
  confirmBox: {
    background: '#1a1d24', border: '1px solid #334155',
    borderRadius: 16, padding: '20px 20px 16px',
    maxWidth: 340, width: '100%',
    color: '#f8fafc',
  },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 500,
    padding: '12px 12px calc(12px + env(safe-area-inset-bottom))',
    background: 'rgba(15,17,21,0.94)', backdropFilter: 'blur(12px)',
    borderTop: '1px solid rgba(255,255,255,0.07)',
    display: 'flex', flexDirection: 'column', gap: 9,
  },
  row: { display: 'flex', gap: 8 },
  addPointBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    padding: '15px 24px', borderRadius: 13,
    background: '#3b82f6', color: '#fff',
    border: 'none', fontWeight: 700, fontSize: 17,
    cursor: 'pointer', width: '100%',
    boxShadow: '0 4px 20px rgba(59,130,246,0.4)',
    fontFamily: 'inherit',
  },
  plusCircle: {
    width: 30, height: 30, borderRadius: '50%',
    background: 'rgba(255,255,255,0.22)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  completeBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: '12px 20px', borderRadius: 11,
    background: 'rgba(16,185,129,0.12)', color: '#10b981',
    border: '1px solid rgba(16,185,129,0.3)',
    fontWeight: 700, fontSize: 15,
    cursor: 'pointer', width: '100%',
    fontFamily: 'inherit',
  },
  saveBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: '13px 20px', borderRadius: 11,
    background: '#3b82f6', color: '#fff',
    border: 'none', fontWeight: 700, fontSize: 15,
    cursor: 'pointer', width: '100%',
    fontFamily: 'inherit',
  },
  savedMsg: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 8, color: '#10b981', fontWeight: 700, fontSize: 15,
  },
  error: {
    color: '#ef4444', fontSize: 13, textAlign: 'center', fontWeight: 500,
  },
  loadingOverlay: {
    position: 'absolute', inset: 0, zIndex: 600,
    background: 'rgba(15,17,21,0.95)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  loadingBox: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', color: '#f8fafc',
  },
  spinner: {
    width: 40, height: 40, border: '4px solid rgba(59,130,246,0.3)',
    borderTopColor: '#3b82f6', borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  savedOverlay: {
    position: 'absolute', top: 56, left: 0, right: 0, bottom: 0, zIndex: 500,
    background: '#0f1115',
    display: 'flex', flexDirection: 'column',
    overflowY: 'auto',
  },
  savedContent: {
    padding: '20px 20px 30px', flex: 1,
    display: 'flex', flexDirection: 'column',
    maxWidth: 600, margin: '0 auto', width: '100%', boxSizing: 'border-box'
  },
  savedHeader: {
    marginBottom: 20, color: '#f8fafc',
  },
  snapshotContainer: {
    width: '100%', aspectRatio: '1/1',
    background: '#1a1d24', borderRadius: 16,
    overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)',
    marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'center'
  },
  snapshotImage: {
    width: '100%', height: 'auto', objectFit: 'contain'
  },
  snapshotPlaceholder: {
    color: '#94a3b8', fontSize: 14, textAlign: 'center'
  },
  savedSuccess: {
    display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24,
    background: 'rgba(16,185,129,0.1)', padding: '16px', borderRadius: 12,
    border: '1px solid rgba(16,185,129,0.2)'
  },
  savedStats: {
    background: '#1a1d24', borderRadius: 12, padding: '16px',
    display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32,
    border: '1px solid rgba(255,255,255,0.05)'
  },
  statRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
  },
  statLabel: {
    color: '#94a3b8', fontSize: 14, fontWeight: 500
  },
  statValue: {
    color: '#f8fafc', fontSize: 15, fontWeight: 600
  }
};

// Add spinner animation globally if not present
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.innerHTML = `
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}
