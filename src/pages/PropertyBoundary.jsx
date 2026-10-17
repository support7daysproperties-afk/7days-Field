/**
 * PropertyBoundary.jsx — Crosshair / Target-based boundary marking
 * Powered by Google Maps JavaScript API (Satellite & Hybrid)
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
 * MAP LIBRARY: Google Maps JavaScript API
 *   - google.maps.Map with MapTypeId.SATELLITE & MapTypeId.HYBRID
 *   - google.maps.Polygon for closed filled boundary
 *   - google.maps.Polyline for open boundary line & selectable edge hit-testing
 *   - google.maps.Marker for vertices (draggable in edit mode)
 *   - google.maps.OverlayView for custom DOM collision-free measurement badges
 *   - map.getCenter() for crosshair coordinate
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import {
  ArrowLeft, Plus, Minus, Navigation2, Layers,
  Undo2, Trash2, Save, CheckCircle2, Check,
  MapPin, Edit3, X, Ruler, AlertTriangle, RefreshCw, Focus
} from 'lucide-react';
import BoundaryRepository from '../services/offline/BoundaryRepository';
import {
  buildBoundaryRecord,
  calcPolygonAreaM2,
  areaFromM2,
  calcPerimeterM,
  calcEdgeDistances,
  formatPerimeter,
  formatDistance,
} from '../services/BoundaryService';
import { computeCollisionFreeLabels } from '../services/BoundaryLabelPlacementService';
import { loadGoogleMaps, getGoogleMapsApiKey } from '../services/GoogleMapsLoader';
import { useAuth } from '../context/AuthContext';

// ── Visual constants ───────────────────────────────────────────────────────────
const C_BLUE    = '#3b82f6';
const C_WHITE   = '#ffffff';
const C_FILL_OP = 0.22;
const C_LINE_W  = 3;
const V_RADIUS  = 8;   // vertex radius px
const MID_RADIUS= 6;   // midpoint radius px

// Convert [lng, lat] GeoJSON coordinates to Google Maps LatLngLiteral { lat, lng }
const toLatLng = (c) => ({ lat: c[1], lng: c[0] });
const toLatLngAll = (cs) => cs.map(toLatLng);

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

  // Google Maps instances
  const mapRef            = useRef(null);
  const googleMapsRef     = useRef(null);
  const mapOverlayRef     = useRef(null);
  const gpsMarkerRef      = useRef(null);
  const gpsWatchRef       = useRef(null);

  // Overlay management refs
  const polygonOverlayRef = useRef(null);
  const polylinesRef      = useRef([]);
  const markersRef        = useRef([]);
  const badgeDivsRef      = useRef([]);

  // Loading & Error states
  const [mapLoaded, setMapLoaded]     = useState(false);
  const [mapError, setMapError]       = useState(null);
  const [mapTypeId, setMapTypeId]     = useState('satellite'); // 'satellite' | 'hybrid'

  // Coords: stored as [lng, lat] pairs (GeoJSON order)
  const drawCoordsRef = useRef([]);
  const [coords, setCoords]           = useState([]);

  // mode: 'drawing' | 'completed' | 'saved' | 'editing'
  const modeRef = useRef('drawing');
  const [mode, setMode]               = useState('drawing');

  const [savedBoundary, setSavedBoundary] = useState(null);
  const [isSaving, setIsSaving]           = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [saveError, setSaveError]         = useState(null);
  const [gpsAccuracy, setGpsAccuracy]     = useState(null);
  const [gpsWarning, setGpsWarning]       = useState(false);
  const [toast, setToast]                 = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Selected edge state for inspection & highlighting
  const [selectedEdge, setSelectedEdge] = useState(null);
  const selectedEdgeRef = useRef(null);

  // Derived metrics
  const isPolygonClosed = mode === 'completed' || mode === 'saved' || mode === 'editing';
  const hasPolygon = coords.length >= 3;
  const areaMetrics = hasPolygon ? areaFromM2(calcPolygonAreaM2(coords)) : null;
  const perimeterM = coords.length >= 2
    ? Math.round(isPolygonClosed && hasPolygon ? calcPerimeterM(coords) : calcEdgeDistances(coords, false).reduce((sum, e) => sum + e.distanceM, 0))
    : 0;

  useEffect(() => { modeRef.current = mode; }, [mode]);

  const showToast = useCallback((msg, duration = 1800) => {
    setToast(msg);
    setTimeout(() => setToast(''), duration);
  }, []);

  // ── Clear all existing map overlays ──────────────────────────────────────────
  const clearMapOverlays = useCallback(() => {
    if (polygonOverlayRef.current) {
      polygonOverlayRef.current.setMap(null);
      polygonOverlayRef.current = null;
    }
    polylinesRef.current.forEach(p => p.setMap(null));
    polylinesRef.current = [];

    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    badgeDivsRef.current.forEach(d => d.remove());
    badgeDivsRef.current = [];
  }, []);

  // ── Render boundary layers on Google Maps ─────────────────────────────────────
  const renderLayers = useCallback((pts, currentMode) => {
    const map = mapRef.current;
    const gmaps = googleMapsRef.current;
    const overlay = mapOverlayRef.current;
    if (!map || !gmaps || !overlay) return;

    clearMapOverlays();

    if (pts.length === 0) return;

    const latLngPts = toLatLngAll(pts);
    const isCompleted = currentMode === 'completed' || currentMode === 'saved' || currentMode === 'editing';

    // 1. Polygon Fill (completed / saved / editing)
    if (isCompleted && pts.length >= 3) {
      const polygon = new gmaps.Polygon({
        paths: latLngPts,
        strokeColor: C_BLUE,
        strokeOpacity: 0.9,
        strokeWeight: C_LINE_W,
        fillColor: C_BLUE,
        fillOpacity: C_FILL_OP,
        clickable: false,
        zIndex: 1,
      });
      polygon.setMap(map);
      polygonOverlayRef.current = polygon;
    }

    // 2. Open Polyline or Selectable Edges
    if (pts.length >= 2) {
      const edges = calcEdgeDistances(pts, isCompleted);
      const activeSelected = selectedEdgeRef.current;

      edges.forEach((edge) => {
        const isThisEdgeSelected = activeSelected && activeSelected.index === edge.index;
        const edgePath = [toLatLng(edge.from), toLatLng(edge.to)];

        // Base/highlight visual polyline
        const line = new gmaps.Polyline({
          path: edgePath,
          strokeColor: isThisEdgeSelected ? '#f59e0b' : C_BLUE,
          strokeOpacity: isThisEdgeSelected ? 1.0 : 0.9,
          strokeWeight: isThisEdgeSelected ? 6 : C_LINE_W,
          clickable: false,
          zIndex: isThisEdgeSelected ? 10 : 2,
        });
        line.setMap(map);
        polylinesRef.current.push(line);

        // Invisible wider hit-testing polyline for effortless touch selection
        const hitLine = new gmaps.Polyline({
          path: edgePath,
          strokeColor: '#000000',
          strokeOpacity: 0.001,
          strokeWeight: 26,
          clickable: true,
          zIndex: 15,
        });
        hitLine.setMap(map);

        const onEdgeClick = (e) => {
          if (e && e.stop) e.stop();
          selectedEdgeRef.current = edge;
          setSelectedEdge(edge);
          renderLayers(drawCoordsRef.current, modeRef.current);
        };

        hitLine.addListener('click', onEdgeClick);
        polylinesRef.current.push(hitLine);
      });

      // ── Collision-Aware Distance Measurement Badges ────────────────────────────
      const projection = overlay.getProjection();
      const mapContainer = map.getDiv();
      const viewportWidth = mapContainer?.clientWidth || 800;
      const viewportHeight = mapContainer?.clientHeight || 600;

      if (projection) {
        const projectLatLngToPoint = (lat, lng) => {
          const latLng = new gmaps.LatLng(lat, lng);
          return projection.fromLatLngToContainerPixel(latLng);
        };

        const projectPointToLatLng = (x, y) => {
          const point = new gmaps.Point(x, y);
          const latLng = projection.fromContainerPixelToLatLng(point);
          return { lat: latLng.lat(), lng: latLng.lng() };
        };

        const currentZoom = map.getZoom ? map.getZoom() : null;
        const placedLabels = computeCollisionFreeLabels({
          edges,
          projectLatLngToPoint,
          projectPointToLatLng,
          viewportWidth,
          viewportHeight,
          verticesLatLng: pts,
          zoom: currentZoom,
        });

        const overlayPanes = overlay.getPanes();
        const floatPane = overlayPanes?.floatPane || mapContainer;

        // Create an SVG layer for connector lines if displaced labels exist
        const hasAnyConnector = placedLabels.some(l => l.hasConnector);
        let svgOverlay = null;
        if (hasAnyConnector) {
          svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svgOverlay.style.position = 'absolute';
          svgOverlay.style.left = '0';
          svgOverlay.style.top = '0';
          svgOverlay.style.width = '100%';
          svgOverlay.style.height = '100%';
          svgOverlay.style.pointerEvents = 'none';
          svgOverlay.style.overflow = 'visible';
          svgOverlay.style.zIndex = '290';
          floatPane.appendChild(svgOverlay);
          badgeDivsRef.current.push(svgOverlay);
        }

        placedLabels.forEach((edgeLabel) => {
          const isThisEdgeSelected = activeSelected && activeSelected.index === edgeLabel.index;

          // LatLng coordinates for label and edge anchor midpoint
          const lat = edgeLabel.labelLatLng ? edgeLabel.labelLatLng[0] : edgeLabel.midpoint[1];
          const lng = edgeLabel.labelLatLng ? edgeLabel.labelLatLng[1] : edgeLabel.midpoint[0];
          const latLng = new gmaps.LatLng(lat, lng);
          const labelPos = projection.fromLatLngToDivPixel(latLng);

          const anchorLatLng = new gmaps.LatLng(edgeLabel.midpoint[1], edgeLabel.midpoint[0]);
          const anchorPos = projection.fromLatLngToDivPixel(anchorLatLng);

          // If label has been displaced to an outer lane, draw a subtle leader line to the edge midpoint
          if (edgeLabel.hasConnector && svgOverlay && labelPos && anchorPos) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', `${anchorPos.x}`);
            line.setAttribute('y1', `${anchorPos.y}`);
            line.setAttribute('x2', `${labelPos.x}`);
            line.setAttribute('y2', `${labelPos.y}`);
            line.setAttribute('stroke', isThisEdgeSelected ? '#f59e0b' : 'rgba(96, 165, 250, 0.45)');
            line.setAttribute('stroke-width', '1');
            line.setAttribute('stroke-dasharray', '2,2');
            svgOverlay.appendChild(line);

            // Small subtle dot on the edge anchor
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', `${anchorPos.x}`);
            circle.setAttribute('cy', `${anchorPos.y}`);
            circle.setAttribute('r', '2');
            circle.setAttribute('fill', isThisEdgeSelected ? '#f59e0b' : 'rgba(96, 165, 250, 0.7)');
            svgOverlay.appendChild(circle);
          }

          // Create badge element
          const badgeDiv = document.createElement('div');
          badgeDiv.className = `edge-distance-badge-wrap ${isThisEdgeSelected ? 'selected' : ''}`;
          badgeDiv.style.position = 'absolute';
          badgeDiv.style.transform = 'translate(-50%, -50%)';
          badgeDiv.style.cursor = 'pointer';
          badgeDiv.style.zIndex = isThisEdgeSelected ? '600' : '300';
          badgeDiv.style.pointerEvents = 'auto';

          badgeDiv.innerHTML = `
            <div class="edge-distance-badge" style="
              display: inline-flex;
              align-items: center;
              justify-content: center;
              padding: 2px 7px;
              background: ${isThisEdgeSelected ? '#f59e0b' : 'rgba(15, 17, 21, 0.90)'};
              backdrop-filter: blur(4px);
              -webkit-backdrop-filter: blur(4px);
              border: 1px solid ${isThisEdgeSelected ? '#fbbf24' : 'rgba(59, 130, 246, 0.65)'};
              border-radius: 9999px;
              color: ${isThisEdgeSelected ? '#0f172a' : '#60a5fa'};
              font-size: 11px;
              font-weight: 700;
              font-family: inherit;
              white-space: nowrap;
              letter-spacing: 0.02em;
              box-shadow: ${isThisEdgeSelected ? '0 0 10px rgba(245, 158, 11, 0.6)' : '0 2px 6px rgba(0, 0, 0, 0.55)'};
              user-select: none;
            ">${edgeLabel.formattedDistance}</div>
          `;

          if (labelPos) {
            badgeDiv.style.left = `${labelPos.x}px`;
            badgeDiv.style.top = `${labelPos.y}px`;
          }

          badgeDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedEdgeRef.current = edgeLabel;
            setSelectedEdge(edgeLabel);
            renderLayers(drawCoordsRef.current, modeRef.current);
          });

          floatPane.appendChild(badgeDiv);
          badgeDivsRef.current.push(badgeDiv);
        });
      }
    }

    // 3. Vertices
    if (currentMode === 'editing') {
      // Draggable vertices in edit mode
      pts.forEach((c, idx) => {
        const marker = new gmaps.Marker({
          position: toLatLng(c),
          map,
          draggable: true,
          icon: {
            path: gmaps.SymbolPath.CIRCLE,
            scale: V_RADIUS,
            fillColor: C_WHITE,
            fillOpacity: 1,
            strokeColor: C_BLUE,
            strokeWeight: 2.5,
          },
          zIndex: 500,
        });

        marker.addListener('drag', (e) => {
          const lat = e.latLng.lat();
          const lng = e.latLng.lng();
          const next = [...drawCoordsRef.current];
          next[idx] = [lng, lat];
          drawCoordsRef.current = next;
          setCoords([...next]);
          renderLayers(next, 'editing');
        });

        markersRef.current.push(marker);
      });

      // Midpoint markers for inserting vertex between existing ones
      if (pts.length >= 2) {
        pts.forEach((c, idx) => {
          const nextIdx = (idx + 1) % pts.length;
          const c2 = pts[nextIdx];
          const midLng = (c[0] + c2[0]) / 2;
          const midLat = (c[1] + c2[1]) / 2;

          const midMarker = new gmaps.Marker({
            position: { lat: midLat, lng: midLng },
            map,
            icon: {
              path: gmaps.SymbolPath.CIRCLE,
              scale: MID_RADIUS,
              fillColor: C_WHITE,
              fillOpacity: 0.85,
              strokeColor: C_BLUE,
              strokeWeight: 2,
            },
            zIndex: 400,
            cursor: 'pointer',
          });

          midMarker.addListener('click', () => {
            const insertAt = idx + 1;
            const next = [
              ...drawCoordsRef.current.slice(0, insertAt),
              [midLng, midLat],
              ...drawCoordsRef.current.slice(insertAt),
            ];
            drawCoordsRef.current = next;
            setCoords([...next]);
            renderLayers(next, 'editing');
            showToast('Point inserted');
          });

          markersRef.current.push(midMarker);
        });
      }
    } else {
      // Static vertex circles
      pts.forEach((c) => {
        const marker = new gmaps.Marker({
          position: toLatLng(c),
          map,
          clickable: false,
          icon: {
            path: gmaps.SymbolPath.CIRCLE,
            scale: V_RADIUS,
            fillColor: C_WHITE,
            fillOpacity: 1,
            strokeColor: C_BLUE,
            strokeWeight: 2.5,
          },
          zIndex: 200,
        });
        markersRef.current.push(marker);
      });
    }
  }, [clearMapOverlays, showToast]);

  // ── Set coords + update layers atomically ─────────────────────────────────────
  const applyCoords = useCallback((next, currentMode) => {
    drawCoordsRef.current = next;
    selectedEdgeRef.current = null;
    setSelectedEdge(null);
    setCoords([...next]);
    renderLayers(next, currentMode ?? modeRef.current);
  }, [renderLayers]);

  // ── Add Point (reads crosshair = map center) ──────────────────────────────────
  const addPoint = useCallback(() => {
    if (!mapRef.current) return;
    const center = mapRef.current.getCenter();
    const newPt  = [center.lng(), center.lat()];
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
    // Ensure map fits the entire polygon with generous padding so all boundary labels are in view
    if (mapRef.current && googleMapsRef.current) {
      const bounds = new googleMapsRef.current.LatLngBounds();
      drawCoordsRef.current.forEach(p => bounds.extend(toLatLng(p)));
      mapRef.current.fitBounds(bounds, 80);
    }
    renderLayers(drawCoordsRef.current, 'completed');
  }, [renderLayers]);

  // ── Clear ─────────────────────────────────────────────────────────────────────
  const clearBoundary = useCallback(() => {
    drawCoordsRef.current = [];
    selectedEdgeRef.current = null;
    setSelectedEdge(null);
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

  // ── Delete vertex ─────────────────────────────────────────────────────────────
  const deleteVertex = useCallback((idx) => {
    const next = drawCoordsRef.current.filter((_, i) => i !== idx);
    applyCoords(next, next.length >= 3 ? 'editing' : 'drawing');
    if (next.length < 3) setMode('drawing');
    showToast('Point deleted');
  }, [applyCoords, showToast]);

  // ── Save Boundary ─────────────────────────────────────────────────────────────
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

      // Ensure map is fitted to boundary before snapshot with generous padding for edge labels
      if (mapRef.current && googleMapsRef.current) {
        const bounds = new googleMapsRef.current.LatLngBounds();
        pts.forEach(p => bounds.extend(toLatLng(p)));
        mapRef.current.fitBounds(bounds, 80);
        await new Promise(r => setTimeout(r, 800));
      }

      // Generate snapshot image
      let snapshotDataUrl = null;
      try {
        if (mapEl.current) {
          snapshotDataUrl = await toPng(mapEl.current, {
            cacheBust: true,
            filter: (node) => {
              // Exclude map controls or UI overlays from static snapshot
              if (node?.classList?.contains('gm-control-active') || node?.classList?.contains('gmnoprint')) return false;
              return true;
            }
          });
        }
      } catch (err) {
        console.error('[PropertyBoundary] snapshot error:', err);
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
      renderLayers(pts, 'saved');
      if (onSave) onSave(saved);
    } catch (err) {
      console.error('[PropertyBoundary] save error:', err);
      setSaveError('Save failed. Boundary is still in memory.');
    } finally {
      setIsSaving(false);
      setSnapshotLoading(false);
    }
  }, [gpsAccuracy, inspectionId, onSave, propertyId, renderLayers, savedBoundary, user]);

  // ── Initialize Google Maps ────────────────────────────────────────────────────
  useEffect(() => {
    let isCancelled = false;

    loadGoogleMaps()
      .then((gmaps) => {
        if (isCancelled || !mapEl.current) return;
        googleMapsRef.current = gmaps;

        const map = new gmaps.Map(mapEl.current, {
          center: { lat: 13.0827, lng: 80.2707 },
          zoom: 18,
          mapTypeId: gmaps.MapTypeId.SATELLITE,
          disableDefaultUI: true, // Clean interface matching DJI SmartFarm custom HUD
          gestureHandling: 'greedy', // Responsive touch panning on mobile
          tilt: 0,                   // Top-down orthographic satellite view for accurate boundary surveying
        });

        // Custom OverlayView for positioning screen-space badge DOM elements
        const overlay = new gmaps.OverlayView();
        overlay.onAdd = function () {};
        overlay.draw = function () {
          if (drawCoordsRef.current.length >= 2) {
            renderLayers(drawCoordsRef.current, modeRef.current);
          }
        };
        overlay.onRemove = function () {};
        overlay.setMap(map);
        mapOverlayRef.current = overlay;

        // Viewport change listeners to update collision-free labels smoothly
        let moveTimer = null;
        const handleMapMovement = () => {
          if (moveTimer) clearTimeout(moveTimer);
          moveTimer = setTimeout(() => {
            if (drawCoordsRef.current.length >= 2) {
              renderLayers(drawCoordsRef.current, modeRef.current);
            }
          }, 40);
        };

        map.addListener('idle', handleMapMovement);
        map.addListener('zoom_changed', handleMapMovement);
        map.addListener('bounds_changed', handleMapMovement);

        // Dismiss selected edge popup when user taps anywhere on map background
        map.addListener('click', () => {
          if (selectedEdgeRef.current) {
            selectedEdgeRef.current = null;
            setSelectedEdge(null);
            renderLayers(drawCoordsRef.current, modeRef.current);
          }
        });

        // ── GPS watch ────────────────────────────────────────────────────────
        if ('geolocation' in navigator) {
          gpsWatchRef.current = navigator.geolocation.watchPosition(
            ({ coords: pos }) => {
              const { latitude, longitude, accuracy } = pos;
              setGpsAccuracy(Math.round(accuracy));
              setGpsWarning(accuracy > 30);

              const userLatLng = { lat: latitude, lng: longitude };

              if (!gpsMarkerRef.current) {
                // If brand new map with no points yet, center on supervisor GPS
                if (drawCoordsRef.current.length === 0) {
                  map.setCenter(userLatLng);
                }
                gpsMarkerRef.current = new gmaps.Marker({
                  position: userLatLng,
                  map,
                  clickable: false,
                  icon: {
                    path: gmaps.SymbolPath.CIRCLE,
                    scale: 9,
                    fillColor: '#3b82f6',
                    fillOpacity: 1,
                    strokeColor: '#ffffff',
                    strokeWeight: 3,
                  },
                  zIndex: 800,
                });
              } else {
                gpsMarkerRef.current.setPosition(userLatLng);
              }
            },
            () => setGpsWarning(true),
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
          );
        } else {
          setGpsWarning(true);
        }

        mapRef.current = map;
        setMapLoaded(true);

        // Load existing boundary from IndexedDB after map is initialized
        BoundaryRepository.getBoundaryForInspection(inspectionId).then((existing) => {
          if (existing?.coordinates?.length >= 3) {
            setSavedBoundary(existing);
            drawCoordsRef.current = existing.coordinates;
            setCoords(existing.coordinates);
            setMode('completed');

            const bounds = new gmaps.LatLngBounds();
            existing.coordinates.forEach(p => bounds.extend(toLatLng(p)));
            map.fitBounds(bounds, 70);

            // Re-render once bounds have settled to ensure overlay projection is ready
            gmaps.event.addListenerOnce(map, 'idle', () => {
              renderLayers(existing.coordinates, 'completed');
            });
            renderLayers(existing.coordinates, 'completed');
          }
        });
      })
      .catch((err) => {
        console.error('[PropertyBoundary] Google Maps load error:', err);
        setMapError(err.message || 'Failed to initialize Google Maps Platform.');
      });

    return () => {
      isCancelled = true;
      if (gpsWatchRef.current) navigator.geolocation.clearWatch(gpsWatchRef.current);
      clearMapOverlays();
      if (mapOverlayRef.current) {
        mapOverlayRef.current.setMap(null);
        mapOverlayRef.current = null;
      }
      mapRef.current = null;
      googleMapsRef.current = null;
      gpsMarkerRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectionId]);

  // ── Map Controls ─────────────────────────────────────────────────────────────
  const zoomIn = () => {
    if (mapRef.current) {
      mapRef.current.setZoom(mapRef.current.getZoom() + 1);
    }
  };

  const zoomOut = () => {
    if (mapRef.current) {
      mapRef.current.setZoom(mapRef.current.getZoom() - 1);
    }
  };

  const goToGPS = () => {
    if (gpsMarkerRef.current && mapRef.current) {
      mapRef.current.setCenter(gpsMarkerRef.current.getPosition());
      mapRef.current.setZoom(19);
      showToast('Centered on device GPS');
    } else {
      showToast('GPS position unavailable');
    }
  };

  const locateBoundary = useCallback(() => {
    const pts = drawCoordsRef.current;
    if (!pts || pts.length < 2) {
      showToast('No boundary points to locate');
      return;
    }
    if (mapRef.current && googleMapsRef.current) {
      const bounds = new googleMapsRef.current.LatLngBounds();
      pts.forEach(p => bounds.extend(toLatLng(p)));
      // fitBounds with 70px padding so vertices and edge measurement badges are fully visible without clipping
      mapRef.current.fitBounds(bounds, 70);
      showToast('Centered on property boundary');
    }
  }, [showToast]);

  const toggleSatelliteHybrid = () => {
    if (!mapRef.current || !googleMapsRef.current) return;
    const gmaps = googleMapsRef.current;
    if (mapTypeId === 'satellite') {
      mapRef.current.setMapTypeId(gmaps.MapTypeId.HYBRID);
      setMapTypeId('hybrid');
      showToast('Hybrid view (Satellite + Roads/Labels)');
    } else {
      mapRef.current.setMapTypeId(gmaps.MapTypeId.SATELLITE);
      setMapTypeId('satellite');
      showToast('Satellite view');
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
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
          <div style={S.headerTitle}>Property Boundary (Google Satellite)</div>
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
        {(isCompleted || isEditing) && (
          <button
            style={{ ...S.headerSaveBtn, opacity: isSaving ? 0.6 : 1 }}
            onClick={handleSave}
            disabled={isSaving}
            aria-label="Save boundary"
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

      {/* ── Google Maps Container ── */}
      <div
        ref={mapEl}
        style={{
          position: 'absolute', inset: 0,
          cursor: isEditing ? 'default' : 'grab',
          background: '#0f1115',
        }}
      />

      {/* ── Error State / Fallback Banner ── */}
      {mapError && (
        <div style={S.errorOverlay}>
          <div style={S.errorCard}>
            <AlertTriangle size={36} color="#ef4444" style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: '#f8fafc' }}>
              Google Maps Loading Failed
            </div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16, textAlign: 'center', lineHeight: 1.4 }}>
              {mapError}
            </div>
            <div style={{ fontSize: 11, color: '#cbd5e1', background: 'rgba(255,255,255,0.06)', padding: '8px 12px', borderRadius: 8, marginBottom: 16, width: '100%' }}>
              Make sure <code>VITE_GOOGLE_MAPS_API_KEY</code> is set in <code>.env</code> with Maps JavaScript API enabled.
            </div>
            <button
              style={S.addPointBtn}
              onClick={() => window.location.reload()}
            >
              <RefreshCw size={16} /> Retry
            </button>
          </div>
        </div>
      )}

      {/* ── Fixed Crosshair (center of map) ── */}
      {(isDrawing || isCompleted) && !mapError && (
        <div style={S.crosshairWrap} aria-hidden="true">
          <svg width="48" height="48" viewBox="0 0 48 48" style={{ display: 'block' }}>
            <circle cx="24" cy="24" r="10" fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth="3"/>
            <circle cx="24" cy="24" r="10" fill="none" stroke={C_WHITE} strokeWidth="2"/>
            <line x1="24" y1="4"  x2="24" y2="12" stroke="rgba(0,0,0,0.5)" strokeWidth="3"/>
            <line x1="24" y1="4"  x2="24" y2="12" stroke={C_WHITE} strokeWidth="2"/>
            <line x1="24" y1="36" x2="24" y2="44" stroke="rgba(0,0,0,0.5)" strokeWidth="3"/>
            <line x1="24" y1="36" x2="24" y2="44" stroke={C_WHITE} strokeWidth="2"/>
            <line x1="4"  y1="24" x2="12" y2="24" stroke="rgba(0,0,0,0.5)" strokeWidth="3"/>
            <line x1="4"  y1="24" x2="12" y2="24" stroke={C_WHITE} strokeWidth="2"/>
            <line x1="36" y1="24" x2="44" y2="24" stroke="rgba(0,0,0,0.5)" strokeWidth="3"/>
            <line x1="36" y1="24" x2="44" y2="24" stroke={C_WHITE} strokeWidth="2"/>
            <circle cx="24" cy="24" r="2.5" fill={C_WHITE} stroke="rgba(0,0,0,0.4)" strokeWidth="1"/>
          </svg>
        </div>
      )}

      {/* ── Map Summary Bar: Field Area | Completed Area ── */}
      <div style={S.summaryBar} role="region" aria-label="Area Summary">
        <div style={S.summaryCol}>
          <div style={S.summaryLabel}>Field Area</div>
          <div style={S.summaryValue}>
            {hasPolygon && areaMetrics ? `${areaMetrics.acres} ac` : coords.length >= 2 ? `${perimeterM} m (open)` : '—'}
          </div>
          <div style={S.summarySub}>
            {hasPolygon && areaMetrics
              ? `${areaMetrics.hectares} ha · ${areaMetrics.sq_m.toLocaleString()} m²`
              : coords.length >= 2
                ? `${coords.length} points`
                : 'Draw boundary'}
          </div>
        </div>

        <div style={S.summaryDivider} />

        <div style={S.summaryCol}>
          <div style={S.summaryLabel}>Completed Area</div>
          <div style={{ ...S.summaryValue, color: '#94a3b8' }}>
            Not recorded
          </div>
          <div style={S.summarySub}>
            No work geometry
          </div>
        </div>
      </div>

      {/* ── Sub-metrics strip (Perimeter, Points, Planned) ── */}
      {coords.length > 0 && (
        <div style={S.stats}>
          <StatItem label="Points" value={coords.length} />
          {propertyAreaAcres && <StatItem label="Planned" value={`${propertyAreaAcres} ac`}/>}
          {perimeterM > 0 && (
            <StatItem
              label={isPolygonClosed && hasPolygon ? 'Perimeter' : 'Length'}
              value={formatPerimeter(perimeterM)}
              sub={isPolygonClosed ? 'Closed loop' : 'Open path'}
            />
          )}
          {hasPolygon && areaMetrics && (
            <StatItem
              label="Area (m² / ¢)"
              value={`${areaMetrics.sq_m.toLocaleString()} m²`}
              sub={`${areaMetrics.cents} cents · ${areaMetrics.sq_ft.toLocaleString()} ft²`}
            />
          )}
        </div>
      )}

      {/* ── Right controls ── */}
      <div style={S.rightControls}>
        <MapBtn
          title={mapTypeId === 'satellite' ? 'Switch to Hybrid' : 'Switch to Satellite'}
          active={mapTypeId === 'hybrid'}
          onClick={toggleSatelliteHybrid}
        >
          <Layers size={16}/>
        </MapBtn>
        <MapBtn title="Locate Boundary" onClick={locateBoundary}><Focus size={16}/></MapBtn>
        <MapBtn title="My location" onClick={goToGPS}><Navigation2 size={16}/></MapBtn>
        <MapBtn title="Zoom in"  onClick={zoomIn}><Plus size={16}/></MapBtn>
        <MapBtn title="Zoom out" onClick={zoomOut}><Minus size={16}/></MapBtn>
      </div>

      {/* ── GPS badge ── */}
      {gpsAccuracy !== null && (
        <div style={{
          ...S.gpsBadge,
          borderColor: gpsWarning ? '#f59e0b' : '#10b981',
          color: gpsWarning ? '#f59e0b' : '#10b981',
          background: gpsWarning ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.1)'
        }}>
          GPS ±{gpsAccuracy}m
        </div>
      )}

      {/* ── Toast ── */}
      {toast !== '' && (
        <div style={S.toast}>{toast}</div>
      )}

      {/* ── Selected Edge Measurement Card ── */}
      {selectedEdge && (
        <div style={S.edgeCard} role="dialog" aria-label="Selected Edge Measurement">
          <div style={S.edgeCardHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Ruler size={15} color="#f59e0b" />
              <span style={S.edgeCardTitle}>
                Segment P{selectedEdge.fromIndex + 1} → P{selectedEdge.toIndex + 1}
              </span>
            </div>
            <button
              style={S.edgeCardClose}
              onClick={() => {
                selectedEdgeRef.current = null;
                setSelectedEdge(null);
                renderLayers(drawCoordsRef.current, modeRef.current);
              }}
              aria-label="Close measurement card"
            >
              <X size={16} />
            </button>
          </div>

          <div style={S.edgeCardBody}>
            <div style={S.edgeCardLength}>{selectedEdge.formattedDistance}</div>
            <div style={S.edgeCardExact}>
              Exact length: {(selectedEdge.distanceM || 0).toFixed(2)} metres
              ({((selectedEdge.distanceM || 0) * 3.28084).toFixed(1)} ft)
            </div>
          </div>
        </div>
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
                <span style={S.statLabel}>Area (Acres)</span>
                <span style={S.statValue}>{savedBoundary?.area_acres} acres</span>
              </div>
              <div style={S.statRow}>
                <span style={S.statLabel}>Area (Hectares)</span>
                <span style={S.statValue}>{savedBoundary?.area_hectares ?? (savedBoundary?.area_sq_m ? (savedBoundary.area_sq_m / 10000).toFixed(4) : '—')} ha</span>
              </div>
              <div style={S.statRow}>
                <span style={S.statLabel}>Area (Sq Metres)</span>
                <span style={S.statValue}>{savedBoundary?.area_sq_m?.toLocaleString()} m²</span>
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

            <div style={{ display: 'flex', gap: 12, marginTop: 'auto', flexWrap: 'wrap' }}>
              <Btn onClick={() => setMode('completed')}><Focus size={16}/> Interactive Map</Btn>
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
            <button style={S.addPointBtn} onClick={addPoint}>
              <span style={S.plusCircle}><Plus size={20}/></span>
              Add Point
            </button>
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
    paddingTop: 'calc(var(--safe-area-top, 36px) + 10px)',
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
  summaryBar: {
    position: 'absolute', top: 56, left: 10, right: 10, zIndex: 400,
    background: 'rgba(15, 17, 21, 0.90)', backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    borderRadius: 12, padding: '9px 14px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    pointerEvents: 'none',
  },
  summaryCol: {
    flex: 1, display: 'flex', flexDirection: 'column', gap: 2,
  },
  summaryDivider: {
    width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.1)',
    margin: '0 12px',
  },
  summaryLabel: {
    fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
  },
  summaryValue: {
    fontSize: 15, fontWeight: 800, color: '#38bdf8', lineHeight: 1.2,
  },
  summarySub: {
    fontSize: 10, color: '#64748b', fontWeight: 500,
  },
  stats: {
    position: 'absolute', top: 124, left: 10, right: 60, zIndex: 400,
    background: 'rgba(15,17,21,0.86)', backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
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
  edgeCard: {
    position: 'absolute',
    bottom: 210, left: 12, right: 60,
    zIndex: 450,
    maxWidth: 340,
    background: 'rgba(15, 17, 21, 0.94)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    borderRadius: 14,
    padding: '10px 14px',
    border: '1px solid rgba(245, 158, 11, 0.4)',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
  },
  edgeCardHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 4,
  },
  edgeCardTitle: {
    fontSize: 12, fontWeight: 700, color: '#f59e0b',
    letterSpacing: '0.02em', textTransform: 'uppercase',
  },
  edgeCardClose: {
    background: 'none', border: 'none', color: '#94a3b8',
    cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center',
    borderRadius: 6,
  },
  edgeCardBody: {
    display: 'flex', flexDirection: 'column', gap: 2,
  },
  edgeCardLength: {
    fontSize: 18, fontWeight: 800, color: '#f8fafc',
  },
  edgeCardExact: {
    fontSize: 11, color: '#94a3b8', fontWeight: 500,
  },
  errorOverlay: {
    position: 'absolute', inset: 0, zIndex: 600,
    background: 'rgba(15,17,21,0.92)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 20,
  },
  errorCard: {
    background: '#1a1d24', border: '1px solid #334155',
    borderRadius: 16, padding: '24px 20px',
    maxWidth: 360, width: '100%',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
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
