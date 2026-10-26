import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Camera Orientation & Dual-Mode Capture (Horizontal & Vertical)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('determines landscape orientation correctly based on window dimensions', () => {
    const isLandscape = (width, height, angle = 0) => {
      return width > height || angle === 90 || angle === 270;
    };

    // Standard mobile portrait
    expect(isLandscape(390, 844, 0)).toBe(false);
    // Standard mobile landscape
    expect(isLandscape(844, 390, 0)).toBe(true);
    // Screen rotated 90 degrees
    expect(isLandscape(390, 844, 90)).toBe(true);
    // Screen rotated 270 degrees
    expect(isLandscape(390, 844, 270)).toBe(true);
  });

  it('correctly maps manual orientation override over automatic orientation', () => {
    const resolveOrientation = (manualOverride, isWindowLandscape, deviceTilt) => {
      if (manualOverride !== null) {
        return manualOverride === 'landscape';
      }
      return isWindowLandscape || deviceTilt === 'landscape';
    };

    // Auto portrait
    expect(resolveOrientation(null, false, 'portrait')).toBe(false);
    // Auto landscape (window rotated)
    expect(resolveOrientation(null, true, 'portrait')).toBe(true);
    // Auto landscape (device physically tilted sideways while auto-rotate locked)
    expect(resolveOrientation(null, false, 'landscape')).toBe(true);
    // Manual force landscape while device is upright
    expect(resolveOrientation('landscape', false, 'portrait')).toBe(true);
    // Manual force portrait while device is tilted
    expect(resolveOrientation('portrait', false, 'landscape')).toBe(false);
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
