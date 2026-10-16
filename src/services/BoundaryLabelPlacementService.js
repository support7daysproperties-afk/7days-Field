/**
 * BoundaryLabelPlacementService.js
 *
 * Screen-space collision detection and adaptive label density for property boundary measurement labels.
 *
 * Responsibilities:
 * 1. Project edge geometry & midpoints into 2D screen coordinates via map.latLngToContainerPoint.
 * 2. Generate deterministic candidate positions for each edge (normal offset both sides, slight longitudinal offsets).
 * 3. Evaluate collision with:
 *    - Previously placed labels (using bounding boxes with padding)
 *    - Vertex handles (avoid obscuring corner points)
 *    - Viewport boundaries (avoid falling off-screen or under fixed UI panels)
 * 4. Choose best candidate or hide label if all candidates collide (adaptive density).
 * 5. Deterministic priorities to ensure visual stability without jitter during pan/zoom.
 */

export const DEFAULT_LABEL_CONFIG = {
  // Estimated label box dimension for typical formatted distance strings (e.g. "45.2 m", "124 m")
  estimatedWidth: 62,
  estimatedHeight: 24,
  padding: 4,               // Extra clearance around bounding boxes
  vertexClearanceRadius: 16,// Clearance around vertex markers
  edgeOffsetDistance: 16,   // Normal distance off the line segment in pixels
  // Screen margins where labels should not appear (avoid header, summary, bottom bars, map controls)
  screenMargin: {
    top: 110,    // Clear header and summary bar
    bottom: 140, // Clear bottom action buttons
    left: 12,
    right: 56,   // Clear right-side map buttons
  },
};

/**
 * Check if two 2D Axis-Aligned Bounding Boxes (AABB) intersect
 * Box format: { x, y, width, height }
 */
export function doBoxesIntersect(b1, b2, padding = 0) {
  const b1MinX = b1.x - padding;
  const b1MaxX = b1.x + b1.width + padding;
  const b1MinY = b1.y - padding;
  const b1MaxY = b1.y + b1.height + padding;

  const b2MinX = b2.x;
  const b2MaxX = b2.x + b2.width;
  const b2MinY = b2.y;
  const b2MaxY = b2.y + b2.height;

  return !(
    b1MaxX <= b2MinX ||
    b1MinX >= b2MaxX ||
    b1MaxY <= b2MinY ||
    b1MinY >= b2MaxY
  );
}

/**
 * Check if a bounding box overlaps with a circular obstacle (e.g., vertex marker)
 */
export function doesBoxIntersectCircle(box, circle) {
  // Nearest point on box to circle center
  const nearestX = Math.max(box.x, Math.min(circle.x, box.x + box.width));
  const nearestY = Math.max(box.y, Math.min(circle.y, box.y + box.height));

  const dx = circle.x - nearestX;
  const dy = circle.y - nearestY;
  return (dx * dx + dy * dy) < (circle.radius * circle.radius);
}

/**
 * Check if a box is within acceptable screen boundaries
 */
export function isBoxInsideViewport(box, viewportWidth, viewportHeight, margins) {
  if (box.x < margins.left) return false;
  if (box.y < margins.top) return false;
  if (box.x + box.width > viewportWidth - margins.right) return false;
  if (box.y + box.height > viewportHeight - margins.bottom) return false;
  return true;
}

/**
 * Generate candidate center positions for an edge label.
 *
 * @param {object} p1 - Screen point { x, y } of edge start
 * @param {object} p2 - Screen point { x, y } of edge end
 * @param {number} offsetDist - Distance perpendicular to edge
 * @returns {Array<{ x: number, y: number, side: string, score: number }>}
 */
export function generateCandidatePositions(p1, p2, offsetDist = 16) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);

  if (len < 1e-4) {
    return [{ x: p1.x, y: p1.y, side: 'center', score: 10 }];
  }

  // Normalized direction vector along edge
  const ux = dx / len;
  const uy = dy / len;

  // Normal vectors perpendicular to edge
  // Side A (right-hand normal) and Side B (left-hand normal)
  const nxA = -uy;
  const nyA = ux;
  const nxB = uy;
  const nyB = -ux;

  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;

  // Longitudinal offsets: center (0), slight forward (+15%), slight backward (-15%)
  const longOffsets = [0, 0.18, -0.18];

  const candidates = [];

  for (const lo of longOffsets) {
    const baseX = midX + ux * (len * lo);
    const baseY = midY + uy * (len * lo);

    // Primary preference: standard perpendicular offset (outer / Side A)
    candidates.push({
      x: baseX + nxA * offsetDist,
      y: baseY + nyA * offsetDist,
      side: 'side_a',
      score: Math.abs(lo) * 2, // 0 for exact midpoint
    });

    // Secondary preference: opposite perpendicular offset (inner / Side B)
    candidates.push({
      x: baseX + nxB * offsetDist,
      y: baseY + nyB * offsetDist,
      side: 'side_b',
      score: 1 + Math.abs(lo) * 2,
    });
  }

  // Also include exact on-edge center as a fallback if edge is very isolated
  candidates.push({
    x: midX,
    y: midY,
    side: 'on_edge',
    score: 5,
  });

  return candidates;
}

/**
 * Calculate collision-free label placements for a set of edges.
 *
 * @param {object} params
 * @param {Array}  params.edges - Edge objects from BoundaryService.calcEdgeDistances
 * @param {Function} params.projectLatLngToPoint - fn(lat, lng) => { x, y }
 * @param {Function} [params.projectPointToLatLng] - fn(x, y) => { lat, lng }
 * @param {number} params.viewportWidth
 * @param {number} params.viewportHeight
 * @param {Array}  [params.verticesLatLng] - [[lng, lat], ...] of polygon vertices
 * @param {object} [params.customConfig]
 * @returns {Array<object>} - Output array matching edges with { ...edge, isVisible, labelPoint: {x,y}, labelLatLng: {lat, lng}, box }
 */
export function computeCollisionFreeLabels({
  edges,
  projectLatLngToPoint,
  projectPointToLatLng,
  viewportWidth = 800,
  viewportHeight = 600,
  verticesLatLng = [],
  customConfig = {},
}) {
  const config = { ...DEFAULT_LABEL_CONFIG, ...customConfig };
  const margins = config.screenMargin;

  // 1. Project all vertex obstacle circles
  const vertexObstacles = (verticesLatLng || []).map((coord) => {
    // coord is [lng, lat]
    const pt = projectLatLngToPoint(coord[1], coord[0]);
    return {
      x: pt.x,
      y: pt.y,
      radius: config.vertexClearanceRadius,
    };
  });

  // 2. Sort edges by length descending: prioritize labeling longer, more significant boundaries first!
  // This gives an intuitive cartographic hierarchy where long property spans are labeled first,
  // and short cramped corners are dropped first if space runs out.
  const edgePriorities = edges.map((edge, idx) => ({
    edge,
    originalIndex: idx,
    length: edge.distanceM || 0,
  }));

  edgePriorities.sort((a, b) => b.length - a.length);

  const placedBoxes = [];
  const results = new Array(edges.length);

  for (const item of edgePriorities) {
    const edge = item.edge;
    const origIdx = item.originalIndex;

    // Project edge endpoints to screen
    const p1 = projectLatLngToPoint(edge.from[1], edge.from[0]);
    const p2 = projectLatLngToPoint(edge.to[1], edge.to[0]);

    // Check pixel length on screen. If edge is extremely tiny in screen space (< 28px),
    // it cannot reasonably hold a 60px badge without overwhelming the polygon corner.
    const screenLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (screenLen < 28) {
      results[origIdx] = {
        ...edge,
        isVisible: false,
        reason: 'edge_too_short_on_screen',
        screenLen,
      };
      continue;
    }

    // Estimate width based on formatted text length (approx 7.5px per char + 18px badge padding)
    const textLen = (edge.formattedDistance || '').length;
    const estimatedWidth = Math.max(config.estimatedWidth, textLen * 7.5 + 16);
    const estimatedHeight = config.estimatedHeight;

    const candidates = generateCandidatePositions(p1, p2, config.edgeOffsetDistance);

    let chosenCandidate = null;
    let chosenBox = null;

    for (const cand of candidates) {
      const box = {
        x: cand.x - estimatedWidth / 2,
        y: cand.y - estimatedHeight / 2,
        width: estimatedWidth,
        height: estimatedHeight,
      };

      // Check viewport boundary
      if (!isBoxInsideViewport(box, viewportWidth, viewportHeight, margins)) {
        continue;
      }

      // Check collision with already placed labels
      let collidesWithPlaced = false;
      for (const placed of placedBoxes) {
        if (doBoxesIntersect(box, placed, config.padding)) {
          collidesWithPlaced = true;
          break;
        }
      }
      if (collidesWithPlaced) continue;

      // Check collision with vertex handles
      let collidesWithVertex = false;
      for (const vObs of vertexObstacles) {
        if (doesBoxIntersectCircle(box, vObs)) {
          collidesWithVertex = true;
          break;
        }
      }
      if (collidesWithVertex) continue;

      // If we reach here, candidate is valid!
      chosenCandidate = cand;
      chosenBox = box;
      break;
    }

    if (chosenCandidate && chosenBox) {
      placedBoxes.push(chosenBox);

      let labelLatLng = null;
      if (typeof projectPointToLatLng === 'function') {
        const ll = projectPointToLatLng(chosenCandidate.x, chosenCandidate.y);
        labelLatLng = [ll.lat, ll.lng];
      } else {
        // Fallback to geometric edge midpoint in lat/lng
        labelLatLng = [edge.midpoint[1], edge.midpoint[0]];
      }

      results[origIdx] = {
        ...edge,
        isVisible: true,
        labelPoint: { x: chosenCandidate.x, y: chosenCandidate.y },
        labelLatLng,
        box: chosenBox,
        side: chosenCandidate.side,
        screenLen,
      };
    } else {
      results[origIdx] = {
        ...edge,
        isVisible: false,
        reason: 'collision_detected',
        screenLen,
        fallbackMidpointLatLng: [edge.midpoint[1], edge.midpoint[0]],
      };
    }
  }

  return results;
}
