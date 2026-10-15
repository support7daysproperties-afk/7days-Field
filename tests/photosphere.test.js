import { describe, it, expect } from 'vitest';
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
} from '../src/features/photo-sphere/PhotoSphereTargets';

describe('PhotoSphereTargets 3D Coordinate & Projection Suite', () => {
  it('should generate a complete 360x180 spherical coverage grid', () => {
    const targets = generateSphericalTargets();
    expect(targets.length).toBe(30);

    const horizon = targets.filter((t) => t.ring === 'horizon');
    const upper = targets.filter((t) => t.ring === 'upper');
    const zenith = targets.filter((t) => t.ring === 'zenith');
    const lower = targets.filter((t) => t.ring === 'lower');
    const nadir = targets.filter((t) => t.ring === 'nadir');

    expect(horizon.length).toBe(10);
    expect(upper.length).toBe(8);
    expect(zenith.length).toBe(2);
    expect(lower.length).toBe(8);
    expect(nadir.length).toBe(2);

    expect(zenith[0].pitch).toBe(78);
    expect(nadir[0].pitch).toBe(-78);
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
});

