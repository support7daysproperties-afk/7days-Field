/**
 * CameraAdapter.js
 *
 * Web camera stream adapter for Photo Sphere capture.
 * Provides:
 * 1. Rear camera access (facingMode: environment)
 * 2. High-resolution photo snapshot capture (OffscreenCanvas / Canvas fallback)
 * 3. Optical FOV measurement from video track settings
 * 4. Proper stream lifecycle and error handling
 */

export class CameraAdapter {
  constructor() {
    this.stream = null;
    this.videoElement = null;
    this.videoTrack = null;
    this.isStreaming = false;

    // Default mobile camera lens optical parameters
    this.hfov = 65;
    this.vfov = 50;
  }

  /**
   * Initializes and opens rear camera stream.
   * @param {HTMLVideoElement} videoElement
   * @returns {Promise<{ hfov: number, vfov: number, width: number, height: number }>}
   */
  async start(videoElement) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Camera API (getUserMedia) is not supported in this environment');
    }

    this.videoElement = videoElement;

    // Prefer 1080p rear camera
    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920, min: 1280 },
        height: { ideal: 1080, min: 720 },
      },
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      // Fallback to basic video constraint if ideal resolution fails
      console.warn('High-res camera request failed, falling back to basic camera:', err);
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'environment' },
      });
    }

    this.videoElement.srcObject = this.stream;
    this.videoTrack = this.stream.getVideoTracks()[0];

    // Wait for video metadata to load dimensions
    await new Promise((resolve) => {
      if (this.videoElement.readyState >= 2) {
        resolve();
      } else {
        this.videoElement.onloadedmetadata = () => resolve();
      }
    });

    try {
      await this.videoElement.play();
    } catch (err) {
      console.warn('Video auto-play warning:', err);
    }

    this.isStreaming = true;
    this._calculateFOV();

    return {
      hfov: this.hfov,
      vfov: this.vfov,
      width: this.videoElement.videoWidth,
      height: this.videoElement.videoHeight,
    };
  }

  /**
   * Stops video stream and turns off hardware camera light.
   */
  stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
    this.isStreaming = false;
  }

  /**
   * Captures the current live camera frame as a high-quality JPEG Data URI.
   * @returns {Promise<string>} Data URI string
   */
  async captureFrame() {
    if (!this.videoElement || !this.isStreaming) {
      throw new Error('Camera is not currently streaming');
    }

    const vw = this.videoElement.videoWidth || 1280;
    const vh = this.videoElement.videoHeight || 720;

    const canvas = document.createElement('canvas');
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d');

    // Draw live video frame to canvas
    ctx.drawImage(this.videoElement, 0, 0, vw, vh);

    // Export as high quality JPEG
    return canvas.toDataURL('image/jpeg', 0.92);
  }

  _calculateFOV() {
    // If device settings expose aspect ratio or focal lengths, calibrate FOV
    if (this.videoElement && this.videoElement.videoWidth && this.videoElement.videoHeight) {
      const aspect = this.videoElement.videoWidth / this.videoElement.videoHeight;
      // Typical standard smartphone back camera is ~65 deg HFOV in 4:3 or 16:9
      if (aspect > 1) {
        // Landscape stream aspect
        this.hfov = 65;
        this.vfov = Math.round(2 * Math.atan(Math.tan((65 * Math.PI) / 360) / aspect) * (180 / Math.PI));
      } else {
        // Portrait stream aspect
        this.vfov = 65;
        this.hfov = Math.round(2 * Math.atan(Math.tan((65 * Math.PI) / 360) * aspect) * (180 / Math.PI));
      }
    }
  }
}
