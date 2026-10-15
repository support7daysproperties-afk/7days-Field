/**
 * OrientationMath.js
 *
 * Implements full 3D attitude, rotation matrix, and vector projection math
 * ported from theclumsypirate/photosphere-android (OrientationTracker, CameraBasis, SphereProjection).
 *
 * Coordinates:
 * World frame: +X East, +Y North, +Z Up.
 * Camera frame: +X Right, +Y Up, +Z Forward (straight down lens).
 */

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

export function normalizeDegrees(deg) {
  let d = deg % 360;
  if (d > 180) d -= 360;
  else if (d < -180) d += 360;
  return d;
}

export function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

/**
 * Construct 3x3 rotation matrix from Euler angles (yaw, pitch, roll in degrees).
 * Yaw: bearing clockwise from North (0° = North, 90° = East)
 * Pitch: tilt relative to horizon (0° = horizon, negative up, positive down)
 * Roll: tilt around lens axis (0° = upright)
 */
export function eulerToRotationMatrix(yawDeg, pitchDeg, rollDeg) {
  const yaw = yawDeg * DEG_TO_RAD;
  const pitch = pitchDeg * DEG_TO_RAD;
  const roll = rollDeg * DEG_TO_RAD;

  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);

  // R = R_yaw * R_pitch * R_roll
  // Returns column-major or 3x3 vectors: [right, up, forward]
  // World frame: +X East, +Y North, +Z Up.
  // When yaw=0, pitch=0, roll=0 (facing North):
  // Forward (+Z lens) = (0, 1, 0) [North]
  // Up (+Y screen) = (0, 0, 1) [Up]
  // Right (+X screen) = (1, 0, 0) [East]

  // Forward vector:
  const fX = sy * cp;
  const fY = cy * cp;
  const fZ = -sp;

  // Up vector with roll:
  // When roll=0, pitch=0: Up = (0, 0, 1)
  const uX = -sy * sp * cr + cy * -sr;
  const uY = -cy * sp * cr - sy * -sr;
  const uZ = cp * cr;

  // Right vector = Forward x Up (so Right x Up = Forward in standard camera system)
  // Or standard cross product:
  const rX = fY * uZ - fZ * uY;
  const rY = fZ * uX - fX * uZ;
  const rZ = fX * uY - fY * uX;

  const normR = Math.hypot(rX, rY, rZ) || 1;
  const normU = Math.hypot(uX, uY, uZ) || 1;
  const normF = Math.hypot(fX, fY, fZ) || 1;

  return {
    right: { x: rX / normR, y: rY / normR, z: rZ / normR },
    up: { x: uX / normU, y: uY / normU, z: uZ / normU },
    forward: { x: fX / normF, y: fY / normF, z: fZ / normF }
  };
}

/**
 * Computes angular distance (in degrees) between two unit vectors.
 */
export function angularDistanceDegrees(v1, v2) {
  const dot = clamp(v1.x * v2.x + v1.y * v2.y + v1.z * v2.z, -1, 1);
  return Math.acos(dot) * RAD_TO_DEG;
}

/**
 * Creates unit world direction vector from yaw (deg) and elevation (deg, positive up).
 */
export function targetDirection(yawDeg, elevationDeg) {
  const yaw = yawDeg * DEG_TO_RAD;
  const elevation = elevationDeg * DEG_TO_RAD;
  const cosEl = Math.cos(elevation);

  return {
    x: Math.sin(yaw) * cosEl, // East
    y: Math.cos(yaw) * cosEl, // North
    z: Math.sin(elevation)   // Up
  };
}
