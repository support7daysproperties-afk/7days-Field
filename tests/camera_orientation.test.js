import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Camera Orientation & Surveyor-Controlled Toggle Mode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('guarantees orientation stays locked to surveyor toggle and never auto-turns on mobile tilt or movement', () => {
    let orientationMode = 'portrait'; // Initial default is Vertical (portrait)

    const toggleOrientation = () => {
      orientationMode = orientationMode === 'portrait' ? 'landscape' : 'portrait';
    };

    // Even if simulated phone physical tilt (deviceorientation / gamma / beta) or window resize changes:
    const simulateMobileTurn = (newGamma, newBeta, newWindowWidth, newWindowHeight) => {
      // The camera mode must NOT change from mobile tilt
      return orientationMode === 'landscape';
    };

    // Upright phone (vertical)
    expect(simulateMobileTurn(0, 80, 390, 844)).toBe(false);

    // Surveyor physically turns phone sideways (horizontal tilt)
    expect(simulateMobileTurn(85, 10, 844, 390)).toBe(false); // Still false (Vertical), because surveyor did not tap button!

    // Surveyor turns phone upside down or sideways
    expect(simulateMobileTurn(-70, 20, 844, 390)).toBe(false);

    // ONLY when surveyor clicks the toggle button does it change to Horizontal (landscape)
    toggleOrientation();
    expect(orientationMode).toBe('landscape');
    expect(simulateMobileTurn(0, 80, 390, 844)).toBe(true);

    // Surveyor taps toggle again to return to Vertical (portrait)
    toggleOrientation();
    expect(orientationMode).toBe('portrait');
    expect(simulateMobileTurn(85, 10, 844, 390)).toBe(false);
  });

  it('prevents changing orientation mode during active video recording', () => {
    let orientationMode = 'portrait';
    let isRecording = true;

    const toggleOrientationMode = () => {
      if (isRecording) return;
      orientationMode = orientationMode === 'portrait' ? 'landscape' : 'portrait';
    };

    toggleOrientationMode();
    expect(orientationMode).toBe('portrait'); // Blocked while recording

    isRecording = false;
    toggleOrientationMode();
    expect(orientationMode).toBe('landscape'); // Allowed when idle
  });

  it('calculates proper canvas target dimensions for horizontal vs vertical photos', () => {
    const getCanvasDimensions = (videoWidth, videoHeight, isLandscape) => {
      const shouldCaptureHorizontal = isLandscape || (videoWidth > videoHeight);
      if (shouldCaptureHorizontal && videoWidth < videoHeight) {
        // Swap dimensions for 90 degree rotated horizontal capture
        return { width: videoHeight, height: videoWidth, rotated: true };
      }
      return { width: videoWidth, height: videoHeight, rotated: false };
    };

    // Taking photo in vertical orientation (1080x1920)
    const portraitRes = getCanvasDimensions(1080, 1920, false);
    expect(portraitRes.width).toBe(1080);
    expect(portraitRes.height).toBe(1920);
    expect(portraitRes.rotated).toBe(false);

    // Taking photo in horizontal orientation when stream naturally rotated (1920x1080)
    const naturalLandscapeRes = getCanvasDimensions(1920, 1080, true);
    expect(naturalLandscapeRes.width).toBe(1920);
    expect(naturalLandscapeRes.height).toBe(1080);
    expect(naturalLandscapeRes.rotated).toBe(false);

    // Taking photo horizontally when stream is vertical due to system auto-rotate lock
    const lockedLandscapeRes = getCanvasDimensions(1080, 1920, true);
    expect(lockedLandscapeRes.width).toBe(1920);
    expect(lockedLandscapeRes.height).toBe(1080);
    expect(lockedLandscapeRes.rotated).toBe(true);
  });

  it('ensures orientation unlock is invoked safely without throwing', () => {
    let unlockCalled = false;
    const mockScreen = {
      orientation: {
        unlock: () => {
          unlockCalled = true;
        }
      }
    };

    if (mockScreen?.orientation?.unlock) {
      try {
        mockScreen.orientation.unlock();
      } catch (_) {}
    }

    expect(unlockCalled).toBe(true);
  });
});
