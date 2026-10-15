/**
 * AlignmentGate.js
 *
 * Implements the 2° alignment proximity and 300ms steady dwell auto-capture rule
 * from theclumsypirate/photosphere-android.
 */

export const ALIGNMENT_THRESHOLD_DEGREES = 3.0; // Proximity to consider aligned
export const DWELL_HOLD_MS = 320; // Must stay steady inside circle for 320ms

export class AlignmentGate {
  constructor(thresholdDegrees = ALIGNMENT_THRESHOLD_DEGREES, dwellMs = DWELL_HOLD_MS) {
    this.thresholdDegrees = thresholdDegrees;
    this.dwellMs = dwellMs;
    this.dwellStartTime = null;
    this.isTriggered = false;
  }

  /**
   * Resets the gate (e.g. after capture or target change).
   */
  reset() {
    this.dwellStartTime = null;
    this.isTriggered = false;
  }

  /**
   * Updates gate with current angular distance to active target.
   *
   * @param {number} angularDistance - angle between target and camera optical axis in degrees
   * @param {number} now - timestamp in milliseconds (e.g. performance.now())
   * @returns {Object} - { isAligned, progress (0..1), shouldCapture }
   */
  update(angularDistance, now = performance.now()) {
    const isAligned = angularDistance <= this.thresholdDegrees;

    if (!isAligned) {
      this.dwellStartTime = null;
      this.isTriggered = false;
      return {
        isAligned: false,
        progress: 0,
        shouldCapture: false
      };
    }

    // Inside alignment circle
    if (!this.dwellStartTime) {
      this.dwellStartTime = now;
    }

    const elapsed = now - this.dwellStartTime;
    const progress = Math.min(elapsed / this.dwellMs, 1.0);

    let shouldCapture = false;
    if (progress >= 1.0 && !this.isTriggered) {
      this.isTriggered = true;
      shouldCapture = true;
    }

    return {
      isAligned: true,
      progress,
      shouldCapture
    };
  }
}
