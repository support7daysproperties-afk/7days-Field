// TargetEngine.js
// Handles generation of 360 sphere targets and alignment math

export class TargetEngine {
  constructor() {
    this.targets = [];
    this.currentTargetIndex = 0;
  }

  /**
   * Generates a grid of targets for full spherical coverage.
   * Based on roughly 45 degree field of view overlapping.
   */
  generateTargets() {
    const targets = [];
    let id = 1;

    // Horizon ring (0 degrees pitch)
    for (let heading = 0; heading < 360; heading += 45) {
      targets.push({ id: id++, heading, pitch: 0, status: 'pending' });
    }

    // Upper ring (+45 degrees pitch)
    for (let heading = 0; heading < 360; heading += 60) {
      targets.push({ id: id++, heading, pitch: 45, status: 'pending' });
    }

    // Lower ring (-45 degrees pitch)
    for (let heading = 0; heading < 360; heading += 60) {
      targets.push({ id: id++, heading, pitch: -45, status: 'pending' });
    }

    // Zenith (straight up, 90 pitch)
    targets.push({ id: id++, heading: 0, pitch: 90, status: 'pending' });
    
    // Nadir (straight down, -90 pitch)
    // targets.push({ id: id++, heading: 0, pitch: -90, status: 'pending' }); 
    // Typically omit true nadir if taking handheld, or keep it. Let's include one down target.
    targets.push({ id: id++, heading: 0, pitch: -80, status: 'pending' });

    this.targets = targets;
    this.currentTargetIndex = 0;
    return this.targets;
  }

  /**
   * Evaluates if current device orientation is aligned with the target
   * @param {number} currentHeading (0 to 360)
   * @param {number} currentPitch (-180 to 180)
   * @param {object} target { heading, pitch }
   * @returns {boolean}
   */
  isAligned(currentHeading, currentPitch, target, tolerance = 5) {
    if (!target) return false;

    // Heading wraps around at 360
    let headingDiff = Math.abs(currentHeading - target.heading);
    if (headingDiff > 180) {
      headingDiff = 360 - headingDiff;
    }

    const pitchDiff = Math.abs(currentPitch - target.pitch);

    return headingDiff <= tolerance && pitchDiff <= tolerance;
  }

  getCurrentTarget() {
    if (this.currentTargetIndex >= this.targets.length) return null;
    return this.targets[this.currentTargetIndex];
  }

  markTargetCaptured(id) {
    const target = this.targets.find(t => t.id === id);
    if (target) {
      target.status = 'captured';
    }
    // Move to next pending target
    this.currentTargetIndex = this.targets.findIndex(t => t.status === 'pending');
  }
  
  getProgress() {
    const captured = this.targets.filter(t => t.status === 'captured').length;
    const total = this.targets.length;
    return {
        captured,
        total,
        percentage: total === 0 ? 0 : (captured / total) * 100
    };
  }
}

export const targetEngine = new TargetEngine();
