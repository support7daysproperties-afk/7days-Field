/**
 * CaptureConfig.js
 * Configuration for spherical 360° capture.
 *
 * SPACING & OVERLAP ASSUMPTIONS
 * ──────────────────────────────
 * • Conservative estimated camera FOV: 60°
 *   Most phone rear cameras have 65–80° FOV, but we cannot reliably query
 *   the actual FOV from the browser MediaStream API.  A conservative 60°
 *   ensures sufficient overlap even on narrower lenses.
 *
 * • Target overlap between adjacent frames: 40 %
 *   Overlap is needed for reliable feature-matching in Phase 3 stitching.
 *
 * • Effective angular step = FOV × (1 − overlap) = 60° × 0.6 = 36°
 *
 * SPHERICAL GEOMETRY
 * ──────────────────
 * At pitch θ the circle of latitude has circumference proportional to cos(θ).
 * The number of horizontal targets is scaled accordingly so that the angular
 * density on the sphere surface stays approximately uniform.
 *
 * KNOWN LIMITATIONS
 * ─────────────────
 * • True camera FOV is unknown — the 60° fallback may over- or under-sample.
 * • Roll is recorded for diagnostics but not used for alignment gating.
 * • Stitching quality depends on factors beyond this configuration (motion
 *   blur, parallax, exposure variation).
 */

export const DEFAULT_CAPTURE_CONFIG = {
  // ── Angular geometry (degrees) ────────────────────────────────────────
  estimatedFovDeg: 60,
  targetOverlap: 0.40,

  // ── Alignment gating ──────────────────────────────────────────────────
  alignmentToleranceDeg: 10,
  stabilityThreshold: 4,       // max stability score (lower is steadier)
  stabilityDurationMs: 300,    // ms the phone must hold still

  // ── Pitch-row configuration ───────────────────────────────────────────
  pitchRows: [-72, -36, 0, 36, 72],
  includePolarCaps: true,
  nadirPitchDeg: -80,          // not exactly −90 for handheld ergonomics
  zenithPitchDeg: 85,

  // ── Image quality thresholds ──────────────────────────────────────────
  minBrightness: 15,           // 0–255, very permissive for dark scenes
  maxBrightness: 245,
  minSharpness: 5,             // Laplacian-variance lower bound
  minImageDimension: 100,      // px — either width or height
  duplicateAngleThresholdDeg: 5,

  // ── Capture-session behaviour ─────────────────────────────────────────
  autoAdvanceDelayMs: 400,
  captureTimeoutMs: 60000,

  // ── Version tag (frozen with each session for reproducibility) ────────
  configVersion: '2.0.0',
};

/**
 * Effective angular step between neighbouring targets.
 */
export function getAngularStep(config = DEFAULT_CAPTURE_CONFIG) {
  return config.estimatedFovDeg * (1 - config.targetOverlap);
}

/**
 * Number of horizontal targets at a given pitch, scaled by cos(pitch).
 */
export function getHorizontalTargetCount(pitchDeg, config = DEFAULT_CAPTURE_CONFIG) {
  const step = getAngularStep(config);
  const cosFactor = Math.cos((pitchDeg * Math.PI) / 180);
  return Math.max(1, Math.round((360 * cosFactor) / step));
}
