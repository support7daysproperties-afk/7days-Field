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

/**
 * Generate full spherical capture targets following Google Camera LightCycle layout:
 * - Horizon (0°): 10 shots (every 36°)
 * - Upper (+35°): 8 shots (every 45°)
 * - Zenith (+78°): 2 shots (opposite yaw)
 * - Lower (-35°): 8 shots (every 45°)
 * - Nadir (-78°): 2 shots (opposite yaw)
 * Total: 30 targets covering the entire sphere.
 */
export function generateSphericalTargets() {
  const targets = [];
  let seq = 0;

  // 1. Horizon ring (pitch = 0°)
  for (let i = 0; i < 10; i++) {
    targets.push({
      id: `target_${seq}`,
      sequenceIndex: seq++,
      yaw: i * 36,
      pitch: 0,
      ring: 'horizon',
      status: 'pending',
    });
  }

  // 2. Upper ring (pitch = +35°)
  for (let i = 0; i < 8; i++) {
    targets.push({
      id: `target_${seq}`,
      sequenceIndex: seq++,
      yaw: i * 45,
      pitch: 35,
      ring: 'upper',
      status: 'pending',
    });
  }

  // 3. Zenith (pitch = +78°)
  for (let i = 0; i < 2; i++) {
    targets.push({
      id: `target_${seq}`,
      sequenceIndex: seq++,
      yaw: i * 180,
      pitch: 78,
      ring: 'zenith',
      status: 'pending',
    });
  }

  // 4. Lower ring (pitch = -35°)
  for (let i = 0; i < 8; i++) {
    targets.push({
      id: `target_${seq}`,
      sequenceIndex: seq++,
      yaw: i * 45,
      pitch: -35,
      ring: 'lower',
      status: 'pending',
    });
  }

  // 5. Nadir (pitch = -78°)
  for (let i = 0; i < 2; i++) {
    targets.push({
      id: `target_${seq}`,
      sequenceIndex: seq++,
      yaw: i * 180,
      pitch: -78,
      ring: 'nadir',
      status: 'pending',
    });
  }

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
  };
}

/**
 * Returns the list of currently unlocked targets:
 * - At startup (0 captured): only target_0 (dead center in front of you) is active.
 * - After captures: unlocks the adjacent 4 targets (Left, Right, Above, Below)
 *   around every captured frame so the user sees real floating marbles in physical 3D space.
 *
 * @param {Array} targets Full spherical target list
 * @param {Array} capturedFrames List of captured frame records
 */
export function getUnlockedTargets(targets, capturedFrames = []) {
  if (!targets || targets.length === 0) return [];

  // When no photos have been taken yet, only target_0 is visible right in front
  if (capturedFrames.length === 0) {
    const initialTarget = targets.find((t) => t.id === 'target_0') || targets[0];
    return [initialTarget];
  }

  const capturedTargetIds = new Set(capturedFrames.map((f) => f.targetId));
  const unlockedTargetIds = new Set();

  // For every photo captured so far, find its 4 adjacent pending neighbors (Left, Right, Above, Below)
  capturedFrames.forEach((frame) => {
    const current = targets.find((t) => t.id === frame.targetId);
    if (!current) return;

    // Find closest pending neighbors in 4 directions:
    // 1. Right (dYaw > 0, same/close pitch)
    // 2. Left (dYaw < 0, same/close pitch)
    // 3. Above (pitch > current.pitch)
    // 4. Below (pitch < current.pitch)

    const pending = targets.filter((t) => t.status === 'pending');

    // Horizontal neighbors along the ring
    const sameRingPending = pending.filter((t) => t.ring === current.ring);
    let rightNeighbor = null;
    let minRightDiff = 999;
    let leftNeighbor = null;
    let minLeftDiff = 999;

    sameRingPending.forEach((t) => {
      const diff = signedAngleDiff(t.yaw, current.yaw);
      if (diff > 0 && diff < minRightDiff) {
        minRightDiff = diff;
        rightNeighbor = t;
      } else if (diff < 0 && Math.abs(diff) < minLeftDiff) {
        minLeftDiff = Math.abs(diff);
        leftNeighbor = t;
      }
    });

    if (rightNeighbor && minRightDiff <= 55) unlockedTargetIds.add(rightNeighbor.id);
    if (leftNeighbor && minLeftDiff <= 55) unlockedTargetIds.add(leftNeighbor.id);

    // Vertical neighbors (above / below)
    let aboveNeighbor = null;
    let minAboveDist = 999;
    let belowNeighbor = null;
    let minBelowDist = 999;

    pending.forEach((t) => {
      const pDiff = t.pitch - current.pitch;
      const yDiff = Math.abs(signedAngleDiff(t.yaw, current.yaw));

      if (pDiff > 10 && pDiff < 60 && yDiff <= 45) {
        const dist = Math.hypot(yDiff, pDiff);
        if (dist < minAboveDist) {
          minAboveDist = dist;
          aboveNeighbor = t;
        }
      } else if (pDiff < -10 && pDiff > -60 && yDiff <= 45) {
        const dist = Math.hypot(yDiff, pDiff);
        if (dist < minBelowDist) {
          minBelowDist = dist;
          belowNeighbor = t;
        }
      }
    });

    if (aboveNeighbor) unlockedTargetIds.add(aboveNeighbor.id);
    if (belowNeighbor) unlockedTargetIds.add(belowNeighbor.id);
  });

  // If all adjacent neighbors are somehow taken, unlock remaining pending targets nearest to last shot
  if (unlockedTargetIds.size === 0) {
    const remainingPending = targets.filter((t) => t.status === 'pending');
    if (remainingPending.length > 0) {
      unlockedTargetIds.add(remainingPending[0].id);
    }
  }

  return targets.filter((t) => unlockedTargetIds.has(t.id));
}

/**
 * Select the next target to capture matching Google Camera's sequence:
 * Completes equatorial horizon ring first in a circular sweep,
 * then upper ring, zenith, lower ring, and nadir.
 */
export function selectNextTarget(targets, lastTarget = null, currentYaw = 0, currentPitch = 0) {
  const pendingTargets = targets.filter((t) => t.status === 'pending');
  if (pendingTargets.length === 0) return null;

  // 1. If currently on a ring, select the next adjacent target on the same ring
  if (lastTarget) {
    const sameRingPending = pendingTargets.filter((t) => t.ring === lastTarget.ring);
    if (sameRingPending.length > 0) {
      let closest = sameRingPending[0];
      let minDist = angularDistance(currentYaw, currentPitch, closest.yaw, closest.pitch);
      for (let i = 1; i < sameRingPending.length; i++) {
        const d = angularDistance(currentYaw, currentPitch, sameRingPending[i].yaw, sameRingPending[i].pitch);
        if (d < minDist) {
          minDist = d;
          closest = sameRingPending[i];
        }
      }
      return closest;
    }
  }

  // 2. Progression order: horizon -> upper -> zenith -> lower -> nadir
  const ringOrder = ['horizon', 'upper', 'zenith', 'lower', 'nadir'];
  for (const ring of ringOrder) {
    const ringPending = pendingTargets.filter((t) => t.ring === ring);
    if (ringPending.length > 0) {
      let closest = ringPending[0];
      let minDist = angularDistance(currentYaw, currentPitch, closest.yaw, closest.pitch);
      for (let i = 1; i < ringPending.length; i++) {
        const d = angularDistance(currentYaw, currentPitch, ringPending[i].yaw, ringPending[i].pitch);
        if (d < minDist) {
          minDist = d;
          closest = ringPending[i];
        }
      }
      return closest;
    }
  }

  return pendingTargets[0];
}
