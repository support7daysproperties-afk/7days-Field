/**
 * TargetEngine.js  (Phase 2 — refactored)
 *
 * State-machine wrapper around SphericalTargetGenerator.
 *
 * Responsibilities
 * ────────────────
 * • Session lifecycle:  start → capture → pause → resume → complete
 * • Reference-heading calibration (relative orientation, NOT geographic north)
 * • Target state management (pending → aligning → captured / needs-retake / failed)
 * • Alignment checking with duplicate-capture protection
 * • Retake support (mark target for retake, capture replacement)
 * • Coverage delegation to CoverageTracker / CoverageValidator
 *
 * This module is independent of React and has no side-effects beyond its
 * own in-memory state.
 */

import { SphericalTargetGenerator, angularDistance, normalizeAngle } from './SphericalTargetGenerator';
import { DEFAULT_CAPTURE_CONFIG } from './CaptureConfig';
import { CoverageTracker } from './CoverageTracker';
import { CoverageValidator } from './CoverageValidator';

export class TargetEngine {
  constructor(config = DEFAULT_CAPTURE_CONFIG) {
    this.config = { ...config };

    // ── Session state ───────────────────────────────────────────────
    this.sessionId = null;
    this.capturePointId = null;
    this.referenceHeading = null;   // device heading at session start
    this.status = 'idle';           // idle | active | paused | completed

    // ── Targets ─────────────────────────────────────────────────────
    this.targets = [];
    this.currentTargetIndex = -1;

    // ── Stability gate ──────────────────────────────────────────────
    this._alignedSince = null;      // timestamp when alignment first detected
    this._isCapturing = false;      // lock to prevent double-capture
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Session lifecycle
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Start a new capture session.
   *
   * @param {string} capturePointId
   * @param {number} referenceHeading – current device heading at session start
   * @returns {{ sessionId, targets }}
   */
  startSession(capturePointId, referenceHeading) {
    this.sessionId = `ses_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    this.capturePointId = capturePointId;
    this.referenceHeading = normalizeAngle(referenceHeading);
    this.status = 'active';
    this._alignedSince = null;
    this._isCapturing = false;

    this.targets = SphericalTargetGenerator.generate(this.config);
    this.currentTargetIndex = 0;

    return { sessionId: this.sessionId, targets: this.targets };
  }

  /**
   * Resume a previously persisted session.
   *
   * @param {object}  session   – persisted session record
   * @param {Array}   targets   – persisted target records
   */
  resumeSession(session, targets) {
    this.sessionId = session.id;
    this.capturePointId = session.capturePointId;
    this.referenceHeading = session.referenceHeading;
    this.config = session.config || this.config;
    this.status = 'active';
    this._alignedSince = null;
    this._isCapturing = false;

    // Restore target state
    this.targets = targets.map((t) => ({ ...t }));

    // Advance to first pending target
    this.currentTargetIndex = this.targets.findIndex(
      (t) => t.status === 'pending' || t.status === 'needs-retake',
    );
    if (this.currentTargetIndex === -1) {
      // All captured — check if truly complete
      this.currentTargetIndex = this.targets.length;
    }
  }

  pauseSession() {
    if (this.status === 'active') this.status = 'paused';
    this._alignedSince = null;
    this._isCapturing = false;
  }

  completeSession() {
    this.status = 'completed';
    this._alignedSince = null;
    this._isCapturing = false;
  }

  getSessionSnapshot() {
    return {
      id: this.sessionId,
      capturePointId: this.capturePointId,
      referenceHeading: this.referenceHeading,
      config: { ...this.config },
      status: this.status,
      currentTargetIndex: this.currentTargetIndex,
      updatedAt: Date.now(),
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Orientation calibration
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Convert a raw device heading to relative yaw within this session.
   */
  deviceHeadingToRelativeYaw(deviceHeading) {
    if (this.referenceHeading == null) return normalizeAngle(deviceHeading);
    return normalizeAngle(deviceHeading - this.referenceHeading);
  }

  setReferenceHeading(heading) {
    this.referenceHeading = normalizeAngle(heading);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Target access
  // ═══════════════════════════════════════════════════════════════════

  getTargets() {
    return this.targets;
  }

  getCurrentTarget() {
    if (this.currentTargetIndex < 0 || this.currentTargetIndex >= this.targets.length) {
      return null;
    }
    return this.targets[this.currentTargetIndex];
  }

  /**
   * Advance to the next pending / needs-retake target.
   * Prefers the nearest pending target to the current orientation.
   */
  advanceToNextTarget(currentYaw, currentPitch) {
    const pendingSet = ['pending', 'needs-retake'];
    if (currentYaw != null && currentPitch != null) {
      const { target } = SphericalTargetGenerator.findNearestPendingTarget(
        this.targets, currentYaw, currentPitch, pendingSet,
      );
      if (target) {
        this.currentTargetIndex = this.targets.indexOf(target);
        return target;
      }
    }

    // Fallback: first pending by sequence
    const idx = this.targets.findIndex((t) => pendingSet.includes(t.status));
    if (idx !== -1) {
      this.currentTargetIndex = idx;
      return this.targets[idx];
    }

    this.currentTargetIndex = this.targets.length; // past end
    return null;
  }

  setCurrentTargetById(targetId) {
    const idx = this.targets.findIndex((t) => t.id === targetId);
    if (idx !== -1) {
      this.currentTargetIndex = idx;
      return this.targets[idx];
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Alignment & stability
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Check whether the device orientation is aligned with the current
   * target and has been stable long enough.
   *
   * @param {number} deviceHeading   raw device heading (degrees)
   * @param {number} devicePitch     device pitch (degrees)
   * @param {number} stabilityScore  from OrientationService (lower = steadier)
   * @returns {'none' | 'aligned' | 'stable'}
   */
  checkAlignment(deviceHeading, devicePitch, stabilityScore) {
    const target = this.getCurrentTarget();
    if (!target) return 'none';
    if (this._isCapturing) return 'none'; // capture already in flight

    const relYaw = this.deviceHeadingToRelativeYaw(deviceHeading);
    const tolerance = this.config.alignmentToleranceDeg;
    const isAligned = angularDistance(relYaw, devicePitch, target.relativeYaw, target.pitch) <= tolerance;

    if (!isAligned) {
      this._alignedSince = null;
      return 'none';
    }

    // Aligned — check stability
    if (stabilityScore > this.config.stabilityThreshold) {
      this._alignedSince = null;
      return 'aligned';
    }

    // Stable enough — check duration
    const now = Date.now();
    if (!this._alignedSince) {
      this._alignedSince = now;
    }

    if (now - this._alignedSince >= this.config.stabilityDurationMs) {
      return 'stable'; // ready for capture
    }

    return 'aligned';
  }

  /**
   * Lock this target for capture (prevents double-fire).
   * Returns true if lock acquired, false if already capturing.
   */
  beginCapture() {
    if (this._isCapturing) return false;
    this._isCapturing = true;

    const target = this.getCurrentTarget();
    if (target) target.status = 'capturing';

    return true;
  }

  /**
   * Mark the current target as successfully captured.
   */
  markCaptured(targetId, frameId) {
    const target = this.targets.find((t) => t.id === targetId);
    if (target) {
      target.status = 'captured';
      target.capturedFrameId = frameId;
    }
    this._isCapturing = false;
    this._alignedSince = null;
  }

  /**
   * Mark a target as failed (e.g. camera error).
   */
  markFailed(targetId) {
    const target = this.targets.find((t) => t.id === targetId);
    if (target) target.status = 'failed';
    this._isCapturing = false;
    this._alignedSince = null;
  }

  /**
   * Mark a target for retake (quality issue or supervisor decision).
   */
  markForRetake(targetId) {
    const target = this.targets.find((t) => t.id === targetId);
    if (target && target.status === 'captured') {
      target.status = 'needs-retake';
      target.capturedFrameId = null; // will be set when new capture completes
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Coverage & progress
  // ═══════════════════════════════════════════════════════════════════

  getProgress() {
    const captured = this.targets.filter((t) => t.status === 'captured').length;
    const total = this.targets.length;
    return {
      captured,
      total,
      percentage: total > 0 ? Math.round((captured / total) * 100) : 0,
    };
  }

  getCoverageReport(frames = []) {
    return CoverageTracker.generateReport(this.targets, frames);
  }

  getValidation(frames = []) {
    return CoverageValidator.validate(this.targets, frames, this.config);
  }

  isComplete() {
    return this.targets.length > 0 &&
      this.targets.every((t) => t.status === 'captured');
  }

  isManualMode() {
    return this._manualMode === true;
  }

  setManualMode(enabled) {
    this._manualMode = enabled;
  }
}

// Default singleton for simple usage — consumers can also create their own instance
export const targetEngine = new TargetEngine();
