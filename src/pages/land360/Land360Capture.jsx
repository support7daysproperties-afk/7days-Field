/**
 * Land360Capture.jsx
 *
 * Guided spherical 360° photo capture screen matching the Google Street View /
 * Photo Sphere camera experience.
 *
 * Key Capabilities:
 * 1. Full-screen responsive camera preview without black side strips or layout distortion.
 * 2. Exact centered reticle anchored to the camera viewport center.
 * 3. Smooth directional target indicator reflecting real device orientation with wraparound.
 * 4. Dual capture: Automatic capture when target snaps & holds stable + visible manual shutter button.
 * 5. Full offline-first persistence to IndexedDB before updating session progress.
 * 6. Audio shutter sound & visual flash feedback on successful capture.
 * 7. Undo last shot, retake, pause/resume, and safe-area compatibility.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Check, RotateCcw, Pause, Play, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { cameraService } from '../../services/platform/CameraService';
import { orientationService } from '../../services/platform/OrientationService';
import { TargetEngine } from '../../lib/land360/TargetEngine';
import { DEFAULT_CAPTURE_CONFIG } from '../../lib/land360/CaptureConfig';
import { angularDistance, angleDifference } from '../../lib/land360/SphericalTargetGenerator';
import { FrameQualityChecker } from '../../lib/land360/FrameQualityChecker';
import { land360Service } from '../../services/Land360Service';
import { locationService } from '../../services/platform/LocationService';
import './Land360Capture.css';

// ── State Machine ─────────────────────────────────────────────────────────────
const S = {
  LOADING:    'LOADING',
  PERMISSION: 'PERMISSION',
  CALIBRATE:  'CALIBRATE',
  WAITING:    'WAITING',
  ALIGNED:    'ALIGNED',
  STABLE:     'STABLE',
  CAPTURING:  'CAPTURING',
  PAUSED:     'PAUSED',
  COMPLETED:  'COMPLETED',
  ERROR:      'ERROR',
};

// Synthetic shutter audio click
function playShutterSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  } catch (_e) {
    // Audio Context not permitted without user gesture, continue silently
  }
}

export default function Land360Capture({
  capturePointId,
  onComplete,
  onCancel,
  retakeTargetId = null,
}) {
  const videoRef = useRef(null);
  const engineRef = useRef(null);
  const capturingLockRef = useRef(false);
  const animationFrameRef = useRef(null);

  // Filtered orientation state for 60fps rendering
  const smoothedOrientationRef = useRef({ heading: 0, pitch: 0 });
  const rawOrientationRef = useRef({ heading: 0, pitch: 0, stability: 100 });

  const [status, setStatus] = useState(S.LOADING);
  const [errorMessage, setErrorMessage] = useState('');
  const [currentTarget, setCurrentTarget] = useState(null);
  const [progress, setProgress] = useState({ captured: 0, total: 0, percentage: 0 });
  const [capturedFrames, setCapturedFrames] = useState([]);
  const [gpsData, setGpsData] = useState(null);
  const [flash, setFlash] = useState(false);
  const [sessionId, setSessionId] = useState(null);

  // Screen coordinates for target dot
  const [targetOffset, setTargetOffset] = useState({ x: 0, y: 0, visible: false, angle: 0 });
  const [isSnapped, setIsSnapped] = useState(false);

  // ── Render / Physics Loop (60 FPS LERP smoothing) ───────────────────────────
  const updateVisualTarget = useCallback(() => {
    const engine = engineRef.current;
    const target = engine ? engine.getCurrentTarget() : null;

    if (!target || status === S.PAUSED || status === S.LOADING || status === S.COMPLETED) {
      animationFrameRef.current = requestAnimationFrame(updateVisualTarget);
      return;
    }

    const currentHeading = smoothedOrientationRef.current.heading;
    const currentPitch = smoothedOrientationRef.current.pitch;
    const relYaw = engine.deviceHeadingToRelativeYaw(currentHeading);

    // Shortest angular difference
    let yawDiff = angleDifference(target.relativeYaw, relYaw);
    const pitchDiff = target.pitch - currentPitch;

    // Projected pixels per degree in mobile viewport
    const pxPerDeg = 8;
    const maxPx = Math.min(window.innerWidth, window.innerHeight) * 0.42;

    const x = yawDiff * pxPerDeg;
    const y = -pitchDiff * pxPerDeg; // Inverted Y for screen space

    const dist = Math.sqrt(x * x + y * y);
    const angDist = angularDistance(relYaw, currentPitch, target.relativeYaw, target.pitch);

    const snapped = angDist <= (engine.config?.alignmentToleranceDeg || 10);
    setIsSnapped(snapped);

    // Direction angle for off-screen compass pointer
    const angleRad = Math.atan2(y, x);
    const angleDeg = (angleRad * 180) / Math.PI + 90;

    if (dist < maxPx) {
      setTargetOffset({ x, y, visible: true, angle: angleDeg });
    } else {
      // Clamp to boundary for arrow direction
      const clampedX = Math.cos(angleRad) * maxPx;
      const clampedY = Math.sin(angleRad) * maxPx;
      setTargetOffset({ x: clampedX, y: clampedY, visible: false, angle: angleDeg });
    }

    animationFrameRef.current = requestAnimationFrame(updateVisualTarget);
  }, [status]);

  // ── Handle Frame Capture & Persistence ──────────────────────────────────────
  const executeCapture = useCallback(async (forcedTarget = null) => {
    const engine = engineRef.current;
    if (!engine || capturingLockRef.current) return;

    const target = forcedTarget || engine.getCurrentTarget();
    if (!target) return;

    capturingLockRef.current = true;
    setStatus(S.CAPTURING);

    try {
      // 1. Capture real visual frame from camera stream
      const photoUri = await cameraService.captureFrame();

      // Audio & Flash Feedback
      playShutterSound();
      setFlash(true);
      setTimeout(() => setFlash(false), 220);

      const reading = rawOrientationRef.current;
      const relYaw = engine.deviceHeadingToRelativeYaw(reading.heading);

      // 2. Build frame record
      const frameRecord = {
        id: `frm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        sessionId: engine.sessionId,
        capture_point_id: capturePointId,
        targetId: target.id,
        sequenceNumber: target.sequenceNumber,
        localUri: photoUri,
        capturedYaw: relYaw,
        capturedPitch: reading.pitch,
        targetYaw: target.relativeYaw,
        targetPitch: target.pitch,
        gps: gpsData,
        capturedAt: Date.now(),
        isActive: true,
        status: 'captured',
      };

      // 3. Quality evaluation
      try {
        const quality = await FrameQualityChecker.check(frameRecord, engine.config);
        frameRecord.qualityStatus = quality.qualityStatus;
        frameRecord.qualityWarnings = quality.qualityWarnings;
      } catch (_e) {
        frameRecord.qualityStatus = 'not-evaluated';
      }

      // 4. Save frame to IndexedDB
      await land360Service.saveFrame(frameRecord);

      // 5. Update target status in engine and IndexedDB
      engine.markCaptured(target.id, frameRecord.id);
      await land360Service.saveTarget(target);

      // 6. Save updated session snapshot
      await land360Service.saveSession(engine.getSessionSnapshot());

      // 7. Update React state
      const updatedFrames = [...capturedFrames, frameRecord];
      setCapturedFrames(updatedFrames);

      const prog = engine.getProgress();
      setProgress(prog);

      // Check if spherical sequence completed
      if (prog.captured >= prog.total && prog.total > 0) {
        setStatus(S.COMPLETED);
        await land360Service.updateCapturePointStatus(capturePointId, 'Completed');
        setTimeout(() => {
          if (onComplete) onComplete();
        }, 1200);
        return;
      }

      // Advance to next target
      const nextTarget = engine.advanceToNextTarget(relYaw, reading.pitch);
      setCurrentTarget(nextTarget);
      setStatus(S.WAITING);
    } catch (err) {
      console.error('Capture execution error:', err);
      setStatus(S.WAITING);
    } finally {
      capturingLockRef.current = false;
    }
  }, [capturePointId, capturedFrames, gpsData, onComplete]);

  // ── Orientation Listener ───────────────────────────────────────────────────
  const handleOrientationUpdate = useCallback((reading) => {
    rawOrientationRef.current = reading;

    // Exponential Moving Average filter (alpha = 0.25)
    const smooth = smoothedOrientationRef.current;
    let headingDiff = angleDifference(reading.heading, smooth.heading);
    smooth.heading = (smooth.heading + headingDiff * 0.25 + 360) % 360;
    smooth.pitch = smooth.pitch + (reading.beta - smooth.pitch) * 0.25;

    const engine = engineRef.current;
    if (!engine || capturingLockRef.current || status === S.PAUSED || status === S.LOADING) {
      return;
    }

    // Alignment & Stability Gate
    const alignState = engine.checkAlignment(smooth.heading, smooth.pitch, reading.stability);

    if (alignState === 'stable') {
      setStatus(S.STABLE);
      executeCapture();
    } else if (alignState === 'aligned') {
      setStatus(S.ALIGNED);
    } else if (status !== S.CAPTURING && status !== S.COMPLETED) {
      setStatus(S.WAITING);
    }
  }, [status, executeCapture]);

  // ── Session Initialization ─────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    const engine = new TargetEngine(DEFAULT_CAPTURE_CONFIG);
    engineRef.current = engine;

    async function setupCameraAndSession() {
      try {
        // 1. Initialize rear-facing camera stream
        if (videoRef.current) {
          await cameraService.initialize(videoRef.current);
        }

        // 2. Request orientation permission (iOS 13+ support)
        const hasOrientation = await orientationService.requestPermission();
        if (!hasOrientation && mounted) {
          setStatus(S.PERMISSION);
          return;
        }

        // 3. Start orientation sensor
        orientationService.addListener(handleOrientationUpdate);
        orientationService.startListening();

        // 4. Retrieve GPS location
        try {
          const loc = await locationService.getCurrentPosition();
          if (mounted && loc) setGpsData(loc);
        } catch (_e) {
          // GPS optional for offline captures
        }

        // 5. Restore previous session or create fresh one
        const latestSession = await land360Service.getLatestSessionForCapturePoint(capturePointId);
        if (latestSession && latestSession.status !== 'completed') {
          const savedTargets = await land360Service.getTargetsForSession(latestSession.id);
          const savedFrames = await land360Service.getActiveFramesForSession(latestSession.id);

          engine.resumeSession(latestSession, savedTargets);
          if (mounted) {
            setSessionId(latestSession.id);
            setCapturedFrames(savedFrames || []);
          }
        } else {
          // Fresh Session: calibrated to current device heading
          const initialHeading = rawOrientationRef.current.heading || 0;
          const { sessionId: newSessionId, targets } = engine.startSession(capturePointId, initialHeading);

          await land360Service.saveSession(engine.getSessionSnapshot());
          await land360Service.saveTargets(targets);
          if (mounted) {
            setSessionId(newSessionId);
            setCapturedFrames([]);
          }
        }

        // If specific target requested for retake
        if (retakeTargetId) {
          engine.setTargetForRetake(retakeTargetId);
        }

        if (mounted) {
          setCurrentTarget(engine.getCurrentTarget());
          setProgress(engine.getProgress());
          setStatus(S.WAITING);
        }
      } catch (err) {
        console.error('Land360 camera setup failed:', err);
        if (mounted) {
          setErrorMessage(err.message || 'Camera or sensor initialization failed.');
          setStatus(S.ERROR);
        }
      }
    }

    setupCameraAndSession();
    animationFrameRef.current = requestAnimationFrame(updateVisualTarget);

    return () => {
      mounted = false;
      cameraService.stop();
      orientationService.removeListener(handleOrientationUpdate);
      orientationService.stopListening();
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [capturePointId, retakeTargetId, handleOrientationUpdate, updateVisualTarget]);

  // ── Undo Last Frame ────────────────────────────────────────────────────────
  const handleUndo = useCallback(async () => {
    if (capturedFrames.length === 0 || capturingLockRef.current) return;
    const lastFrame = capturedFrames[capturedFrames.length - 1];

    try {
      await land360Service.markFrameReplaced(lastFrame.id);
      const engine = engineRef.current;
      if (engine) {
        engine.setTargetForRetake(lastFrame.targetId);
        await land360Service.saveTarget(engine.getCurrentTarget());
        await land360Service.saveSession(engine.getSessionSnapshot());

        setCurrentTarget(engine.getCurrentTarget());
        setProgress(engine.getProgress());
      }
      setCapturedFrames((prev) => prev.slice(0, -1));
    } catch (err) {
      console.error('Error undoing capture:', err);
    }
  }, [capturedFrames]);

  // ── Pause / Resume ─────────────────────────────────────────────────────────
  const togglePause = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;

    if (status === S.PAUSED) {
      engine.resumeSession(engine.getSessionSnapshot(), engine.getTargets());
      setStatus(S.WAITING);
    } else {
      engine.pauseSession();
      setStatus(S.PAUSED);
    }
  }, [status]);

  // ── Guidance Status Text ───────────────────────────────────────────────────
  const getInstructionText = () => {
    if (status === S.LOADING) return 'Initializing 360° Camera…';
    if (status === S.CALIBRATE) return 'Calibrating compass heading…';
    if (status === S.PAUSED) return 'Capture paused';
    if (status === S.CAPTURING) return 'Recording frame…';
    if (status === S.STABLE) return 'Hold steady…';
    if (status === S.ALIGNED || isSnapped) return 'Target locked. Keep still.';
    return 'Rotate phone to align circle with target';
  };

  return (
    <div className="land360-screen" id="land360-capture-root">
      {/* Visual Flash Feedback */}
      {flash && <div className="land360-flash" />}

      {/* ── Top Bar Controls ── */}
      <div className="land360-topbar">
        <button
          className="land360-icon-btn"
          onClick={onCancel}
          aria-label="Exit capture"
          id="land360-exit-btn"
        >
          <X size={22} />
        </button>

        <div className="land360-header-info">
          <div className="land360-header-title">Land 360° Capture</div>
          <div className="land360-header-subtitle">
            {gpsData ? `GPS ±${Math.round(gpsData.accuracy)}m` : 'Offline Ready'}
            {currentTarget && (
              <span>• {currentTarget.ringLabel} ({Math.round(currentTarget.pitch)}°)</span>
            )}
          </div>
        </div>

        <button
          className="land360-icon-btn"
          onClick={togglePause}
          aria-label="Pause capture"
          id="land360-pause-btn"
        >
          {status === S.PAUSED ? <Play size={22} /> : <Pause size={22} />}
        </button>
      </div>

      {/* ── Guidance Status Pill ── */}
      <div className="land360-instruction">
        <div className="land360-instruction-pill">
          {status === S.CAPTURING && <Loader2 size={14} className="animate-spin" />}
          <span>{getInstructionText()}</span>
        </div>
      </div>

      {/* ── Real Fullscreen Live Camera Viewport (No side black strips) ── */}
      <div className="land360-viewport">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="land360-video"
          id="land360-video-stream"
        />

        {/* ── Fixed Aiming Reticle at Viewport Center ── */}
        <div className="land360-reticle-container">
          <div
            className={`land360-reticle-ring ${
              status === S.STABLE ? 'is-stable' : isSnapped ? 'is-aligned' : ''
            }`}
          >
            <div className="land360-reticle-crosshair-h" />
            <div className="land360-reticle-crosshair-v" />
            <div className="land360-reticle-center-dot" />
          </div>
        </div>

        {/* ── Directional Target Indicator (Google Street View blue/green dot) ── */}
        {currentTarget && status !== S.PAUSED && status !== S.LOADING && (
          <>
            {targetOffset.visible ? (
              <div
                className={`land360-target-dot ${isSnapped ? 'is-snapped' : ''}`}
                style={{
                  transform: `translate(${targetOffset.x}px, ${targetOffset.y}px)`,
                }}
              >
                <div className="land360-target-inner" />
              </div>
            ) : (
              <div
                className="land360-offscreen-arrow"
                style={{
                  transform: `rotate(${targetOffset.angle}deg)`,
                }}
              >
                <div className="land360-arrow-icon" />
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Bottom Action & Progress Bar ── */}
      <div className="land360-bottom-controls">
        <div className="land360-progress-bar-container">
          <div className="land360-progress-info">
            <span>
              {progress.captured} of {progress.total} points captured
            </span>
            <span>{progress.percentage}%</span>
          </div>
          <div className="land360-progress-track">
            <div
              className="land360-progress-fill"
              style={{ width: `${progress.percentage}%` }}
            />
          </div>
        </div>

        <div className="land360-actions-row">
          {/* Undo Button */}
          <button
            className="land360-sub-btn"
            onClick={handleUndo}
            disabled={capturedFrames.length === 0 || status === S.CAPTURING}
            aria-label="Undo last capture"
            id="land360-undo-btn"
          >
            <RotateCcw size={22} />
          </button>

          {/* Visible Center Shutter Button (Manual capture & feedback) */}
          <button
            className="land360-shutter-btn"
            onClick={() => executeCapture()}
            disabled={status === S.CAPTURING || status === S.PAUSED}
            aria-label="Capture frame"
            id="land360-shutter-btn"
          >
            <div
              className={`land360-shutter-inner ${
                status === S.CAPTURING ? 'is-capturing' : ''
              }`}
            />
          </button>

          {/* Complete / Confirm Button */}
          <button
            className="land360-sub-btn"
            onClick={onComplete}
            disabled={progress.captured === 0}
            aria-label="Finish and review"
            id="land360-finish-btn"
          >
            <Check size={22} />
          </button>
        </div>
      </div>

      {/* ── Overlays: Paused / Error / Permission ── */}
      {status === S.PAUSED && (
        <div className="land360-overlay">
          <div className="land360-modal-card">
            <Pause size={48} className="text-secondary" />
            <h3 style={{ fontSize: 18, fontWeight: 600 }}>Capture Paused</h3>
            <p className="text-sm text-secondary">
              Take a break. Your {progress.captured} captured frames are saved safely in offline storage.
            </p>
            <button className="land360-btn-primary" onClick={togglePause}>
              <Play size={18} /> Resume Capture
            </button>
          </div>
        </div>
      )}

      {status === S.ERROR && (
        <div className="land360-overlay">
          <div className="land360-modal-card">
            <AlertCircle size={48} style={{ color: 'var(--danger-color, #ef4444)' }} />
            <h3 style={{ fontSize: 18, fontWeight: 600 }}>Camera Setup Error</h3>
            <p className="text-sm text-secondary">{errorMessage}</p>
            <button className="land360-btn-primary" onClick={onCancel}>
              Go Back
            </button>
          </div>
        </div>
      )}

      {status === S.PERMISSION && (
        <div className="land360-overlay">
          <div className="land360-modal-card">
            <Sparkles size={48} style={{ color: 'var(--primary-color)' }} />
            <h3 style={{ fontSize: 18, fontWeight: 600 }}>Sensor Access Needed</h3>
            <p className="text-sm text-secondary">
              Guided 360° photo spheres require device orientation sensors to align each capture target.
            </p>
            <button
              className="land360-btn-primary"
              onClick={async () => {
                const granted = await orientationService.requestPermission();
                if (granted) {
                  setStatus(S.WAITING);
                  orientationService.startListening();
                }
              }}
            >
              Grant Sensor Permission
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
