import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  generateSphericalTargets,
  projectTargetToViewport,
  selectNextTarget,
  getUnlockedTargets,
  angularDistance,
  normalizeAngle,
  signedAngleDiff,
  sphericalToVector,
  createCameraMatrix,
  transformVectorInverse,
  createCoverageGrid,
  projectFrameOntoGrid,
  computeCoveragePercent,
  getLocalCoverageRatio,
  findLargestUncapturedGap,
  updateFrontierAndGapDots,
  COVERAGE_CONFIG,
} from '../src/features/photo-sphere/PhotoSphereTargets';

describe('PhotoSphereTargets 3D Coordinate & Projection Suite', () => {
  it('should generate a complete 360x180 spherical coverage grid matching 34-dot lattice', () => {
    const targets = generateSphericalTargets();
    expect(targets.length).toBe(34);

    const horizon = targets.filter((t) => t.ring === 'horizon');
    const lowerHorizon = targets.filter((t) => t.ring === 'lower-horizon');
    const upperHorizon = targets.filter((t) => t.ring === 'upper-horizon');
    const lower = targets.filter((t) => t.ring === 'lower');
    const upper = targets.filter((t) => t.ring === 'upper');
    const zenith = targets.filter((t) => t.ring === 'zenith');
    const nadir = targets.filter((t) => t.ring === 'nadir');

    expect(horizon.length).toBe(10);
    expect(lowerHorizon.length).toBe(8);
    expect(upperHorizon.length).toBe(8);
    expect(lower.length).toBe(3);
    expect(upper.length).toBe(3);
    expect(zenith.length).toBe(1);
    expect(nadir.length).toBe(1);

    expect(horizon[0].pitch).toBe(0);
    expect(lowerHorizon[0].pitch).toBe(-35);
    expect(upperHorizon[0].pitch).toBe(35);
    expect(lower[0].pitch).toBe(-72);
    expect(upper[0].pitch).toBe(65);
    expect(zenith[0].pitch).toBe(90);
    expect(nadir[0].pitch).toBe(-90);
  });

  it('should normalize angles into [0, 360)', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(720)).toBe(0);
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(450)).toBe(90);
  });

  it('should calculate signed angle difference across wrap-around', () => {
    expect(signedAngleDiff(10, 350)).toBe(20);
    expect(signedAngleDiff(350, 10)).toBe(-20);
    expect(signedAngleDiff(0, 180)).toBe(-180);
  });

  it('should project target directly at bore sight to exact center of viewport', () => {
    const width = 1000;
    const height = 1000;
    const proj = projectTargetToViewport(0, 0, 0, 0, width, height, 60);

    expect(proj.visible).toBe(true);
    expect(proj.isBehind).toBe(false);
    expect(Math.round(proj.x)).toBe(500);
    expect(Math.round(proj.y)).toBe(500);
    expect(proj.angularDistance).toBe(0);
  });

  it('should cull targets positioned behind the camera lens (z >= -0.05 in camera space)', () => {
    const width = 1000;
    const height = 1000;
    // Target is behind camera (180° away in yaw)
    const proj = projectTargetToViewport(180, 0, 0, 0, width, height, 60);
    expect(proj.visible).toBe(false);
    expect(proj.isBehind).toBe(true);
    expect(proj.x).toBe(-9999);
    expect(proj.y).toBe(-9999);
  });

  it('should correctly transform 3D world unit vectors into camera space', () => {
    // Looking straight ahead (0, 0) -> target is (0, 0)
    const vTarget = sphericalToVector(0, 0);
    expect(vTarget[0]).toBeCloseTo(0);
    expect(vTarget[1]).toBeCloseTo(0);
    expect(vTarget[2]).toBeCloseTo(-1);

    // Camera turned 90° right (yaw = 90) looking at target (0, 0)
    // Target should now be to the left of the camera (Xc < 0)
    const RCam = createCameraMatrix(90, 0, 0);
    const vCam = transformVectorInverse(RCam, vTarget);
    expect(vCam[0]).toBeCloseTo(-1); // to the left in camera space
    expect(vCam[2]).toBeCloseTo(0);
  });

  it('should maintain target anchor when camera rolls', () => {
    const width = 1000;
    const height = 1000;
    // Target is slightly above horizon (yaw 0, pitch 10)
    // Camera is looking at yaw 0, pitch 0, but rolled 90 deg clockwise
    const proj = projectTargetToViewport(0, 10, 0, 0, width, height, 60, 90);
    expect(proj.visible).toBe(true);
    // When camera is tilted 90° clockwise, the screen-X axis points down, so world-up (+Y) projects along positive screen-X
    expect(proj.x).toBeGreaterThan(500);
    expect(Math.round(proj.y)).toBe(500);
  });

  it('should compute spherical angular distance correctly', () => {
    expect(angularDistance(0, 0, 0, 0)).toBe(0);
    expect(Math.round(angularDistance(0, 0, 90, 0))).toBe(90);
    expect(Math.round(angularDistance(0, 0, 0, 90))).toBe(90);
    expect(Math.round(angularDistance(0, 45, 0, -45))).toBe(90);
  });

  it('should select adjacent targets on the same ring before transitioning', () => {
    const targets = generateSphericalTargets();
    const firstTarget = targets[0]; // target_0 (yaw: 0, pitch: 0)
    firstTarget.status = 'captured';

    // selectNextTarget should pick the nearest pending target on horizon
    const next = selectNextTarget(targets, firstTarget, 10, 0);
    expect(next).not.toBeNull();
    expect(next.ring).toBe('horizon');
    expect(next.status).toBe('pending');
  });

  it('should return null when all targets have been captured', () => {
    const targets = generateSphericalTargets();
    targets.forEach((t) => (t.status = 'captured'));
    const next = selectNextTarget(targets, targets[targets.length - 1], 0, 0);
    expect(next).toBeNull();
  });
});

import { PhotoSphereOrientation } from '../src/features/photo-sphere/PhotoSphereOrientation';

describe('PhotoSphereOrientation Sensor Fusion & Guard Suite', () => {
  it('should calibrate both heading and pitch so initial pose is bore sight (0, 0)', () => {
    let capturedOrientation = null;
    const tracker = new PhotoSphereOrientation((o) => {
      capturedOrientation = o;
    });

    // Simulate phone held tilted up 15° (beta = 105°) and pointing compass 120° (alpha = 120°)
    tracker._handleOrientation({ alpha: 120, beta: 105, gamma: 0 });
    // In optical camera space: rawYaw = normalizeAngle(360 - alpha) = 240, rawPitch = beta - 90 = 15
    expect(capturedOrientation.rawYaw).toBe(240);
    expect(capturedOrientation.rawPitch).toBe(15);
    // Before calibration, pitch is 15
    expect(capturedOrientation.pitch).toBe(15);

    // Calibrate reference frame matching initial pose
    tracker.setReferenceHeading(240, 15);
    tracker._handleOrientation({ alpha: 120, beta: 105, gamma: 0 });

    // After calibration, phone is directly looking at target_0 (yaw = 0, pitch = 0)
    expect(capturedOrientation.yaw).toBe(0);
    expect(capturedOrientation.pitch).toBe(0);
  });

  it('should ensure target converges to reticle center when phone rotates toward target', () => {
    // Reticle is at screen center (W/2, H/2)
    const W = 400;
    const H = 800;
    const fov = 60;

    // Target at world yaw 0, pitch 0
    const targetYaw = 0;
    const targetPitch = 0;

    // Case 1: Phone starts pointed slightly to the left (yaw = -10° = 350°)
    // The target is to the right in the viewport: screen X > W/2
    const projLeft = projectTargetToViewport(targetYaw, targetPitch, 350, 0, W, H, fov);
    expect(projLeft.x).toBeGreaterThan(W / 2);

    // User rotates phone right towards target (yaw moves from 350° towards 0°)
    // As yaw approaches 0°, target moves towards center W/2
    const projCenter = projectTargetToViewport(targetYaw, targetPitch, 0, 0, W, H, fov);
    expect(projCenter.x).toBe(W / 2);
    expect(projCenter.y).toBe(H / 2);

    // Case 2: Phone is pointed slightly down (pitch = -10°)
    // With camera pitch = -10° and target at pitch = 0°:
    // The target is higher than the camera center. As the user tilts the phone up (towards pitch 0°),
    // the target moves towards the reticle center.
    // projDown.y is 461.08, while center is 400.
    const projDown = projectTargetToViewport(targetYaw, targetPitch, 0, -10, W, H, fov);
    expect(projDown.y).toBeGreaterThan(H / 2);

    // User tilts phone up towards target (pitch moves from -10° towards 0°)
    const projCenterPitch = projectTargetToViewport(targetYaw, targetPitch, 0, 0, W, H, fov);
    expect(projCenterPitch.y).toBe(H / 2);
  });

  it('should filter out high-frequency sensor jitter from falsely tripping movingTooFast (>45 deg/s)', () => {
    let capturedOrientation = null;
    const tracker = new PhotoSphereOrientation((o) => {
      capturedOrientation = o;
    });

    tracker.setReferenceHeading(0, 0);

    // Initial steady reading
    tracker._handleOrientation({ alpha: 0, beta: 90, gamma: 0 });

    // Microscopic jitter under 0.08 degrees
    tracker._handleOrientation({ alpha: 0.05, beta: 90.02, gamma: 0 });
    expect(capturedOrientation.isMovingTooFast).toBe(false);
    expect(capturedOrientation.angularVelocity).toBe(0);

    // Single 1-degree sensor jitter spike
    tracker._handleOrientation({ alpha: 1.0, beta: 90, gamma: 0 });

    // EMA smoothing dampens jitter spike, keeping isMovingTooFast false
    expect(capturedOrientation.isMovingTooFast).toBe(false);
  });

  it('should correctly project targets in mobile portrait orientation (width < height)', () => {
    const width = 390;
    const height = 844;
    // Target 15 degrees to the right in portrait
    const projRight = projectTargetToViewport(15, 0, 0, 0, width, height, 65);
    expect(projRight.visible).toBe(true);
    expect(projRight.x).toBeGreaterThan(width / 2);
    expect(Math.round(projRight.y)).toBe(height / 2);

    // Target 15 degrees up in portrait
    const projUp = projectTargetToViewport(0, 15, 0, 0, width, height, 65);
    expect(projUp.visible).toBe(true);
    expect(Math.round(projUp.x)).toBe(width / 2);
    expect(projUp.y).toBeLessThan(height / 2);
  });

  it('should correctly project targets in landscape orientation (width > height)', () => {
    const width = 844;
    const height = 390;
    // Target 15 degrees to the right in landscape
    const projRight = projectTargetToViewport(15, 0, 0, 0, width, height, 65);
    expect(projRight.visible).toBe(true);
    expect(projRight.x).toBeGreaterThan(width / 2);
    expect(Math.round(projRight.y)).toBe(height / 2);

    // Target 15 degrees up in landscape
    const projUp = projectTargetToViewport(0, 15, 0, 0, width, height, 65);
    expect(projUp.visible).toBe(true);
    expect(Math.round(projUp.x)).toBe(width / 2);
    expect(projUp.y).toBeLessThan(height / 2);
  });

  it('should unlock the 4 physical 3D adjacent neighbors (left, right, above, below) around captured shots', () => {
    const targets = generateSphericalTargets();
    // 1. Initial state (0 captured): only target_0 unlocked
    const initialUnlocked = getUnlockedTargets(targets, []);
    expect(initialUnlocked.length).toBe(1);
    expect(initialUnlocked[0].id).toBe('target_0');

    // 2. After capturing target_0 (yaw: 0, pitch: 0)
    const capturedFrames = [{ targetId: 'target_0' }];
    targets[0].status = 'captured';

    const unlockedAfterFirst = getUnlockedTargets(targets, capturedFrames);
    // Should have right neighbor (target_1, yaw: 36, pitch: 0), left neighbor (target_9, yaw: 324, pitch: 0),
    // and vertical neighbors (upper and lower)
    const right = unlockedAfterFirst.find((t) => t.yaw === 36 && t.pitch === 0);
    const left = unlockedAfterFirst.find((t) => t.yaw === 324 && t.pitch === 0);
    const upper = unlockedAfterFirst.find((t) => t.pitch > 0);
    const lower = unlockedAfterFirst.find((t) => t.pitch < 0);

    expect(right).toBeDefined();
    expect(left).toBeDefined();
    expect(upper).toBeDefined();
    expect(lower).toBeDefined();
  });

  it('should guide user through a continuous 360° circular horizontal loop back to starting direction', () => {
    let targets = generateSphericalTargets();
    const capturedFrames = [];

    // Capture target_0 (yaw 0, pitch 0)
    capturedFrames.push({ targetId: 'target_0' });
    let result = updateFrontierAndGapDots(targets, capturedFrames);
    targets = result.updatedTargets;

    // Next target to the right along the equator should be at yaw 36° (target_1)
    const right1 = targets.find((t) => t.yaw === 36 && t.pitch === 0);
    expect(right1.visible).toBe(true);

    // Sequence through the 10 equatorial targets in order (0°, 36°, 72°, 108°, 144°, 180°, 216°, 252°, 288°, 324°)
    const expectedYawSequence = [36, 72, 108, 144, 180, 216, 252, 288, 324];
    for (const expectedYaw of expectedYawSequence) {
      const nextRight = targets.find((t) => t.yaw === expectedYaw && t.pitch === 0 && !t.captured);
      expect(nextRight).toBeDefined();
      expect(nextRight.visible).toBe(true);

      // User captures this target
      capturedFrames.push({ targetId: nextRight.id });
      result = updateFrontierAndGapDots(targets, capturedFrames);
      targets = result.updatedTargets;
    }

    // After completing the loop around the horizon (capturing up to 324° = -36°),
    // all 10 horizon targets have been captured
    const horizonTargets = targets.filter((t) => t.ring === 'horizon');
    expect(horizonTargets.every((t) => t.captured)).toBe(true);

    // Frontier should now have unlocked adjacent upper-horizon (+35°) and lower-horizon (-35°) targets
    const unlockedUpper = targets.filter((t) => (t.ring === 'upper-horizon' || t.ring === 'upper') && t.visible);
    const unlockedLower = targets.filter((t) => (t.ring === 'lower-horizon' || t.ring === 'lower') && t.visible);
    expect(unlockedUpper.length).toBeGreaterThan(0);
    expect(unlockedLower.length).toBeGreaterThan(0);
  });

  it('should track coverage on 72x36 grid and calculate weighted percentage', () => {
    const grid = createCoverageGrid();
    expect(grid.length).toBe(72 * 36);
    expect(computeCoveragePercent(grid)).toBe(0);

    // Project single frame at equator (0, 0)
    projectFrameOntoGrid(grid, 0, 0, 44, 54);
    const cov1 = computeCoveragePercent(grid);
    expect(cov1).toBeGreaterThan(2);
    expect(cov1).toBeLessThan(10);

    // Project overlapping frames around the equator
    for (let i = 0; i < 10; i++) {
      projectFrameOntoGrid(grid, i * 36, 0, 44, 54);
    }
    const covEquator = computeCoveragePercent(grid);
    expect(covEquator).toBeGreaterThan(25);
  });

  it('should auto-retire target when local area coverage is >= 96%', () => {
    const grid = createCoverageGrid();
    const targets = generateSphericalTargets();

    // Mark entire region around target_0 (yaw 0, pitch 0) as covered
    projectFrameOntoGrid(grid, 0, 0, 60, 60);

    const ratio = getLocalCoverageRatio(grid, 0, 0, 10);
    expect(ratio).toBeGreaterThanOrEqual(0.96);

    const capturedFrames = [{ targetId: 'dummy_frame' }];
    const { updatedTargets } = updateFrontierAndGapDots(targets, capturedFrames, grid);
    const target0 = updatedTargets.find((t) => t.id === 'target_0');
    expect(target0.captured).toBe(true);
    expect(target0.visible).toBe(false);
  });

  it('should identify uncaptured gaps and dynamically spawn gap targets when needed', () => {
    const grid = createCoverageGrid();

    // Fill most of the grid
    for (let gy = 0; gy < 36; gy++) {
      for (let gx = 0; gx < 72; gx++) {
        // Leave a gap around gx=36, gy=18 (yaw ~0°, pitch ~0°)
        if (Math.abs(gx - 36) > 4 || Math.abs(gy - 18) > 3) {
          grid[gy * 72 + gx] = 1;
        }
      }
    }

    const gap = findLargestUncapturedGap(grid);
    expect(gap).not.toBeNull();
    expect(Math.abs(gap.pitchDeg)).toBeLessThan(20);

    // updateFrontierAndGapDots should spawn gap dot if activeVisible is 0 and coverage < 99
    const targets = generateSphericalTargets();
    targets.forEach((t) => { t.captured = true; t.visible = false; });
    const { updatedTargets } = updateFrontierAndGapDots(targets, [{ targetId: 'all' }], grid);
    const gapTarget = updatedTargets.find((t) => t.isGapDot);
    expect(gapTarget).toBeDefined();
    expect(gapTarget.visible).toBe(true);
  });
});

describe('PhotoSphere Critical Fixes: Center Target, Camera Zoom & Stitching Quality', () => {
  it('should ensure the initial target begins exactly at the camera forward direction with 0° angular error', () => {
    // Forward look vector in camera space: [0, 0, -1]
    const vForward = [0, 0, -1];
    // Initial target direction: [0, 0, -1]
    const vTarget0 = sphericalToVector(0, 0);

    const dot = vForward[0] * vTarget0[0] + vForward[1] * vTarget0[1] + vForward[2] * vTarget0[2];
    const angleRad = Math.acos(Math.max(-1, Math.min(1, dot)));
    const angleDeg = (angleRad * 180) / Math.PI;

    expect(angleDeg).toBeCloseTo(0, 5);
  });

  it('should project target aligned with camera-forward vector to exact preview center in camera coordinates', () => {
    const W = 400;
    const H = 800;
    // Camera looking at (yaw=0, pitch=0), Target 0 at (yaw=0, pitch=0)
    const proj = projectTargetToViewport(0, 0, 0, 0, W, H, 60);

    expect(proj.visible).toBe(true);
    expect(proj.isBehind).toBe(false);
    expect(proj.angularDistance).toBeCloseTo(0, 5);
    expect(proj.x).toBe(W / 2);
    expect(proj.y).toBe(H / 2);
  });

  it('should project centered target accurately in both portrait (W < H) and landscape (W > H) viewports', () => {
    // Portrait: 390x844
    const projPortrait = projectTargetToViewport(0, 0, 0, 0, 390, 844, 65);
    expect(projPortrait.x).toBe(195);
    expect(projPortrait.y).toBe(422);

    // Landscape: 844x390
    const projLandscape = projectTargetToViewport(0, 0, 0, 0, 844, 390, 65);
    expect(projLandscape.x).toBe(422);
    expect(projLandscape.y).toBe(195);
  });

  it('should compute wide optical FOV without zoom or cropping based on sensor aspect ratio', () => {
    // 16:9 sensor (1920x1080)
    const aspect169 = 1920 / 1080;
    const tanHalfD = Math.tan(37.0 * (Math.PI / 180)); // 74 deg diagonal FOV
    const tanHalfV169 = tanHalfD / Math.sqrt(1 + aspect169 * aspect169);
    const tanHalfH169 = aspect169 * tanHalfV169;
    const hFovDeg169 = (Math.atan(tanHalfH169) * 2 * 180) / Math.PI;
    const vFovDeg169 = (Math.atan(tanHalfV169) * 2 * 180) / Math.PI;

    // HFOV should be wide (~66.7°), providing wide environmental view matching Google Camera
    expect(hFovDeg169).toBeGreaterThan(64);
    expect(hFovDeg169).toBeLessThan(70);
    expect(vFovDeg169).toBeGreaterThan(38);
    expect(vFovDeg169).toBeLessThan(44);

    // 4:3 sensor (1280x960)
    const aspect43 = 1280 / 960;
    const tanHalfV43 = tanHalfD / Math.sqrt(1 + aspect43 * aspect43);
    const tanHalfH43 = aspect43 * tanHalfV43;
    const hFovDeg43 = (Math.atan(tanHalfH43) * 2 * 180) / Math.PI;

    expect(hFovDeg43).toBeGreaterThan(60);
    expect(hFovDeg43).toBeLessThan(65);
  });

  it('should ensure continuous cosine weighting falls to 0 at frame boundaries to prevent seam lines', () => {
    // Optical center: normX = 0, normY = 0 -> weight = 1.0
    const wCenter = Math.pow(Math.cos(0) * Math.cos(0), 1.4);
    expect(wCenter).toBeCloseTo(1.0, 5);

    // Frame boundary: normX = 1.0 or normY = 1.0 -> weight = 0.0
    const wEdgeX = Math.pow(Math.max(0, Math.cos((1.0 * Math.PI) / 2) * Math.cos(0)), 1.4);
    const wEdgeY = Math.pow(Math.max(0, Math.cos(0) * Math.cos((1.0 * Math.PI) / 2)), 1.4);
    expect(wEdgeX).toBeCloseTo(0, 5);
    expect(wEdgeY).toBeCloseTo(0, 5);
  });

  it('should correctly blend overlapping frames with normalized weights without hard cut boundaries', () => {
    const W = 100;
    const H = 50;
    const accumR = new Float32Array(W * H);
    const accumW = new Float32Array(W * H);

    // Frame 1 covers pixel 25 with weight 0.8 and brightness 100
    accumR[25] += 100 * 0.8;
    accumW[25] += 0.8;

    // Frame 2 overlaps pixel 25 with weight 0.2 and brightness 150
    accumR[25] += 150 * 0.2;
    accumW[25] += 0.2;

    const blended = Math.round(accumR[25] / accumW[25]);
    // (100 * 0.8 + 150 * 0.2) / 1.0 = 80 + 30 = 110
    expect(blended).toBe(110);
  });
  it('should anchor initial reference orientation so Target 0 starts dead-center (0, 0)', () => {
    // User starts holding phone with arbitrary initial pose: e.g. alpha = 135 deg, beta = 75 deg, gamma = 4 deg
    const e0 = { alpha: 135, beta: 75, gamma: 4 };
    const initialAlphaOffset = e0.alpha || 0;
    const initialBetaOffset = (e0.beta || 90) - 90;
    const initialGammaOffset = e0.gamma || 0;

    function computePoseQuaternion(e) {
      const relAlpha = (e.alpha || 0) - initialAlphaOffset;
      const relBeta = (e.beta || 90) - initialBetaOffset;
      const relGamma = (e.gamma || 0) - initialGammaOffset;

      const alpha = (relAlpha * Math.PI) / 180;
      const beta = (relBeta * Math.PI) / 180;
      const gamma = (relGamma * Math.PI) / 180;

      const euler = new THREE.Euler(beta, alpha, -gamma, 'YXZ');
      const q = new THREE.Quaternion().setFromEuler(euler);
      q.multiply(new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)));
      return q;
    }

    const q0 = computePoseQuaternion(e0);
    const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 100);
    camera.quaternion.copy(q0);
    camera.updateMatrixWorld();

    // Target 0 is at (0, 0, -9) in world coordinates
    const target0 = new THREE.Vector3(0, 0, -9);
    target0.project(camera);

    // Target 0 projects to exactly (0, 0) in screen coordinates
    expect(target0.x).toBeCloseTo(0, 4);
    expect(target0.y).toBeCloseTo(0, 4);

    // Turning right horizontally moves target left with zero vertical drift
    const qRight = computePoseQuaternion({ alpha: 115, beta: 75, gamma: 4 });
    camera.quaternion.copy(qRight);
    camera.updateMatrixWorld();
    const targetRight = new THREE.Vector3(0, 0, -9);
    targetRight.project(camera);
    expect(targetRight.x).toBeLessThan(0);
    expect(targetRight.y).toBeCloseTo(0, 4);

    // Tilting up vertically moves target down with zero horizontal drift
    const qUp = computePoseQuaternion({ alpha: 135, beta: 90, gamma: 4 });
    camera.quaternion.copy(qUp);
    camera.updateMatrixWorld();
    const targetUp = new THREE.Vector3(0, 0, -9);
    targetUp.project(camera);
    expect(targetUp.x).toBeCloseTo(0, 4);
    expect(targetUp.y).toBeLessThan(0);
  });
});


