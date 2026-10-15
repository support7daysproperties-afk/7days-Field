/**
 * OrientationTracker.js
 *
 * Robust device orientation tracking for modern Chrome Mobile, Safari iOS, and desktop fallback.
 * Uses both deviceorientation and deviceorientationabsolute with auto-permission request.
 */

import { eulerToRotationMatrix, normalizeDegrees } from './OrientationMath.js';

export class OrientationTracker {
  constructor(onUpdate) {
    this.onUpdate = onUpdate;
    this.isActive = false;

    this.currentData = {
      yawDegrees: 0,
      pitchDegrees: 0,
      rollDegrees: 0,
      hasFix: false,
      cameraBasis: eulerToRotationMatrix(0, 0, 0)
    };

    this.initialYawOffset = null;
    this.handleOrientation = this.handleOrientation.bind(this);
  }

  async requestPermissionAndStart() {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const state = await DeviceOrientationEvent.requestPermission();
        if (state === 'granted') {
          this.start();
          return true;
        }
      } catch (err) {
        console.warn("DeviceOrientation permission error:", err);
      }
    }
    this.start();
    return true;
  }

  start() {
    if (this.isActive) return;
    this.isActive = true;

    // Listen on both standard and absolute events for cross-Android/iOS compatibility
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', this.handleOrientation, true);
    }
    window.addEventListener('deviceorientation', this.handleOrientation, true);
  }

  stop() {
    this.isActive = false;
    window.removeEventListener('deviceorientationabsolute', this.handleOrientation, true);
    window.removeEventListener('deviceorientation', this.handleOrientation, true);
  }

  handleOrientation(event) {
    if (!this.isActive) return;

    let { alpha, beta, gamma } = event;
    if (alpha === null && beta === null && gamma === null) return;

    alpha = alpha || 0;
    beta = beta || 0;
    gamma = gamma || 0;

    // Convert Android / Web sensor coordinates to Photo Sphere Camera Frame:
    // When held upright facing horizon:
    // yaw = alpha (compass azimuth)
    // pitch = beta - 90 (0° at horizon, negative tilting up, positive tilting down)
    // roll = gamma
    let yaw = alpha;
    let pitch = beta - 90;
    let roll = gamma;

    // Anchor first heading so the user starts facing 0° yaw
    if (this.initialYawOffset === null) {
      this.initialYawOffset = yaw;
    }
    yaw = normalizeDegrees(yaw - this.initialYawOffset);

    // Compute basis matrix
    const cameraBasis = eulerToRotationMatrix(yaw, pitch, roll);

    this.currentData = {
      yawDegrees: yaw,
      pitchDegrees: pitch,
      rollDegrees: roll,
      hasFix: true,
      cameraBasis
    };

    if (this.onUpdate) {
      this.onUpdate(this.currentData);
    }
  }

  setOrientationManual(yaw, pitch, roll = 0) {
    const cameraBasis = eulerToRotationMatrix(yaw, pitch, roll);
    this.currentData = {
      yawDegrees: yaw,
      pitchDegrees: pitch,
      rollDegrees: roll,
      hasFix: true,
      cameraBasis
    };
    if (this.onUpdate) {
      this.onUpdate(this.currentData);
    }
  }
}
