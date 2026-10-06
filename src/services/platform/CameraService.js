export class CameraService {
  constructor() {
    this.stream = null;
    this.videoElement = null;
    this.canvasElement = document.createElement('canvas');
  }

  async initialize(videoElement) {
    this.videoElement = videoElement;
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Camera API is not supported in this browser.");
    }

    try {
      // Prefer rear camera
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false
      });
      
      this.videoElement.srcObject = this.stream;
      
      // Return a promise that resolves when video is actually playing
      return new Promise((resolve) => {
        this.videoElement.onloadedmetadata = () => {
          this.videoElement.play();
          resolve();
        };
      });
    } catch (err) {
      console.error("Error accessing camera:", err);
      throw err;
    }
  }

  async captureFrame() {
    if (!this.videoElement || !this.stream) {
      throw new Error("Camera not initialized");
    }

    const context = this.canvasElement.getContext('2d');
    
    // Set canvas dimensions to match video
    this.canvasElement.width = this.videoElement.videoWidth;
    this.canvasElement.height = this.videoElement.videoHeight;
    
    // Draw current frame to canvas
    context.drawImage(this.videoElement, 0, 0, this.canvasElement.width, this.canvasElement.height);
    
    // Return base64 string or blob. Returning base64 for simplicity in local storage initially
    return new Promise((resolve) => {
      resolve(this.canvasElement.toDataURL('image/jpeg', 0.9));
    });
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement = null;
    }
  }
}

export const cameraService = new CameraService();
