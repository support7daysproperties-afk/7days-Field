/**
 * BoundaryService — Pure business-logic layer for property boundary operations.
 *
 * Deliberately decoupled from any specific map library or GPS implementation
 * so that a Capacitor-native implementation can replace the browser layer later
 * without changing how boundaries are stored, calculated, or synced.
 */

// ─── Area / Perimeter Calculations ────────────────────────────────────────────

const EARTH_RADIUS_M = 6378137; // WGS-84 semi-major axis

/** Convert degrees to radians */
function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Calculate the geodesic area of a closed polygon using the spherical excess formula
 * (Shoelace variant on a sphere).  Coordinates: [[lng, lat], ...]
 * Returns area in square metres.
 */
export function calcPolygonAreaM2(coords) {
  if (!coords || coords.length < 3) return 0;

  let area = 0;
  const n = coords.length;

  for (let i = 0; i < n; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[(i + 1) % n];
    area +=
      toRad(lng2 - lng1) *
      (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
  }

  area = Math.abs((area * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
  return area;
}

/** Haversine distance in metres between two [lng, lat] points */
export function haversineM(p1, p2) {
  const [lng1, lat1] = p1;
  const [lng2, lat2] = p2;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** Perimeter of a closed polygon in metres */
export function calcPerimeterM(coords) {
  if (!coords || coords.length < 2) return 0;
  let perimeter = 0;
  for (let i = 0; i < coords.length; i++) {
    perimeter += haversineM(coords[i], coords[(i + 1) % coords.length]);
  }
  return perimeter;
}

/** Geometric centroid of the polygon (not geodesic, but fine for display) */
export function calcCentroid(coords) {
  if (!coords || coords.length === 0) return { lat: 0, lng: 0 };
  const sumLng = coords.reduce((s, c) => s + c[0], 0);
  const sumLat = coords.reduce((s, c) => s + c[1], 0);
  return { lng: sumLng / coords.length, lat: sumLat / coords.length };
}

export const SQ_M_PER_ACRE = 4046.8564224;
export const SQ_M_PER_HECTARE = 10000;
export const ACRES_PER_HECTARE = SQ_M_PER_HECTARE / SQ_M_PER_ACRE; // approx 2.47105381

/** Convert sq metres to various units with deterministic precision */
export function areaFromM2(m2) {
  if (!m2 || m2 < 0) {
    return {
      sq_m: 0,
      sq_ft: 0,
      acres: 0,
      cents: 0,
      hectares: 0,
    };
  }
  return {
    sq_m: Math.round(m2),
    sq_ft: Math.round(m2 * 10.7639104),
    acres: +(m2 / SQ_M_PER_ACRE).toFixed(4),
    cents: +(m2 / 40.4685642).toFixed(2),
    hectares: +(m2 / SQ_M_PER_HECTARE).toFixed(4),
  };
}

/** Format distance in metres for readable display (m / km) */
export function formatDistance(m) {
  if (m == null || isNaN(m)) return '0 m';
  if (m >= 1000) {
    return `${(m / 1000).toFixed(2)} km`;
  }
  if (m >= 100) {
    return `${Math.round(m)} m`;
  }
  return `${m.toFixed(1)} m`;
}

/** Format perimeter for display (m / km) */
export function formatPerimeter(m) {
  return formatDistance(m);
}

/**
 * Calculate distance along each edge of the polygon / line.
 * If isClosed is true and coords.length >= 3, also calculates the closing edge (last -> first).
 * Returns array of { index, from, to, distanceM, formattedDistance, midpoint: [lng, lat] }
 */
export function calcEdgeDistances(coords, isClosed = false) {
  if (!coords || coords.length < 2) return [];

  const edges = [];
  const count = coords.length;
  const numEdges = isClosed && count >= 3 ? count : count - 1;

  for (let i = 0; i < numEdges; i++) {
    const from = coords[i];
    const to = coords[(i + 1) % count];

    if (!from || !to) continue;

    const dist = haversineM(from, to);
    // Midpoint in geographic [lng, lat]
    const midLng = (from[0] + to[0]) / 2;
    const midLat = (from[1] + to[1]) / 2;

    edges.push({
      index: i,
      fromIndex: i,
      toIndex: (i + 1) % count,
      from,
      to,
      distanceM: dist,
      formattedDistance: formatDistance(dist),
      midpoint: [midLng, midLat],
      isClosingEdge: i === count - 1,
    });
  }

  return edges;
}

// ─── GeoJSON helpers ───────────────────────────────────────────────────────────

/**
 * Build a GeoJSON Polygon from an ordered array of [lng, lat] coordinate pairs.
 * The ring is automatically closed (first === last).
 */
export function buildGeoJSONPolygon(coords) {
  if (!coords || coords.length < 3) return null;
  const ring = [...coords, coords[0]]; // close the ring
  return {
    type: 'Polygon',
    coordinates: [ring],
  };
}

// ─── Boundary record builder ───────────────────────────────────────────────────

/**
 * Build a complete boundary record ready for IndexedDB / Supabase.
 *
 * @param {object} params
 * @param {string}   params.inspectionId
 * @param {string}   params.propertyId
 * @param {string}   params.supervisorId
 * @param {Array}    params.coords         [[lng, lat], ...]
 * @param {string}   [params.captureMode]  'manual' | 'walk'
 * @param {number}   [params.gpsAccuracyM]
 * @param {string}   [params.existingId]   If updating an existing record
 */
export function buildBoundaryRecord({
  inspectionId,
  propertyId,
  supervisorId,
  coords,
  captureMode = 'manual',
  gpsAccuracyM = null,
  existingId = null,
  snapshotImage = null,
}) {
  const m2 = calcPolygonAreaM2(coords);
  const areas = areaFromM2(m2);
  const perimeterM = calcPerimeterM(coords);
  const center = calcCentroid(coords);
  const geometry = buildGeoJSONPolygon(coords);

  return {
    id: existingId || crypto.randomUUID(),
    inspection_id: inspectionId,
    property_id: propertyId,
    supervisor_id: supervisorId,
    geometry,
    coordinates: coords, // raw open ring for easy editing restore
    area_sq_m: areas.sq_m,
    area_sq_ft: areas.sq_ft,
    area_acres: areas.acres,
    area_cents: areas.cents,
    area_hectares: areas.hectares,
    perimeter_m: Math.round(perimeterM),
    center_lat: center.lat,
    center_lng: center.lng,
    capture_mode: captureMode,
    gps_accuracy_m: gpsAccuracyM,
    snapshot_image: snapshotImage,
    sync_status: 'LOCAL_ONLY',
  };
}
