/**
 * OrientationMath.js
 *
 * Mathematical utilities for spherical orientation, angular differences,
 * wrapping, coordinate transformations, and camera projection.
 *
 * Conforming to standard spherical navigation & n30dyn4m1c/360-photo-app conventions:
 * - Yaw: [-180, 180] or [0, 360] degrees azimuth
 * - Pitch: [-90, 90] degrees elevation (0 = horizon, +90 = zenith/sky, -90 = nadir/ground)
 * - Roll: [-180, 180] degrees tilt
 */

/**
 * Normalizes an angle into the [-180, 180) range.
 * @param {number} degrees
 * @returns {number}
 */
export function normalizeAngle180(degrees) {
  let a = degrees % 360;
  if (a >= 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}

/**
 * Normalizes an angle into the [0, 360) range.
 * @param {number} degrees
 * @returns {number}
 */
export function normalizeAngle360(degrees) {
  let a = degrees % 360;
  if (a < 0) a += 360;
  return a;
}

/**
 * Computes shortest signed delta from current angle to target angle in degrees [-180, 180].
 * positive means target is clockwise / to the right / up.
 * @param {number} currentDeg
 * @param {number} targetDeg
 * @returns {number}
 */
export function deltaAngle(currentDeg, targetDeg) {
  return normalizeAngle180(targetDeg - currentDeg);
}

/**
 * Computes angular distance (in degrees) between two spherical orientations (yaw1, pitch1) and (yaw2, pitch2).
 * Uses great-circle distance approximation (haversine) on unit sphere.
 * @param {number} yaw1
 * @param {number} pitch1
 * @param {number} yaw2
 * @param {number} pitch2
 * @returns {number} Distance in degrees
 */
export function sphericalDistance(yaw1, pitch1, yaw2, pitch2) {
  const toRad = Math.PI / 180;
  const p1 = pitch1 * toRad;
  const p2 = pitch2 * toRad;
  const dPitch = (pitch2 - pitch1) * toRad;
  const dYaw = deltaAngle(yaw1, yaw2) * toRad;

  const a =
    Math.sin(dPitch / 2) * Math.sin(dPitch / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dYaw / 2) * Math.sin(dYaw / 2);

  const c = 2 * Math.atan2(Math.sqrt(Math.min(1, Math.max(0, a))), Math.sqrt(Math.max(0, 1 - a)));
  return (c * 180) / Math.PI;
}

/**
 * Converts device orientation (alpha, beta, gamma) into world yaw, pitch, roll.
 * Handles phone in portrait mode.
 * @param {number} alpha - Z-axis rotation [0, 360]
 * @param {number} beta  - X-axis rotation [-180, 180]
 * @param {number} gamma - Y-axis rotation [-90, 90]
 * @param {number} [screenOrientation=0] - window.orientation or ScreenOrientation.angle
 * @returns {{ yaw: number, pitch: number, roll: number }}
 */
export function deviceOrientationToEuler(alpha, beta, gamma, screenOrientation = 0) {
  const degToRad = Math.PI / 180;
  const radToDeg = 180 / Math.PI;

  const _x = (beta || 0) * degToRad;
  const _y = (gamma || 0) * degToRad;
  const _z = (alpha || 0) * degToRad;

  // Rotation matrix from Euler angles (Z-X'-Y'')
  const cX = Math.cos(_x);
  const sX = Math.sin(_x);
  const cY = Math.cos(_y);
  const sY = Math.sin(_y);
  const cZ = Math.cos(_z);
  const sZ = Math.sin(_z);

  // Rotation matrix elements R
  // [ r00, r01, r02 ]
  // [ r10, r11, r12 ]
  // [ r20, r21, r22 ]
  const r20 = -cZ * sY + sZ * sX * cY;
  const r21 = -sZ * sY - cZ * sX * cY;
  const r22 = cX * cY;

  // In portrait holding upright:
  // Yaw corresponds to azimuth compass heading (0..360 or -180..180)
  // Pitch is angle relative to horizontal plane
  // Roll is tilt sideways
  let yaw = alpha != null ? normalizeAngle180(360 - alpha) : 0;
  let pitch = beta != null ? beta - 90 : 0; // When held vertical upright, beta is ~90 deg -> pitch is 0
  let roll = gamma || 0;

  // Screen orientation compensation
  if (screenOrientation === 90) {
    yaw = normalizeAngle180(yaw - 90);
  } else if (screenOrientation === -90 || screenOrientation === 270) {
    yaw = normalizeAngle180(yaw + 90);
  } else if (screenOrientation === 180) {
    yaw = normalizeAngle180(yaw + 180);
  }

  return {
    yaw: normalizeAngle180(yaw),
    pitch: Math.max(-90, Math.min(90, pitch)),
    roll: normalizeAngle180(roll),
  };
}

/**
 * Projects a 3D spherical target (targetYaw, targetPitch) onto a 2D camera viewport
 * centered at (viewportWidth / 2, viewportHeight / 2).
 *
 * @param {object} params
 * @param {number} params.targetYaw - Target yaw in degrees
 * @param {number} params.targetPitch - Target pitch in degrees
 * @param {number} params.cameraYaw - Current camera yaw in degrees
 * @param {number} params.cameraPitch - Current camera pitch in degrees
 * @param {number} params.cameraRoll - Current camera roll in degrees (optional)
 * @param {number} params.hfov - Camera horizontal FOV in degrees (e.g. 65)
 * @param {number} params.vfov - Camera vertical FOV in degrees (e.g. 50)
 * @param {number} params.viewportWidth - Measured pixel width of camera viewport
 * @param {number} params.viewportHeight - Measured pixel height of camera viewport
 * @returns {{
 *   x: number,
 *   y: number,
 *   isOnScreen: boolean,
 *   angleFromCenter: number,
 *   indicatorAngle: number,
 *   distanceDeg: number
 * }}
 */
export function projectTargetToViewport({
  targetYaw,
  targetPitch,
  cameraYaw,
  cameraPitch,
  cameraRoll = 0,
  hfov = 65,
  vfov = 50,
  viewportWidth,
  viewportHeight,
}) {
  const centerX = viewportWidth / 2;
  const centerY = viewportHeight / 2;

  const dYaw = deltaAngle(cameraYaw, targetYaw);
  // Pitch convention: if target is above camera (targetPitch > cameraPitch),
  // target appears higher on screen (smaller Y in screen coords).
  const dPitch = targetPitch - cameraPitch;

  const distDeg = sphericalDistance(cameraYaw, cameraPitch, targetYaw, targetPitch);

  // Perspective pinhole projection:
  // tan(angle) = offset / focal_length
  const radHFOV = (hfov * Math.PI) / 360;
  const radVFOV = (vfov * Math.PI) / 360;
  const focalLengthX = centerX / Math.tan(radHFOV);
  const focalLengthY = centerY / Math.tan(radVFOV);

  const radDYaw = (dYaw * Math.PI) / 180;
  const radDPitch = (dPitch * Math.PI) / 180;

  // In front of camera: |dYaw| < 90
  const isFacing = Math.abs(dYaw) <= 90;

  let rawX = centerX + Math.tan(radDYaw) * focalLengthX;
  let rawY = centerY - Math.tan(radDPitch) * focalLengthY;

  // Apply camera roll if present
  if (cameraRoll !== 0) {
    const radRoll = (-cameraRoll * Math.PI) / 180;
    const dx = rawX - centerX;
    const dy = rawY - centerY;
    rawX = centerX + (dx * Math.cos(radRoll) - dy * Math.sin(radRoll));
    rawY = centerY + (dx * Math.sin(radRoll) + dy * Math.cos(radRoll));
  }

  // Margin buffer to consider on-screen
  const margin = 24;
  const isOnScreen =
    isFacing &&
    rawX >= margin &&
    rawX <= viewportWidth - margin &&
    rawY >= margin &&
    rawY <= viewportHeight - margin;

  // Calculate indicator direction angle in radians for off-screen pointers
  const dx = rawX - centerX;
  const dy = rawY - centerY;
  // If facing away, invert pointer direction to lead user correctly around
  const effDx = isFacing ? dx : -dx;
  const effDy = isFacing ? dy : -dy;
  const indicatorAngle = Math.atan2(effDy, effDx);

  return {
    x: rawX,
    y: rawY,
    isOnScreen,
    angleFromCenter: Math.sqrt(dx * dx + dy * dy),
    indicatorAngle,
    distanceDeg: distDeg,
  };
}

/**
 * Computes circular running average of an angle series to prevent 360/0 jump jitter.
 * @param {number[]} angles - Array of angles in degrees
 * @returns {number}
 */
export function circularMeanDegrees(angles) {
  if (!angles || angles.length === 0) return 0;
  let sinSum = 0;
  let cosSum = 0;
  for (const a of angles) {
    const rad = (a * Math.PI) / 180;
    sinSum += Math.sin(rad);
    cosSum += Math.cos(rad);
  }
  const meanRad = Math.atan2(sinSum / angles.length, cosSum / angles.length);
  return normalizeAngle180((meanRad * 180) / Math.PI);
}
