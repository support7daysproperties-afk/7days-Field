/**
 * land360.test.js
 *
 * Unit tests for Phase 2 spherical capture engine.
 *
 * Tests are organised to cover:
 *   1.  SphericalTargetGenerator  (target generation, angle math, uniqueness)
 *   2.  TargetEngine              (session lifecycle, alignment, retake, coverage)
 *   3.  CoverageTracker           (region classification, gap detection, reporting)
 *   4.  CoverageValidator         (issue detection, validation rules)
 *
 * Physical-device tests (camera, orientation sensor, GPS) are NOT performed
 * here — they are integration concerns that require a real device.
 *
 * Test runner: Vitest
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SphericalTargetGenerator,
  normalizeAngle,
  angularDistance,
  angleDifference,
} from '../src/lib/land360/SphericalTargetGenerator';
import { DEFAULT_CAPTURE_CONFIG, getAngularStep, getHorizontalTargetCount } from '../src/lib/land360/CaptureConfig';
import { TargetEngine } from '../src/lib/land360/TargetEngine';
import { CoverageTracker } from '../src/lib/land360/CoverageTracker';
import { CoverageValidator } from '../src/lib/land360/CoverageValidator';

// ─── Helper: build a minimal target array ─────────────────────────────────────

function makeTarget(id, yaw, pitch, status = 'pending', frameId = null) {
  return {
    id,
    sequenceNumber: parseInt(id),
    relativeYaw: yaw,
    pitch,
    ringLabel: 'horizon',
    status,
    capturedFrameId: frameId,
    originalTargetId: id,
  };
}

function makeFrame(id, targetId, yaw, pitch, qStatus = 'passed', isActive = true) {
  return {
    id,
    targetId,
    capturedYaw: yaw,
    capturedPitch: pitch,
    isActive,
    status: isActive ? 'captured' : 'replaced',
    qualityStatus: qStatus,
    qualityWarnings: qStatus === 'warning' ? [{ check: 'test', severity: 'warning', message: 'Test warning' }] : [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  1. Angle utilities
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeAngle', () => {
  it('keeps 0 as 0', () => expect(normalizeAngle(0)).toBe(0));
  it('keeps 180 as 180', () => expect(normalizeAngle(180)).toBe(180));
  it('keeps 359 as 359', () => expect(normalizeAngle(359)).toBe(359));
  it('wraps 360 to 0', () => expect(normalizeAngle(360)).toBe(0));
  it('wraps 361 to 1', () => expect(normalizeAngle(361)).toBe(1));
  it('wraps negative -1 to 359', () => expect(normalizeAngle(-1)).toBe(359));
  it('wraps -360 to 0', () => expect(normalizeAngle(-360)).toBe(0));
  it('wraps -720 to 0', () => expect(normalizeAngle(-720)).toBe(0));
  it('handles large positive', () => expect(normalizeAngle(721)).toBeCloseTo(1, 0));
});

describe('angularDistance', () => {
  it('returns 0 for identical directions', () => {
    expect(angularDistance(0, 0, 0, 0)).toBeCloseTo(0, 5);
  });
  it('returns 180 for opposite directions on equator', () => {
    expect(angularDistance(0, 0, 180, 0)).toBeCloseTo(180, 1);
  });
  it('handles wraparound: 350 → 10 = 20°', () => {
    expect(angularDistance(350, 0, 10, 0)).toBeCloseTo(20, 1);
  });
  it('zenith vs horizon = 90°', () => {
    expect(angularDistance(0, 0, 0, 90)).toBeCloseTo(90, 1);
  });
  it('is symmetric', () => {
    const d1 = angularDistance(45, 20, 200, -30);
    const d2 = angularDistance(200, -30, 45, 20);
    expect(Math.abs(d1 - d2)).toBeLessThan(0.001);
  });
});

describe('angleDifference', () => {
  it('returns 0 for equal angles', () => expect(angleDifference(90, 90)).toBe(0));
  it('returns positive for anticlockwise', () => expect(angleDifference(10, 350)).toBeCloseTo(20, 1));
  it('returns negative for clockwise', () => expect(angleDifference(350, 10)).toBeCloseTo(-20, 1));
  it('handles 0/360 boundary correctly', () => {
    expect(Math.abs(angleDifference(1, 359))).toBeCloseTo(2, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  2. SphericalTargetGenerator
// ─────────────────────────────────────────────────────────────────────────────

describe('SphericalTargetGenerator.generate', () => {
  let targets;
  beforeEach(() => {
    targets = SphericalTargetGenerator.generate(DEFAULT_CAPTURE_CONFIG);
  });

  it('generates at least one target', () => {
    expect(targets.length).toBeGreaterThan(0);
  });

  it('all targets have required fields', () => {
    for (const t of targets) {
      expect(t).toHaveProperty('id');
      expect(t).toHaveProperty('relativeYaw');
      expect(t).toHaveProperty('pitch');
      expect(t).toHaveProperty('status', 'pending');
      expect(t).toHaveProperty('capturedFrameId', null);
      expect(t).toHaveProperty('ringLabel');
    }
  });

  it('all relativeYaw values are in [0, 360)', () => {
    for (const t of targets) {
      expect(t.relativeYaw).toBeGreaterThanOrEqual(0);
      expect(t.relativeYaw).toBeLessThan(360);
    }
  });

  it('pitch values cover both upper and lower hemispheres', () => {
    const hasPosivePitch = targets.some((t) => t.pitch > 30);
    const hasNegativePitch = targets.some((t) => t.pitch < -30);
    expect(hasPosivePitch).toBe(true);
    expect(hasNegativePitch).toBe(true);
  });

  it('includes polar caps when configured', () => {
    const zenith = targets.filter((t) => t.ringLabel === 'zenith');
    const nadir  = targets.filter((t) => t.ringLabel === 'nadir');
    expect(zenith.length).toBeGreaterThan(0);
    expect(nadir.length).toBeGreaterThan(0);
  });

  it('includes horizon-level targets', () => {
    const horizon = targets.filter((t) => Math.abs(t.pitch) <= 15);
    expect(horizon.length).toBeGreaterThan(0);
  });

  it('no two targets have identical (yaw, pitch)', () => {
    const keys = new Set(targets.map((t) => `${t.relativeYaw}_${t.pitch}`));
    expect(keys.size).toBe(targets.length);
  });

  it('no two targets are within 3° of each other', () => {
    const issues = SphericalTargetGenerator.validateUniqueness(targets, 3);
    expect(issues.length).toBe(0);
  });

  it('horizon has more targets than zenith (cos-weighting)', () => {
    const horizonCount = targets.filter((t) => Math.abs(t.pitch) <= 15).length;
    const zenithCount  = targets.filter((t) => t.pitch >= 70).length;
    expect(horizonCount).toBeGreaterThan(zenithCount);
  });

  it('sequence numbers are unique and ascending', () => {
    const seqs = targets.map((t) => t.sequenceNumber);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });

  it('configVersion is set', () => {
    const summary = SphericalTargetGenerator.getSummary(DEFAULT_CAPTURE_CONFIG);
    expect(summary.configVersion).toBeTruthy();
  });
});

describe('SphericalTargetGenerator.findNearestPendingTarget', () => {
  const targets = [
    makeTarget('0', 0,   0),
    makeTarget('1', 45,  0),
    makeTarget('2', 90,  0),
    makeTarget('3', 180, 0, 'captured'),
  ];

  it('returns the closest pending target', () => {
    const { target } = SphericalTargetGenerator.findNearestPendingTarget(targets, 80, 0);
    expect(target.id).toBe('2'); // 90° is nearest to 80°
  });

  it('skips captured targets', () => {
    const { target } = SphericalTargetGenerator.findNearestPendingTarget(targets, 180, 0);
    // 180 is captured, nearest pending is 2 (90°) or 1 (45°) — 90° is closer
    expect(['1', '2']).toContain(target.id);
  });

  it('returns null when all targets are captured', () => {
    const allCaptured = targets.map((t) => ({ ...t, status: 'captured' }));
    const { target } = SphericalTargetGenerator.findNearestPendingTarget(allCaptured, 0, 0);
    expect(target).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  3. TargetEngine  (no IndexedDB needed — pure in-memory)
// ─────────────────────────────────────────────────────────────────────────────

describe('TargetEngine', () => {
  let engine;
  beforeEach(() => {
    engine = new TargetEngine(DEFAULT_CAPTURE_CONFIG);
    engine.startSession('cp_test', 0); // referenceHeading = 0
  });

  it('generates targets on startSession', () => {
    expect(engine.targets.length).toBeGreaterThan(0);
  });

  it('starts with first target at index 0', () => {
    const t = engine.getCurrentTarget();
    expect(t).not.toBeNull();
    expect(t.status).toBe('pending');
  });

  it('deviceHeadingToRelativeYaw handles zero reference', () => {
    expect(engine.deviceHeadingToRelativeYaw(90)).toBeCloseTo(90, 1);
  });

  it('deviceHeadingToRelativeYaw handles wraparound', () => {
    engine.setReferenceHeading(350);
    const yaw = engine.deviceHeadingToRelativeYaw(10);
    expect(yaw).toBeCloseTo(20, 1);
  });

  it('checkAlignment returns stable when within tolerance and stable', () => {
    const target = engine.getCurrentTarget();
    // Perfect alignment: relativeYaw = target.relativeYaw; heading = referenceHeading + relativeYaw
    const deviceHeading = normalizeAngle(engine.referenceHeading + target.relativeYaw);
    const devicePitch   = target.pitch;
    // First call sets _alignedSince timestamp
    engine.checkAlignment(deviceHeading, devicePitch, 0);
    // Simulate time passing by patching _alignedSince
    engine._alignedSince = Date.now() - (DEFAULT_CAPTURE_CONFIG.stabilityDurationMs + 100);
    const result = engine.checkAlignment(deviceHeading, devicePitch, 0);
    expect(result).toBe('stable');
  });

  it('checkAlignment returns none when far from target', () => {
    const target = engine.getCurrentTarget();
    const wrongHeading = normalizeAngle(target.relativeYaw + 90);
    const result = engine.checkAlignment(wrongHeading, target.pitch, 0);
    expect(result).toBe('none');
  });

  it('beginCapture prevents double-fire', () => {
    const first  = engine.beginCapture();
    const second = engine.beginCapture();
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('markCaptured updates target status', () => {
    const target = engine.getCurrentTarget();
    engine.beginCapture();
    engine.markCaptured(target.id, 'frame_1');
    const updated = engine.targets.find((t) => t.id === target.id);
    expect(updated.status).toBe('captured');
    expect(updated.capturedFrameId).toBe('frame_1');
  });

  it('markForRetake resets target to needs-retake', () => {
    const target = engine.getCurrentTarget();
    engine.beginCapture();
    engine.markCaptured(target.id, 'frame_1');
    engine.markForRetake(target.id);
    const updated = engine.targets.find((t) => t.id === target.id);
    expect(updated.status).toBe('needs-retake');
    expect(updated.capturedFrameId).toBeNull();
  });

  it('isComplete returns true when all targets captured', () => {
    for (const t of engine.targets) {
      t.status = 'captured';
      t.capturedFrameId = 'f1';
    }
    expect(engine.isComplete()).toBe(true);
  });

  it('isComplete returns false when any target is pending', () => {
    engine.targets[0].status = 'pending';
    expect(engine.isComplete()).toBe(false);
  });

  it('getProgress counts correctly', () => {
    engine.targets[0].status = 'captured';
    engine.targets[1].status = 'captured';
    const prog = engine.getProgress();
    expect(prog.captured).toBe(2);
    expect(prog.total).toBe(engine.targets.length);
  });

  it('resumeSession restores targets', () => {
    const original = engine.targets.map((t) => ({ ...t }));
    // Simulate 3 captured
    original[0].status = 'captured';
    original[1].status = 'captured';
    original[2].status = 'captured';

    const session = engine.getSessionSnapshot();
    const newEngine = new TargetEngine(DEFAULT_CAPTURE_CONFIG);
    newEngine.resumeSession({ ...session, capturePointId: 'cp_test', referenceHeading: 0 }, original);

    expect(newEngine.targets.length).toBe(original.length);
    expect(newEngine.targets.filter((t) => t.status === 'captured').length).toBe(3);
    // Current target should be first non-captured
    const cur = newEngine.getCurrentTarget();
    expect(cur?.status).toMatch(/pending|needs-retake/);
  });

  it('resumeSession with all captured sets index past end', () => {
    const original = engine.targets.map((t) => ({ ...t, status: 'captured' }));
    const session = engine.getSessionSnapshot();
    const newEngine = new TargetEngine(DEFAULT_CAPTURE_CONFIG);
    newEngine.resumeSession({ ...session, capturePointId: 'cp_test', referenceHeading: 0 }, original);
    expect(newEngine.getCurrentTarget()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  4. CoverageTracker
// ─────────────────────────────────────────────────────────────────────────────

describe('CoverageTracker.generateReport', () => {
  it('returns zero counts when no targets', () => {
    const report = CoverageTracker.generateReport([], []);
    expect(report.totalTargets).toBe(0);
    expect(report.capturedTargets).toBe(0);
    expect(report.overallTargetCompletion).toBe(0);
  });

  it('correctly counts captured targets', () => {
    const targets = [
      makeTarget('0', 0,   0, 'captured', 'f1'),
      makeTarget('1', 45,  0, 'captured', 'f2'),
      makeTarget('2', 90,  0, 'pending'),
    ];
    const report = CoverageTracker.generateReport(targets, []);
    expect(report.capturedTargets).toBe(2);
    expect(report.pendingTargets).toBe(1);
    expect(report.overallTargetCompletion).toBe(67);
  });

  it('canProceedToStitching only when all targets captured', () => {
    const all = SphericalTargetGenerator.generate(DEFAULT_CAPTURE_CONFIG)
      .map((t) => ({ ...t, status: 'captured' }));
    const report = CoverageTracker.generateReport(all, []);
    expect(report.canProceedToStitching).toBe(true);
  });

  it('canProceedToStitching false when any pending', () => {
    const targets = SphericalTargetGenerator.generate(DEFAULT_CAPTURE_CONFIG);
    // Leave one pending
    const report = CoverageTracker.generateReport(targets, []);
    expect(report.canProceedToStitching).toBe(false);
  });

  it('collects quality warnings from active frames', () => {
    const targets = [makeTarget('0', 0, 0, 'captured', 'f1')];
    const frames  = [makeFrame('f1', '0', 0, 0, 'warning')];
    const report = CoverageTracker.generateReport(targets, frames);
    expect(report.qualityWarnings.length).toBeGreaterThan(0);
  });

  it('excludes replaced frames from quality check', () => {
    const targets = [makeTarget('0', 0, 0, 'captured', 'f2')];
    const frames  = [
      makeFrame('f1', '0', 0, 0, 'failed', false), // replaced
      makeFrame('f2', '0', 0, 0, 'passed', true),  // active
    ];
    const report = CoverageTracker.generateReport(targets, frames);
    const failedWarnings = report.qualityWarnings.filter((w) => w.severity === 'failed');
    expect(failedWarnings.length).toBe(0);
  });
});

describe('CoverageTracker.detectHorizontalGaps', () => {
  it('returns no gaps for full horizontal coverage at fine spacing', () => {
    const targets = [];
    for (let y = 0; y < 360; y += 30) {
      targets.push(makeTarget(String(y), y, 0, 'captured'));
    }
    const gaps = CoverageTracker.detectHorizontalGaps(targets, 40);
    expect(gaps.length).toBe(0);
  });

  it('detects a large gap when one direction is missing', () => {
    // 0, 90, 180 captured — gap of 180° between 180 and 0 (wrapping)
    const targets = [
      makeTarget('0',   0,   0, 'captured'),
      makeTarget('90',  90,  0, 'captured'),
      makeTarget('180', 180, 0, 'captured'),
    ];
    const gaps = CoverageTracker.detectHorizontalGaps(targets, 60);
    // Largest gap: 180° → 0° (wrapping) = 180°
    expect(gaps.some((g) => g.gapDeg >= 170)).toBe(true);
  });

  it('handles the 360/0 wraparound correctly', () => {
    // 350° and 10° should give a gap of 20°, not 340°
    const targets = [
      makeTarget('350', 350, 0, 'captured'),
      makeTarget('10',  10,  0, 'captured'),
    ];
    const gaps = CoverageTracker.detectHorizontalGaps(targets, 25);
    // Only gap < 25° so no gaps reported
    // (350→10 = 20°; 10→350 = 340°)
    // The function checks gaps > maxGapDeg
    expect(gaps.some((g) => g.gapDeg < 25)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  5. CoverageValidator
// ─────────────────────────────────────────────────────────────────────────────

describe('CoverageValidator.validate', () => {
  it('scenario 1: no targets captured', () => {
    const targets = SphericalTargetGenerator.generate(DEFAULT_CAPTURE_CONFIG);
    const v = CoverageValidator.validate(targets, []);
    expect(v.isValid).toBe(false);
    expect(v.issues.some((i) => i.type === 'uncaptured_targets')).toBe(true);
  });

  it('scenario 2: only one horizontal direction captured', () => {
    const targets = SphericalTargetGenerator.generate(DEFAULT_CAPTURE_CONFIG);
    targets[0].status = 'captured';
    const v = CoverageValidator.validate(targets, []);
    expect(v.isValid).toBe(false);
  });

  it('scenario 5: several missing targets', () => {
    const targets = SphericalTargetGenerator.generate(DEFAULT_CAPTURE_CONFIG)
      .map((t) => ({ ...t, status: 'captured' }));
    // Mark 5 as pending
    for (let i = 0; i < 5; i++) targets[i].status = 'pending';
    const v = CoverageValidator.validate(targets, []);
    const uncapturedIssue = v.issues.find((i) => i.type === 'uncaptured_targets');
    expect(uncapturedIssue?.count).toBeGreaterThanOrEqual(5);
  });

  it('scenario 6: detects duplicate frame orientations', () => {
    const targets = SphericalTargetGenerator.generate(DEFAULT_CAPTURE_CONFIG)
      .map((t) => ({ ...t, status: 'captured' }));
    const frames = [
      { id: 'fA', targetId: 't0', capturedYaw: 45, capturedPitch: 0, isActive: true, status: 'captured', qualityStatus: 'passed', qualityWarnings: [] },
      { id: 'fB', targetId: 't1', capturedYaw: 46, capturedPitch: 0, isActive: true, status: 'captured', qualityStatus: 'passed', qualityWarnings: [] },
    ];
    const v = CoverageValidator.validate(targets, frames, DEFAULT_CAPTURE_CONFIG);
    expect(v.issues.some((i) => i.type === 'duplicate_frames')).toBe(true);
  });

  it('scenario 7: angle wraparound near 0°/360° does not produce false positive gaps', () => {
    // Captured at 355° and 5° — 10° gap should not trigger (maxGap = 90°)
    const targets = [
      makeTarget('355', 355, 0, 'captured'),
      makeTarget('5',     5, 0, 'captured'),
    ];
    const gaps = CoverageTracker.detectHorizontalGaps(targets, 90);
    // 355→5 = 10°, 5→355 = 350° → gap should be 350° (the large one)
    // BUT since these are the only two targets, the wraparound gap is 350°
    // The 10° gap is the "short" direction; the 350° gap IS a real issue
    // This tests that the 10° direction is computed correctly (not 350°)
    const smallGap = gaps.find((g) => g.gapDeg < 20);
    expect(smallGap).toBeUndefined(); // 10° gap is NOT > 90° so not reported
  });

  it('scenario 8: failed capture creates failed_frames issue', () => {
    const targets = SphericalTargetGenerator.generate(DEFAULT_CAPTURE_CONFIG)
      .map((t) => ({ ...t, status: 'captured' }));
    const frames = [
      { id: 'fBad', targetId: 't0', capturedYaw: 0, capturedPitch: 0, isActive: true, status: 'captured', qualityStatus: 'failed', qualityWarnings: [{ severity: 'failed', message: 'test' }] },
    ];
    const v = CoverageValidator.validate(targets, frames, DEFAULT_CAPTURE_CONFIG);
    expect(v.issues.some((i) => i.type === 'failed_frames')).toBe(true);
  });

  it('scenario 9: retake removes failed_frames issue', () => {
    const targets = SphericalTargetGenerator.generate(DEFAULT_CAPTURE_CONFIG)
      .map((t) => ({ ...t, status: 'captured' }));
    const frames = [
      // Old frame replaced
      { id: 'fOld', targetId: 't0', capturedYaw: 0, capturedPitch: 0, isActive: false, status: 'replaced', qualityStatus: 'failed', qualityWarnings: [{ severity: 'failed', message: 'test' }] },
      // New frame active
      { id: 'fNew', targetId: 't0', capturedYaw: 0, capturedPitch: 0, isActive: true, status: 'captured', qualityStatus: 'passed', qualityWarnings: [] },
    ];
    const v = CoverageValidator.validate(targets, frames, DEFAULT_CAPTURE_CONFIG);
    expect(v.issues.some((i) => i.type === 'failed_frames')).toBe(false);
  });

  it('scenario 10: validation is not tripped by valid session', () => {
    const targets = SphericalTargetGenerator.generate(DEFAULT_CAPTURE_CONFIG)
      .map((t) => ({ ...t, status: 'captured' }));
    const frames = targets.map((t, i) => ({
      id: `f${i}`,
      targetId: t.id,
      capturedYaw:   t.relativeYaw,
      capturedPitch: t.pitch,
      isActive: true,
      status: 'captured',
      qualityStatus: 'passed',
      qualityWarnings: [],
    }));
    const v = CoverageValidator.validate(targets, frames, DEFAULT_CAPTURE_CONFIG);
    expect(v.isValid).toBe(true);
  });
});

describe('CoverageTracker.getStatusLabel', () => {
  it('returns Not started for zero captured', () => {
    const targets = [makeTarget('0', 0, 0, 'pending')];
    const report = CoverageTracker.generateReport(targets, []);
    expect(CoverageTracker.getStatusLabel(report)).toBe('Not started');
  });

  it('returns Capture in progress when some pending', () => {
    const targets = [
      makeTarget('0', 0, 0, 'captured'),
      makeTarget('1', 45, 0, 'pending'),
    ];
    const report = CoverageTracker.generateReport(targets, []);
    expect(CoverageTracker.getStatusLabel(report)).toBe('Capture in progress');
  });

  it('returns Retakes needed when needs-retake exists', () => {
    const targets = [makeTarget('0', 0, 0, 'needs-retake')];
    const report = CoverageTracker.generateReport(targets, []);
    expect(CoverageTracker.getStatusLabel(report)).toBe('Retakes needed');
  });
});

describe('CaptureConfig helpers', () => {
  it('getAngularStep returns FOV * (1 - overlap)', () => {
    const step = getAngularStep(DEFAULT_CAPTURE_CONFIG);
    expect(step).toBeCloseTo(
      DEFAULT_CAPTURE_CONFIG.estimatedFovDeg * (1 - DEFAULT_CAPTURE_CONFIG.targetOverlap),
      5
    );
  });

  it('getHorizontalTargetCount is higher at 0° than at 60°', () => {
    const at0  = getHorizontalTargetCount(0,  DEFAULT_CAPTURE_CONFIG);
    const at60 = getHorizontalTargetCount(60, DEFAULT_CAPTURE_CONFIG);
    expect(at0).toBeGreaterThan(at60);
  });

  it('getHorizontalTargetCount returns at least 1 at 85°', () => {
    expect(getHorizontalTargetCount(85, DEFAULT_CAPTURE_CONFIG)).toBeGreaterThanOrEqual(1);
  });
});
