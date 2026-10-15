/**
 * SphereProjection.js
 *
 * Direct port of SphereProjection.kt from theclumsypirate/photosphere-android.
 * Maps 3D spherical targets into 2D camera viewport pixel coordinates.
 */

import { targetDirection, angularDistanceDegrees } from './OrientationMath.js';

export const MIN_FORWARD_COMPONENT = 1e-3;

export class SphereProjection {
  /**
   * Computes focal length in pixels for viewport of dimensions (width, height)
   * given horizontal & vertical field of view (FOV in degrees).
   */
  static focalLengthPx(width, height, fovH = 65, fovV = 80) {
    const fH = (width / 2) / Math.tan((fovH / 2) * (Math.PI / 180));
    const fV = (height / 2) / Math.tan((fovV / 2) * (Math.PI / 180));
    // For FILL_CENTER, use max
    return Math.max(fH, fV);
  }

  /**
   * Projects a target direction vector into camera-frame coordinates [x, y, z]
   * using the camera's orthogonal basis { right, up, forward }.
   */
  static projectToCamera(targetDir, cameraBasis) {
    const { right, up, forward } = cameraBasis;

    // Dot products project world vector into camera basis
    const x = targetDir.x * right.x + targetDir.y * right.y + targetDir.z * right.z;
    const y = targetDir.x * up.x + targetDir.y * up.y + targetDir.z * up.z;
    const z = targetDir.x * forward.x + targetDir.y * forward.y + targetDir.z * forward.z;

    const angle = angularDistanceDegrees(targetDir, forward);

    return {
      x,
      y,
      z,
      angularDistanceDegrees: angle,
      isInFront: z > MIN_FORWARD_COMPONENT
    };
  }

  /**
   * Projects a target onto 2D screen coordinates (px).
   * Center of screen is (width / 2, height / 2).
   *
   * @param {Object} target - { yawDegrees, pitchDegrees }
   * @param {Object} cameraBasis - { right, up, forward }
   * @param {number} width - screen width in px
   * @param {number} height - screen height in px
   * @param {number} focalPx - focal length in px
   * @returns {Object} - { screenX, screenY, isInFront, angularDistance, edgeClamped: boolean, headingAngleRad }
   */
  static projectTargetToScreen(target, cameraBasis, width, height, focalPx) {
    const elevation = -target.pitchDegrees; // pitch is negative above horizon
    const dir = targetDirection(target.yawDegrees, elevation);
    const camView = this.projectToCamera(dir, cameraBasis);

    const centerX = width / 2;
    const centerY = height / 2;

    if (!camView.isInFront) {
      // Behind camera -> calculate 2D direction for off-screen edge arrow
      const angle = Math.atan2(-camView.y, camView.x); // screen coords (y down)
      const edgeRadius = Math.min(centerX, centerY) * 0.85;
      return {
        screenX: centerX + Math.cos(angle) * edgeRadius,
        screenY: centerY + Math.sin(angle) * edgeRadius,
        isInFront: false,
        angularDistance: camView.angularDistanceDegrees,
        isOffScreen: true,
        angleRad: angle
      };
    }

    // Pinhole projection: screenX = centerX + f * (x / z), screenY = centerY - f * (y / z) (since screen y is down)
    const rawX = centerX + focalPx * (camView.x / camView.z);
    const rawY = centerY - focalPx * (camView.y / camView.z);

    const margin = 20;
    const isOffScreen = rawX < margin || rawX > width - margin || rawY < margin || rawY > height - margin;

    // Angle from center
    const angleRad = Math.atan2(rawY - centerY, rawX - centerX);

    return {
      screenX: rawX,
      screenY: rawY,
      isInFront: true,
      angularDistance: camView.angularDistanceDegrees,
      isOffScreen,
      angleRad
    };
  }
}
