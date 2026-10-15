/**
 * OrientationService.js  (Phase 2 — fixed)
 *
 * Changes from Phase 1
 * ────────────────────
 * • Heading smoothing now uses circular mean (atan2 of sin/cos sums)
 *   so it handles the 0°/360° wraparound correctly.
 * • Stability is computed as standard deviation of recent headings,
 *   giving a more meaningful and consistent metric.
 * • Added `getLatestReading()` accessor for non-listener consumers.
 */

export class OrientationService {
  constructor() {
    this.listeners = [];
    this.isListening = false;
    this.latestReading = { alpha: 0, beta: 0, gamma: 0, heading: 0, stability: 100 };
    this.history = [];
    this.HISTORY_SIZE = 10;

    this.handleOrientation = this.handleOrientation.bind(this);
  }

  // ── Permission ────────────────────────────────────────────────────

  async requestPermission() {
    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      try {
        const state = await DeviceOrientationEvent.requestPermission();
        return state === 'granted';
      } catch (err) {
        console.error('Orientation permission error', err);
        return false;
      }
    }
    return true; // Non-iOS or older devices that don't need explicit permission
  }

  /** Returns true if DeviceOrientationEvent is likely available. */
  isSupported() {
    return typeof DeviceOrientationEvent !== 'undefined';
  }

  // ── Start / Stop ──────────────────────────────────────────────────

  startListening() {
    if (this.isListening) return;
    window.addEventListener('deviceorientation', this.handleOrientation);
    this.isListening = true;
  }

  stopListening() {
    if (!this.isListening) return;
    window.removeEventListener('deviceorientation', this.handleOrientation);
    this.isListening = false;
    this.history = [];
  }

  // ── Event handler ─────────────────────────────────────────────────

  handleOrientation(event) {
    const { alpha, beta, gamma, webkitCompassHeading } = event;

    // alpha: rotation around z (0–360).  beta: front-to-back tilt (−180–180).
    // webkitCompassHeading: iOS-specific compass heading.
    const heading =
      webkitCompassHeading !== undefined && webkitCompassHeading !== null
        ? webkitCompassHeading
        : alpha != null
          ? (360 - alpha) % 360
          : 0;

    this.history.push({ alpha, beta, gamma, heading, time: Date.now() });
    if (this.history.length > this.HISTORY_SIZE) {
      this.history.shift();
    }

    const stability = this._calculateStability();

    this.latestReading = {
      alpha: this._linearSmooth('alpha'),
      beta: this._linearSmooth('beta'),
      gamma: this._linearSmooth('gamma'),
      heading: this._circularSmooth('heading'),
      stability,
    };

    this._notifyListeners();
  }

  // ── Smoothing ─────────────────────────────────────────────────────

  /** Arithmetic mean — suitable for beta / gamma / alpha (small range). */
  _linearSmooth(key) {
    if (this.history.length === 0) return 0;
    let sum = 0;
    for (const entry of this.history) {
      sum += entry[key] ?? 0;
    }
    return sum / this.history.length;
  }

  /**
   * Circular mean — correctly handles the 0°/360° wraparound.
   *
   *   mean_angle = atan2(Σ sin(θ), Σ cos(θ))
   */
  _circularSmooth(key) {
    if (this.history.length === 0) return 0;
    let sinSum = 0;
    let cosSum = 0;
    for (const entry of this.history) {
      const rad = ((entry[key] ?? 0) * Math.PI) / 180;
      sinSum += Math.sin(rad);
      cosSum += Math.cos(rad);
    }
    let avg = (Math.atan2(sinSum, cosSum) * 180) / Math.PI;
    if (avg < 0) avg += 360;
    return avg;
  }

  // ── Stability ─────────────────────────────────────────────────────

  /**
   * Stability score = angular standard deviation of recent headings.
   * Lower is steadier.  A perfectly still device returns ~0.
   *
   * Uses circular std-dev to handle wraparound.
   */
  _calculateStability() {
    if (this.history.length < 2) return 100;

    let sinSum = 0;
    let cosSum = 0;
    for (const entry of this.history) {
      const rad = (entry.heading * Math.PI) / 180;
      sinSum += Math.sin(rad);
      cosSum += Math.cos(rad);
    }
    const n = this.history.length;
    const R = Math.sqrt((sinSum / n) ** 2 + (cosSum / n) ** 2);

    // Circular standard deviation (degrees)
    // R → 1 when all angles are the same (perfectly stable)
    // R → 0 when angles are uniformly spread
    const _circularVariance = 1 - R;
    const circularStdDeg = Math.sqrt(-2 * Math.log(Math.max(R, 1e-10))) * (180 / Math.PI);

    // Also include pitch (beta) variance for a combined score
    const betas = this.history.map((h) => h.beta ?? 0);
    const betaMean = betas.reduce((a, b) => a + b, 0) / n;
    const betaVar = betas.reduce((a, b) => a + (b - betaMean) ** 2, 0) / n;
    const betaStd = Math.sqrt(betaVar);

    // Combined stability: sum of heading std and pitch std
    return Math.round((circularStdDeg + betaStd) * 100) / 100;
  }

  // ── Listeners ─────────────────────────────────────────────────────

  addListener(callback) {
    this.listeners.push(callback);
  }

  removeListener(callback) {
    this.listeners = this.listeners.filter((l) => l !== callback);
  }

  _notifyListeners() {
    for (const cb of this.listeners) {
      cb(this.latestReading);
    }
  }

  getLatestReading() {
    return { ...this.latestReading };
  }
}

export const orientationService = new OrientationService();
