/**
 * BoundaryLabelPlacementService.js
 *
 * Screen-space collision detection and hybrid edge-attached label layout
 * for Google Maps property boundary measurement labels.
 *
 * PRIMARY ARCHITECTURAL PRINCIPLE:
 * Measurement labels must stay attached to their respective boundary edges by default.
 * Labels must NEVER be scattered freely across the property or placed on a generic grid.
 *
 * Progressive 4-stage placement:
 *   Stage A — Preferred Position: Near edge midpoint with small perpendicular offset (~14px).
 *   Stage B — Small Adjustments: Opposite side of edge, small longitudinal shifts (±15%, ±30%),
 *             or slightly stepped perpendicular offset (22px).
 *   Stage C — Local Staggering: Stagger into nearby local lanes (30px, 40px) in the same
 *             boundary region.
 *   Stage D — Leader-line Fallback: Only when stages A-C genuine collision cannot fit without
 *             overlap, move into an outer lane with a subtle, non-intrusive leader line.
 */

export const DEFAULT_LABEL_CONFIG = {
  // Estimated label box dimension for typical formatted distance strings (e.g. "45.2 m", "124 m")
  estimatedWidth: 50,
  estimatedHeight: 20,
  padding: 3,                // Clearance between label bounding boxes
  vertexClearanceRadius: 10, // Clearance around vertex markers
  edgeOffsetDistance: 14,    // Small perpendicular offset keeping label close to edge
  screenMargin: {
    top: 60,
    bottom: 80,
    left: 10,
    right: 40,
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
 * Generate candidate positions strictly structured by progressive stages:
 *
 * Stage A: Immediate midpoint offset (Side A & Side B, outward preferred).
 * Stage B: Small adjustments (longitudinal shifts ±15%, ±30% along edge, slight offset 22px).
 * Stage C: Local staggering (perpendicular lanes 30px, 40px, keeping close to the edge).
 * Stage D: Leader-line fallback (outer lanes 52px, 66px, with hasConnector = true).
 *
 * @param {object} p1 - Screen point { x, y } of edge start
 * @param {object} p2 - Screen point { x, y } of edge end
 * @param {object} [options]
 * @param {number} [options.baseOffset] - Base perpendicular offset (default 14px)
 * @param {object} [options.polygonCenter] - Optional screen centroid to prioritize outward positions
 * @returns {Array<{ x: number, y: number, side: string, stage: string, lane: number, hasConnector: boolean, score: number, distToMid: number }>}
 */
export function generateCandidatePositions(p1, p2, options = {}) {
  const baseOffset = typeof options === 'number' ? options : (options.baseOffset || 14);
  const polygonCenter = (typeof options === 'object' && options !== null) ? options.polygonCenter : null;

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);

  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;

  if (len < 1e-4) {
    return [{
      x: midX,
      y: midY,
      side: 'center',
      stage: 'stage_a',
      lane: 1,
      hasConnector: false,
      score: 0,
      distToMid: 0,
    }];
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
    const dotA = nxA * toCentroidX + nyA * toCentroidY;
    outwardSide = dotA < 0 ? 'side_a' : 'side_b';
  }

  const inwardSide = outwardSide === 'side_a' ? 'side_b' : 'side_a';

  // Helper to build a candidate
  const makeCand = (side, perpDist, longRatio, stage, lane, hasConnector, baseStageScore) => {
    const nx = side === 'side_a' ? nxA : nxB;
    const ny = side === 'side_a' ? nyA : nyB;
    const x = midX + ux * (len * longRatio) + nx * perpDist;
    const y = midY + uy * (len * longRatio) + ny * perpDist;
    const distToMid = Math.hypot(x - midX, y - midY);
    const sidePenalty = side === outwardSide ? 0 : 5;
    const shiftPenalty = Math.abs(longRatio) * 10;
    return {
      x,
      y,
      side,
      stage,
      lane,
      hasConnector,
      score: baseStageScore + sidePenalty + shiftPenalty + distToMid * 0.1,
      distToMid,
    };
  };

  const stageA = [];
  const stageB = [];
  const stageC = [];
  const stageD = [];

  // ── Stage A: Preferred close-to-edge midpoint (outward then inward) ───────────
  // Distance: ~14px. No longitudinal shift.
  stageA.push(makeCand(outwardSide, baseOffset, 0, 'stage_a', 1, false, 0));
  stageA.push(makeCand(inwardSide, baseOffset, 0, 'stage_a', 1, false, 2));

  // ── Stage B: Small adjustments along and slightly off edge ─────────────────────
  // Small longitudinal shifts (±15%, ±30%) and slightly larger offset (1.5x ~21px)
  for (const shift of [0.15, -0.15, 0.30, -0.30]) {
    stageB.push(makeCand(outwardSide, baseOffset, shift, 'stage_b', 1, false, 10));
    stageB.push(makeCand(inwardSide, baseOffset, shift, 'stage_b', 1, false, 12));
  }
  const offsetB = baseOffset * 1.5;
  stageB.push(makeCand(outwardSide, offsetB, 0, 'stage_b', 2, false, 15));
  stageB.push(makeCand(inwardSide, offsetB, 0, 'stage_b', 2, false, 17));
  for (const shift of [0.15, -0.15]) {
    stageB.push(makeCand(outwardSide, offsetB, shift, 'stage_b', 2, false, 20));
    stageB.push(makeCand(inwardSide, offsetB, shift, 'stage_b', 2, false, 22));
  }

  // ── Stage C: Local staggering in nearby lanes ──────────────────────────────────
  // Perpendicular lanes: 2.2x (~31px) and 3.0x (~42px) with small shifts
  for (const laneMult of [2.2, 3.0]) {
    const perp = baseOffset * laneMult;
    stageC.push(makeCand(outwardSide, perp, 0, 'stage_c', 3, false, 40));
    stageC.push(makeCand(inwardSide, perp, 0, 'stage_c', 3, false, 43));
    for (const shift of [0.18, -0.18]) {
      stageC.push(makeCand(outwardSide, perp, shift, 'stage_c', 3, false, 46));
      stageC.push(makeCand(inwardSide, perp, shift, 'stage_c', 3, false, 49));
    }
  }

  // ── Stage D: Leader-line fallback (displaced outward into outer clear lane) ────
  // Only reached when tight corners/dense vertices prevent local placement.
  for (const laneMult of [3.8, 4.8]) {
    const perp = baseOffset * laneMult;
    stageD.push(makeCand(outwardSide, perp, 0, 'stage_d', 4, true, 80));
    for (const shift of [0.15, -0.15, 0.30, -0.30]) {
      stageD.push(makeCand(outwardSide, perp, shift, 'stage_d', 4, true, 85));
    }
  }

  // Sort each stage internally by score
  stageA.sort((a, b) => a.score - b.score);
  stageB.sort((a, b) => a.score - b.score);
  stageC.sort((a, b) => a.score - b.score);
  stageD.sort((a, b) => a.score - b.score);

  // Return strictly ordered: all Stage A, then Stage B, then Stage C, then Stage D
  return [...stageA, ...stageB, ...stageC, ...stageD];
}

/**
 * Calculate collision-free label placements for ALL boundary edges.
 *
 * PROGRESSIVE STAGE GUARANTEE:
 * 1. Edges are placed in natural boundary order so each edge gets first access
 *    to its own immediate edge-attached midpoint (Stage A).
 * 2. If a collision occurs, Stage B (small shifts) is attempted.
 * 3. Then Stage C (local staggering in same region) is attempted.
 * 4. Only if genuine dense clustering occurs is Stage D (leader-line) used.
 * 5. Every edge retains a stable ID and its exact geographic measurement.
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
  if (!edges || edges.length === 0) return [];

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

  // Project all vertex obstacle circles
  const vertexObstacles = (verticesLatLng || []).map((coord, idx) => {
    const pt = projectLatLngToPoint(coord[1], coord[0]);
    return {
      index: idx,
      x: pt.x,
      y: pt.y,
      radius: config.vertexClearanceRadius,
    };
  });

  // Prepare edge metadata and candidate sets in natural boundary sequence
  const edgeMeta = edges.map((edge, idx) => {
    const p1 = projectLatLngToPoint(edge.from[1], edge.from[0]);
    const p2 = projectLatLngToPoint(edge.to[1], edge.to[0]);
    const edgeMidScreen = {
      x: (p1.x + p2.x) / 2,
      y: (p1.y + p2.y) / 2,
    };

    const textLen = (edge.formattedDistance || '').length;
    const estimatedWidth = Math.max(config.estimatedWidth, textLen * 7.0 + 12);
    const estimatedHeight = config.estimatedHeight;

    const candidates = generateCandidatePositions(p1, p2, {
      baseOffset: config.edgeOffsetDistance,
      polygonCenter: polygonScreenCenter,
    });

    // Vertex obstacles to avoid: other vertices are obstacles; own endpoints are acceptable if not fully overlapping
    const otherVertexObstacles = vertexObstacles.filter(
      v => v.index !== edge.fromIndex && v.index !== edge.toIndex
    );

    return {
      edge,
      originalIndex: idx,
      stableId: edge.id || `edge-${edge.fromIndex}-${edge.toIndex}`,
      p1,
      p2,
      edgeMidScreen,
      estimatedWidth,
      estimatedHeight,
      candidates,
      otherVertexObstacles,
    };
  });

  const placedBoxes = [];
  const results = new Array(edges.length);

  // Progressive placement: Process edges sequentially to maximize clean, edge-attached alignment
  for (const item of edgeMeta) {
    const {
      edge,
      originalIndex,
      stableId,
      edgeMidScreen,
      estimatedWidth,
      estimatedHeight,
      candidates,
      otherVertexObstacles,
    } = item;

    let chosenCandidate = null;
    let chosenBox = null;

    // Helper: Test if candidate box fits with given clearance and margin restrictions
    const testCandidate = (cand, padding, useStrictMargins) => {
      const box = {
        x: cand.x - estimatedWidth / 2,
        y: cand.y - estimatedHeight / 2,
        width: estimatedWidth,
        height: estimatedHeight,
      };

      if (useStrictMargins) {
        if (!isBoxInsideViewport(box, viewportWidth, viewportHeight, margins)) {
          return null;
        }
      } else {
        // Relaxed margin: keep inside screen canvas
        if (box.x < 2 || box.y < 2 || box.x + box.width > viewportWidth - 2 || box.y + box.height > viewportHeight - 2) {
          return null;
        }
      }

      // Check collision with already placed labels
      for (const placed of placedBoxes) {
        if (doBoxesIntersect(box, placed, padding)) {
          return null;
        }
      }

      // Check collision with other vertices
      for (const vObs of otherVertexObstacles) {
        if (doesBoxIntersectCircle(box, vObs)) {
          return null;
        }
      }

      return box;
    };

    // Pass 1: Strict viewport margins and full padding clearance
    for (const cand of candidates) {
      const box = testCandidate(cand, config.padding, true);
      if (box) {
        chosenCandidate = cand;
        chosenBox = box;
        break;
      }
    }

    // Pass 2: If no strict candidate fit (e.g. narrow mobile screen), relax margins and minimal padding (1px)
    if (!chosenCandidate) {
      for (const cand of candidates) {
        const box = testCandidate(cand, 1, false);
        if (box) {
          chosenCandidate = cand;
          chosenBox = box;
          break;
        }
      }
    }

    // Pass 3 (Guaranteed Fallback): Absolutely preserve measurement visibility
    if (!chosenCandidate) {
      // Pick best Stage A/B candidate or first candidate
      chosenCandidate = candidates[0] || {
        x: edgeMidScreen.x + 14,
        y: edgeMidScreen.y - 14,
        side: 'fallback',
        stage: 'stage_b',
        lane: 1,
        hasConnector: false,
      };
      chosenBox = {
        x: chosenCandidate.x - estimatedWidth / 2,
        y: chosenCandidate.y - estimatedHeight / 2,
        width: estimatedWidth,
        height: estimatedHeight,
      };
    }

    placedBoxes.push(chosenBox);

    // Compute geographic coordinate of label center
    let labelLatLng = null;
    if (typeof projectPointToLatLng === 'function') {
      const ll = projectPointToLatLng(chosenCandidate.x, chosenCandidate.y);
      labelLatLng = [ll.lat, ll.lng];
    } else {
      labelLatLng = [edge.midpoint[1], edge.midpoint[0]];
    }

    results[originalIndex] = {
      ...edge,
      id: stableId,
      isVisible: true, // Always true: all edge measurements remain visible
      labelPoint: { x: chosenCandidate.x, y: chosenCandidate.y },
      anchorPoint: edgeMidScreen,
      labelLatLng,
      box: chosenBox,
      lane: chosenCandidate.lane,
      stage: chosenCandidate.stage,
      hasConnector: Boolean(chosenCandidate.hasConnector),
      side: chosenCandidate.side,
    };
  }

  return results;
}
