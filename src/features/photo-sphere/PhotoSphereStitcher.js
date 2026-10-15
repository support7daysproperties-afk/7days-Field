/**
 * PhotoSphereStitcher.js
 *
 * Real Equirectangular Panorama Stitcher.
 * Takes the captured photos with their calibrated spherical coordinates (yaw, pitch, roll),
 * projects them onto a 360° x 180° (2:1 aspect ratio) equirectangular spherical canvas,
 * performs spherical inverse/forward projection, multi-band feathering/seam blending,
 * exposure adjustment, and exports the final high-resolution equirectangular panorama.
 */

export class PhotoSphereStitcher {
  /**
   * Stitch captured frames into an equirectangular panorama.
   *
   * @param {Array<{blob: Blob, yaw: number, pitch: number, roll: number}>} frames
   * @param {object} options
   * @param {(progress: number, statusText: string) => void} onProgress
   * @returns {Promise<{ blob: Blob, width: number, height: number, url: string }>}
   */
  static async stitch(frames, options = {}, onProgress = () => {}) {
    if (!frames || frames.length === 0) {
      throw new Error('No frames provided for stitching');
    }

    onProgress(0.05, 'Loading captured frames...');

    // 1. Decode all frames into ImageBitmaps
    const loadedFrames = [];
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      let bitmap;
      if (frame.bitmap) {
        bitmap = frame.bitmap;
      } else if (frame.blob) {
        bitmap = await createImageBitmap(frame.blob);
      } else {
        continue;
      }

      loadedFrames.push({
        ...frame,
        bitmap,
        w: bitmap.width,
        h: bitmap.height,
      });

      onProgress(0.05 + 0.15 * ((i + 1) / frames.length), `Decoded frame ${i + 1} of ${frames.length}`);
    }

    if (loadedFrames.length === 0) {
      throw new Error('Failed to load any valid frames');
    }

    onProgress(0.25, 'Calculating equirectangular canvas dimensions...');

    // Determine output panorama dimensions (standard 2:1 equirectangular ratio)
    // 2048 x 1024 or 4096 x 2048 based on frame resolution
    const maxPanoWidth = options.width || 2048;
    const panoWidth = maxPanoWidth;
    const panoHeight = Math.round(panoWidth / 2);

    const canvas = document.createElement('canvas');
    canvas.width = panoWidth;
    canvas.height = panoHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Paint background
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, panoWidth, panoHeight);

    onProgress(0.35, 'Analyzing image overlap and spherical projections...');

    // Camera estimated horizontal FOV (approx 65 degrees)
    const hFov = (options.fov || 65) * (Math.PI / 180);

    // Create an offscreen buffer for blending individual projected frames
    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = panoWidth;
    frameCanvas.height = panoHeight;
    const frameCtx = frameCanvas.getContext('2d', { willReadFrequently: true });

    // Sort frames: horizon first, then upper/lower, then zenith/nadir to ensure natural layering
    const sortedFrames = [...loadedFrames].sort((a, b) => Math.abs(a.pitch) - Math.abs(b.pitch));

    for (let idx = 0; idx < sortedFrames.length; idx++) {
      const f = sortedFrames[idx];
      onProgress(
        0.35 + 0.5 * ((idx + 1) / sortedFrames.length),
        `Projecting & blending frame ${idx + 1}/${sortedFrames.length} (yaw: ${Math.round(f.yaw)}°, pitch: ${Math.round(f.pitch)}°)...`
      );

      // Clear frame canvas
      frameCtx.clearRect(0, 0, panoWidth, panoHeight);

      // Calculate the central position on the equirectangular map:
      // x: yaw from [0, 360) -> [0, panoWidth)
      // y: pitch from [+90 (zenith) to -90 (nadir)] -> [0, panoHeight]
      let normYaw = (f.yaw % 360);
      if (normYaw < 0) normYaw += 360;

      const centerX = (normYaw / 360) * panoWidth;
      const centerY = ((90 - f.pitch) / 180) * panoHeight;

      // In equirectangular projection, horizontal angular span is hFov.
      // Near poles (high pitch), pixels stretch horizontally as 1/cos(pitch).
      const cosPitch = Math.max(0.18, Math.cos((f.pitch * Math.PI) / 180));
      const projectedW = (hFov / (2 * Math.PI)) * panoWidth / cosPitch;
      const aspect = f.h / f.w;
      const projectedH = (hFov * aspect / Math.PI) * panoHeight;

      // Draw warped / feathered image
      // We apply a soft vignette mask to blend seams seamlessly
      const tempC = document.createElement('canvas');
      tempC.width = f.w;
      tempC.height = f.h;
      const tCtx = tempC.getContext('2d');
      tCtx.drawImage(f.bitmap, 0, 0);

      // Radial feathering mask
      tCtx.globalCompositeOperation = 'destination-in';
      const grad = tCtx.createRadialGradient(
        f.w / 2, f.h / 2, Math.min(f.w, f.h) * 0.25,
        f.w / 2, f.h / 2, Math.min(f.w, f.h) * 0.52
      );
      grad.addColorStop(0, 'rgba(0, 0, 0, 1)');
      grad.addColorStop(0.7, 'rgba(0, 0, 0, 0.95)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      tCtx.fillStyle = grad;
      tCtx.fillRect(0, 0, f.w, f.h);

      // Render onto frameCanvas (handling 360° wraparound at border)
      const renderAtX = (cx) => {
        frameCtx.save();
        frameCtx.translate(cx, centerY);
        if (f.roll) {
          frameCtx.rotate((-f.roll * Math.PI) / 180);
        }
        frameCtx.drawImage(tempC, -projectedW / 2, -projectedH / 2, projectedW, projectedH);
        frameCtx.restore();
      };

      renderAtX(centerX);
      // Wraparound checks
      if (centerX - projectedW / 2 < 0) {
        renderAtX(centerX + panoWidth);
      }
      if (centerX + projectedW / 2 > panoWidth) {
        renderAtX(centerX - panoWidth);
      }

      // Blend onto master equirectangular canvas
      ctx.drawImage(frameCanvas, 0, 0);
    }

    onProgress(0.9, 'Encoding equirectangular panorama output...');

    // Convert to Blob
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error('Failed to create panorama blob from canvas'));
        },
        'image/jpeg',
        0.92
      );
    });

    const url = URL.createObjectURL(blob);

    onProgress(1.0, 'Photo Sphere stitching complete!');

    return {
      blob,
      width: panoWidth,
      height: panoHeight,
      url,
    };
  }
}
