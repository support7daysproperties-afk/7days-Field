/**
 * OrientationAdapter.js
 *
 * Real device orientation tracker for Photo Sphere capture.
 * Captures device orientation from hardware sensors via:
 * 1. DeviceOrientationEvent (absolute or standard)
 * 2. Circular smoothing & stability assessment
 * 3. Graceful degradation, permission gates, and cleanup
 */

import {
  deviceOrientationToEuler,
  circularMeanDegrees,
  normalizeAngle180,
} from './OrientationMath';

export class OrientationAdapter {
  constructor(options = {}) {
    this.historySize = options.historySize || 8;
    this.stabilityThresholdDeg = options.stabilityThresholdDeg || 2.5; // Max stdev to consider steady
    this.listeners = new Set();
    this.isListening = false;
    this.permissionState = 'prompt'; // 'prompt' | 'granted' | 'denied' | 'unsupported'

    this.rawHistory = [];
    this.currentOrientation = {
      yaw: 0,
      pitch: 0,
      roll: 0,
      stability: 100, // 0..100 (100 is rock solid)
      isStable: true,
      timestamp: Date.now(),
    };

    this._onDeviceOrientation = this._onDeviceOrientation.bind(this);
    this._onScreenOrientationChange = this._onScreenOrientationChange.bind(this);
    this.screenAngle = 0;
  }

  /**
   * Request sensor permissions where required (e.g. iOS 13+ Safari).
   * @returns {Promise<boolean>}
   */
  async requestPermission() {
    if (typeof window === 'undefined') return false;

    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      try {
        const response = await DeviceOrientationEvent.requestPermission();
        if (response === 'granted') {
          this.permissionState = 'granted';
          return true;
        } else {
          this.permissionState = 'denied';
          return false;
        }
      } catch (err) {
        console.warn('Orientation permission error:', err);
        this.permissionState = 'denied';
        return false;
      }
    }

    if ('ondeviceorientation' in window || typeof DeviceOrientationEvent !== 'undefined') {
      this.permissionState = 'granted';
      return true;
    }

    this.permissionState = 'unsupported';
    return false;
  }

  /**
   * Starts listening to orientation sensors.
   */
  start() {
    if (this.isListening || typeof window === 'undefined') return;

    this.screenAngle = window.screen?.orientation?.angle ?? window.orientation ?? 0;
    if (window.screen?.orientation) {
      window.screen.orientation.addEventListener('change', this._onScreenOrientationChange);
    } else {
      window.addEventListener('orientationchange', this._onScreenOrientationChange);
    }

    // Prefer deviceorientationabsolute if available (Chrome Android)
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', this._onDeviceOrientation, true);
    } else {
      window.addEventListener('deviceorientation', this._onDeviceOrientation, true);
    }

    this.isListening = true;
  }

  /**
   * Stops listening to orientation sensors and releases listeners.
   */
  stop() {
    if (!this.isListening || typeof window === 'undefined') return;

    window.removeEventListener('deviceorientationabsolute', this._onDeviceOrientation, true);
    window.removeEventListener('deviceorientation', this._onDeviceOrientation, true);

    if (window.screen?.orientation) {
      window.screen.orientation.removeEventListener('change', this._onScreenOrientationChange);
    } else {
      window.removeEventListener('orientationchange', this._onScreenOrientationChange);
    }

    this.rawHistory = [];
    this.isListening = false;
  }

  /**
   * Subscribes a listener to orientation updates.
   * @param {function(OrientationState): void} listener
   * @returns {function(): void} unsubscribe
   */
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.currentOrientation);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getOrientation() {
    return this.currentOrientation;
  }

  _onScreenOrientationChange() {
    this.screenAngle = window.screen?.orientation?.angle ?? window.orientation ?? 0;
  }

  _onDeviceOrientation(event) {
    const { alpha, beta, gamma, webkitCompassHeading } = event;

    // Reject all-null events
    if (alpha == null && beta == null && gamma == null) return;

    let euler = deviceOrientationToEuler(alpha, beta, gamma, this.screenAngle);

    // If iOS compass heading is directly provided, use it for azimuth
    if (webkitCompassHeading != null && !isNaN(webkitCompassHeading)) {
      euler.yaw = normalizeAngle180(webkitCompassHeading);
    }

    const now = Date.now();
    this.rawHistory.push({ ...euler, timestamp: now });
    if (this.rawHistory.length > this.historySize) {
      this.rawHistory.shift();
    }

    // Circular smoothing for yaw
    const smoothedYaw = circularMeanDegrees(this.rawHistory.map((h) => h.yaw));
    // Linear smoothing for pitch & roll
    const avgPitch =
      this.rawHistory.reduce((acc, h) => acc + h.pitch, 0) / this.rawHistory.length;
    const avgRoll =
      this.rawHistory.reduce((acc, h) => acc + h.roll, 0) / this.rawHistory.length;

    // Stability calculation: standard deviation of yaw and pitch over recent window
    let sumSqDiff = 0;
    for (const h of this.rawHistory) {
      const dYaw = normalizeAngle180(h.yaw - smoothedYaw);
      const dPitch = h.pitch - avgPitch;
      sumSqDiff += dYaw * dYaw + dPitch * dPitch;
    }
    const variance = sumSqDiff / Math.max(1, this.rawHistory.length);
    const stdev = Math.sqrt(variance);

    // Score from 0 to 100
    const stabilityScore = Math.max(0, Math.min(100, Math.round(100 - stdev * 15)));
    const isStable = stdev <= this.stabilityThresholdDeg;

    this.currentOrientation = {
      yaw: smoothedYaw,
      pitch: avgPitch,
      roll: avgRoll,
      stability: stabilityScore,
      isStable,
      timestamp: now,
    };

    for (const listener of this.listeners) {
      listener(this.currentOrientation);
    }
  }
}
