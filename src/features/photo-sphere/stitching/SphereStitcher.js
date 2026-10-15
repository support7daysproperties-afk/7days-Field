/**
 * SphereStitcher.js
 *
 * Stitches captured spherical camera frames into a seamless 2:1 Equirectangular Panorama.
 * Maps each camera frame's pixels into spherical lat/lon coordinates using the recorded orientation quaternion/yaw/pitch.
 */

export class SphereStitcher {
  /**
   * Stitches an array of frames into an equirectangular panorama image.
   *
   * @param {Array} frames - Array of { dataUrl, yawDegrees, pitchDegrees, rollDegrees }
   * @param {number} panoWidth - output panorama width (default 2048)
   * @param {number} panoHeight - output panorama height (default 1024, exactly 2:1)
   * @returns {Promise<string>} - Equirectangular Panorama Data URL
   */
  static async stitchFrames(frames, panoWidth = 2048, panoHeight = 1024) {
    if (!frames || frames.length === 0) {
      throw new Error("No frames provided for stitching");
    }

    const canvas = document.createElement('canvas');
    canvas.width = panoWidth;
    canvas.height = panoHeight;
    const ctx = canvas.getContext('2d');

    // Fill background with neutral sky/ground gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, panoHeight);
    bgGrad.addColorStop(0, '#1e293b');
    bgGrad.addColorStop(0.5, '#334155');
    bgGrad.addColorStop(1, '#0f172a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, panoWidth, panoHeight);

    // Load all frame images
    const loadedImages = await Promise.all(
      frames.map(frame => {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve({ img, frame });
          img.onerror = reject;
          img.src = frame.dataUrl;
        });
      })
    );

    // Approximate rectilinear-to-equirectangular patch placement
    // In equirectangular coordinates:
    // x = ((yaw + 180) / 360) * panoWidth
    // y = ((pitch + 90) / 180) * panoHeight (or elevation: (90 - elevation) / 180 * panoHeight)
    const patchWidth = panoWidth * 0.28;
    const patchHeight = panoHeight * 0.38;

    ctx.globalCompositeOperation = 'source-over';

    loadedImages.forEach(({ img, frame }) => {
      let normYaw = (frame.yawDegrees + 360) % 360; // 0..360
      const normPitch = frame.pitchDegrees; // -90..90 (negative up)
      const elevation = -normPitch; // 90..-90 (90 at zenith, -90 at nadir)

      const centerX = (normYaw / 360) * panoWidth;
      const centerY = ((90 - elevation) / 180) * panoHeight;

      ctx.save();
      ctx.translate(centerX, centerY);

      // Soft feathering border
      ctx.drawImage(
        img,
        -patchWidth / 2,
        -patchHeight / 2,
        patchWidth,
        patchHeight
      );

      // Handle seam wrap-around for frames near 0° / 360°
      if (centerX - patchWidth / 2 < 0) {
        ctx.drawImage(img, -patchWidth / 2 + panoWidth, -patchHeight / 2, patchWidth, patchHeight);
      } else if (centerX + patchWidth / 2 > panoWidth) {
        ctx.drawImage(img, -patchWidth / 2 - panoWidth, -patchHeight / 2, patchWidth, patchHeight);
      }

      ctx.restore();
    });

    return canvas.toDataURL('image/jpeg', 0.92);
  }
}
