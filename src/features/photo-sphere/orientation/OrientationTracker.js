/**
 * OrientationTracker.js
 *
 * Captures device orientation using AbsoluteOrientationSensor / DeviceOrientationEvent.
 * Provides smoothed orientation (yaw, pitch, roll) and camera orthogonal basis matrix.
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
    this.handleDeviceOrientation = this.handleDeviceOrientation.bind(this);
  }

  start() {
    if (this.isActive) return;
    this.isActive = true;

    // Request permission on iOS 13+ if needed
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission()
        .then(permissionState => {
          if (permissionState === 'granted') {
            window.addEventListener('deviceorientation', this.handleDeviceOrientation, true);
          }
        })
        .catch(console.error);
    } else {
      window.addEventListener('deviceorientation', this.handleDeviceOrientation, true);
    }
  }

  stop() {
    this.isActive = false;
    window.removeEventListener('deviceorientation', this.handleDeviceOrientation, true);
  }

  handleDeviceOrientation(event) {
    if (!this.isActive) return;

    let { alpha, beta, gamma } = event; // alpha: compass [0..360], beta: pitch [-180..180], gamma: roll [-90..90]
    if (alpha === null && beta === null && gamma === null) return;

    alpha = alpha || 0;
    beta = beta || 0;
    gamma = gamma || 0;

    // Convert Android / Web sensor coordinates to Photo Sphere Camera Frame:
    // When held upright facing horizon:
    // yaw = alpha
    // pitch = beta - 90 (0° at horizon, negative tilting up, positive tilting down)
    // roll = gamma
    let yaw = alpha;
    let pitch = beta - 90;
    let roll = gamma;

    // Handle initial bearing calibration (so the user starts facing 0° yaw)
    if (this.initialYawOffset === null) {
      this.initialYawOffset = yaw;
    }
    yaw = normalizeDegrees(yaw - this.initialYawOffset);

    // Calculate basis matrix
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

  // Fallback / manual simulator for testing in desktop browser
  setSimulatedOrientation(yaw, pitch, roll = 0) {
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
