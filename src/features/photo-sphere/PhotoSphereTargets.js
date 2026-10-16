/**
 * PhotoSphereTargets.js
 *
 * Implements Google Camera Photo Sphere 3D target coordinates,
 * rigid rotation matrix camera space transformation, frustum culling,
 * perspective projection, and single-target sequence progression.
 *
 * Coordinate Convention (Right-Handed):
 * - World Space:
 *   +X: Right (East)
 *   +Y: Up (Zenith)
 *   -Z: Forward (initial bore sight heading)
 * - Camera Space:
 *   +X_c: Screen Right
 *   +Y_c: Screen Up
 *   -Z_c: Camera lens pointing direction (straight out through back of phone)
 */

export function normalizeAngle(angle) {
  let n = angle % 360;
  if (n < 0) n += 360;
  if (Math.abs(n - 360) < 1e-9 || n === 0) return 0;
  return Math.round(n * 1000) / 1000;
}

export function signedAngleDiff(a, b) {
  let diff = (a - b) % 360;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return diff;
}

/**
 * Computes angular distance in degrees between two spherical directions
 */
export function angularDistance(yaw1, pitch1, yaw2, pitch2) {
  const toRad = Math.PI / 180;
  const p1 = pitch1 * toRad;
  const p2 = pitch2 * toRad;
  const dYaw = (yaw2 - yaw1) * toRad;
  const dPitch = (pitch2 - pitch1) * toRad;

  const a =
    Math.sin(dPitch / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dYaw / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return (c * 180) / Math.PI;
}

/**
 * Converts spherical (yaw, pitch) to 3D unit vector in World Space.
 * Yaw 0°, Pitch 0° corresponds to looking straight along -Z.
 * Yaw +90° turns right (+X).
 * Pitch +90° turns up (+Y).
 */
export function sphericalToVector(yawDeg, pitchDeg) {
  const toRad = Math.PI / 180;
  const y = yawDeg * toRad;
  const p = pitchDeg * toRad;
  const cosP = Math.cos(p);

  return [
    Math.sin(y) * cosP,  // X
    Math.sin(p),         // Y
    -Math.cos(y) * cosP  // Z
  ];
}

/**
 * Constructs 3x3 camera orientation matrix from Euler angles (yaw, pitch, roll in degrees).
 * R_cam maps camera local coordinates to world coordinates.
 * Inverse (R_cam^T) maps world vectors to camera frame.
 */
export function createCameraMatrix(yawDeg, pitchDeg, rollDeg = 0) {
  const toRad = Math.PI / 180;
  const y = yawDeg * toRad;
  const p = pitchDeg * toRad;
  const r = rollDeg * toRad;

  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cp = Math.cos(p);
  const sp = Math.sin(p);
  const cr = Math.cos(r);
  const sr = Math.sin(r);

  // In camera coordinates:
  // Forward vector is [0, 0, -1]. Looking at (yaw=y, pitch=p) means:
  // Forward_world = [sin(y)*cos(p), sin(p), -cos(y)*cos(p)]
  // Therefore column 2 of R (which multiplies [0, 0, -1] to get -Forward_world) is:
  // col2 = [-sin(y)*cos(p), -sin(p), cos(y)*cos(p)]
  // Column 0 is Camera Right (+Xc)
  // Column 1 is Camera Up (+Yc)
  // R = [col0 col1 col2]
  // With roll r around forward axis:
  const col0 = [
    cy * cr + sy * sp * sr,
    cp * sr,
    sy * cr - cy * sp * sr
  ];
  const col1 = [
    -cy * sr + sy * sp * cr,
    cp * cr,
    -sy * sr - cy * sp * cr
  ];
  const col2 = [
    -sy * cp,
    -sp,
    cy * cp
  ];

  return [
    [col0[0], col1[0], col2[0]],
    [col0[1], col1[1], col2[1]],
    [col0[2], col1[2], col2[2]],
  ];
}

/**
 * Multiplies transpose of 3x3 matrix by 3D vector: V_cam = R^T * V_world
 */
export function transformVectorInverse(R, v) {
  return [
    R[0][0] * v[0] + R[1][0] * v[1] + R[2][0] * v[2],
    R[0][1] * v[0] + R[1][1] * v[1] + R[2][1] * v[2],
    R[0][2] * v[0] + R[1][2] * v[1] + R[2][2] * v[2],
  ];
}

export const LATTICE_RINGS = [
  { pitchDeg: 0, count: 10, name: 'horizon' },
  { pitchDeg: 38, count: 8, name: 'upper' },
  { pitchDeg: -38, count: 8, name: 'lower' },
  { pitchDeg: 74, count: 4, name: 'zenith' },
  { pitchDeg: -74, count: 4, name: 'nadir' },
];

export const COVERAGE_CONFIG = {
  LON_STEPS: 72,
  LAT_STEPS: 36,
  NEIGHBOR_DISTANCE_DEG: 52.0,
  AUTO_RETIRE_COVERAGE_RATIO: 0.96,
  ALIGNMENT_THRESHOLD_DEG: 4.8,
  HOLD_DURATION_MS: 320,
  MAX_ANGULAR_VELOCITY: 20.0,
  CAPTURE_FOV_H_DEG: 44,
  CAPTURE_FOV_V_DEG: 54,
};

/**
 * Generate full spherical capture targets following index.html lattice:
 * - Horizon (0°): 10 shots (every 36°)
 * - Upper (+38°): 8 shots (every 45°)
 * - Lower (-38°): 8 shots (every 45°)
 * - Zenith (+74°): 4 shots (every 90°)
 * - Nadir (-74°): 4 shots (every 90°)
 * Total: 34 base targets covering the entire sphere.
 */
export function generateSphericalTargets() {
  const targets = [];
  let id = 0;

  LATTICE_RINGS.forEach((ring) => {
    for (let i = 0; i < ring.count; i++) {
      let yawDeg = ((360 / ring.count) * i) % 360;
      if (yawDeg > 180) yawDeg -= 360; // Normalize to [-180, 180]
      const yawNorm = normalizeAngle(yawDeg); // [0, 360)
      const pitchNorm = ring.pitchDeg;
      const isCenterStartDot = id === 0;

      const v = sphericalToVector(yawNorm, pitchNorm);

      targets.push({
        id: `target_${id}`,
        idNum: id,
        sequenceIndex: id,
        yaw: yawNorm,
        pitch: pitchNorm,
        yawDeg,
        pitchDeg: ring.pitchDeg,
        yawRad: (yawDeg * Math.PI) / 180,
        pitchRad: (ring.pitchDeg * Math.PI) / 180,
        direction: v,
        ring: ring.name,
        status: 'pending',
        captured: false,
        visible: isCenterStartDot,
        isCenterStartDot,
        isGapDot: false,
      });
      id++;
    }
  });

  return targets;
}

/**
 * Projects a 3D world target onto 2D camera viewport using camera rotation matrix
 * and perspective projection matching the APK's LightCycle projection.
 *
 * @param {number} targetYaw Target world yaw in degrees
 * @param {number} targetPitch Target world pitch in degrees
 * @param {number} currentYaw Current camera yaw in degrees
 * @param {number} currentPitch Current camera pitch in degrees
 * @param {number} currentRoll Current camera roll in degrees (default 0)
 * @param {number} viewportWidth Viewport width in pixels
 * @param {number} viewportHeight Viewport height in pixels
 * @param {number} hFovDeg Camera horizontal field of view in degrees (default 65°)
 */
export function projectTargetToViewport(
  targetYaw,
  targetPitch,
  currentYaw,
  currentPitch,
  viewportWidth,
  viewportHeight,
  hFovDeg = 65,
  currentRoll = 0,
) {
  // 1. Convert target to 3D world unit vector
  const vWorld = sphericalToVector(targetYaw, targetPitch);

  // 2. Build camera orientation matrix
  const RCam = createCameraMatrix(currentYaw, currentPitch, currentRoll);

  // 3. Transform to camera space: V_cam = R_cam^T * V_world
  const [xc, yc, zc] = transformVectorInverse(RCam, vWorld);

  // Angular distance to bore sight [0, 0, -1]
  // In camera coordinates, looking straight ahead is [0, 0, -1]
  const cosAngle = Math.max(-1, Math.min(1, -zc));
  const angularDist = (Math.acos(cosAngle) * 180) / Math.PI;

  const dYaw = signedAngleDiff(targetYaw, currentYaw);
  const dPitch = targetPitch - currentPitch;

  // 4. Frustum / Plane Culling:
  // Camera looks down -Z. If zc >= -0.05, the target is behind or parallel to the lens plane!
  // Behind-camera targets MUST NEVER be projected or rendered on screen.
  if (zc >= -0.05) {
    return {
      x: -9999,
      y: -9999,
      visible: false,
      angularDistance: angularDist,
      dYaw,
      dPitch,
      isBehind: true,
      cameraSpaceVector: [Math.round(xc * 1000) / 1000, Math.round(yc * 1000) / 1000, Math.round(zc * 1000) / 1000],
    };
  }

  // 5. Perspective Projection
  // In Google Camera (gof.java: m1017663474ff5f2bm):
  // When viewport is portrait (width < height), the field of view along the narrower axis (width)
  // is preserved (tanHalfFov), and the field of view along the taller axis (height) is:
  // tan(vfov / 2) = tan(hfov / 2) * (viewportHeight / viewportWidth)
  const toRad = Math.PI / 180;
  const halfFovRad = (hFovDeg / 2) * toRad;
  const tanHalfFovX = Math.tan(halfFovRad);

  // In portrait (width < height), viewportHeight > viewportWidth:
  // tanHalfFovY = tanHalfFovX * (viewportHeight / viewportWidth)
  // In landscape (width >= height):
  // tanHalfFovX is preserved for width, tanHalfFovY = tanHalfFovX * (viewportHeight / viewportWidth)
  const tanHalfFovY = tanHalfFovX * (viewportHeight / Math.max(1, viewportWidth));

  // Normalized coordinates in camera plane (-1 to +1)
  const xNorm = xc / (-zc * tanHalfFovX);
  const yNorm = yc / (-zc * tanHalfFovY);

  // Convert to screen pixel coordinates
  const screenX = (viewportWidth / 2) + (xNorm * (viewportWidth / 2));
  const screenY = (viewportHeight / 2) - (yNorm * (viewportHeight / 2));

  // Determine visibility within the viewport (with small 20px padding for smooth entry)
  const isVisible =
    screenX >= -20 &&
    screenX <= viewportWidth + 20 &&
    screenY >= -20 &&
    screenY <= viewportHeight + 20;

  return {
    x: screenX,
    y: screenY,
    visible: isVisible,
    angularDistance: angularDist,
    dYaw,
    dPitch,
    isBehind: false,
    cameraSpaceVector: [Math.round(xc * 1000) / 1000, Math.round(yc * 1000) / 1000, Math.round(zc * 1000) / 1000],
  };
}

/**
 * Initializes a logical coverage grid (72 longitude steps x 36 latitude steps).
 * Represents 5°x5° patches of the sphere surface area.
 */
export function createCoverageGrid() {
  return new Uint8Array(COVERAGE_CONFIG.LON_STEPS * COVERAGE_CONFIG.LAT_STEPS);
}

/**
 * Projects a captured camera frame frustum onto the 72x36 coverage grid.
 * Any grid cell falling inside the camera's FOV (44° H x 54° V) is marked as 1.
 */
export function projectFrameOntoGrid(
  grid,
  captureYawDeg,
  capturePitchDeg,
  hFovDeg = COVERAGE_CONFIG.CAPTURE_FOV_H_DEG,
  vFovDeg = COVERAGE_CONFIG.CAPTURE_FOV_V_DEG
) {
  if (!grid) return;
  const toRad = Math.PI / 180;
  const forward = sphericalToVector(captureYawDeg, capturePitchDeg);

  let worldUp = [0, 1, 0];
  if (Math.abs(forward[1]) > 0.98) {
    const yRad = captureYawDeg * toRad;
    worldUp = [Math.sin(yRad), 0, -Math.cos(yRad)];
  }

  // right = cross(forward, worldUp).normalize()
  const right = [
    forward[1] * worldUp[2] - forward[2] * worldUp[1],
    forward[2] * worldUp[0] - forward[0] * worldUp[2],
    forward[0] * worldUp[1] - forward[1] * worldUp[0],
  ];
  const rLen = Math.hypot(right[0], right[1], right[2]) || 1;
  right[0] /= rLen; right[1] /= rLen; right[2] /= rLen;

  // up = cross(right, forward).normalize()
  const up = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  const uLen = Math.hypot(up[0], up[1], up[2]) || 1;
  up[0] /= uLen; up[1] /= uLen; up[2] /= uLen;

  const tanHalfH = Math.tan((hFovDeg / 2) * toRad);
  const tanHalfV = Math.tan((vFovDeg / 2) * toRad);

  const lonSteps = COVERAGE_CONFIG.LON_STEPS;
  const latSteps = COVERAGE_CONFIG.LAT_STEPS;

  for (let gy = 0; gy < latSteps; gy++) {
    const lat = (0.5 - (gy + 0.5) / latSteps) * Math.PI;
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);

    for (let gx = 0; gx < lonSteps; gx++) {
      const lon = ((gx + 0.5) / lonSteps - 0.5) * 2 * Math.PI;
      const cellVec = [
        Math.sin(lon) * cosLat,
        sinLat,
        -Math.cos(lon) * cosLat,
      ];

      const dotZ = cellVec[0] * forward[0] + cellVec[1] * forward[1] + cellVec[2] * forward[2];
      if (dotZ > 0) {
        const dotR = cellVec[0] * right[0] + cellVec[1] * right[1] + cellVec[2] * right[2];
        const dotU = cellVec[0] * up[0] + cellVec[1] * up[1] + cellVec[2] * up[2];
        const nx = dotR / dotZ / tanHalfH;
        const ny = dotU / dotZ / tanHalfV;
        if (Math.abs(nx) <= 0.94 && Math.abs(ny) <= 0.94) {
          grid[gy * lonSteps + gx] = 1;
        }
      }
    }
  }
}

/**
 * Computes spherical coverage percentage weighted by cosine of latitude
 * to account for shrinking surface area near the poles.
 */
export function computeCoveragePercent(grid) {
  if (!grid) return 0;
  const lonSteps = COVERAGE_CONFIG.LON_STEPS;
  const latSteps = COVERAGE_CONFIG.LAT_STEPS;
  let totalWeight = 0;
  let coveredWeight = 0;

  for (let gy = 0; gy < latSteps; gy++) {
    const lat = (0.5 - (gy + 0.5) / latSteps) * Math.PI;
    const w = Math.cos(lat);
    for (let gx = 0; gx < lonSteps; gx++) {
      totalWeight += w;
      if (grid[gy * lonSteps + gx] === 1) {
        coveredWeight += w;
      }
    }
  }

  if (totalWeight <= 0) return 0;
  return Math.min(100, Math.round((coveredWeight / totalWeight) * 100));
}

/**
 * Checks local coverage ratio in a radius around a spherical point (yaw, pitch).
 */
export function getLocalCoverageRatio(grid, yawRad, pitchRad, radiusDeg = 10) {
  if (!grid) return 0;
  const centerCos = Math.cos(pitchRad);
  const centerVec = [
    Math.sin(yawRad) * centerCos,
    Math.sin(pitchRad),
    -Math.cos(yawRad) * centerCos,
  ];
  const cosThresh = Math.cos((radiusDeg * Math.PI) / 180);
  let total = 0;
  let covered = 0;

  const lonSteps = COVERAGE_CONFIG.LON_STEPS;
  const latSteps = COVERAGE_CONFIG.LAT_STEPS;

  for (let gy = 0; gy < latSteps; gy++) {
    const lat = (0.5 - (gy + 0.5) / latSteps) * Math.PI;
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);
    for (let gx = 0; gx < lonSteps; gx++) {
      const lon = ((gx + 0.5) / lonSteps - 0.5) * 2 * Math.PI;
      const cellVec = [
        Math.sin(lon) * cosLat,
        sinLat,
        -Math.cos(lon) * cosLat,
      ];
      const dotVal = centerVec[0] * cellVec[0] + centerVec[1] * cellVec[1] + centerVec[2] * cellVec[2];
      if (dotVal >= cosThresh) {
        total++;
        if (grid[gy * lonSteps + gx] === 1) {
          covered++;
        }
      }
    }
  }

  return total === 0 ? 1 : covered / total;
}

/**
 * Scans the coverage grid for the largest cluster of uncaptured zeros
 * and returns the centroid coordinate.
 */
export function findLargestUncapturedGap(grid) {
  if (!grid) return null;
  let bestScore = -1;
  let bestLon = 0;
  let bestLat = 0;

  const lonSteps = COVERAGE_CONFIG.LON_STEPS;
  const latSteps = COVERAGE_CONFIG.LAT_STEPS;

  for (let gy = 1; gy < latSteps - 1; gy++) {
    const lat = (0.5 - (gy + 0.5) / latSteps) * Math.PI;
    const weight = Math.cos(lat);
    for (let gx = 0; gx < lonSteps; gx++) {
      if (grid[gy * lonSteps + gx] === 0) {
        const lon = ((gx + 0.5) / lonSteps - 0.5) * 2 * Math.PI;
        const uncoveredRatio = 1 - getLocalCoverageRatio(grid, lon, lat, 16);
        const score = uncoveredRatio * (0.35 + 0.65 * weight);
        if (score > bestScore) {
          bestScore = score;
          bestLon = lon;
          bestLat = lat;
        }
      }
    }
  }

  if (bestScore > 0.05) {
    const yawDeg = normalizeAngle((bestLon * 180) / Math.PI);
    const pitchDeg = (bestLat * 180) / Math.PI;
    return {
      yawRad: bestLon,
      pitchRad: bestLat,
      yawDeg,
      pitchDeg,
    };
  }
  return null;
}

/**
 * Spawns a dynamic gap target dot to seal uncovered gaps.
 */
export function spawnGapDot(id, yawDeg, pitchDeg) {
  const yawNorm = normalizeAngle(yawDeg);
  const v = sphericalToVector(yawNorm, pitchDeg);
  return {
    id: `target_gap_${id}`,
    idNum: id,
    sequenceIndex: id,
    yaw: yawNorm,
    pitch: pitchDeg,
    yawDeg,
    pitchDeg,
    yawRad: (yawDeg * Math.PI) / 180,
    pitchRad: (pitchDeg * Math.PI) / 180,
    direction: v,
    ring: 'gap',
    status: 'pending',
    captured: false,
    visible: true,
    isCenterStartDot: false,
    isGapDot: true,
  };
}

/**
 * Updates frontier unlocking, auto-retires over-covered dots, and fills gaps.
 * Based strictly on index.html updateFrontierAndGapDots():
 * - Checks uncaptured dots against all captured dots in 3D angular space.
 * - Angular distance <= 52° unlocks contiguous frontier neighbors.
 * - Auto-retires dots with >= 96% local coverage.
 * - Dispatches dynamic gap target if frontier runs out but coverage < 99%.
 */
export function updateFrontierAndGapDots(targets, capturedFrames = [], coverageGrid = null) {
  if (!targets || targets.length === 0) return { updatedTargets: [], coveragePercent: 0 };

  const coveragePercent = coverageGrid ? computeCoveragePercent(coverageGrid) : 0;

  // At start (0 captured)
  if (capturedFrames.length === 0) {
    const updated = targets.map((t) => ({
      ...t,
      captured: false,
      status: 'pending',
      visible: t.isCenterStartDot || t.id === 'target_0',
    }));
    return { updatedTargets: updated, coveragePercent };
  }

  const capturedTargetIds = new Set(capturedFrames.map((f) => f.targetId));
  const capturedList = targets.filter(
    (t) => capturedTargetIds.has(t.id) || t.captured || t.status === 'captured'
  );

  const updated = targets.map((t) => {
    if (capturedTargetIds.has(t.id) || t.captured || t.status === 'captured') {
      return { ...t, captured: true, status: 'captured', visible: false };
    }

    // Auto-retire if coverage >= 96%
    if (coverageGrid) {
      const centerCov = getLocalCoverageRatio(coverageGrid, t.yawRad, t.pitchRad, 10);
      if (centerCov >= COVERAGE_CONFIG.AUTO_RETIRE_COVERAGE_RATIO) {
        return { ...t, captured: true, status: 'captured', visible: false, autoRetired: true };
      }
    }

    // Frontier unlocking: angular distance <= 52° to ANY captured target
    let isImmediateNeighbor = false;
    for (const cap of capturedList) {
      const dotVal =
        t.direction[0] * cap.direction[0] +
        t.direction[1] * cap.direction[1] +
        t.direction[2] * cap.direction[2];
      const ang = (Math.acos(Math.max(-1, Math.min(1, dotVal))) * 180) / Math.PI;
      if (ang <= COVERAGE_CONFIG.NEIGHBOR_DISTANCE_DEG) {
        isImmediateNeighbor = true;
        break;
      }
    }

    const isVisible = isImmediateNeighbor || t.isGapDot;
    return { ...t, visible: isVisible };
  });

  // Dynamic gap-filling: if no targets visible but coverage < 99%, locate gap
  const activeVisible = updated.filter((t) => !t.captured && t.visible);
  if (activeVisible.length === 0 && coveragePercent < 99 && coverageGrid) {
    const gap = findLargestUncapturedGap(coverageGrid);
    if (gap) {
      const gapTarget = spawnGapDot(updated.length, gap.yawDeg, gap.pitchDeg);
      updated.push(gapTarget);
    }
  }

  return { updatedTargets: updated, coveragePercent };
}

/**
 * Returns the list of currently unlocked target dots for projection and rendering.
 *
 * @param {Array} targets Full spherical target list
 * @param {Array} capturedFrames List of captured frame records
 * @param {Uint8Array} [coverageGrid] Optional 72x36 coverage grid
 */
export function getUnlockedTargets(targets, capturedFrames = [], coverageGrid = null) {
  if (!targets || targets.length === 0) return [];

  // When no photos have been taken yet, only target_0 is visible right in front
  if (capturedFrames.length === 0) {
    const initialTarget = targets.find((t) => t.isCenterStartDot || t.id === 'target_0') || targets[0];
    return [{ ...initialTarget, visible: true }];
  }

  const { updatedTargets } = updateFrontierAndGapDots(targets, capturedFrames, coverageGrid);
  return updatedTargets.filter((t) => !t.captured && t.visible);
}

/**
 * Select the active target to aim at.
 * Prioritizes the closest visible unlocked target in 3D angular space to the current camera direction.
 */
export function selectNextTarget(
  targets,
  lastTarget = null,
  currentYaw = 0,
  currentPitch = 0,
  coverageGrid = null
) {
  // 1. First look for visible unlocked pending targets
  const unlocked = targets.filter((t) => !t.captured && t.status !== 'captured' && t.visible);
  if (unlocked.length > 0) {
    const camDir = sphericalToVector(currentYaw, currentPitch);
    let closest = unlocked[0];
    let minAngle = 999;

    for (const t of unlocked) {
      const dotVal = camDir[0] * t.direction[0] + camDir[1] * t.direction[1] + camDir[2] * t.direction[2];
      const ang = (Math.acos(Math.max(-1, Math.min(1, dotVal))) * 180) / Math.PI;
      if (ang < minAngle) {
        minAngle = ang;
        closest = t;
      }
    }
    return closest;
  }

  // 2. Fallback to any pending targets if frontier unlocking is currently updating
  const pendingTargets = targets.filter((t) => !t.captured && t.status !== 'captured');
  if (pendingTargets.length === 0) return null;

  // On same ring as lastTarget first if possible
  if (lastTarget) {
    const sameRing = pendingTargets.filter((t) => t.ring === lastTarget.ring);
    if (sameRing.length > 0) {
      let closest = sameRing[0];
      let minDist = angularDistance(currentYaw, currentPitch, closest.yaw, closest.pitch);
      for (let i = 1; i < sameRing.length; i++) {
        const d = angularDistance(currentYaw, currentPitch, sameRing[i].yaw, sameRing[i].pitch);
        if (d < minDist) {
          minDist = d;
          closest = sameRing[i];
        }
      }
      return closest;
    }
  }

  return pendingTargets[0];
}
