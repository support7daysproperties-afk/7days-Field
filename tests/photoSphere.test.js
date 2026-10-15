import { describe, it, expect } from 'vitest';
import { eulerToRotationMatrix, targetDirection, angularDistanceDegrees, normalizeDegrees } from '../src/features/photo-sphere/orientation/OrientationMath';
import { SphereProjection } from '../src/features/photo-sphere/orientation/SphereProjection';
import { SphereTargetPlan } from '../src/features/photo-sphere/targets/SphereTargetPlan';
import { AlignmentGate } from '../src/features/photo-sphere/camera/AlignmentGate';
import { TargetSelection } from '../src/features/photo-sphere/targets/TargetSelection';

describe('Photo Sphere Core Engine', () => {
  it('correctly normalizes degrees', () => {
    expect(normalizeDegrees(0)).toBe(0);
    expect(normalizeDegrees(190)).toBe(-170);
    expect(normalizeDegrees(-190)).toBe(170);
    expect(normalizeDegrees(360)).toBe(0);
  });

  it('builds camera basis matrix from Euler angles', () => {
    const basis = eulerToRotationMatrix(0, 0, 0);
    expect(basis.forward.y).toBeCloseTo(1, 3); // Facing North (+Y)
    expect(basis.right.x).toBeCloseTo(1, 3); // Right (+X)
  });

  it('generates spherical target plan with equator and rings', () => {
    const plan = SphereTargetPlan.createPlan('sphere');
    expect(plan.targets.length).toBeGreaterThan(15);
    expect(plan.rings.length).toBeGreaterThanOrEqual(1);

    const ringPlan = SphereTargetPlan.createPlan('ring');
    expect(ringPlan.rings.length).toBe(1);
  });

  it('projects target directly ahead to the center of the screen', () => {
    const target = { yawDegrees: 0, pitchDegrees: 0 };
    const basis = eulerToRotationMatrix(0, 0, 0);
    const proj = SphereProjection.projectTargetToScreen(target, basis, 1000, 1000, 800);

    expect(proj.isInFront).toBe(true);
    expect(proj.isOffScreen).toBe(false);
    expect(proj.screenX).toBeCloseTo(500, 1);
    expect(proj.screenY).toBeCloseTo(500, 1);
    expect(proj.angularDistance).toBeCloseTo(0, 1);
  });

  it('detects off-screen direction when target is to the side or behind', () => {
    const target = { yawDegrees: 180, pitchDegrees: 0 }; // Behind camera
    const basis = eulerToRotationMatrix(0, 0, 0);
    const proj = SphereProjection.projectTargetToScreen(target, basis, 1000, 1000, 800);

    expect(proj.isInFront).toBe(false);
    expect(proj.isOffScreen).toBe(true);
    expect(typeof proj.angleRad).toBe('number');
  });

  it('alignment gate requires 300ms dwell hold before triggering auto-capture', () => {
    const gate = new AlignmentGate(3.0, 300);

    // Initial out of range
    const r1 = gate.update(10.0, 1000);
    expect(r1.isAligned).toBe(false);
    expect(r1.shouldCapture).toBe(false);

    // Enter alignment ring
    const r2 = gate.update(1.5, 1050);
    expect(r2.isAligned).toBe(true);
    expect(r2.shouldCapture).toBe(false);
    expect(r2.progress).toBe(0);

    // Still holding at 150ms
    const r3 = gate.update(1.2, 1200);
    expect(r3.isAligned).toBe(true);
    expect(r3.shouldCapture).toBe(false);
    expect(r3.progress).toBeCloseTo(0.5, 1);

    // Reached 300ms steady hold -> trigger capture!
    const r4 = gate.update(0.8, 1360);
    expect(r4.isAligned).toBe(true);
    expect(r4.shouldCapture).toBe(true);
  });
});
