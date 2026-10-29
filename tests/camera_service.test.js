import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  acquireCameraStream,
  attachStreamToVideo,
  stopMediaStream,
  getAvailableCameras,
  waitDelay
} from '../src/services/platform/CameraService';

describe('CameraService — Robust Camera Acquisition & Hardware Control', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('stopMediaStream stops all tracks safely without throwing', () => {
    const track1 = { stop: vi.fn() };
    const track2 = { stop: vi.fn() };
    const mockStream = {
      getTracks: () => [track1, track2]
    };

    stopMediaStream(mockStream);
    expect(track1.stop).toHaveBeenCalledTimes(1);
    expect(track2.stop).toHaveBeenCalledTimes(1);
  });

  it('stopMediaStream gracefully handles null, undefined, or broken streams', () => {
    expect(() => stopMediaStream(null)).not.toThrow();
    expect(() => stopMediaStream({})).not.toThrow();
    expect(() => stopMediaStream({ getTracks: () => [{ stop: () => { throw new Error('HAL locked'); } }] })).not.toThrow();
  });

  it('getAvailableCameras categorizes rear vs front cameras and prioritizes primary lenses', async () => {
    const mockDevices = [
      { kind: 'videoinput', deviceId: 'cam_front', label: 'Front Camera (facing front)' },
      { kind: 'videoinput', deviceId: 'cam_depth', label: 'Back Depth Sensor' },
      { kind: 'videoinput', deviceId: 'cam_back_main', label: 'camera2 0, facing back' },
      { kind: 'audioinput', deviceId: 'mic_1', label: 'Microphone' }
    ];

    navigator.mediaDevices = {
      enumerateDevices: vi.fn().mockResolvedValue(mockDevices)
    };

    const { backCameras, frontCameras, allCameras } = await getAvailableCameras();
    expect(allCameras.length).toBe(3);
    expect(frontCameras.length).toBe(1);
    expect(frontCameras[0].deviceId).toBe('cam_front');
    expect(backCameras.length).toBe(2);
    // Main rear camera should be prioritized over depth sensor
    expect(backCameras[0].deviceId).toBe('cam_back_main');
  });

  it('acquireCameraStream requests rear camera without prematurely falling back to front camera', async () => {
    const rearStream = { id: 'stream_rear', getTracks: () => [] };
    const calls = [];

    navigator.mediaDevices = {
      enumerateDevices: vi.fn().mockResolvedValue([
        { kind: 'videoinput', deviceId: 'rear_main', label: 'Back Camera 0' },
        { kind: 'videoinput', deviceId: 'front_main', label: 'Front Camera 1' }
      ]),
      getUserMedia: vi.fn().mockImplementation((constraints) => {
        calls.push(constraints);
        // Fail 1080p exact rear request to simulate budget phone
        if (constraints.video?.width?.ideal === 1920) {
          return Promise.reject(new Error('OverconstrainedError'));
        }
        // Succeed on 720p rear request
        if (constraints.video?.width?.ideal === 1280 && constraints.video?.deviceId?.exact === 'rear_main') {
          return Promise.resolve(rearStream);
        }
        return Promise.reject(new Error('Unknown constraint'));
      })
    };

    const resultStream = await acquireCameraStream({ facingMode: 'environment', audio: false });
    expect(resultStream).toBe(rearStream);

    // Verify none of the calls targeted the front camera
    for (const call of calls) {
      if (call.video?.facingMode) {
        const mode = typeof call.video.facingMode === 'string' ? call.video.facingMode : call.video.facingMode.ideal || call.video.facingMode.exact;
        expect(mode).toBe('environment');
      }
      if (call.video?.deviceId?.exact) {
        expect(call.video.deviceId.exact).toBe('rear_main');
      }
    }
  });

  it('acquireCameraStream seamlessly drops audio if microphone fails, preserving rear camera', async () => {
    const rearVideoOnlyStream = { id: 'stream_video_only', getTracks: () => [] };
    let triedWithAudio = false;

    navigator.mediaDevices = {
      enumerateDevices: vi.fn().mockResolvedValue([]),
      getUserMedia: vi.fn().mockImplementation((constraints) => {
        if (constraints.audio === true) {
          triedWithAudio = true;
          return Promise.reject(new Error('NotAllowedError: Microphone access denied'));
        }
        return Promise.resolve(rearVideoOnlyStream);
      })
    };

    const result = await acquireCameraStream({ facingMode: 'environment', audio: true });
    expect(triedWithAudio).toBe(true);
    expect(result).toBe(rearVideoOnlyStream);
  });

  it('attachStreamToVideo configures autoplay safety attributes and calls play()', async () => {
    const playMock = vi.fn().mockResolvedValue(undefined);
    const setAttributeMock = vi.fn();

    const videoEl = {
      srcObject: null,
      muted: false,
      playsInline: false,
      setAttribute: setAttributeMock,
      play: playMock,
      paused: false
    };

    const mockStream = { id: 'stream_test' };
    await attachStreamToVideo(videoEl, mockStream);

    expect(videoEl.srcObject).toBe(mockStream);
    expect(videoEl.muted).toBe(true);
    expect(videoEl.playsInline).toBe(true);
    expect(setAttributeMock).toHaveBeenCalledWith('playsinline', 'true');
    expect(setAttributeMock).toHaveBeenCalledWith('muted', 'true');
    expect(playMock).toHaveBeenCalled();
  });

  it('waitDelay yields asynchronously for the specified time', async () => {
    const start = Date.now();
    await waitDelay(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });
});
