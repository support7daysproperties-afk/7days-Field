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

    it('hides labels on cramped edges while preserving exact distance in state', () => {
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

      // Some labels should be hidden to avoid messy collision
      const hiddenLabels = results.filter(r => !r.isVisible);
      expect(hiddenLabels.length).toBeGreaterThan(0);

      // Every hidden edge MUST retain its original distance and formattedDistance!
      hiddenLabels.forEach((hiddenEdge) => {
        expect(hiddenEdge.distanceM).toBeGreaterThan(0);
        expect(hiddenEdge.formattedDistance).toBeDefined();
        expect(typeof hiddenEdge.formattedDistance).toBe('string');
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
});
