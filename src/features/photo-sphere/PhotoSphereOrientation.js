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

  setReferenceHeading(heading) {
    this.referenceHeading = normalizeAngle(heading);
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
    // In Photo Sphere coordinate system, horizontal horizon is pitch = 0°, zenith is +90°, nadir is -90°.
    // Thus pitch = beta - 90 (when vertical, pitch is 0; tilting up makes beta > 90 -> pitch > 0; tilting down makes beta < 90 -> pitch < 0)
    let pitch = beta - 90;
    // Bound pitch to [-90, 90]
    pitch = Math.max(-90, Math.min(90, pitch));

    // Calculate relative yaw based on reference heading
    let rawYaw = normalizeAngle(alpha);
    let relYaw = rawYaw;
    if (this.referenceHeading !== null) {
      relYaw = normalizeAngle(rawYaw - this.referenceHeading);
    }

    // Compute angular velocity (deg/s)
    let angularVelocity = 0;
    if (this.lastTimestamp && this.lastYaw !== null && this.lastPitch !== null) {
      const dt = (now - this.lastTimestamp) / 1000;
      if (dt > 0.005) {
        let dYaw = Math.abs(relYaw - this.lastYaw);
        if (dYaw > 180) dYaw = 360 - dYaw;
        const dPitch = Math.abs(pitch - this.lastPitch);
        const totalDelta = Math.hypot(dYaw, dPitch);
        angularVelocity = totalDelta / dt;
      }
    }

    this.lastTimestamp = now;
    this.lastYaw = relYaw;
    this.lastPitch = pitch;

    // Fast movement threshold: > 45 deg/sec causes blur and GCam shows "Moving too fast"
    const isMovingTooFast = angularVelocity > 45;

    this.currentOrientation = {
      yaw: relYaw,
      rawYaw,
      pitch,
      roll: gamma || 0,
      angularVelocity,
      isMovingTooFast,
    };

    if (this.onUpdate) {
      this.onUpdate(this.currentOrientation);
    }
  }
}
