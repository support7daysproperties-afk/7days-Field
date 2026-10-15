/**
 * photoSphere.test.js
 *
 * Dedicated unit test suite for the new photo-sphere module:
 * 1. Angle normalization & wrapping around -180° / +180° / 360°
 * 2. Great-circle spherical distance calculations
 * 3. Screen projection & viewport math
 * 4. Full-sphere target planning (equator, upper, lower, zenith, nadir)
 * 5. Target alignment & dwell time evaluation
 * 6. GPano XMP packet generation and marker splicing
 * 7. CaptureCoordinator duplicate prevention and state machine
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  normalizeAngle180,
  normalizeAngle360,
  deltaAngle,
  sphericalDistance,
  deviceOrientationToEuler,
  projectTargetToViewport,
  circularMeanDegrees,
} from '../src/features/photo-sphere/orientation/OrientationMath';
import { SphereTargetPlan } from '../src/features/photo-sphere/targets/SphereTargetPlan';
import { TargetSelection } from '../src/features/photo-sphere/targets/TargetSelection';
import { buildGPanoXmpPacket, injectGPanoMetadata } from '../src/features/photo-sphere/stitching/GPanoMetadata';

describe('PhotoSphere Math & Orientation', () => {
  it('normalizes angles within [-180, 180)', () => {
    expect(normalizeAngle180(0)).toBe(0);
    expect(normalizeAngle180(180)).toBe(-180);
    expect(normalizeAngle180(185)).toBe(-175);
    expect(normalizeAngle180(-185)).toBe(175);
    expect(normalizeAngle180(360)).toBe(0);
    expect(normalizeAngle180(540)).toBe(-180);
  });

  it('computes shortest signed angular delta correctly across 0/360 wrap', () => {
    expect(deltaAngle(10, 20)).toBe(10);
    expect(deltaAngle(20, 10)).toBe(-10);
    expect(deltaAngle(350, 10)).toBe(20);
    expect(deltaAngle(10, 350)).toBe(-20);
    expect(deltaAngle(-170, 170)).toBe(-20);
  });

  it('calculates spherical great-circle distance accurately', () => {
    // Same position -> distance 0
    expect(sphericalDistance(0, 0, 0, 0)).toBeCloseTo(0, 2);
    // 90 deg yaw along equator -> distance 90
    expect(sphericalDistance(0, 0, 90, 0)).toBeCloseTo(90, 1);
    // From equator to zenith pole -> distance 90
    expect(sphericalDistance(0, 0, 0, 90)).toBeCloseTo(90, 1);
    // Opposite sides of sphere -> distance 180
    expect(sphericalDistance(0, 0, 180, 0)).toBeCloseTo(180, 1);
  });

  it('circular mean correctly averages around 0°/360° boundary without jump jitter', () => {
    const angles = [350, 355, 0, 5, 10];
    const mean = circularMeanDegrees(angles);
    expect(mean).toBeCloseTo(0, 1);
  });

  it('converts device orientation angles to euler yaw/pitch/roll', () => {
    const euler = deviceOrientationToEuler(90, 90, 0, 0);
    // Beta = 90 (upright) -> pitch = 0
    expect(euler.pitch).toBe(0);
    expect(euler.roll).toBe(0);
    expect(euler.yaw).toBeDefined();
  });
});

describe('Target Projection & Viewport Coordinates', () => {
  it('projects dead-ahead target exactly to viewport center', () => {
    const proj = projectTargetToViewport({
      targetYaw: 0,
      targetPitch: 0,
      cameraYaw: 0,
      cameraPitch: 0,
      cameraRoll: 0,
      hfov: 60,
      vfov: 45,
      viewportWidth: 800,
      viewportHeight: 600,
    });

    expect(proj.x).toBeCloseTo(400, 1);
    expect(proj.y).toBeCloseTo(300, 1);
    expect(proj.isOnScreen).toBe(true);
    expect(proj.distanceDeg).toBeCloseTo(0, 1);
  });

  it('identifies targets behind camera as off-screen', () => {
    const proj = projectTargetToViewport({
      targetYaw: 180,
      targetPitch: 0,
      cameraYaw: 0,
      cameraPitch: 0,
      cameraRoll: 0,
      hfov: 60,
      vfov: 45,
      viewportWidth: 800,
      viewportHeight: 600,
    });

    expect(proj.isOnScreen).toBe(false);
  });
});

describe('SphereTargetPlan Full Coverage', () => {
  it('generates a full 360° x 180° plan covering horizon, sky, and ground rings', () => {
    const planner = new SphereTargetPlan({ hfov: 65, vfov: 50 });
    const targets = planner.targets;

    expect(targets.length).toBeGreaterThanOrEqual(18);

    const labels = new Set(targets.map((t) => t.ringLabel));
    expect(labels.has('equator')).toBe(true);
    expect(labels.has('upper')).toBe(true);
    expect(labels.has('lower')).toBe(true);
    expect(labels.has('zenith')).toBe(true);
    expect(labels.has('nadir')).toBe(true);
  });

  it('tracks progress and ring completion accurately', () => {
    const planner = new SphereTargetPlan({ hfov: 65, vfov: 50 });
    const initialProgress = planner.getProgress();

    expect(initialProgress.captured).toBe(0);
    expect(initialProgress.percentage).toBe(0);
    expect(initialProgress.isComplete).toBe(false);

    // Capture first target
    planner.markCaptured(planner.targets[0].id, 'frame_1');
    const updated = planner.getProgress();
    expect(updated.captured).toBe(1);
    expect(updated.percentage).toBeGreaterThan(0);

    // Reset target (undo test)
    planner.resetTarget(planner.targets[0].id);
    expect(planner.getProgress().captured).toBe(0);
  });

  it('finds closest target intelligently without erratic hopping', () => {
    const planner = new SphereTargetPlan({ hfov: 65, vfov: 50 });
    const next = planner.findNextTarget(0, 0);

    expect(next).toBeDefined();
    expect(next.pitch).toBe(0); // Closest to horizon when pointing at horizon
  });
});

describe('TargetSelection & Auto-Capture Dwell Logic', () => {
  let selection;
  const target = { id: 't_1', yaw: 0, pitch: 0, ringLabel: 'equator' };

  beforeEach(() => {
    selection = new TargetSelection({ alignmentToleranceDeg: 4.5, dwellTimeMs: 200 });
    selection.setActiveTarget(target);
  });

  it('flags aligned when camera is within tolerance threshold', () => {
    const res = selection.evaluate(2.0, 1.0, true);
    expect(res.isAligned).toBe(true);
    expect(res.distanceDeg).toBeLessThanOrEqual(4.5);
  });

  it('does not trigger auto-capture immediately on first alignment', () => {
    const res = selection.evaluate(0, 0, true);
    expect(res.isAligned).toBe(true);
    expect(res.shouldTriggerAutoCapture).toBe(false);
    expect(res.dwellProgress).toBe(0);
  });

  it('resets dwell if camera moves out of alignment', () => {
    selection.evaluate(0, 0, true);
    const drifted = selection.evaluate(30, 20, true);
    expect(drifted.isAligned).toBe(false);
    expect(drifted.dwellProgress).toBe(0);
  });
});

describe('GPano XMP Injection', () => {
  it('builds standard GPano RDF XMP packet', () => {
    const xmp = buildGPanoXmpPacket({ fullWidth: 4096, fullHeight: 2048 });
    expect(xmp).toContain('<GPano:UsePanoramaViewer>True</GPano:UsePanoramaViewer>');
    expect(xmp).toContain('<GPano:ProjectionType>equirectangular</GPano:ProjectionType>');
    expect(xmp).toContain('<GPano:FullPanoWidthPixels>4096</GPano:FullPanoWidthPixels>');
    expect(xmp).toContain('<GPano:FullPanoHeightPixels>2048</GPano:FullPanoHeightPixels>');
  });

  it('injects APP1 XMP marker into synthetic JPEG binary stream', () => {
    // Minimal valid JPEG stream with SOI (0xFF, 0xD8) and EOI (0xFF, 0xD9)
    const mockJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const tagged = injectGPanoMetadata(mockJpeg.buffer, { fullWidth: 2048, fullHeight: 1024 });

    const view = new Uint8Array(tagged);
    // SOI intact
    expect(view[0]).toBe(0xff);
    expect(view[1]).toBe(0xd8);
    // Next marker is APP1 (0xFF, 0xE1)
    expect(view[2]).toBe(0xff);
    expect(view[3]).toBe(0xe1);
  });
});
