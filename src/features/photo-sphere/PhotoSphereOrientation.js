/**
 * PhotoSphereOrientation.js
 *
 * Real device orientation tracker and motion stability monitor.
 * Employs DeviceOrientationEvent (alpha, beta, gamma), computes device rotation,
 * relative yaw calibrated to first capture, and tracks angular velocity (deg/sec).
 *
 * Provides 'moving too fast' feedback matching GCam's Motion Stability Guard.
 */

import { normalizeAngle } from './PhotoSphereTargets';

export class PhotoSphereOrientation {
  constructor(onUpdate) {
    this.onUpdate = onUpdate;
    this.referenceHeading = null;
    this.referencePitch = null;
    this.currentOrientation = {
      yaw: 0,
      pitch: 0,
      roll: 0,
      angularVelocity: 0,
      isMovingTooFast: false,
    };

    this.lastTimestamp = null;
    this.lastYaw = null;
    this.lastPitch = null;
    this.smoothedVelocity = 0;
    this.isRunning = false;
    this.permissionState = 'unknown'; // 'granted' | 'denied' | 'prompt'

    this._handleOrientation = this._handleOrientation.bind(this);
  }

  async requestPermission() {
    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      try {
        const response = await DeviceOrientationEvent.requestPermission();
        this.permissionState = response;
        return response === 'granted';
      } catch (err) {
        console.warn('Orientation permission error:', err);
        this.permissionState = 'denied';
        return false;
      }
    }
    this.permissionState = 'granted';
    return true;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    window.addEventListener('deviceorientation', this._handleOrientation, true);
  }

  stop() {
    this.isRunning = false;
    window.removeEventListener('deviceorientation', this._handleOrientation, true);
  }

  setReferenceHeading(heading, pitch = null) {
    this.referenceHeading = normalizeAngle(heading);
    if (pitch !== null) {
      this.referencePitch = Math.max(-90, Math.min(90, pitch));
    }
  }

  _handleOrientation(event) {
    const now = performance.now();
    let alpha = event.alpha; // 0 to 360 (compass/yaw)
    let beta = event.beta;   // -180 to 180 (pitch)
    let gamma = event.gamma; // -90 to 90 (roll)

    if (alpha === null || beta === null) {
      return;
    }

    // In portrait orientation:
    // When held vertically pointing forward, beta is ~90.
    // In camera optical space:
    // - Tilting phone UP (beta increases, e.g. 90 -> 105) tilts the camera up (pitch > 0).
    //   Thus rawPitch = beta - 90.
    let rawPitch = beta - 90;
    rawPitch = Math.max(-90, Math.min(90, rawPitch));

    // Calculate relative pitch if reference pitch is calibrated
    let pitch = rawPitch;
    if (this.referencePitch !== null) {
      pitch = rawPitch - this.referencePitch;
      pitch = Math.max(-90, Math.min(90, pitch));
    }

    // In W3C DeviceOrientationEvent:
    // alpha increases counter-clockwise (turning left increases alpha; turning right decreases alpha).
    // In spherical camera space:
    // Looking straight is yaw = 0. Turning right is positive yaw (+yaw).
    // Therefore, camera yaw = normalizeAngle(360 - alpha) (or -alpha).
    let rawYaw = normalizeAngle(360 - alpha);
    let relYaw = rawYaw;
    if (this.referenceHeading !== null) {
      relYaw = normalizeAngle(rawYaw - this.referenceHeading);
    }

    // Compute angular velocity (deg/s) with low-pass filter (Kalman/EMA emulation)
    // Prevents single-frame sensor jitter from falsely tripping speed guard
    let instantaneousVelocity = 0;
    if (this.lastTimestamp && this.lastYaw !== null && this.lastPitch !== null) {
      const dt = (now - this.lastTimestamp) / 1000;
      if (dt > 0.005) {
        let dYaw = Math.abs(relYaw - this.lastYaw);
        if (dYaw > 180) dYaw = 360 - dYaw;
        const dPitch = Math.abs(pitch - this.lastPitch);
        const totalDelta = Math.hypot(dYaw, dPitch);

        // Filter out microscopic sensor noise under 0.08 degrees
        if (totalDelta > 0.08) {
          instantaneousVelocity = totalDelta / dt;
        } else {
          instantaneousVelocity = 0;
        }
      }
    }

    // Exponential Moving Average filter (alpha = 0.20)
    this.smoothedVelocity = this.smoothedVelocity === 0
      ? instantaneousVelocity
      : 0.80 * this.smoothedVelocity + 0.20 * instantaneousVelocity;

    this.lastTimestamp = now;
    this.lastYaw = relYaw;
    this.lastPitch = pitch;

    // Fast movement threshold with hysteresis to prevent display flickering:
    // Trip above 50 deg/sec; only clear once user slows down below 32 deg/sec.
    let isMovingTooFast = this.currentOrientation.isMovingTooFast;
    if (this.smoothedVelocity > 50) {
      isMovingTooFast = true;
    } else if (this.smoothedVelocity < 32) {
      isMovingTooFast = false;
    }

    const screenOrientation = typeof window !== 'undefined' && window.screen && window.screen.orientation
      ? window.screen.orientation.angle || 0
      : (typeof window !== 'undefined' ? window.orientation || 0 : 0);

    this.currentOrientation = {
      yaw: relYaw,
      rawYaw,
      pitch,
      rawPitch,
      roll: gamma || 0,
      angularVelocity: Math.round(this.smoothedVelocity * 10) / 10,
      isMovingTooFast,
      rawSensor: {
        alpha: Math.round(alpha * 10) / 10,
        beta: Math.round(beta * 10) / 10,
        gamma: Math.round((gamma || 0) * 10) / 10,
      },
      screenOrientationAngle: screenOrientation,
    };

    if (this.onUpdate) {
      this.onUpdate(this.currentOrientation);
    }
  }
}
