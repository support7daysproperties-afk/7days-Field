/**
 * TargetSelection.js
 *
 * Implements Google Photo Sphere free-form target selection rules:
 * Allows user to capture dots in any order while prioritizing closest dot or following plan.
 */

import { angularDistanceDegrees, targetDirection, eulerToRotationMatrix } from '../orientation/OrientationMath.js';

export const CLAIM_DEGREES = 8.0; // Distance to latch onto a target
export const CLAIM_HYSTERESIS_DEGREES = 2.0;

export class TargetSelection {
  /**
   * Evaluates aim attitude against uncaptured targets.
   * If user aims close to any uncaptured target, claim it as active.
   */
  static selectActiveTarget(plan, currentOrientation, currentActiveIndex, capturedSet) {
    if (!plan || !plan.targets.length) return 0;

    const cameraBasis = eulerToRotationMatrix(
      currentOrientation.yawDegrees,
      currentOrientation.pitchDegrees,
      currentOrientation.rollDegrees
    );

    const forward = cameraBasis.forward;

    let closestIndex = currentActiveIndex;
    let minDistance = Infinity;

    // Check all uncaptured targets
    for (let i = 0; i < plan.targets.length; i++) {
      if (capturedSet.has(i)) continue;

      const target = plan.targets[i];
      const dir = targetDirection(target.yawDegrees, -target.pitchDegrees);
      const dist = angularDistanceDegrees(dir, forward);

      if (dist < minDistance) {
        minDistance = dist;
        closestIndex = i;
      }
    }

    // If closest is within claim radius, switch to it; otherwise stick with current active if uncaptured
    if (minDistance <= CLAIM_DEGREES) {
      return closestIndex;
    }

    if (!capturedSet.has(currentActiveIndex)) {
      return currentActiveIndex;
    }

    return closestIndex;
  }
}
