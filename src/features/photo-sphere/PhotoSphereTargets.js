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
