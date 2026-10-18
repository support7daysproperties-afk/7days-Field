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

export const PHOTO_SPHERE_TARGETS = [
  // Ring 0: Horizon Ring (Pitch: 0°, 10 dots, Step: 36°, Stagger: 0°)
  { id: "t_0",  dotNumber: 0,  region: "horizon", ring: "horizon", yaw: 0,    pitch: 0,   x: 0,       y: 0,       z: -1      },
  { id: "t_1",  dotNumber: 1,  region: "horizon", ring: "horizon", yaw: 36,   pitch: 0,   x: 0.5878,  y: 0,       z: -0.809  },
  { id: "t_2",  dotNumber: 2,  region: "horizon", ring: "horizon", yaw: 72,   pitch: 0,   x: 0.9511,  y: 0,       z: -0.309  },
  { id: "t_3",  dotNumber: 3,  region: "horizon", ring: "horizon", yaw: 108,  pitch: 0,   x: 0.9511,  y: 0,       z: 0.309   },
  { id: "t_4",  dotNumber: 4,  region: "horizon", ring: "horizon", yaw: 144,  pitch: 0,   x: 0.5878,  y: 0,       z: 0.809   },
  { id: "t_5",  dotNumber: 5,  region: "horizon", ring: "horizon", yaw: 180,  pitch: 0,   x: 0,       y: 0,       z: 1       },
  { id: "t_6",  dotNumber: 6,  region: "horizon", ring: "horizon", yaw: -144, pitch: 0,   x: -0.5878, y: 0,       z: 0.809   },
  { id: "t_7",  dotNumber: 7,  region: "horizon", ring: "horizon", yaw: -108, pitch: 0,   x: -0.9511, y: 0,       z: 0.309   },
  { id: "t_8",  dotNumber: 8,  region: "horizon", ring: "horizon", yaw: -72,  pitch: 0,   x: -0.9511, y: 0,       z: -0.309  },
  { id: "t_9",  dotNumber: 9,  region: "horizon", ring: "horizon", yaw: -36,  pitch: 0,   x: -0.5878, y: 0,       z: -0.809  },

  // Ring 1: Upper Hemisphere Ring (Pitch: +38°, 8 dots, Step: 45°, Stagger: +22.5°)
  { id: "t_10", dotNumber: 10, region: "upper", ring: "upper", yaw: 22.5,  pitch: 38,  x: 0.3016,  y: 0.6157,  z: -0.728  },
  { id: "t_11", dotNumber: 11, region: "upper", ring: "upper", yaw: 67.5,  pitch: 38,  x: 0.728,   y: 0.6157,  z: -0.3016 },
  { id: "t_12", dotNumber: 12, region: "upper", ring: "upper", yaw: 112.5, pitch: 38,  x: 0.728,   y: 0.6157,  z: 0.3016  },
  { id: "t_13", dotNumber: 13, region: "upper", ring: "upper", yaw: 157.5, pitch: 38,  x: 0.3016,  y: 0.6157,  z: 0.728   },
  { id: "t_14", dotNumber: 14, region: "upper", ring: "upper", yaw: -157.5,pitch: 38,  x: -0.3016, y: 0.6157,  z: 0.728   },
  { id: "t_15", dotNumber: 15, region: "upper", ring: "upper", yaw: -112.5,pitch: 38,  x: -0.728,  y: 0.6157,  z: 0.3016  },
  { id: "t_16", dotNumber: 16, region: "upper", ring: "upper", yaw: -67.5, pitch: 38,  x: -0.728,  y: 0.6157,  z: -0.3016 },
  { id: "t_17", dotNumber: 17, region: "upper", ring: "upper", yaw: -22.5, pitch: 38,  x: -0.3016, y: 0.6157,  z: -0.728  },

  // Ring 2: Lower Hemisphere Ring (Pitch: -38°, 8 dots, Step: 45°, Stagger: +22.5°)
  { id: "t_18", dotNumber: 18, region: "lower", ring: "lower", yaw: 22.5,  pitch: -38, x: 0.3016,  y: -0.6157, z: -0.728  },
  { id: "t_19", dotNumber: 19, region: "lower", ring: "lower", yaw: 67.5,  pitch: -38, x: 0.728,   y: -0.6157, z: -0.3016 },
  { id: "t_20", dotNumber: 20, region: "lower", ring: "lower", yaw: 112.5, pitch: -38, x: 0.728,   y: -0.6157, z: 0.3016  },
  { id: "t_21", dotNumber: 21, region: "lower", ring: "lower", yaw: 157.5, pitch: -38, x: 0.3016,  y: -0.6157, z: 0.728   },
  { id: "t_22", dotNumber: 22, region: "lower", ring: "lower", yaw: -157.5,pitch: -38, x: -0.3016, y: -0.6157, z: 0.728   },
  { id: "t_23", dotNumber: 23, region: "lower", ring: "lower", yaw: -112.5,pitch: -38, x: -0.728,  y: -0.6157, z: 0.3016  },
  { id: "t_24", dotNumber: 24, region: "lower", ring: "lower", yaw: -67.5, pitch: -38, x: -0.728,  y: -0.6157, z: -0.3016 },
  { id: "t_25", dotNumber: 25, region: "lower", ring: "lower", yaw: -22.5, pitch: -38, x: -0.3016, y: -0.6157, z: -0.728  },

  // Ring 3: Zenith Cap (Pitch: +74°, 4 dots, Step: 90°, Stagger: 0°)
  { id: "t_26", dotNumber: 26, region: "zenith", ring: "zenith", yaw: 0,    pitch: 74,  x: 0,       y: 0.9613,  z: -0.2756 },
  { id: "t_27", dotNumber: 27, region: "zenith", ring: "zenith", yaw: 90,   pitch: 74,  x: 0.2756,  y: 0.9613,  z: 0       },
  { id: "t_28", dotNumber: 28, region: "zenith", ring: "zenith", yaw: 180,  pitch: 74,  x: 0,       y: 0.9613,  z: 0.2756  },
  { id: "t_29", dotNumber: 29, region: "zenith", ring: "zenith", yaw: -90,  pitch: 74,  x: -0.2756, y: 0.9613,  z: 0       },

  // Ring 4: Nadir Cap (Pitch: -74°, 4 dots, Step: 90°, Stagger: 0°)
  { id: "t_30", dotNumber: 30, region: "nadir", ring: "nadir", yaw: 0,    pitch: -74, x: 0,       y: -0.9613, z: -0.2756 },
  { id: "t_31", dotNumber: 31, region: "nadir", ring: "nadir", yaw: 90,   pitch: -74, x: 0.2756,  y: -0.9613, z: 0       },
  { id: "t_32", dotNumber: 32, region: "nadir", ring: "nadir", yaw: 180,  pitch: -74, x: 0,       y: -0.9613, z: 0.2756  },
  { id: "t_33", dotNumber: 33, region: "nadir", ring: "nadir", yaw: -90,  pitch: -74, x: -0.2756, y: -0.9613, z: 0       }
];

export const LATTICE_RINGS = [
  { pitchDeg: 0, count: 10, staggerDeg: 0, name: 'horizon', ring: 'horizon' },
  { pitchDeg: 38, count: 8, staggerDeg: 22.5, name: 'upper', ring: 'upper' },
  { pitchDeg: -38, count: 8, staggerDeg: 22.5, name: 'lower', ring: 'lower' },
  { pitchDeg: 74, count: 4, staggerDeg: 0, name: 'zenith', ring: 'zenith' },
  { pitchDeg: -74, count: 4, staggerDeg: 0, name: 'nadir', ring: 'nadir' },
];

export const COVERAGE_CONFIG = {
  LON_STEPS: 72,
  LAT_STEPS: 36,
  NEIGHBOR_DISTANCE_DEG: 52.0,
  AUTO_RETIRE_COVERAGE_RATIO: 0.95,
  ALIGNMENT_THRESHOLD_DEG: 4.8,
  ALIGNMENT_THRESHOLD_RAD: 0.0837,
  UNLOCK_NEIGHBOR_RAD: 0.9075,
  HOLD_DURATION_MS: 600,
  MAX_ANGULAR_VELOCITY: 5.73,
  CAPTURE_FOV_H_DEG: 46,
  CAPTURE_FOV_V_DEG: 56,
};

/**
 * Generate full spherical capture targets following exact 34-dot lattice
 * (Anchor frame t_0 + 33 target dots t_1 to t_33):
 * - Horizon (0°): 10 shots (every 36°) [Anchor t_0 + t_1..t_9]
 * - Lower Horizon (-35°): 8 shots (every 45°) [t_10..t_17]
 * - Upper Horizon (+35°): 8 shots (every 45°) [t_18..t_25]
 * - Lower (-72°): 3 shots (every 120°) [t_26..t_28]
 * - Upper (+65°): 3 shots (every 120°) [t_29..t_31]
 * - Zenith (+90°): 1 shot [t_32]
 * - Nadir (-90°): 1 shot [t_33]
 * Total: 34 base targets covering the entire sphere.
 */
export function generateSphericalTargets() {
  return PHOTO_SPHERE_TARGETS.map((t) => {
    const yawDeg = t.yaw;
    const pitchDeg = t.pitch;
    const yawNorm = normalizeAngle(yawDeg);
    const yawRad = (yawDeg * Math.PI) / 180;
    const pitchRad = (pitchDeg * Math.PI) / 180;
    const isCenterStartDot = t.dotNumber === 0;
    const v = [t.x, t.y, t.z];

    return {
      id: `target_${t.dotNumber}`,
      targetId: t.id,
      dotNumber: t.dotNumber,
      idNum: t.dotNumber,
      sequenceIndex: t.dotNumber,
      yaw: yawNorm,
      pitch: pitchDeg,
      yawDeg,
      pitchDeg,
      yawRad,
      pitchRad,
      direction: v,
      x: t.x,
      y: t.y,
      z: t.z,
      ring: t.region,
      region: t.region,
      status: 'pending',
      captured: false,
      visible: isCenterStartDot,
      isCenterStartDot,
      isGapDot: false,
    };
  });
}

/**
 * Match focal distance to the viewfinder box width (~45° camera horizontal FOV)
 * So a 36° horizon step sits cleanly outside the box to the left and right
 */
export function getProjectionScale(viewfinderWidthPx) {
  const cameraHorizontalFovRad = (45 * Math.PI) / 180;
  // Focal distance in pixels from the center of the screen:
  return (viewfinderWidthPx / 2) / Math.tan(cameraHorizontalFovRad / 2);
}

/**
 * Perspective projection with soft wide-angle compression so side dots stay visible on screen
 */
export function projectDotToScreen(x_c, y_c, z_c, screenW, screenH, viewfinderWidthPx) {
  if (z_c <= 0.15 && z_c >= -0.05) return null; // Dot is behind camera

  const focalPx = getProjectionScale(viewfinderWidthPx);
  const depth = Math.abs(z_c) || 1;

  // Perspective projection with soft wide-angle compression so side dots stay visible on screen
  const screenX = (screenW / 2) + (x_c / depth) * focalPx;
  const screenY = (screenH / 2) - (y_c / depth) * focalPx;

  return { screenX, screenY, focalPx };
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
      visible: t.isCenterStartDot || t.id === 'target_0' || t.id === 't_0' || t.targetId === 't_0',
    }));
    return { updatedTargets: updated, coveragePercent };
  }

  const capturedTargetIds = new Set(
    capturedFrames.map((f) => f.targetId || f.id)
  );
  const isTargetCaptured = (t) =>
    capturedTargetIds.has(t.id) ||
    (t.targetId && capturedTargetIds.has(t.targetId)) ||
    (t.dotNumber !== undefined && (
      capturedTargetIds.has(`target_${t.dotNumber}`) ||
      capturedTargetIds.has(`t_${t.dotNumber}`)
    )) ||
    t.captured ||
    t.status === 'captured';

  const capturedList = targets.filter(isTargetCaptured);

  const updated = targets.map((t) => {
    if (isTargetCaptured(t)) {
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
    const initialTarget = targets.find(
      (t) => t.isCenterStartDot || t.id === 'target_0' || t.id === 't_0' || t.targetId === 't_0'
    ) || targets[0];
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

/**
 * Convert W3C DeviceOrientation (alpha, beta, gamma) to a clean camera look direction (yaw, pitch)
 * WITHOUT allowing wrist roll (gamma) to twist the horizon!
 */
export function getStabilizedYawPitch(alphaDeg, betaDeg, gammaDeg) {
  const deg2rad = Math.PI / 180;
  const rad2deg = 180 / Math.PI;

  const alpha = (alphaDeg || 0) * deg2rad;
  const beta  = (betaDeg !== null && betaDeg !== undefined ? betaDeg : 90) * deg2rad;
  const gamma = (gammaDeg || 0) * deg2rad;

  // Compute forward camera vector in world space using W3C Z-X'-Y'' matrix
  const cA = Math.cos(alpha), sA = Math.sin(alpha);
  const cB = Math.cos(beta),  sB = Math.sin(beta);
  const cG = Math.cos(gamma), sG = Math.sin(gamma);

  // Forward look vector of back camera (-Z axis of device in world space)
  const vx = -sA * sB * cG - cA * sG;
  const vy =  cA * sB * cG - sA * sG;
  const vz = -cB * cG;

  // Pitch: elevation above/below horizon (-90° to +90°)
  // When phone is held upright (beta = 90°), pitch = 0° (horizon)
  const pitch = Math.asin(Math.max(-1, Math.min(1, -vz))) * rad2deg;

  // Compass-free stabilized Yaw (-180° to +180°)
  const yaw = Math.atan2(vx, vy) * rad2deg;

  return { yaw, pitch };
}

/**
 * Circular angle low-pass smoothing (shortest wrapping path)
 */
export function lerpAngleDeg(current, target, factor = 0.22) {
  let delta = ((target - current + 540) % 360) - 180;
  return current + delta * factor;
}

// Center viewfinder box field of view
export const BOX_FOV_X = 42; // degrees
export const BOX_FOV_Y = 56; // degrees

/**
 * Shared projection function for BOTH captured photo tiles AND target dots.
 * Ensures both sit at the exact same screen coordinates and move at identical speeds.
 */
export function projectWorldToScreen(
  targetYaw,
  targetPitch,
  currentYaw,
  currentPitch,
  viewportWidth,
  viewportHeight,
  boxWidth,
  boxHeight
) {
  const pxPerDegX = boxWidth / BOX_FOV_X;
  const pxPerDegY = boxHeight / BOX_FOV_Y;

  // Shortest angular delta from current camera center (currentYaw, currentPitch)
  const deltaYaw = ((targetYaw - currentYaw + 540) % 360) - 180;
  const deltaPitch = targetPitch - currentPitch;

  // Cull if more than 95° away from current view
  if (Math.abs(deltaYaw) > 95 || Math.abs(deltaPitch) > 95) return null;

  // Scale horizontal offset by cos(pitch) so upper/lower rings converge naturally without stretching
  const pitchCos = Math.max(0.25, Math.cos((targetPitch * Math.PI) / 180));

  const screenX = (viewportWidth / 2) + (deltaYaw * pitchCos) * pxPerDegX;
  const screenY = (viewportHeight / 2) - deltaPitch * pxPerDegY;

  return { screenX, screenY, deltaYaw, deltaPitch };
}

/**
 * Convert W3C DeviceOrientation (alpha, beta, gamma) into a 3x3 Rotation Matrix (Z-X'-Y'' intrinsic order)
 */
export function getCameraBasisFromDeviceOrientation(alphaDeg, betaDeg, gammaDeg) {
  const rad = Math.PI / 180;
  const a = (alphaDeg || 0) * rad;
  const b = (betaDeg !== null && betaDeg !== undefined ? betaDeg : 90) * rad;
  const g = (gammaDeg || 0) * rad;

  const cA = Math.cos(a), sA = Math.sin(a);
  const cB = Math.cos(b), sB = Math.sin(b);
  const cG = Math.cos(g), sG = Math.sin(g);

  // Device axes in World Coordinates (East = +X, North = +Y, Up = +Z)
  // Right vector of phone screen (+X_device):
  const rx = cA * cG - sA * sB * sG;
  const ry = sA * cG + cA * sB * sG;
  const rz = -cB * sG;

  // Up vector of phone screen (+Y_device):
  const ux = -sA * cB;
  const uy = cA * cB;
  const uz = sB;

  // Forward look vector of Rear Camera (-Z_device):
  const fx = -cA * sG - sA * sB * cG;
  const fy = -sA * sG + cA * sB * cG;
  const fz = -cB * cG;

  // Extract world Pitch (-90° straight down, 0° horizon, +90° straight up)
  const pitchDeg = Math.asin(Math.max(-1, Math.min(1, fz))) / rad;

  // Extract world Yaw (0° to 360° clockwise when looking from above: atan2(East, North))
  let yawDeg = Math.atan2(fx, fy) / rad;
  if (yawDeg < 0) yawDeg += 360;

  return { yawDeg, pitchDeg, right: [rx, ry, rz], up: [ux, uy, uz], forward: [fx, fy, fz] };
}

/**
 * 3D Vector Dot-Product Perspective Projection (glued to real world, roll-stabilized)
 * Used for both target dots and captured photo tiles.
 */
export function projectTargetDot3D(
  targetYaw,
  targetPitch,
  anchorYaw,
  smoothedYaw,
  smoothedPitch,
  screenWidth,
  screenHeight,
  viewfinderBoxWidth
) {
  // 1. Convert target (yaw, pitch) relative to anchorYaw into a 3D World Unit Vector:
  //    (World: +X = East/Right, +Y = North/Forward at yaw=0, +Z = Up)
  const worldYawRad = (((anchorYaw || 0) + targetYaw) * Math.PI) / 180;
  const worldPitchRad = (targetPitch * Math.PI) / 180;

  const tx = Math.cos(worldPitchRad) * Math.sin(worldYawRad);
  const ty = Math.cos(worldPitchRad) * Math.cos(worldYawRad);
  const tz = Math.sin(worldPitchRad);

  // 2. Project target vector onto a Roll-Stabilized Camera Frame:
  const camYawRad = (smoothedYaw * Math.PI) / 180;
  const camPitchRad = (smoothedPitch * Math.PI) / 180;

  // Camera Forward vector:
  const cfx = Math.cos(camPitchRad) * Math.sin(camYawRad);
  const cfy = Math.cos(camPitchRad) * Math.cos(camYawRad);
  const cfz = Math.sin(camPitchRad);

  // Horizon-locked Camera Right vector (always parallel to the floor, roll = 0!):
  const crx = Math.cos(camYawRad);
  const cry = -Math.sin(camYawRad);
  const crz = 0;

  // Horizon-locked Camera Up vector (Forward × Right):
  const cux = -Math.sin(camPitchRad) * Math.sin(camYawRad);
  const cuy = -Math.sin(camPitchRad) * Math.cos(camYawRad);
  const cuz = Math.cos(camPitchRad);

  // Dot product into camera space:
  const x_cam = tx * crx + ty * cry + tz * crz; // + is Right on screen
  const y_cam = tx * cux + ty * cuy + tz * cuz; // + is Up on screen
  const z_cam = tx * cfx + ty * cfy + tz * cfz; // + is In Front of camera

  // 3. Cull if behind camera:
  if (z_cam <= 0.15) return null;

  // 4. Convert to Screen Coordinates (where viewfinderBoxWidth = 42° horizontal FOV):
  const focalPx = (viewfinderBoxWidth / 2) / Math.tan((21 * Math.PI) / 180);
  const screenX = (screenWidth / 2) + (x_cam / z_cam) * focalPx;
  const screenY = (screenHeight / 2) - (y_cam / z_cam) * focalPx;

  return { screenX, screenY, x_cam, y_cam, z_cam, focalPx };
}

/**
 * PhotoSpherePlanner: Reference Implementation for 34-Target Lattice,
 * Frontier State Engine, and Spherical Perspective Projection.
 */
export class PhotoSpherePlanner {
  static ALIGNMENT_THRESHOLD_RAD = 0.0837; // 4.8 degrees
  static UNLOCK_NEIGHBOR_RAD = 0.9075;     // 52.0 degrees
  static ALIGNMENT_THRESHOLD_DEG = 4.8;
  static UNLOCK_NEIGHBOR_DEG = 52.0;

  static generate34Lattice() {
    return generateSphericalTargets();
  }

  static projectTarget(
    target,
    camRotMatrix, // 16-element float array (4x4 row-major) or 3x3 array
    viewportW,
    viewportH,
    fovHDeg = 46.0,
    fovVDeg = 56.0
  ) {
    const [ux, uy, uz] = target.direction || [target.x, target.y, target.z];

    let xc, yc, zc;
    if (camRotMatrix.length === 16) {
      xc = camRotMatrix[0] * ux + camRotMatrix[1] * uy + camRotMatrix[2] * uz;
      yc = camRotMatrix[4] * ux + camRotMatrix[5] * uy + camRotMatrix[6] * uz;
      zc = camRotMatrix[8] * ux + camRotMatrix[9] * uy + camRotMatrix[10] * uz;
    } else if (Array.isArray(camRotMatrix[0])) {
      xc = camRotMatrix[0][0] * ux + camRotMatrix[0][1] * uy + camRotMatrix[0][2] * uz;
      yc = camRotMatrix[1][0] * ux + camRotMatrix[1][1] * uy + camRotMatrix[1][2] * uz;
      zc = camRotMatrix[2][0] * ux + camRotMatrix[2][1] * uy + camRotMatrix[2][2] * uz;
    } else {
      xc = camRotMatrix[0] * ux + camRotMatrix[1] * uy + camRotMatrix[2] * uz;
      yc = camRotMatrix[3] * ux + camRotMatrix[4] * uy + camRotMatrix[5] * uz;
      zc = camRotMatrix[6] * ux + camRotMatrix[7] * uy + camRotMatrix[8] * uz;
    }

    if (zc >= -0.05) {
      return { x: -999, y: -999, visible: false, angularDistDeg: 180 };
    }

    const tanH = Math.tan(((fovHDeg / 2) * Math.PI) / 180);
    const tanV = Math.tan(((fovVDeg / 2) * Math.PI) / 180);

    const xNdc = xc / (-zc * tanH);
    const yNdc = yc / (-zc * tanV);

    const xPixel = (viewportW / 2) * (1 + xNdc);
    const yPixel = (viewportH / 2) * (1 - yNdc);

    const cosAngle = Math.max(-1, Math.min(1, -zc));
    const angularDistDeg = (Math.acos(cosAngle) * 180) / Math.PI;

    const inBounds = xPixel >= 0 && xPixel <= viewportW && yPixel >= 0 && yPixel <= viewportH;
    return { x: xPixel, y: yPixel, visible: inBounds, angularDistDeg };
  }
}

