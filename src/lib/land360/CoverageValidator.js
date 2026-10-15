/**
 * CoverageValidator.js
 *
 * Independently testable validation service that determines whether a
 * capture session has sufficient coverage for the intended spherical
 * capture profile.
 *
 * Every check uses actual target / frame orientation metadata.
 * Angle wraparound at 0°/360° is handled correctly.
 */

import { angularDistance } from './SphericalTargetGenerator';
import { CoverageTracker } from './CoverageTracker';

export class CoverageValidator {
  /**
   * Run all validations and return a structured report.
   *
   * @param {Array} targets  – target objects
   * @param {Array} frames   – active frame records
   * @param {object} config  – CaptureConfig
   * @returns {object}       validation report
   */
  static validate(targets, frames = [], config = {}) {
    const issues = [];

    // 1. Uncaptured targets
    const uncaptured = targets.filter(
      (t) => t.status === 'pending' || t.status === 'needs-retake' || t.status === 'failed',
    );
    if (uncaptured.length > 0) {
      issues.push({
        type: 'uncaptured_targets',
        severity: 'error',
        count: uncaptured.length,
        targetIds: uncaptured.map((t) => t.id),
        message: `${uncaptured.length} target(s) have not been captured.`,
      });
    }

    // 2. Failed frame records (active frames only — replaced frames are excluded)
    const failedFrames = frames.filter(
      (f) => f.isActive !== false && f.status !== 'replaced' && f.qualityStatus === 'failed',
    );
    if (failedFrames.length > 0) {
      issues.push({
        type: 'failed_frames',
        severity: 'error',
        count: failedFrames.length,
        frameIds: failedFrames.map((f) => f.id),
        message: `${failedFrames.length} frame(s) failed quality checks.`,
      });
    }

    // 3. Large horizontal gaps
    const maxGap = (config.estimatedFovDeg || 60) * 1.5;
    const gaps = CoverageTracker.detectHorizontalGaps(targets, maxGap);
    if (gaps.length > 0) {
      issues.push({
        type: 'horizontal_gaps',
        severity: 'warning',
        gaps,
        message: `${gaps.length} large gap(s) detected in horizontal coverage.`,
      });
    }

    // 4. Duplicate / near-duplicate captured orientations
    const activeFrames = frames.filter((f) => f.isActive !== false && f.status !== 'replaced');
    const duplicates = this._findDuplicateFrames(
      activeFrames,
      config.duplicateAngleThresholdDeg || 5,
    );
    if (duplicates.length > 0) {
      issues.push({
        type: 'duplicate_frames',
        severity: 'warning',
        pairs: duplicates,
        message: `${duplicates.length} pair(s) of near-duplicate frames detected.`,
      });
    }

    // 5. Missing orientation metadata
    const missingMeta = activeFrames.filter(
      (f) =>
        f.capturedYaw === null ||
        f.capturedYaw === undefined ||
        f.capturedPitch === null ||
        f.capturedPitch === undefined,
    );
    if (missingMeta.length > 0) {
      issues.push({
        type: 'missing_orientation',
        severity: 'warning',
        count: missingMeta.length,
        frameIds: missingMeta.map((f) => f.id),
        message: `${missingMeta.length} frame(s) are missing orientation metadata.`,
      });
    }

    // 6. Region coverage check
    const regionIssues = this._checkRegionCoverage(targets);
    issues.push(...regionIssues);

    // Determine overall readiness
    const errors   = issues.filter((i) => i.severity === 'error');
    const warnings = issues.filter((i) => i.severity === 'warning');

    return {
      isValid: errors.length === 0,
      canProceedToStitching: errors.length === 0 && warnings.length === 0,
      errorCount: errors.length,
      warningCount: warnings.length,
      issues,
    };
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  /**
   * Find pairs of active frames whose orientations are suspiciously close.
   */
  static _findDuplicateFrames(frames, thresholdDeg) {
    const pairs = [];
    for (let i = 0; i < frames.length; i++) {
      for (let j = i + 1; j < frames.length; j++) {
        const a = frames[i];
        const b = frames[j];
        if (
          a.capturedYaw != null && a.capturedPitch != null &&
          b.capturedYaw != null && b.capturedPitch != null
        ) {
          const d = angularDistance(
            a.capturedYaw, a.capturedPitch,
            b.capturedYaw, b.capturedPitch,
          );
          if (d < thresholdDeg) {
            pairs.push({
              frameA: a.id,
              frameB: b.id,
              angularDistance: Math.round(d * 100) / 100,
            });
          }
        }
      }
    }
    return pairs;
  }

  /**
   * Check that every named region has at least one captured target.
   */
  static _checkRegionCoverage(targets) {
    const issues = [];
    const regions = CoverageTracker.classifyTargetsByRegion(targets);

    for (const [name, list] of Object.entries(regions)) {
      if (list.length === 0) continue;
      const captured = list.filter((t) => t.status === 'captured').length;
      if (captured === 0) {
        issues.push({
          type: 'missing_region',
          severity: 'error',
          region: name,
          totalInRegion: list.length,
          message: `Region "${name}" has 0 captured targets out of ${list.length}.`,
        });
      }
    }
    return issues;
  }
}
