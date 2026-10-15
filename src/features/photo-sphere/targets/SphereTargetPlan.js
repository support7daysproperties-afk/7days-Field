/**
 * SphereTargetPlan.js
 *
 * Direct port of SphereTarget.kt and SphereTargetPlan.kt from theclumsypirate/photosphere-android.
 * Defines the spherical rings and boustrophedon sweep trajectory.
 */

import { normalizeDegrees } from '../orientation/OrientationMath.js';

export class SphereTargetPlan {
  /**
   * Generates a standard Photo Sphere target plan.
   * Rings at elevations: Equator (0°), Upper (+26°, +52°, +78°), Lower (-26°, -52°, -78°), Zenith (+90°), Nadir (-90°).
   *
   * @param {string} scope - 'ring' (equator only) or 'sphere' (full 360° x 180°)
   * @param {number} overlap - target overlap ratio (default ~0.35)
   * @param {number} fovDeg - approx camera field of view (default 65°)
   */
  static createPlan(scope = 'sphere', overlap = 0.35, fovDeg = 65) {
    const angularStep = fovDeg * (1 - overlap); // e.g. ~42° step on equator -> ~9 frames on equator
    const targets = [];
    const rings = [];

    // Elevation rings:
    // Full sphere uses equator (0°), middle upper/lower (+30°, -30°), high/low (+60°, -60°), and poles (+90°, -90°)
    // Or ring mode: equator only
    const ringElevations = scope === 'ring'
      ? [0]
      : [0, 28, 56, 85, -28, -56, -85];

    let globalIndex = 0;

    for (let r = 0; r < ringElevations.length; r++) {
      const elevation = ringElevations[r];
      const pitch = -elevation; // pitch is negative above horizon
      const ringStart = globalIndex;

      if (Math.abs(elevation) >= 80) {
        // Near poles: 1 or 2 frames suffice
        targets.push({
          id: globalIndex++,
          ringIndex: r,
          yawDegrees: 0,
          pitchDegrees: pitch,
          elevationDegrees: elevation,
          isPole: true
        });
      } else {
        // Ring count scaled by cos(elevation)
        const cosEl = Math.cos(elevation * (Math.PI / 180));
        const effectiveStep = Math.max(angularStep / cosEl, 30);
        const count = Math.max(Math.round(360 / effectiveStep), 4);
        const yawStep = 360 / count;

        // Boustrophedon sweep: alternate clockwise / counter-clockwise on each ring
        const sweepDirection = (r % 2 === 0) ? 1 : -1;
        const startYaw = sweepDirection === 1 ? 0 : 360 - yawStep;

        for (let i = 0; i < count; i++) {
          const rawYaw = startYaw + sweepDirection * (i * yawStep);
          const yaw = normalizeDegrees(rawYaw);

          targets.push({
            id: globalIndex++,
            ringIndex: r,
            yawDegrees: yaw,
            pitchDegrees: pitch,
            elevationDegrees: elevation,
            isPole: false
          });
        }
      }

      const ringEnd = globalIndex - 1;
      rings.push({ ringIndex: r, elevation, start: ringStart, end: ringEnd });
    }

    return {
      scope,
      targets,
      rings,
      totalCount: targets.length
    };
  }

  /**
   * Find next recommended target index given the current active target and captured set.
   */
  static getNextTargetIndex(plan, activeIndex, capturedSet) {
    if (!plan || !plan.targets.length) return 0;

    // First try the sequential next target
    const total = plan.targets.length;
    for (let offset = 0; offset < total; offset++) {
      const idx = (activeIndex + offset) % total;
      if (!capturedSet.has(idx)) {
        return idx;
      }
    }

    return -1; // All captured
  }
}
