/**
 * BoundaryLabelPlacementService.js
 *
 * Screen-space collision detection and multi-lane label layout for property boundary measurement labels.
 *
 * GOAL: Every single edge of an N-sided boundary MUST have a visible measurement label.
 * No arbitrary caps. When edges or corners are cramped:
 * 1. Test multi-lane perpendicular offsets (lane 1 = 18px, lane 2 = 36px, lane 3 = 54px, lane 4 = 72px)
 * 2. Test longitudinal shifts along the edge (±20%, ±40%)
 * 3. Test outside-the-polygon outward lane expansion
 * 4. Connect displaced labels to their edge midpoint using a clean SVG connector line
 * 5. Guarantee that every edge receives an assigned readable label position
 */

export const DEFAULT_LABEL_CONFIG = {
  // Estimated label box dimension for typical formatted distance strings (e.g. "45.2 m", "124 m")
  estimatedWidth: 54,
  estimatedHeight: 22,
  padding: 3,               // Clearance around bounding boxes
  vertexClearanceRadius: 12,// Clearance around vertex markers
  edgeOffsetDistance: 16,   // Base normal distance off line segment
  screenMargin: {
    top: 90,
    bottom: 120,
    left: 8,
    right: 48,
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
 * Generate comprehensive candidate positions across multiple offset lanes and longitudinal positions.
 *
 * @param {object} p1 - Screen point { x, y } of edge start
 * @param {object} p2 - Screen point { x, y } of edge end
 * @param {object} [options]
 * @param {number} [options.baseOffset] - Base perpendicular offset (default 18px)
 * @param {object} [options.polygonCenter] - Optional screen centroid to prioritize outward positions
 * @returns {Array<{ x: number, y: number, side: string, lane: number, hasConnector: boolean, score: number }>}
 */
export function generateCandidatePositions(p1, p2, options = {}) {
  const baseOffset = typeof options === 'number' ? options : (options.baseOffset || 18);
  const polygonCenter = (typeof options === 'object' && options !== null) ? options.polygonCenter : null;

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);

  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;

  if (len < 1e-4) {
    return [{ x: midX, y: midY, side: 'center', lane: 1, hasConnector: false, score: 0 }];
  }

  // Normalized direction vector along edge
  const ux = dx / len;
  const uy = dy / len;

  // Normal vectors perpendicular to edge
  const nxA = -uy;
  const nyA = ux;
  const nxB = uy;
  const nyB = -ux;

  // Determine if Side A or Side B points outward from the polygon centroid
  let outwardSide = 'side_a';
  if (polygonCenter) {
    const toCentroidX = polygonCenter.x - midX;
    const toCentroidY = polygonCenter.y - midY;
    // Dot product with normal A
    const dotA = nxA * toCentroidX + nyA * toCentroidY;
    outwardSide = dotA < 0 ? 'side_a' : 'side_b';
  }

  // 4 offset lanes: lane 1 (close ~18px), lane 2 (~36px), lane 3 (~54px), lane 4 (~72px)
  const lanes = [1, 2, 3, 4];
  // Longitudinal offsets: center (0), slight forward (+22%), slight backward (-22%), outer (+40%, -40%)
  const longOffsets = [0, 0.22, -0.22, 0.40, -0.40];

  const candidates = [];

  for (const lane of lanes) {
    const laneDist = baseOffset * lane;
    const hasConnector = lane > 1;

    for (const lo of longOffsets) {
      const baseX = midX + ux * (len * lo);
      const baseY = midY + uy * (len * lo);

      // Candidate on Side A
      const candA = {
        x: baseX + nxA * laneDist,
        y: baseY + nyA * laneDist,
        side: 'side_a',
        lane,
        hasConnector: hasConnector || Math.abs(lo) > 0.25,
        score: (outwardSide === 'side_a' ? 0 : 2) + (lane - 1) * 3 + Math.abs(lo) * 2,
      };

      // Candidate on Side B
      const candB = {
        x: baseX + nxB * laneDist,
        y: baseY + nyB * laneDist,
        side: 'side_b',
        lane,
        hasConnector: hasConnector || Math.abs(lo) > 0.25,
        score: (outwardSide === 'side_b' ? 0 : 2) + (lane - 1) * 3 + Math.abs(lo) * 2,
      };

      candidates.push(candA, candB);
    }
  }

  // Fallback candidate at exact midpoint
  candidates.push({
    x: midX,
    y: midY,
    side: 'on_edge',
    lane: 0,
    hasConnector: false,
    score: 20,
  });

  // Sort by score ascending (lowest score = highest preference)
  candidates.sort((a, b) => a.score - b.score);
  return candidates;
}

/**
 * Calculate collision-free label placements for ALL boundary edges.
 *
 * Guarantees every edge receives a visible measurement label.
 *
 * @param {object} params
 * @param {Array}  params.edges - Edge objects from BoundaryService.calcEdgeDistances
 * @param {Function} params.projectLatLngToPoint - fn(lat, lng) => { x, y }
 * @param {Function} [params.projectPointToLatLng] - fn(x, y) => { lat, lng }
 * @param {number} params.viewportWidth
 * @param {number} params.viewportHeight
 * @param {Array}  [params.verticesLatLng] - [[lng, lat], ...] of polygon vertices
 * @param {object} [params.customConfig]
 * @returns {Array<object>} - Output array matching edges with { ...edge, isVisible: true, labelPoint: {x,y}, labelLatLng: {lat, lng}, box, hasConnector, anchorPoint: {x,y} }
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

  // Calculate polygon screen centroid to direct displaced labels outward
  let polygonScreenCenter = null;
  if (verticesLatLng && verticesLatLng.length >= 3) {
    let sumX = 0;
    let sumY = 0;
    verticesLatLng.forEach((coord) => {
      const pt = projectLatLngToPoint(coord[1], coord[0]);
      sumX += pt.x;
      sumY += pt.y;
    });
    polygonScreenCenter = {
      x: sumX / verticesLatLng.length,
      y: sumY / verticesLatLng.length,
    };
  }

  // 1. Project all vertex obstacle circles
  const vertexObstacles = (verticesLatLng || []).map((coord) => {
    const pt = projectLatLngToPoint(coord[1], coord[0]);
    return {
      x: pt.x,
      y: pt.y,
      radius: config.vertexClearanceRadius,
    };
  });

  // Sort edges by distance descending: place long edges first, then fit shorter edges around them
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

    // Project edge endpoints & midpoint to screen
    const p1 = projectLatLngToPoint(edge.from[1], edge.from[0]);
    const p2 = projectLatLngToPoint(edge.to[1], edge.to[0]);
    const edgeMidScreen = {
      x: (p1.x + p2.x) / 2,
      y: (p1.y + p2.y) / 2,
    };

    const textLen = (edge.formattedDistance || '').length;
    const estimatedWidth = Math.max(config.estimatedWidth, textLen * 7.0 + 14);
    const estimatedHeight = config.estimatedHeight;

    const candidates = generateCandidatePositions(p1, p2, {
      baseOffset: config.edgeOffsetDistance,
      polygonCenter: polygonScreenCenter,
    });

    let chosenCandidate = null;
    let chosenBox = null;

    // First pass: Find non-colliding candidate that respects viewport margins
    for (const cand of candidates) {
      const box = {
        x: cand.x - estimatedWidth / 2,
        y: cand.y - estimatedHeight / 2,
        width: estimatedWidth,
        height: estimatedHeight,
      };

      if (!isBoxInsideViewport(box, viewportWidth, viewportHeight, margins)) {
        continue;
      }

      let collidesWithPlaced = false;
      for (const placed of placedBoxes) {
        if (doBoxesIntersect(box, placed, config.padding)) {
          collidesWithPlaced = true;
          break;
        }
      }
      if (collidesWithPlaced) continue;

      let collidesWithVertex = false;
      for (const vObs of vertexObstacles) {
        if (doesBoxIntersectCircle(box, vObs)) {
          collidesWithVertex = true;
          break;
        }
      }
      if (collidesWithVertex) continue;

      chosenCandidate = cand;
      chosenBox = box;
      break;
    }

    // Second pass: If strict padding/margins were too tight on a dense polygon,
    // relax padding and screen margins so the measurement is STILL VISIBLE (never hidden!)
    if (!chosenCandidate) {
      for (const cand of candidates) {
        const box = {
          x: cand.x - estimatedWidth / 2,
          y: cand.y - estimatedHeight / 2,
          width: estimatedWidth,
          height: estimatedHeight,
        };

        // Allow candidate if it's anywhere within the actual screen canvas
        if (box.x < 2 || box.y < 2 || box.x + box.width > viewportWidth - 2 || box.y + box.height > viewportHeight - 2) {
          continue;
        }

        let collides = false;
        for (const placed of placedBoxes) {
          if (doBoxesIntersect(box, placed, 1)) {
            collides = true;
            break;
          }
        }
        if (!collides) {
          chosenCandidate = cand;
          chosenBox = box;
          break;
        }
      }
    }

    // Guaranteed fallback: If absolutely every candidate was touched, take the best candidate
    // with outward displacement so no measurement is ever dropped!
    if (!chosenCandidate) {
      chosenCandidate = candidates[0] || {
        x: edgeMidScreen.x + 24,
        y: edgeMidScreen.y - 24,
        side: 'fallback',
        lane: 2,
        hasConnector: true,
      };
      chosenBox = {
        x: chosenCandidate.x - estimatedWidth / 2,
        y: chosenCandidate.y - estimatedHeight / 2,
        width: estimatedWidth,
        height: estimatedHeight,
      };
    }

    placedBoxes.push(chosenBox);

    let labelLatLng = null;
    if (typeof projectPointToLatLng === 'function') {
      const ll = projectPointToLatLng(chosenCandidate.x, chosenCandidate.y);
      labelLatLng = [ll.lat, ll.lng];
    } else {
      labelLatLng = [edge.midpoint[1], edge.midpoint[0]];
    }

    results[origIdx] = {
      ...edge,
      isVisible: true, // Always true! All measurements must show
      labelPoint: { x: chosenCandidate.x, y: chosenCandidate.y },
      anchorPoint: edgeMidScreen,
      labelLatLng,
      box: chosenBox,
      lane: chosenCandidate.lane,
      hasConnector: chosenCandidate.hasConnector,
      side: chosenCandidate.side,
    };
  }

  return results;
}
