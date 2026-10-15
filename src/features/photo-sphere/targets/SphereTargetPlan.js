/**
 * SphereTargetPlan.js
 *
 * Full-sphere target planning module conforming to n30dyn4m1c/360-photo-app.
 * Generates an adaptive spherical grid of targets covering:
 * 1. Horizon equator (pitch = 0°)
 * 2. Intermediate upward ring(s) (pitch ≈ +30° to +40°)
 * 3. Zenith pole cap (pitch ≈ +75° to +90°)
 * 4. Intermediate downward ring(s) (pitch ≈ -30° to -40°)
 * 5. Nadir pole cap (pitch ≈ -75° to -90°)
 *
 * Spacing adapts to measured camera FOV with ~35% overlap between adjacent shots.
 */

import { deltaAngle, sphericalDistance } from '../orientation/OrientationMath';

export class SphereTargetPlan {
  /**
   * @param {object} [config]
   * @param {number} [config.hfov=65] - Horizontal camera field of view in degrees
   * @param {number} [config.vfov=50] - Vertical camera field of view in degrees
   * @param {number} [config.overlapFraction=0.35] - Desired overlap (0.35 = 35%)
   */
  constructor(config = {}) {
    this.hfov = config.hfov || 65;
    this.vfov = config.vfov || 50;
    this.overlapFraction = config.overlapFraction || 0.35;
    this.targets = this.generatePlan();
  }

  /**
   * Generates spherical target markers covering complete 360° x 180° sphere.
   * @returns {Array<SphereTarget>}
   */
  generatePlan() {
    const targets = [];
    let sequence = 1;

    // Effective step size per frame factoring in overlap
    const effectiveHStep = Math.max(25, this.hfov * (1 - this.overlapFraction));
    const effectiveVStep = Math.max(25, this.vfov * (1 - this.overlapFraction));

    // Calculate ring pitch elevations from -90 to +90
    // Standard photo sphere rings: Nadir (-75°), Lower (-32°), Equator (0°), Upper (+32°), Zenith (+75°)
    const pitchRings = [
      { pitch: 0, label: 'equator', weight: 1.0 },
      { pitch: Math.min(40, effectiveVStep), label: 'upper', weight: Math.cos((effectiveVStep * Math.PI) / 180) },
      { pitch: Math.min(80, effectiveVStep * 2), label: 'zenith', weight: 0.25 },
      { pitch: -Math.min(40, effectiveVStep), label: 'lower', weight: Math.cos((effectiveVStep * Math.PI) / 180) },
      { pitch: -Math.min(80, effectiveVStep * 2), label: 'nadir', weight: 0.25 },
    ];

    for (const ring of pitchRings) {
      if (Math.abs(ring.pitch) >= 70) {
        // Pole caps: 1 or 2 shots are sufficient due to spherical convergence
        const poleSteps = 2;
        for (let i = 0; i < poleSteps; i++) {
          const yaw = i * 180 - 90;
          targets.push({
            id: `target_${sequence}`,
            sequenceNumber: sequence++,
            yaw,
            pitch: ring.pitch,
            ringLabel: ring.label,
            status: 'pending', // 'pending' | 'captured' | 'active'
            capturedFrameId: null,
          });
        }
      } else {
        // Horizontal ring: calculate target count along circumference
        // Ring circumference shrinks with cos(pitch)
        const ringCircumferenceRatio = Math.max(0.4, Math.cos((ring.pitch * Math.PI) / 180));
        const ringHStep = effectiveHStep / ringCircumferenceRatio;
        const count = Math.max(6, Math.round(360 / ringHStep));
        const actualStep = 360 / count;

        // Offset alternating rings by half-step for optimal hexagonal packing
        const yawOffset = ring.pitch !== 0 ? actualStep / 2 : 0;

        for (let i = 0; i < count; i++) {
          let yaw = i * actualStep + yawOffset;
          if (yaw > 180) yaw -= 360;

          targets.push({
            id: `target_${sequence}`,
            sequenceNumber: sequence++,
            yaw: Math.round(yaw * 10) / 10,
            pitch: Math.round(ring.pitch * 10) / 10,
            ringLabel: ring.label,
            status: 'pending',
            capturedFrameId: null,
          });
        }
      }
    }

    return targets;
  }

  /**
   * Finds the best next target closest to current camera orientation
   * with priority to completing the current ring before leaping across sphere.
   *
   * @param {number} currentYaw
   * @param {number} currentPitch
   * @returns {SphereTarget|null}
   */
  findNextTarget(currentYaw, currentPitch) {
    const pendingTargets = this.targets.filter((t) => t.status === 'pending');
    if (pendingTargets.length === 0) return null;

    let bestTarget = null;
    let minCost = Infinity;

    for (const target of pendingTargets) {
      const dist = sphericalDistance(currentYaw, currentPitch, target.yaw, target.pitch);
      const pitchPenalty = Math.abs(currentPitch - target.pitch) * 1.5;
      const cost = dist + pitchPenalty;

      if (cost < minCost) {
        minCost = cost;
        bestTarget = target;
      }
    }

    return bestTarget;
  }

  /**
   * Marks a target as captured.
   * @param {string} targetId
   * @param {string} frameId
   */
  markCaptured(targetId, frameId) {
    const target = this.targets.find((t) => t.id === targetId);
    if (target) {
      target.status = 'captured';
      target.capturedFrameId = frameId;
    }
  }

  /**
   * Resets a target back to pending (for undo or retake).
   * @param {string} targetId
   */
  resetTarget(targetId) {
    const target = this.targets.find((t) => t.id === targetId);
    if (target) {
      target.status = 'pending';
      target.capturedFrameId = null;
    }
  }

  /**
   * Calculates overall capture progress and regional breakdowns.
   * @returns {{
   *   total: number,
   *   captured: number,
   *   percentage: number,
   *   isComplete: boolean,
   *   rings: Record<string, { total: number, captured: number, complete: boolean }>
   * }}
   */
  getProgress() {
    const total = this.targets.length;
    const captured = this.targets.filter((t) => t.status === 'captured').length;
    const percentage = total > 0 ? Math.round((captured / total) * 100) : 0;

    const rings = {};
    for (const t of this.targets) {
      if (!rings[t.ringLabel]) {
        rings[t.ringLabel] = { total: 0, captured: 0, complete: false };
      }
      rings[t.ringLabel].total++;
      if (t.status === 'captured') {
        rings[t.ringLabel].captured++;
      }
    }

    for (const key of Object.keys(rings)) {
      rings[key].complete = rings[key].captured >= rings[key].total;
    }

    return {
      total,
      captured,
      percentage,
      isComplete: captured === total,
      rings,
    };
  }
}
