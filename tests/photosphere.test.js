import { describe, it, expect } from 'vitest';
import {
  generateSphericalTargets,
  projectTargetToViewport,
  selectNextTarget,
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
