/**
 * CoverageTracker.js
 *
 * Calculates coverage metrics from actual target states and frame records.
 * Every value is computed from real data — nothing is hardcoded.
 */



// ─── Region helpers ───────────────────────────────────────────────────────────

function classifyPitch(pitch) {
  if (pitch >= 80)  return 'zenith';
  if (pitch >= 50)  return 'upper';
  if (pitch >= 15)  return 'upper-horizon';
  if (pitch >= -15) return 'horizon';
  if (pitch >= -50) return 'lower-horizon';
  if (pitch >= -80) return 'lower';
  return 'nadir';
}

const REGION_DESCRIPTIONS = {
  zenith:          'Sky / ceiling area (directly above)',
  upper:           'Upper viewing angles',
  'upper-horizon': 'Above horizon',
  horizon:         'Horizon level (surrounding view)',
  'lower-horizon': 'Below horizon',
  lower:           'Lower viewing angles',
  nadir:           'Ground / floor area (directly below)',
};

// ─── Public API ───────────────────────────────────────────────────────────────

export class CoverageTracker {
  /**
   * Build a full coverage report from targets and active frames.
   *
   * @param {Array} targets  – target objects (must have .status, .ringLabel)
   * @param {Array} frames   – frame records (filtered to active only by caller)
   * @returns {object}       SphericalCoverageReport
   */
  static generateReport(targets, frames = []) {
    const activeFrames = frames.filter(
      (f) => f.isActive !== false && f.status !== 'replaced',
    );

    const totalTargets     = targets.length;
    const capturedTargets  = targets.filter((t) => t.status === 'captured').length;
    const pendingTargets   = targets.filter((t) => t.status === 'pending').length;
    const failedTargets    = targets.filter((t) => t.status === 'failed').length;
    const needsRetake      = targets.filter((t) => t.status === 'needs-retake').length;

    const regions = this.classifyTargetsByRegion(targets);

    const upperCoverage = this._regionCoverage([
      ...(regions.zenith || []),
      ...(regions.upper || []),
      ...(regions['upper-horizon'] || []),
    ]);
    const horizonCoverage = this._regionCoverage(regions.horizon || []);
    const lowerCoverage = this._regionCoverage([
      ...(regions['lower-horizon'] || []),
      ...(regions.lower || []),
      ...(regions.nadir || []),
    ]);
    const horizontalCoverage = this._regionCoverage(regions.horizon || []);

    const missingRegions  = this.identifyMissingRegions(targets);
    const qualityWarnings = this.collectQualityWarnings(activeFrames);

    const criticalQuality = qualityWarnings.filter((w) => w.severity === 'failed');

    const canProceedToStitching =
      pendingTargets === 0 &&
      failedTargets === 0 &&
      needsRetake === 0 &&
      missingRegions.length === 0 &&
      criticalQuality.length === 0;

    return {
      totalTargets,
      capturedTargets,
      pendingTargets,
      failedTargets,
      needsRetakeTargets: needsRetake,

      horizontalCoverageEstimate: horizontalCoverage,
      upperCoverageEstimate:      upperCoverage,
      horizonCoverageEstimate:    horizonCoverage,
      lowerCoverageEstimate:      lowerCoverage,

      overallTargetCompletion:
        totalTargets > 0
          ? Math.round((capturedTargets / totalTargets) * 100)
          : 0,

      missingRegions,
      qualityWarnings,
      canProceedToStitching,
    };
  }

  // ── Regions ───────────────────────────────────────────────────────────

  static classifyTargetsByRegion(targets) {
    const regions = {};
    for (const t of targets) {
      const label = t.ringLabel || classifyPitch(t.pitch);
      if (!regions[label]) regions[label] = [];
      regions[label].push(t);
    }
    return regions;
  }

  /** Percentage of captured targets in a region (null if region is empty). */
  static _regionCoverage(regionTargets) {
    if (regionTargets.length === 0) return null;
    const captured = regionTargets.filter((t) => t.status === 'captured').length;
    return Math.round((captured / regionTargets.length) * 100);
  }

  // ── Missing-region detection ──────────────────────────────────────────

  static identifyMissingRegions(targets) {
    const regions = this.classifyTargetsByRegion(targets);
    const missing = [];

    for (const [name, list] of Object.entries(regions)) {
      const uncaptured = list.filter((t) => t.status !== 'captured');
      if (uncaptured.length > 0) {
        missing.push({
          region: name,
          description: REGION_DESCRIPTIONS[name] || name,
          uncapturedCount: uncaptured.length,
          totalInRegion: list.length,
          uncapturedTargetIds: uncaptured.map((t) => t.id),
        });
      }
    }
    return missing;
  }

  // ── Horizontal gap detection ──────────────────────────────────────────

  /**
   * Detect large angular gaps between neighbouring captured targets
   * in the near-horizon ring.  Handles 360°/0° wraparound correctly.
   */
  static detectHorizontalGaps(targets, maxGapDeg = 60) {
    const captured = targets
      .filter((t) => Math.abs(t.pitch) < 20 && t.status === 'captured')
      .sort((a, b) => a.relativeYaw - b.relativeYaw);

    if (captured.length < 2) return [];

    const gaps = [];
    for (let i = 0; i < captured.length; i++) {
      const curr = captured[i];
      const next = captured[(i + 1) % captured.length];
      let gap = next.relativeYaw - curr.relativeYaw;
      if (gap <= 0) gap += 360; // wraparound

      if (gap > maxGapDeg) {
        gaps.push({
          fromYaw: curr.relativeYaw,
          toYaw: next.relativeYaw,
          gapDeg: Math.round(gap * 10) / 10,
          description: `${Math.round(gap)}° gap between ${Math.round(curr.relativeYaw)}° and ${Math.round(next.relativeYaw)}°`,
        });
      }
    }
    return gaps;
  }

  // ── Quality warnings ──────────────────────────────────────────────────

  static collectQualityWarnings(frames) {
    const warnings = [];
    for (const frame of frames) {
      if (frame.qualityWarnings?.length) {
        for (const w of frame.qualityWarnings) {
          warnings.push({ frameId: frame.id, targetId: frame.targetId, ...w });
        }
      }
    }
    return warnings;
  }

  // ── Status label ──────────────────────────────────────────────────────

  static getStatusLabel(report) {
    if (report.canProceedToStitching) return 'Ready for stitching';
    if (report.needsRetakeTargets > 0)  return 'Retakes needed';
    if (report.failedTargets > 0)       return 'Review required';
    if (report.capturedTargets === 0)   return 'Not started';
    if (report.pendingTargets > 0)      return 'Capture in progress';
    if (report.missingRegions.length > 0) return 'Coverage incomplete';
    return 'Review required';
  }
}
