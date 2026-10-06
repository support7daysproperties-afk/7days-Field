export class OrientationService {
  constructor() {
    this.listeners = [];
    this.isListening = false;
    this.latestReading = { alpha: 0, beta: 0, gamma: 0, heading: 0, stability: 0 };
    this.history = []; // For smoothing and stability checking
    this.HISTORY_SIZE = 10;
    
    this.handleOrientation = this.handleOrientation.bind(this);
  }

  async requestPermission() {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const permissionState = await DeviceOrientationEvent.requestPermission();
        return permissionState === 'granted';
      } catch (error) {
        console.error('Error requesting orientation permission', error);
        return false;
      }
    }
    return true; // Non-iOS or older devices that don't need explicit permission
  }

  startListening() {
    if (this.isListening) return;
    window.addEventListener('deviceorientation', this.handleOrientation);
    this.isListening = true;
  }

  stopListening() {
    if (!this.isListening) return;
    window.removeEventListener('deviceorientation', this.handleOrientation);
    this.isListening = false;
  }

  handleOrientation(event) {
    const { alpha, beta, gamma, webkitCompassHeading } = event;
    
    // alpha is rotation around z (0-360)
    // beta is front-to-back tilt (-180 to 180)
    // gamma is left-to-right tilt (-90 to 90)
    // webkitCompassHeading is iOS specific heading
    
    let heading = webkitCompassHeading !== undefined ? webkitCompassHeading : (360 - alpha);
    
    // Basic smoothing
    this.history.push({ alpha, beta, gamma, heading, time: Date.now() });
    if (this.history.length > this.HISTORY_SIZE) {
      this.history.shift();
    }

    // Calculate stability (variance in recent readings)
    const stability = this.calculateStability();

    this.latestReading = {
      alpha: this.smoothValue('alpha'),
      beta: this.smoothValue('beta'),
      gamma: this.smoothValue('gamma'),
      heading: this.smoothValue('heading'),
      stability
    };

    this.notifyListeners();
  }

  smoothValue(key) {
    if (this.history.length === 0) return 0;
    const sum = this.history.reduce((acc, curr) => acc + (curr[key] || 0), 0);
    return sum / this.history.length;
  }

  calculateStability() {
    if (this.history.length < 2) return 100; // Not stable if no history
    
    // Very simple stability metric based on delta of recent angles
    let maxDelta = 0;
    const latest = this.history[this.history.length - 1];
    
    for (let i = 0; i < this.history.length - 1; i++) {
        const reading = this.history[i];
        const delta = Math.abs(reading.alpha - latest.alpha) + Math.abs(reading.beta - latest.beta);
        if (delta > maxDelta) maxDelta = delta;
    }
    
    // Return a stability score (0 is perfectly stable)
    return maxDelta;
  }

  addListener(callback) {
    this.listeners.push(callback);
  }

  removeListener(callback) {
    this.listeners = this.listeners.filter(l => l !== callback);
  }

  notifyListeners() {
    this.listeners.forEach(callback => callback(this.latestReading));
  }
}

export const orientationService = new OrientationService();
