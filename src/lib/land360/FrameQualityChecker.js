/**
 * FrameQualityChecker.js
 *
 * Real image-analysis utilities for captured frames.
 *
 * Where a measurement is unavailable (e.g. the image cannot be decoded)
 * the check reports "not-evaluated" rather than fabricating a score.
 *
 * Quality levels:
 *   passed        – frame is acceptable
 *   warning       – frame has a recoverable issue (retake recommended)
 *   failed        – frame is unusable (retake required)
 *   not-evaluated – check could not be performed
 */

import { angularDistance } from './SphericalTargetGenerator';
import { DEFAULT_CAPTURE_CONFIG } from './CaptureConfig';

// ─── Main API ─────────────────────────────────────────────────────────────────

export class FrameQualityChecker {
  /**
   * Run all quality checks on a frame.
   *
   * @param {object} frame  – frame record (must include localUri, image dims, orientation)
   * @param {object} config – CaptureConfig
   * @returns {Promise<object>}  { qualityStatus, qualityWarnings, qualityMetrics }
   */
  static async check(frame, config = DEFAULT_CAPTURE_CONFIG) {
    const warnings = [];
    const metrics = {};

    // 1. Validate image exists and can be loaded
    if (!frame.localUri) {
      warnings.push({ check: 'image_exists', severity: 'failed', message: 'Missing image data.' });
      return { qualityStatus: 'failed', qualityWarnings: warnings, qualityMetrics: metrics };
    }

    // 2. Try to load and analyse the image
    let imgData = null;
    try {
      imgData = await this._loadImageData(frame.localUri);
    } catch (err) {
      warnings.push({
        check: 'image_readable',
        severity: 'failed',
        message: `Cannot decode image: ${err.message}`,
      });
      return { qualityStatus: 'failed', qualityWarnings: warnings, qualityMetrics: metrics };
    }

    // 3. Dimension check
    const dimResult = this._checkDimensions(imgData, config);
    metrics.width = imgData.width;
    metrics.height = imgData.height;
    if (dimResult) warnings.push(dimResult);

    // 4. Brightness / exposure
    const brightnessResult = this._checkBrightness(imgData, config);
    metrics.averageBrightness = brightnessResult.average;
    if (brightnessResult.warning) warnings.push(brightnessResult.warning);

    // 5. Sharpness (Laplacian variance)
    const sharpnessResult = this._checkSharpness(imgData, config);
    metrics.sharpnessScore = sharpnessResult.score;
    if (sharpnessResult.warning) warnings.push(sharpnessResult.warning);

    // 6. Orientation metadata
    if (frame.capturedYaw == null || frame.capturedPitch == null) {
      warnings.push({
        check: 'orientation_metadata',
        severity: 'warning',
        message: 'Missing captured orientation metadata.',
      });
    }

    // 7. Target alignment deviation
    if (
      frame.targetYaw != null && frame.targetPitch != null &&
      frame.capturedYaw != null && frame.capturedPitch != null
    ) {
      const deviation = angularDistance(
        frame.targetYaw, frame.targetPitch,
        frame.capturedYaw, frame.capturedPitch,
      );
      metrics.alignmentDeviation = Math.round(deviation * 100) / 100;
      if (deviation > 20) {
        warnings.push({
          check: 'alignment_deviation',
          severity: 'warning',
          message: `Frame captured ${Math.round(deviation)}° from target direction.`,
        });
      }
    }

    // Aggregate status
    const hasFailed = warnings.some((w) => w.severity === 'failed');
    const hasWarning = warnings.some((w) => w.severity === 'warning');
    const qualityStatus = hasFailed ? 'failed' : hasWarning ? 'warning' : 'passed';

    return { qualityStatus, qualityWarnings: warnings, qualityMetrics: metrics };
  }

  /**
   * Check whether two frames are near-duplicates based on orientation.
   */
  static areDuplicates(frameA, frameB, thresholdDeg = 5) {
    if (
      frameA.capturedYaw == null || frameA.capturedPitch == null ||
      frameB.capturedYaw == null || frameB.capturedPitch == null
    ) {
      return false; // can't determine without orientation
    }
    const d = angularDistance(
      frameA.capturedYaw, frameA.capturedPitch,
      frameB.capturedYaw, frameB.capturedPitch,
    );
    return d < thresholdDeg;
  }

  // ─── Internal helpers ─────────────────────────────────────────────────

  /**
   * Load a base64/blob-url image and return pixel data at reduced resolution.
   * Downsample to ≤ 200 px for performance.
   */
  static _loadImageData(uri) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 200;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        const data = ctx.getImageData(0, 0, w, h);
        resolve({
          width: img.width,
          height: img.height,
          analysisWidth: w,
          analysisHeight: h,
          pixels: data.data,
        });
      };
      img.onerror = () => reject(new Error('Image failed to load'));
      img.src = uri;
    });
  }

  /** Dimension check */
  static _checkDimensions(imgData, config) {
    const min = config.minImageDimension || 100;
    if (imgData.width < min || imgData.height < min) {
      return {
        check: 'dimensions',
        severity: 'warning',
        message: `Image resolution ${imgData.width}×${imgData.height} is below minimum ${min}px.`,
      };
    }
    return null;
  }

  /**
   * Compute average luminance and check exposure.
   * Luminance = 0.299R + 0.587G + 0.114B
   */
  static _checkBrightness(imgData, config) {
    const px = imgData.pixels;
    let sum = 0;
    const pixelCount = px.length / 4;

    for (let i = 0; i < px.length; i += 4) {
      sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    }

    const avg = pixelCount > 0 ? sum / pixelCount : 0;
    const rounded = Math.round(avg * 10) / 10;

    let warning = null;
    if (avg < (config.minBrightness || 15)) {
      warning = {
        check: 'brightness',
        severity: 'warning',
        message: `Very dark image (avg brightness ${rounded}). May be unusable for stitching.`,
      };
    } else if (avg > (config.maxBrightness || 245)) {
      warning = {
        check: 'brightness',
        severity: 'warning',
        message: `Severely overexposed image (avg brightness ${rounded}).`,
      };
    }

    return { average: rounded, warning };
  }

  /**
   * Estimate image sharpness via Laplacian variance.
   * Higher variance → sharper image.
   *
   * Uses a simplified 3×3 Laplacian kernel on the greyscale image.
   */
  static _checkSharpness(imgData, config) {
    const w = imgData.analysisWidth;
    const h = imgData.analysisHeight;
    const px = imgData.pixels;

    // Build greyscale buffer
    const grey = new Float32Array(w * h);
    for (let i = 0; i < grey.length; i++) {
      const off = i * 4;
      grey[i] = 0.299 * px[off] + 0.587 * px[off + 1] + 0.114 * px[off + 2];
    }

    // Laplacian convolution (skip border pixels)
    let sum = 0;
    let sumSq = 0;
    let count = 0;

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        const laplacian =
          -4 * grey[idx] +
          grey[idx - 1] +
          grey[idx + 1] +
          grey[idx - w] +
          grey[idx + w];
        sum += laplacian;
        sumSq += laplacian * laplacian;
        count++;
      }
    }

    const mean = count > 0 ? sum / count : 0;
    const variance = count > 0 ? sumSq / count - mean * mean : 0;
    const score = Math.round(variance * 100) / 100;

    let warning = null;
    if (score < (config.minSharpness || 5)) {
      warning = {
        check: 'sharpness',
        severity: 'warning',
        message: `Possibly blurry image (sharpness score ${score}).`,
      };
    }

    return { score, warning };
  }
}
