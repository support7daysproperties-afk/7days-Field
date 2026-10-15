/**
 * PhotoSphereTargets.js
 *
 * Generates a full 360° x 180° spherical target grid following the Google Camera Photo Sphere
 * layout (equatorial ring, upper ring, zenith overhead, lower ring, nadir downward).
 *
 * Math & Coordinate Conventions:
 * - Yaw: 0° to 360° (or -180° to +180°)
 * - Pitch: -90° (nadir / directly downward) to +90° (zenith / directly overhead)
 * - Reference heading: established on 1st shot, aligning subsequent targets relatively.
 */

export function normalizeAngle(angle) {
  let n = angle % 360;
  if (n < 0) n += 360;
  if (Math.abs(n - 360) < 1e-9 || n === 0) return 0;
  return Math.round(n * 1000) / 1000;
}

export function angularDistance(yaw1, pitch1, yaw2, pitch2) {
  const toRad = Math.PI / 180;
  const dYaw = (yaw2 - yaw1) * toRad;
  const dPitch = (pitch2 - pitch1) * toRad;
  const p1 = pitch1 * toRad;
  const p2 = pitch2 * toRad;

  const a =
    Math.sin(dPitch / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dYaw / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return (c * 180) / Math.PI;
}

export function signedAngleDiff(a, b) {
  let diff = (a - b) % 360;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return diff;
}

/**
 * Generate full spherical capture targets.
 * Standard full 360x180 sphere:
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
      status: 'pending', // pending | capturing | captured
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
 * Convert 3D spherical coordinates (yaw, pitch relative to camera center)
 * into 2D screen coordinates based on camera FOV and viewport dimensions.
 *
 * @param {number} targetYaw Target relative yaw in degrees
 * @param {number} targetPitch Target relative pitch in degrees
 * @param {number} currentYaw Current camera relative yaw in degrees
 * @param {number} currentPitch Current camera pitch in degrees
 * @param {number} viewportWidth Viewport width in pixels
 * @param {number} viewportHeight Viewport height in pixels
 * @param {number} hFovDeg Horizontal field of view in degrees (default ~60°)
 */
export function projectTargetToViewport(
  targetYaw,
  targetPitch,
  currentYaw,
  currentPitch,
  viewportWidth,
  viewportHeight,
  hFovDeg = 65,
) {
  const dYaw = signedAngleDiff(targetYaw, currentYaw); // horizontal angular delta
  const dPitch = targetPitch - currentPitch;           // vertical angular delta

  // If the target is behind the camera (angular distance > 90° in azimuth), it is culled
  const isBehind = Math.abs(dYaw) > 85;

  const toRad = Math.PI / 180;
  const f = (viewportWidth / 2) / Math.tan((hFovDeg / 2) * toRad);

  // Perspective projection
  // x is horizontal offset, y is vertical offset (pointing up is negative in screen y)
  const tanYaw = Math.tan(dYaw * toRad);
  const tanPitch = Math.tan(dPitch * toRad);

  const screenX = (viewportWidth / 2) + (tanYaw * f);
  const screenY = (viewportHeight / 2) - (tanPitch * f);

  const angularDist = angularDistance(currentYaw, currentPitch, targetYaw, targetPitch);

  return {
    x: screenX,
    y: screenY,
    visible: !isBehind && screenX >= -50 && screenX <= viewportWidth + 50 && screenY >= -50 && screenY <= viewportHeight + 50,
    angularDistance: angularDist,
    dYaw,
    dPitch,
  };
}

/**
 * Select the next target to capture based on the reference Photo Sphere sequence:
 * Prefers adjacent targets on the same ring (e.g. completing horizon ring first),
 * then transitions to upper ring, zenith, lower ring, and nadir.
 *
 * @param {Array<object>} targets Array of targets
 * @param {object|null} lastTarget The most recently captured target
 * @param {number} currentYaw Current camera yaw
 * @param {number} currentPitch Current camera pitch
 * @returns {object|null} The next active target
 */
export function selectNextTarget(targets, lastTarget = null, currentYaw = 0, currentPitch = 0) {
  const pendingTargets = targets.filter((t) => t.status === 'pending');
  if (pendingTargets.length === 0) return null;

  // 1. If we have a last target, prefer pending targets in the same ring
  if (lastTarget) {
    const sameRingPending = pendingTargets.filter((t) => t.ring === lastTarget.ring);
    if (sameRingPending.length > 0) {
      // Find the one closest in azimuth to current yaw
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

  // 2. Ring order priority: horizon -> upper -> zenith -> lower -> nadir
  const ringOrder = ['horizon', 'upper', 'zenith', 'lower', 'nadir'];
  for (const ring of ringOrder) {
    const ringPending = pendingTargets.filter((t) => t.ring === ring);
    if (ringPending.length > 0) {
      // Pick nearest in angular distance to current orientation
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

