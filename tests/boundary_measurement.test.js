import { describe, it, expect } from 'vitest';
import {
  haversineM,
  calcPerimeterM,
  calcPolygonAreaM2,
  areaFromM2,
  formatDistance,
  formatPerimeter,
  calcEdgeDistances,
  buildBoundaryRecord,
  SQ_M_PER_ACRE,
  SQ_M_PER_HECTARE,
  ACRES_PER_HECTARE,
} from '../src/services/BoundaryService';

describe('BoundaryService - Automatic Property Boundary Measurements', () => {
  // ── 1. Distance between two known geographic coordinates ─────────────────────────
  it('calculates accurate distance between two known geographic coordinates', () => {
    // 1 degree of latitude at the equator is approx 111,319.49 m
    const p1 = [0, 0];
    const p2 = [0, 1];
    const distLat1Deg = haversineM(p1, p2);
    expect(distLat1Deg).toBeGreaterThan(111000);
    expect(distLat1Deg).toBeLessThan(111500);

    // Identical points should have 0 distance
    expect(haversineM([80.2707, 13.0827], [80.2707, 13.0827])).toBe(0);

    // Known distance in Chennai (~1.1 km between Chennai Central and Egmore)
    const chennaiCentral = [80.2755, 13.0828];
    const chennaiEgmore = [80.2608, 13.0802];
    const chennaiDist = haversineM(chennaiCentral, chennaiEgmore);
    expect(chennaiDist).toBeGreaterThan(1500);
    expect(chennaiDist).toBeLessThan(1700);
  });

  // ── 2. Perimeter of a closed polygon ─────────────────────────────────────────────
  it('calculates perimeter of closed and open paths', () => {
    // A square: 4 vertices
    // [0,0] -> [0.001, 0] -> [0.001, 0.001] -> [0, 0.001]
    const square = [
      [0, 0],
      [0.001, 0],
      [0.001, 0.001],
      [0, 0.001],
    ];

    const perimeter = calcPerimeterM(square);
    // Each side at equator for 0.001 deg is ~111.32 m, total perimeter ~445.28 m
    expect(perimeter).toBeGreaterThan(440);
    expect(perimeter).toBeLessThan(450);

    // Handling degenerate/empty input
    expect(calcPerimeterM([])).toBe(0);
    expect(calcPerimeterM([[0, 0]])).toBe(0);
  });

  // ── 3. Area of a known polygon ──────────────────────────────────────────────────
  it('calculates area of a known spherical polygon accurately', () => {
    // A square of 0.001 deg by 0.001 deg at equator:
    // width ≈ 111.3195 m, height ≈ 111.3195 m -> Area ≈ 12,392 m²
    const square = [
      [0, 0],
      [0.001, 0],
      [0.001, 0.001],
      [0, 0.001],
    ];

    const areaM2 = calcPolygonAreaM2(square);
    expect(areaM2).toBeGreaterThan(12300);
    expect(areaM2).toBeLessThan(12500);

    // Test a ~1 hectare square (100m x 100m approx at equator)
    // 100m ≈ 0.000898315 degrees
    const delta = 0.000898315;
    const hectareSquare = [
      [0, 0],
      [delta, 0],
      [delta, delta],
      [0, delta],
    ];
    const hectareArea = calcPolygonAreaM2(hectareSquare);
    expect(hectareArea).toBeGreaterThan(9950);
    expect(hectareArea).toBeLessThan(10050);
  });

  // ── 4. Unit conversions (acres, hectares, square meters) ─────────────────────────
  it('handles exact conversions between acres, hectares, and square meters', () => {
    expect(SQ_M_PER_ACRE).toBe(4046.8564224);
    expect(SQ_M_PER_HECTARE).toBe(10000);
    expect(ACRES_PER_HECTARE).toBeCloseTo(2.47105381, 6);

    // 10,000 m² = 1 hectare = 2.4711 acres
    const converted1Ha = areaFromM2(10000);
    expect(converted1Ha.sq_m).toBe(10000);
    expect(converted1Ha.hectares).toBe(1);
    expect(converted1Ha.acres).toBe(2.4711);

    // 1 acre = 4046.8564224 m²
    const converted1Ac = areaFromM2(SQ_M_PER_ACRE);
    expect(converted1Ac.sq_m).toBe(4047);
    expect(converted1Ac.acres).toBe(1);
    expect(converted1Ac.hectares).toBe(0.4047);

    // Negative or zero input safe guard
    expect(areaFromM2(0)).toEqual({ sq_m: 0, sq_ft: 0, acres: 0, cents: 0, hectares: 0 });
    expect(areaFromM2(-50)).toEqual({ sq_m: 0, sq_ft: 0, acres: 0, cents: 0, hectares: 0 });
  });

  // ── 5. Edge distances and midpoints ──────────────────────────────────────────────
  it('calculates edge distances and midpoints for open and closed polygons', () => {
    const coords = [
      [80.0, 13.0],
      [80.001, 13.0],
      [80.001, 13.001],
    ];

    // Open polyline (2 segments)
    const openEdges = calcEdgeDistances(coords, false);
    expect(openEdges.length).toBe(2);
    expect(openEdges[0].index).toBe(0);
    expect(openEdges[0].fromIndex).toBe(0);
    expect(openEdges[0].toIndex).toBe(1);
    expect(openEdges[0].distanceM).toBeGreaterThan(100);
    expect(openEdges[0].formattedDistance).toMatch(/m|km/);
    expect(openEdges[0].midpoint[0]).toBeCloseTo(80.0005, 5);
    expect(openEdges[0].midpoint[1]).toBeCloseTo(13.0, 5);
    expect(openEdges[0].isClosingEdge).toBe(false);

    // Closed polygon (3 segments, includes closing edge)
    const closedEdges = calcEdgeDistances(coords, true);
    expect(closedEdges.length).toBe(3);
    expect(closedEdges[2].isClosingEdge).toBe(true);
    expect(closedEdges[2].fromIndex).toBe(2);
    expect(closedEdges[2].toIndex).toBe(0);
  });

  // ── 6. Incomplete and invalid polygons ───────────────────────────────────────────
  it('safely handles incomplete, empty, and degenerate polygons', () => {
    expect(calcPolygonAreaM2([])).toBe(0);
    expect(calcPolygonAreaM2([[80.0, 13.0]])).toBe(0);
    expect(calcPolygonAreaM2([[80.0, 13.0], [80.001, 13.0]])).toBe(0);

    expect(calcEdgeDistances([])).toEqual([]);
    expect(calcEdgeDistances([[80.0, 13.0]])).toEqual([]);
  });

  // ── 7. Adding, moving, and removing vertices ─────────────────────────────────────
  it('updates measurements dynamically when adding, moving, and removing vertices', () => {
    let vertices = [
      [80.0, 13.0],
      [80.002, 13.0],
      [80.002, 13.002],
    ];

    const initialArea = calcPolygonAreaM2(vertices);
    const initialPerimeter = calcPerimeterM(vertices);
    expect(initialArea).toBeGreaterThan(0);

    // Add a 4th vertex
    vertices = [...vertices, [80.0, 13.002]];
    const updatedArea = calcPolygonAreaM2(vertices);
    const updatedPerimeter = calcPerimeterM(vertices);

    // Adding the 4th corner completes the full square, doubling the area of the right triangle
    expect(updatedArea).toBeGreaterThan(initialArea);
    expect(updatedPerimeter).toBeGreaterThan(initialPerimeter);

    // Move a vertex
    const moved = [...vertices];
    moved[1] = [80.003, 13.0]; // stretch edge
    const movedArea = calcPolygonAreaM2(moved);
    expect(movedArea).toBeGreaterThan(updatedArea);

    // Remove a vertex
    const removed = vertices.filter((_, i) => i !== 2);
    expect(removed.length).toBe(3);
    const removedArea = calcPolygonAreaM2(removed);
    expect(removedArea).toBeLessThan(updatedArea);
  });

  // ── 8. Boundary record building and persistence reproducibility ──────────────────
  it('builds a boundary record that preserves authoritative coordinates and derived values', () => {
    const coords = [
      [80.1234, 13.5678],
      [80.1244, 13.5678],
      [80.1244, 13.5688],
      [80.1234, 13.5688],
    ];

    const record = buildBoundaryRecord({
      inspectionId: 'test-insp-1',
      propertyId: 'prop-1',
      supervisorId: 'sup-1',
      coords,
    });

    expect(record.inspection_id).toBe('test-insp-1');
    expect(record.coordinates).toEqual(coords);
    expect(record.area_acres).toBeGreaterThan(0);
    expect(record.area_hectares).toBeGreaterThan(0);
    expect(record.area_sq_m).toBeGreaterThan(0);
    expect(record.perimeter_m).toBeGreaterThan(0);
    expect(record.geometry.type).toBe('Polygon');
    expect(record.geometry.coordinates[0].length).toBe(5); // closed GeoJSON ring

    // Reopening saved boundary reproduces the exact measurements
    const recomputedArea = calcPolygonAreaM2(record.coordinates);
    const recomputedPerimeter = calcPerimeterM(record.coordinates);
    const recomputedMetrics = areaFromM2(recomputedArea);

    expect(recomputedMetrics.acres).toBe(record.area_acres);
    expect(recomputedMetrics.hectares).toBe(record.area_hectares);
    expect(recomputedMetrics.sq_m).toBe(record.area_sq_m);
    expect(Math.round(recomputedPerimeter)).toBe(record.perimeter_m);
  });

  // ── 9. Formatting utilities ──────────────────────────────────────────────────────
  it('formats distance and perimeter cleanly for UI readability', () => {
    expect(formatDistance(5.4)).toBe('5.4 m');
    expect(formatDistance(45.8)).toBe('45.8 m');
    expect(formatDistance(125.3)).toBe('125 m');
    expect(formatDistance(1250)).toBe('1.25 km');
    expect(formatPerimeter(3450)).toBe('3.45 km');
    expect(formatDistance(null)).toBe('0 m');
  });
});
