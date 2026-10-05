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

/** Convert sq metres to various units */
export function areaFromM2(m2) {
  return {
    sq_m: Math.round(m2),
    sq_ft: Math.round(m2 * 10.7639),
    acres: +(m2 / 4046.856).toFixed(4),
    cents: +(m2 / 40.4686).toFixed(2),
    hectares: +(m2 / 10000).toFixed(4),
  };
}

/** Format metres for display (m / km) */
export function formatPerimeter(m) {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
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
