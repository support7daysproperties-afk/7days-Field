/**
 * SphericalTargetGenerator.js
 *
 * Generates a configurable spherical target grid for 360° capture.
 *
 * Target density varies with latitude to maintain approximately uniform
 * coverage on the sphere surface (fewer targets near the poles, more at
 * the equator).
 *
 * COORDINATE SYSTEM
 * ─────────────────
 * • relativeYaw  0°–360°, clockwise from the reference heading that was
 *   established when the capture session started.
 *   This is NOT geographic north.
 *
 * • pitch  −90° (nadir / ground) to +90° (zenith / sky).
 *   0° is horizontal / horizon level.
 *
 * All orientations are relative to the capture session's reference frame.
 */

import {
  DEFAULT_CAPTURE_CONFIG,
  getAngularStep,
  getHorizontalTargetCount,
} from './CaptureConfig';

// ─── Angle utilities (exported for reuse & testing) ───────────────────────────

/**
 * Normalise an angle into the [0, 360) range.
 */
export function normalizeAngle(angle) {
  let n = angle % 360;
  if (n < 0) n += 360;
  if (Math.abs(n - 360) < 1e-10) n = 0;
  // Prevent -0 (can occur for exact multiples of 360 in JS)
  if (n === 0) n = 0;
  return Math.round(n * 1000) / 1000 || 0;
}

/**
 * Angular distance between two points on a sphere (degrees).
 * Uses a Haversine-like formula adapted for yaw/pitch coordinates.
 */
export function angularDistance(yaw1, pitch1, yaw2, pitch2) {
  const toRad = Math.PI / 180;
  const dYaw = (yaw2 - yaw1) * toRad;
  const dPitch = (pitch2 - pitch1) * toRad;
  const p1 = pitch1 * toRad;
  const p2 = pitch2 * toRad;

  const a =
    Math.sin(dPitch / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dYaw / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return c / toRad;
}

/**
 * Signed angular difference in the shortest arc (−180 to +180).
 */
export function angleDifference(a, b) {
  let d = normalizeAngle(a) - normalizeAngle(b);
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

// ─── Ring label helpers ───────────────────────────────────────────────────────

function getRingLabel(pitch) {
  if (pitch >= 80) return 'zenith';
  if (pitch >= 50) return 'upper';
  if (pitch >= 15) return 'upper-horizon';
  if (pitch >= -15) return 'horizon';
  if (pitch >= -50) return 'lower-horizon';
  if (pitch >= -80) return 'lower';
  return 'nadir';
}

// ─── Generator ────────────────────────────────────────────────────────────────

export class SphericalTargetGenerator {
  /**
   * Generate a full spherical target grid.
   *
   * @param {object} config  CaptureConfig — defaults to DEFAULT_CAPTURE_CONFIG
   * @returns {Array<object>}
   */
  static generate(config = DEFAULT_CAPTURE_CONFIG) {
    const targets = [];
    let seq = 0;

    // Sort pitch rows low → high for consistent ordering
    const pitchRows = [...config.pitchRows].sort((a, b) => a - b);

    for (let ringIdx = 0; ringIdx < pitchRows.length; ringIdx++) {
      const pitch = pitchRows[ringIdx];
      const count = getHorizontalTargetCount(pitch, config);
      const yawStep = 360 / count;

      for (let i = 0; i < count; i++) {
        const yaw = normalizeAngle(i * yawStep);
        targets.push({
          id: `t_${seq}`,
          sequenceNumber: seq++,
          relativeYaw: yaw,
          pitch,
          ringIndex: ringIdx,
          ringLabel: getRingLabel(pitch),
          status: 'pending',
          capturedFrameId: null,
        });
      }
    }

    // Polar caps
    if (config.includePolarCaps) {
      targets.push({
        id: `t_${seq}`,
        sequenceNumber: seq++,
        relativeYaw: 0,
        pitch: config.zenithPitchDeg,
        ringIndex: pitchRows.length,
        ringLabel: 'zenith',
        status: 'pending',
        capturedFrameId: null,
      });
      targets.push({
        id: `t_${seq}`,
        sequenceNumber: seq++,
        relativeYaw: 0,
        pitch: config.nadirPitchDeg,
        ringIndex: pitchRows.length + 1,
        ringLabel: 'nadir',
        status: 'pending',
        capturedFrameId: null,
      });
    }

    return targets;
  }

  /**
   * Human-readable summary of the grid that would be generated.
   */
  static getSummary(config = DEFAULT_CAPTURE_CONFIG) {
    const targets = this.generate(config);
    const step = getAngularStep(config);

    const ringCounts = {};
    for (const t of targets) {
      ringCounts[t.ringLabel] = (ringCounts[t.ringLabel] || 0) + 1;
    }

    return {
      totalTargets: targets.length,
      angularStep: step,
      estimatedFov: config.estimatedFovDeg,
      overlap: config.targetOverlap,
      pitchRows: config.pitchRows,
      ringCounts,
      configVersion: config.configVersion,
    };
  }

  /**
   * Verify that no two targets in the grid sit closer than `thresholdDeg`.
   * Returns an array of { type, targetA, targetB, angularDistance } objects.
   */
  static validateUniqueness(targets, thresholdDeg = 3) {
    const issues = [];
    for (let i = 0; i < targets.length; i++) {
      for (let j = i + 1; j < targets.length; j++) {
        const dist = angularDistance(
          targets[i].relativeYaw,
          targets[i].pitch,
          targets[j].relativeYaw,
          targets[j].pitch,
        );
        if (dist < thresholdDeg) {
          issues.push({
            type: 'duplicate_target',
            targetA: targets[i].id,
            targetB: targets[j].id,
            angularDistance: dist,
          });
        }
      }
    }
    return issues;
  }

  /**
   * Find the target nearest to an arbitrary orientation.
   */
  static findNearestTarget(targets, yaw, pitch) {
    let nearest = null;
    let minDist = Infinity;

    for (const target of targets) {
      const d = angularDistance(yaw, pitch, target.relativeYaw, target.pitch);
      if (d < minDist) {
        minDist = d;
        nearest = target;
      }
    }
    return { target: nearest, distance: minDist };
  }

  /**
   * Find the nearest target in a given status set.
   */
  static findNearestPendingTarget(targets, yaw, pitch, statusSet = ['pending', 'needs-retake']) {
    const candidates = targets.filter(t => statusSet.includes(t.status));
    if (candidates.length === 0) return { target: null, distance: Infinity };
    return this.findNearestTarget(candidates, yaw, pitch);
  }
}
