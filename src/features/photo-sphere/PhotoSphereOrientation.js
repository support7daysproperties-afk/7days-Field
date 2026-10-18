/**
 * PhotoSphereOrientation.js
 *
 * Real device orientation tracker and motion stability monitor.
 * Employs DeviceOrientationEvent (alpha, beta, gamma), computes device rotation,
 * relative yaw calibrated to first capture, and tracks angular velocity (deg/sec).
 *
 * Provides 'moving too fast' feedback matching GCam's Motion Stability Guard.
 */

import { normalizeAngle, createCameraMatrix } from './PhotoSphereTargets';

/**
 * Computes 4x4 Camera Rotation Matrix remapped from device sensor frame
 * to camera optical frame, matching GCam goy.java:119-123:
 * 1. Android/W3C device orientation -> R_device
 * 2. Rotate 90 deg around X (points back camera optical axis forward)
 * 3. Rotate by displayRotationDeg around Z (display compensation for portrait/landscape)
 * 4. R_cam = R_display * (R_device * R_x(90))
 */
export function computeCameraRotationMatrix(
  alphaDeg = 0,
  betaDeg = 90,
  gammaDeg = 0,
  displayRotationDeg = 0
) {
  const deg2rad = Math.PI / 180;
  const a = (alphaDeg || 0) * deg2rad;
  const b = (betaDeg !== null && betaDeg !== undefined ? betaDeg : 90) * deg2rad;
  const g = (gammaDeg || 0) * deg2rad;

  const cA = Math.cos(a), sA = Math.sin(a);
  const cB = Math.cos(b), sB = Math.sin(b);
  const cG = Math.cos(g), sG = Math.sin(g);

  // W3C Device Orientation Matrix (Z-X'-Y'' intrinsic Euler angles)
  const r00 = cA * cG - sA * sB * sG;
  const r01 = -cB * sA;
  const r02 = cA * sG + sA * sB * cG;

  const r10 = sA * cG + cA * sB * sG;
  const r11 = cB * cA;
  const r12 = sA * sG - cA * sB * cG;

  const r20 = -cB * sG;
  const r21 = sB;
  const r22 = cB * cG;

  // Step 2: Post-multiply by Rx(90 deg) [points back camera along optical axis]
  const m00 = r00;
  const m01 = r02;
  const m02 = -r01;

  const m10 = r10;
  const m11 = r12;
  const m12 = -r11;

  const m20 = r20;
  const m21 = r22;
  const m22 = -r21;

  // Step 3: Display compensation around Z axis
  let f00 = m00, f01 = m01, f02 = m02;
  let f10 = m10, f11 = m11, f12 = m12;
  let f20 = m20, f21 = m21, f22 = m22;

  if (displayRotationDeg !== 0) {
    const dRad = displayRotationDeg * deg2rad;
    const cD = Math.cos(dRad);
    const sD = Math.sin(dRad);
    f00 = cD * m00 - sD * m10;
    f01 = cD * m01 - sD * m11;
    f02 = cD * m02 - sD * m12;

    f10 = sD * m00 + cD * m10;
    f11 = sD * m01 + cD * m11;
    f12 = sD * m02 + cD * m12;
  }

  return [
    f00, f01, f02, 0,
    f10, f11, f12, 0,
    f20, f21, f22, 0,
    0,   0,   0,   1
  ];
}

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
      angularVelocityRad: 0,
      isMovingTooFast: false,
      isStableForCapture: false,
      cameraRotationMatrix: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
      ],
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
    // alpha increases counter-clockwise.
    // In spherical camera space:
    // Looking straight is yaw = 0. Turning right is positive yaw (+yaw).
    let rawYaw = normalizeAngle(360 - alpha);
    let relYaw = rawYaw;
    if (this.referenceHeading !== null) {
      relYaw = normalizeAngle(rawYaw - this.referenceHeading);
    }

    // Compute angular velocity (deg/s) with low-pass filter
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

    // Fast movement warning threshold with hysteresis:
    let isMovingTooFast = this.currentOrientation.isMovingTooFast;
    if (this.smoothedVelocity > 50) {
      isMovingTooFast = true;
    } else if (this.smoothedVelocity < 32) {
      isMovingTooFast = false;
    }

    // Angular velocity in rad/s matching REA verified motion gating (||omega|| < 0.10 rad/s)
    const angularVelocityRad = (this.smoothedVelocity * Math.PI) / 180;
    const isStableForCapture = angularVelocityRad < 0.10 && !isMovingTooFast;

    const screenOrientation = typeof window !== 'undefined' && window.screen && window.screen.orientation
      ? window.screen.orientation.angle || 0
      : (typeof window !== 'undefined' ? window.orientation || 0 : 0);

    const sampleDtMs = this.lastTimestamp ? Math.round(now - this.lastTimestamp) : 0;

    // Construct 4x4 camera rotation matrix matching optical frame
    const rCam = createCameraMatrix(relYaw, pitch, gamma || 0);
    const cameraRotationMatrix = [
      rCam[0][0], rCam[1][0], rCam[2][0], 0,
      rCam[0][1], rCam[1][1], rCam[2][1], 0,
      rCam[0][2], rCam[1][2], rCam[2][2], 0,
      0,          0,          0,          1,
    ];

    this.currentOrientation = {
      yaw: relYaw,
      rawYaw,
      pitch,
      rawPitch,
      roll: gamma || 0,
      angularVelocity: Math.round(this.smoothedVelocity * 10) / 10,
      angularVelocityRad: Math.round(angularVelocityRad * 1000) / 1000,
      isMovingTooFast,
      isStableForCapture,
      cameraRotationMatrix,
      sampleDtMs,
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

