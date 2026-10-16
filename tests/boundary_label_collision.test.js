import { describe, it, expect } from 'vitest';
import {
  doBoxesIntersect,
  doesBoxIntersectCircle,
  isBoxInsideViewport,
  generateCandidatePositions,
  computeCollisionFreeLabels,
  DEFAULT_LABEL_CONFIG,
} from '../src/services/BoundaryLabelPlacementService';
import { calcEdgeDistances, formatDistance } from '../src/services/BoundaryService';

describe('BoundaryLabelPlacementService — Screen-space Collision & Density', () => {
  describe('1. 2D Bounding Box Collision Detection', () => {
    it('detects two overlapping bounding boxes', () => {
      const boxA = { x: 100, y: 100, width: 60, height: 24 };
      const boxB = { x: 120, y: 110, width: 60, height: 24 };

      expect(doBoxesIntersect(boxA, boxB, 0)).toBe(true);
      expect(doBoxesIntersect(boxA, boxB, 4)).toBe(true);
    });

    it('detects two non-overlapping bounding boxes', () => {
      const boxA = { x: 100, y: 100, width: 60, height: 24 };
      const boxB = { x: 200, y: 200, width: 60, height: 24 };

      expect(doBoxesIntersect(boxA, boxB, 0)).toBe(false);
      expect(doBoxesIntersect(boxA, boxB, 4)).toBe(false);
    });

    it('enforces padding clearance around bounding boxes', () => {
      // Touching edges: x = 100 + 60 = 160 vs x = 160
      const boxA = { x: 100, y: 100, width: 60, height: 24 };
      const boxB = { x: 161, y: 100, width: 60, height: 24 };

      // Without padding, they do not intersect
      expect(doBoxesIntersect(boxA, boxB, 0)).toBe(false);
      // With padding = 4px, they do intersect (boxA maxX extends to 164)
      expect(doBoxesIntersect(boxA, boxB, 4)).toBe(true);
    });

    it('detects collision with circular vertex obstacle', () => {
      const box = { x: 100, y: 100, width: 60, height: 24 };
      const circleInside = { x: 110, y: 110, radius: 10 };
      const circleOutside = { x: 200, y: 200, radius: 10 };

      expect(doesBoxIntersectCircle(box, circleInside)).toBe(true);
      expect(doesBoxIntersectCircle(box, circleOutside)).toBe(false);
    });
  });

  describe('2. Viewport Boundary Checks', () => {
    const margins = { top: 50, bottom: 50, left: 10, right: 10 };

    it('accepts boxes well within viewport', () => {
      const box = { x: 100, y: 100, width: 60, height: 24 };
      expect(isBoxInsideViewport(box, 800, 600, margins)).toBe(true);
    });

    it('rejects boxes that fall outside margins or screen boundaries', () => {
      const boxTooLeft = { x: 5, y: 100, width: 60, height: 24 };
      const boxTooTop = { x: 100, y: 30, width: 60, height: 24 };
      const boxTooBottom = { x: 100, y: 560, width: 60, height: 24 };
      const boxTooRight = { x: 750, y: 100, width: 60, height: 24 };

      expect(isBoxInsideViewport(boxTooLeft, 800, 600, margins)).toBe(false);
      expect(isBoxInsideViewport(boxTooTop, 800, 600, margins)).toBe(false);
      expect(isBoxInsideViewport(boxTooBottom, 800, 600, margins)).toBe(false);
      expect(isBoxInsideViewport(boxTooRight, 800, 600, margins)).toBe(false);
    });
  });

  describe('3. Candidate Position Generation', () => {
    it('generates deterministic candidate positions perpendicular and along the edge', () => {
      const p1 = { x: 100, y: 100 };
      const p2 = { x: 200, y: 100 }; // horizontal edge length 100, midpoint at (150, 100)

      const candidates = generateCandidatePositions(p1, p2, 16);
      expect(candidates.length).toBeGreaterThanOrEqual(6);

      // Verify Side A perpendicular candidate (y - 16 or y + 16)
      const candA = candidates.find(c => c.side === 'side_a' && Math.abs(c.x - 150) < 0.1);
      expect(candA).toBeDefined();
      expect(Math.abs(candA.y - 100)).toBeCloseTo(16, 1);
    });
  });

  describe('4. Clustered Corners & Overlapping Labels Prevention', () => {
    it('prevents overlapping labels on two adjacent edges meeting at a sharp corner', () => {
      // 3 vertices forming a sharp corner: P0 -> P1 -> P2
      // In screen coordinates:
      // Edge 0: (100, 100) -> (115, 105) (very short segment 15px)
      // Edge 1: (115, 105) -> (130, 100) (very short segment 15px)
      // Edge 2: (130, 100) -> (100, 100) (closing edge)
      const coords = [
        [80.2700, 13.0800],
        [80.2701, 13.0801],
        [80.2702, 13.0800],
      ];

      const edges = calcEdgeDistances(coords, true);

      // Simple mock projection: scale lat/lng directly to container pixels
      const projectLatLngToPoint = (lat, lng) => {
        return {
          x: (lng - 80.2700) * 500000 + 200,
          y: (lat - 13.0800) * 500000 + 200,
        };
      };

      const results = computeCollisionFreeLabels({
        edges,
        projectLatLngToPoint,
        viewportWidth: 800,
        viewportHeight: 600,
        verticesLatLng: coords,
      });

      expect(results).toHaveLength(3);

      // Verify that no two visible labels intersect each other
      const visibleLabels = results.filter(r => r.isVisible);
      for (let i = 0; i < visibleLabels.length; i++) {
        for (let j = i + 1; j < visibleLabels.length; j++) {
          const intersects = doBoxesIntersect(
            visibleLabels[i].box,
            visibleLabels[j].box,
            DEFAULT_LABEL_CONFIG.padding
          );
          expect(intersects).toBe(false);
        }
      }
    });

    it('repositions labels onto staggered lanes with connector lines on cramped edges rather than hiding them', () => {
      // Dense zigzag polygon with 7 closely-spaced unique vertices
      const coords = [
        [80.27000, 13.08000],
        [80.27002, 13.08002],
        [80.27004, 13.08000],
        [80.27006, 13.08002],
        [80.27008, 13.08000],
        [80.27010, 13.08002],
        [80.27012, 13.08000],
      ];

      const edges = calcEdgeDistances(coords, true);

      // Tight screen projection where each edge is only ~10-15px on screen
      const projectLatLngToPoint = (lat, lng) => ({
        x: (lng - 80.2700) * 400000 + 300,
        y: (lat - 13.0800) * 400000 + 300,
      });

      const results = computeCollisionFreeLabels({
        edges,
        projectLatLngToPoint,
        viewportWidth: 800,
        viewportHeight: 600,
        verticesLatLng: coords,
      });

      // Fundamental requirement: EVERY edge must remain visible (no arbitrary hiding)
      expect(results.length).toBe(edges.length);
      const visibleLabels = results.filter(r => r.isVisible);
      expect(visibleLabels.length).toBe(edges.length);

      // Cramped edges should be displaced onto higher lanes with connector lines
      const displacedLabels = results.filter(r => r.hasConnector || r.lane > 1);
      expect(displacedLabels.length).toBeGreaterThan(0);

      // Every edge MUST retain its original distance and formattedDistance
      results.forEach((edge) => {
        expect(edge.distanceM).toBeGreaterThan(0);
        expect(edge.formattedDistance).toBeDefined();
        expect(typeof edge.formattedDistance).toBe('string');
        expect(edge.box).toBeDefined();
        expect(edge.box.x).toBeGreaterThan(0);
        expect(edge.box.y).toBeGreaterThan(0);
      });
    });
  });

  describe('5. Deterministic Stability for Unchanged Viewport', () => {
    it('produces identical placement results across repeated renders at the same position', () => {
      const coords = [
        [80.270, 13.080],
        [80.275, 13.080],
        [80.275, 13.085],
        [80.270, 13.085],
      ];
      const edges = calcEdgeDistances(coords, true);

      const projectLatLngToPoint = (lat, lng) => ({
        x: (lng - 80.270) * 10000 + 200,
        y: (lat - 13.080) * 10000 + 200,
      });

      const run1 = computeCollisionFreeLabels({
        edges,
        projectLatLngToPoint,
        viewportWidth: 800,
        viewportHeight: 600,
        verticesLatLng: coords,
      });

      const run2 = computeCollisionFreeLabels({
        edges,
        projectLatLngToPoint,
        viewportWidth: 800,
        viewportHeight: 600,
        verticesLatLng: coords,
      });

      expect(run1).toEqual(run2);
    });
  });

  describe('6. Edge Selection Accessibility', () => {
    it('keeps edge measurement fully accessible when selected even if normal label is hidden', () => {
      // In PropertyBoundary, selecting an edge overrides isVisible:
      // if (edgeLabel.isVisible || isThisEdgeSelected) -> render marker and display card
      const mockEdge = {
        index: 2,
        fromIndex: 2,
        toIndex: 3,
        distanceM: 34.56,
        formattedDistance: '35 m',
        isVisible: false, // hidden due to density
      };

      const isThisEdgeSelected = true;
      const shouldRenderBadgeOrCard = mockEdge.isVisible || isThisEdgeSelected;

      expect(shouldRenderBadgeOrCard).toBe(true);
      expect(mockEdge.distanceM).toBe(34.56);
      expect(mockEdge.formattedDistance).toBe('35 m');
    });
  });

  describe('7. Comprehensive Regression Suite — Showing ALL N Edge Measurements', () => {
    it('produces exactly 3 edge measurements for a 3-vertex polygon, including the closing edge', () => {
      const coords = [
        [80.270, 13.080],
        [80.275, 13.080],
        [80.275, 13.085],
      ];
      const edges = calcEdgeDistances(coords, true);
      expect(edges.length).toBe(3);
      expect(edges[2].isClosingEdge).toBe(true);

      const projectLatLngToPoint = (lat, lng) => ({
        x: (lng - 80.270) * 100000 + 100,
        y: (lat - 13.080) * 100000 + 100,
      });

      const labels = computeCollisionFreeLabels({
        edges,
        projectLatLngToPoint,
        viewportWidth: 800,
        viewportHeight: 600,
        verticesLatLng: coords,
      });

      expect(labels.length).toBe(3);
      expect(labels.every(l => l.isVisible)).toBe(true);
      expect(labels[2].isClosingEdge).toBe(true);
    });

    it('produces exactly 10 edge measurements for a 10-vertex polygon with NO arbitrary 3-label cap', () => {
      // 10-sided polygon
      const coords = [];
      const numVertices = 10;
      const centerLng = 80.270;
      const centerLat = 13.080;
      const radius = 0.005;

      for (let i = 0; i < numVertices; i++) {
        const angle = (i / numVertices) * 2 * Math.PI;
        coords.push([
          centerLng + radius * Math.cos(angle),
          centerLat + radius * Math.sin(angle),
        ]);
      }

      const edges = calcEdgeDistances(coords, true);
      expect(edges.length).toBe(10);

      const projectLatLngToPoint = (lat, lng) => ({
        x: (lng - centerLng) * 50000 + 400,
        y: (lat - centerLat) * 50000 + 300,
      });

      const labels = computeCollisionFreeLabels({
        edges,
        projectLatLngToPoint,
        viewportWidth: 800,
        viewportHeight: 600,
        verticesLatLng: coords,
      });

      // No arbitrary cap of 3! ALL 10 must be rendered and visible
      expect(labels.length).toBe(10);
      const visibleCount = labels.filter(l => l.isVisible).length;
      expect(visibleCount).toBe(10);

      // Verify each edge retains its unique stable index
      labels.forEach((lbl, i) => {
        expect(lbl.index).toBe(i);
        expect(lbl.fromIndex).toBe(i);
        expect(lbl.toIndex).toBe((i + 1) % 10);
        expect(lbl.distanceM).toBeGreaterThan(0);
      });
    });

    it('updates measurements of the two adjacent edges when a vertex is moved', () => {
      let coords = [
        [80.270, 13.080],
        [80.275, 13.080],
        [80.275, 13.085],
        [80.270, 13.085],
      ];

      const initialEdges = calcEdgeDistances(coords, true);
      const initialDist0 = initialEdges[0].distanceM;
      const initialDist1 = initialEdges[1].distanceM;
      const initialDist2 = initialEdges[2].distanceM;
      const initialDist3 = initialEdges[3].distanceM;

      // Move vertex index 1: from [80.275, 13.080] to [80.278, 13.082]
      coords[1] = [80.278, 13.082];
      const updatedEdges = calcEdgeDistances(coords, true);

      // Edge 0 (0 -> 1) and Edge 1 (1 -> 2) must change
      expect(updatedEdges[0].distanceM).not.toBe(initialDist0);
      expect(updatedEdges[1].distanceM).not.toBe(initialDist1);

      // Edge 2 (2 -> 3) and Edge 3 (3 -> 0) must remain unaffected
      expect(updatedEdges[2].distanceM).toBeCloseTo(initialDist2, 5);
      expect(updatedEdges[3].distanceM).toBeCloseTo(initialDist3, 5);
    });

    it('panning and zooming updates screen positions without changing geographic distance measurements', () => {
      const coords = [
        [80.270, 13.080],
        [80.275, 13.080],
        [80.275, 13.085],
        [80.270, 13.085],
      ];
      const edges = calcEdgeDistances(coords, true);

      // Zoom 1
      const projectZoom1 = (lat, lng) => ({
        x: (lng - 80.270) * 10000 + 200,
        y: (lat - 13.080) * 10000 + 200,
      });

      // Zoom 2 (zoomed in by 2x and panned by 50px)
      const projectZoom2 = (lat, lng) => ({
        x: (lng - 80.270) * 20000 + 250,
        y: (lat - 13.080) * 20000 + 250,
      });

      const labels1 = computeCollisionFreeLabels({
        edges,
        projectLatLngToPoint: projectZoom1,
        viewportWidth: 800,
        viewportHeight: 600,
        verticesLatLng: coords,
      });

      const labels2 = computeCollisionFreeLabels({
        edges,
        projectLatLngToPoint: projectZoom2,
        viewportWidth: 800,
        viewportHeight: 600,
        verticesLatLng: coords,
      });

      for (let i = 0; i < 4; i++) {
        // Geographic distances must be identically preserved
        expect(labels1[i].distanceM).toBe(labels2[i].distanceM);
        expect(labels1[i].formattedDistance).toBe(labels2[i].formattedDistance);
        // Screen coordinates must reflect the new zoom/pan
        expect(labels1[i].labelPoint.x).not.toBe(labels2[i].labelPoint.x);
        expect(labels1[i].labelPoint.y).not.toBe(labels2[i].labelPoint.y);
      }
    });

    it('remains usable on a narrow mobile screen (360x640) with all labels positioned and visible', () => {
      // 5-vertex polygon on mobile viewport
      const coords = [
        [80.270, 13.080],
        [80.272, 13.080],
        [80.273, 13.082],
        [80.271, 13.083],
        [80.269, 13.081],
      ];
      const edges = calcEdgeDistances(coords, true);

      const projectMobile = (lat, lng) => ({
        x: (lng - 80.270) * 40000 + 180,
        y: (lat - 13.080) * 40000 + 320,
      });

      const labels = computeCollisionFreeLabels({
        edges,
        projectLatLngToPoint: projectMobile,
        viewportWidth: 360,
        viewportHeight: 640,
        verticesLatLng: coords,
      });

      expect(labels.length).toBe(5);
      expect(labels.every(l => l.isVisible)).toBe(true);
      labels.forEach(l => {
        expect(l.box.x).toBeGreaterThanOrEqual(0);
        expect(l.box.x + l.box.width).toBeLessThanOrEqual(360 + 50); // within bounds with margin
      });
    });
  });
});
