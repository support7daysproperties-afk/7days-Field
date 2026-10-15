/**
 * TargetSelection.js
 *
 * Coordinates active target selection, proximity detection, angular tolerance check,
 * and dwell-time stability tracking for automatic capture.
 */

import { sphericalDistance } from '../orientation/OrientationMath';

export class TargetSelection {
  /**
   * @param {object} [config]
   * @param {number} [config.alignmentToleranceDeg=4.5] - Max angular distance to qualify as aligned
   * @param {number} [config.dwellTimeMs=600] - Continuous stable dwell time before triggering auto-capture
   */
  constructor(config = {}) {
    this.alignmentToleranceDeg = config.alignmentToleranceDeg || 4.5;
    this.dwellTimeMs = config.dwellTimeMs || 600;

    this.activeTarget = null;
    this.dwellStartTime = null;
    this.dwellProgress = 0; // 0..1
    this.isAligned = false;
  }

  /**
   * Sets or updates active target.
   * @param {SphereTarget|null} target
   */
  setActiveTarget(target) {
    if (this.activeTarget?.id !== target?.id) {
      this.activeTarget = target;
      this.resetDwell();
    }
  }

  resetDwell() {
    this.dwellStartTime = null;
    this.dwellProgress = 0;
    this.isAligned = false;
  }

  /**
   * Evaluates current orientation against active target.
   *
   * @param {number} cameraYaw
   * @param {number} cameraPitch
   * @param {boolean} isOrientationStable - Whether hardware sensor has low jitter
   * @returns {{
   *   isAligned: boolean,
   *   distanceDeg: number,
   *   dwellProgress: number,
   *   shouldTriggerAutoCapture: boolean
   * }}
   */
  evaluate(cameraYaw, cameraPitch, isOrientationStable = true) {
    if (!this.activeTarget) {
      return {
        isAligned: false,
        distanceDeg: Infinity,
        dwellProgress: 0,
        shouldTriggerAutoCapture: false,
      };
    }

    const dist = sphericalDistance(
      cameraYaw,
      cameraPitch,
      this.activeTarget.yaw,
      this.activeTarget.pitch
    );

    const aligned = dist <= this.alignmentToleranceDeg;
    this.isAligned = aligned;

    let shouldTrigger = false;
    const now = Date.now();

    if (aligned && isOrientationStable) {
      if (!this.dwellStartTime) {
        this.dwellStartTime = now;
        this.dwellProgress = 0;
      } else {
        const elapsed = now - this.dwellStartTime;
        this.dwellProgress = Math.min(1.0, elapsed / this.dwellTimeMs);
        if (this.dwellProgress >= 1.0) {
          shouldTrigger = true;
          // Reset dwell start so we don't trigger back-to-back immediately
          this.dwellStartTime = null;
          this.dwellProgress = 1.0;
        }
      }
    } else {
      // Aim drifted or phone moved rapidly
      this.dwellStartTime = null;
      this.dwellProgress = 0;
    }

    return {
      isAligned: aligned,
      distanceDeg: dist,
      dwellProgress: this.dwellProgress,
      shouldTriggerAutoCapture: shouldTrigger,
    };
  }
}
