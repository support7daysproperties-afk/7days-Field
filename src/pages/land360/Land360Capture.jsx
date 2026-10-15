/**
 * Land360Capture.jsx  –  Phase 2
 *
 * Guided spherical 360° capture screen.
 *
 * Architecture
 * ────────────
 * 1.  On mount: attempt session recovery from IndexedDB.
 *     If a prior session exists it is resumed; otherwise a new session starts.
 * 2.  The TargetEngine manages all target / alignment logic.
 * 3.  Orientation events drive checkAlignment(); a STABLE result triggers
 *     auto-capture (one frame per target, duplicate-capture protected).
 * 4.  Manual-fallback mode is activated when orientation is unavailable.
 * 5.  Completed frames are quality-checked async (FrameQualityChecker).
 * 6.  Session + target state is persisted to IndexedDB after each capture.
 * 7.  Retake: the caller passes the target ID via `retakeTargetId` prop.
 *
 * Props
 * ─────
 *   capturePointId  – string  required
 *   onComplete      – fn()   called when all targets are captured
 *   onCancel        – fn()   called on user cancel / back
 *   retakeTargetId  – string | null   if set, navigate straight to retake
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Check, Loader2, Pause, Play } from 'lucide-react';
import { cameraService } from '../../services/platform/CameraService';
import { orientationService } from '../../services/platform/OrientationService';
import { TargetEngine } from '../../lib/land360/TargetEngine';
import { DEFAULT_CAPTURE_CONFIG } from '../../lib/land360/CaptureConfig';
import { FrameQualityChecker } from '../../lib/land360/FrameQualityChecker';
import { land360Service } from '../../services/Land360Service';
import { locationService } from '../../services/platform/LocationService';

// ─── Status machine states ────────────────────────────────────────────────────
const S = {
  LOADING:    'LOADING',
  CALIBRATE:  'CALIBRATE',   // waiting for first valid heading to set reference
  WAITING:    'WAITING',
  ALIGNED:    'ALIGNED',
  STABLE:     'STABLE',
  CAPTURING:  'CAPTURING',
  REVIEWING:  'REVIEWING',
  PAUSED:     'PAUSED',
  COMPLETED:  'COMPLETED',
  MANUAL:     'MANUAL',
  ERROR:      'ERROR',
};

const STATUS_LABEL = {
  [S.LOADING]:   'Preparing…',
  [S.CALIBRATE]: 'Calibrating orientation…',
  [S.WAITING]:   'Rotate to target',
  [S.ALIGNED]:   'Hold still',
  [S.STABLE]:    'Capturing…',
  [S.CAPTURING]: 'Saving…',
  [S.PAUSED]:    'Paused',
  [S.COMPLETED]: 'Capture complete!',
  [S.MANUAL]:    'Manual mode – tap to capture',
  [S.ERROR]:     'Error',
};

const STATUS_COLOR = {
  [S.WAITING]:   'var(--primary-color)',
  [S.ALIGNED]:   'var(--warning-color, #f59e0b)',
  [S.STABLE]:    'var(--success-color, #22c55e)',
  [S.CAPTURING]: 'var(--success-color, #22c55e)',
  [S.COMPLETED]: 'var(--success-color, #22c55e)',
  [S.MANUAL]:    'var(--primary-color)',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function Land360Capture({ capturePointId, onComplete, onCancel, retakeTargetId = null }) {
  const videoRef    = useRef(null);
  const engineRef   = useRef(null);     // TargetEngine instance
  const capturingRef = useRef(false);   // extra guard for double-capture

  const [status, setStatus]             = useState(S.LOADING);
  const [progress, setProgress]         = useState({ captured: 0, total: 0, percentage: 0 });
  const [currentTarget, setCurrentTarget] = useState(null);
  const [orientation, setOrientation]   = useState({ heading: 0, pitch: 0 }); // eslint-disable-line no-unused-vars
  const [gpsData, setGpsData]           = useState(null);
  const [dotStyle, setDotStyle]         = useState({ x: '50%', y: '50%', visible: false });
  const [lastCaptureFlash, setLastCaptureFlash] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [manualMode, setManualMode]     = useState(false);
  const [_sessionId, setSessionId]      = useState(null);
  const [_frames, setFrames]            = useState([]);
  const [recoveredCount, setRecoveredCount] = useState(0);

  // ── initialise ─────────────────────────────────────────────────────────────

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        // 1. Camera
        await cameraService.initialize(videoRef.current);

        // 2. GPS (non-blocking)
        locationService.getCurrentPosition().then((loc) => {
          if (mounted) setGpsData(loc);
        }).catch(() => {});

        // 3. Create or recover a TargetEngine
        const engine = new TargetEngine(DEFAULT_CAPTURE_CONFIG);
        engineRef.current = engine;

        // 4. Attempt session recovery
        const recovered = await land360Service.recoverSession(capturePointId);
        if (recovered && recovered.targets.length > 0) {
          // Map persisted targets back: strip the DB prefixed id, restore originalTargetId
          const restoredTargets = recovered.targets.map((t) => ({
            ...t,
            id: t.originalTargetId || t.id,
          }));
          engine.resumeSession(recovered.session, restoredTargets);
          if (mounted) {
            setSessionId(recovered.session.id);
            setFrames(recovered.frames);
            setRecoveredCount(recovered.frames.length);
            setProgress(engine.getProgress());
          }
        } else {
          // New session — need heading for reference (defer until CALIBRATE)
          // referenceHeading will be set once we get first orientation event
        }

        // 5. Orientation permission
        const hasOrientation = await orientationService.requestPermission();
        if (!hasOrientation || !orientationService.isSupported()) {
          engine.setManualMode(true);
          if (mounted) {
            setManualMode(true);
            setStatus(S.MANUAL);
          }
        } else {
          if (mounted) setStatus(engine.sessionId ? S.WAITING : S.CALIBRATE);
        }

        // 6. If retake requested, navigate to that target
        if (retakeTargetId && engine.sessionId) {
          engine.setCurrentTargetById(retakeTargetId);
        }

        // 7. Bind orientation listener
        orientationService.addListener(handleOrientationUpdate);
        orientationService.startListening();

        if (mounted) {
          setCurrentTarget(engine.getCurrentTarget());
          updateProgress();
        }
      } catch (err) {
        console.error('Land360Capture init failed:', err);
        if (mounted) {
          setErrorMessage(err.message || 'Failed to initialise capture.');
          setStatus(S.ERROR);
        }
      }
    }

    init();

    return () => {
      mounted = false;
      cameraService.stop();
      orientationService.removeListener(handleOrientationUpdate);
      orientationService.stopListening();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturePointId]);

  // ── Orientation handler (called at ~60 Hz) ─────────────────────────────────

  const handleOrientationUpdate = useCallback((reading) => {
    const engine = engineRef.current;
    if (!engine) return;

    const heading = reading.heading ?? 0;
    const pitch   = reading.beta   ?? 0;

    setOrientation({ heading, pitch });

    // CALIBRATE: set reference heading on first real reading
    if (!engine.sessionId || engine.referenceHeading == null) {
      if (engine.status !== 'active') {
        // Start a new session using this reading as reference
        const { sessionId: sid } = engine.startSession(capturePointId, heading);
        persistSessionAndTargets(engine, sid);
        setSessionId(sid);
        setStatus(S.WAITING);
        setCurrentTarget(engine.getCurrentTarget());
        updateProgress();
      } else {
        engine.setReferenceHeading(heading);
        setStatus(S.WAITING);
      }
      return;
    }

    if (status === S.PAUSED || status === S.CAPTURING || status === S.COMPLETED) return;
    if (capturingRef.current) return;

    // Convert to session-relative yaw
    const relYaw = engine.deviceHeadingToRelativeYaw(heading);

    // Update dot position
    const target = engine.getCurrentTarget();
    if (target) {
      setCurrentTarget(target);
      setDotStyle(computeDotStyle(relYaw, pitch, target));
    }

    // Check alignment
    const alignState = engine.checkAlignment(heading, pitch, reading.stability ?? 100);
    if (alignState === 'stable') {
      setStatus(S.STABLE);
      triggerAutoCapture(heading, pitch);
    } else if (alignState === 'aligned') {
      setStatus(S.ALIGNED);
    } else {
      setStatus(S.WAITING);
    }
  }, [status, capturePointId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-capture ───────────────────────────────────────────────────────────

  async function triggerAutoCapture(deviceHeading, devicePitch) {
    const engine = engineRef.current;
    if (!engine) return;
    if (capturingRef.current) return; // double-fire guard

    const lockAcquired = engine.beginCapture();
    if (!lockAcquired) return;

    capturingRef.current = true;
    setStatus(S.CAPTURING);

    const target = engine.getCurrentTarget();
    if (!target) {
      capturingRef.current = false;
      engine.markFailed('unknown');
      return;
    }

    try {
      const dataUri = await cameraService.captureFrame();
      const relYaw  = engine.deviceHeadingToRelativeYaw(deviceHeading);

      // Quality check (async, non-blocking for flow)
      const framePayload = {
        sequenceNumber: target.sequenceNumber,
        targetYaw:   target.relativeYaw,
        targetPitch: target.pitch,
        capturedYaw:   relYaw,
        capturedPitch: devicePitch,
        capturedRoll:  0,
        localUri:  dataUri,
        latitude:  gpsData?.latitude ?? null,
        longitude: gpsData?.longitude ?? null,
        gpsAccuracy: gpsData?.accuracy ?? null,
        imageFormat: 'image/jpeg',
        qualityStatus: 'not-evaluated',
        qualityWarnings: [],
      };

      // Persist frame
      const frame = await land360Service.saveFrame(
        engine.sessionId,
        capturePointId,
        target.id,
        framePayload,
      );

      // Run quality check (does not block the capture flow)
      FrameQualityChecker.check(frame, DEFAULT_CAPTURE_CONFIG).then(async (quality) => {
        frame.qualityStatus  = quality.qualityStatus;
        frame.qualityWarnings = quality.qualityWarnings;
        frame.qualityMetrics  = quality.qualityMetrics;
        // Update frame in DB with quality info
        const db = await land360Service.dbPromise;
        await db.put('frames', frame);
        setFrames((prev) =>
          prev.map((f) => (f.id === frame.id ? { ...frame } : f))
        );
      }).catch(() => {/* quality check failure is non-fatal */});

      // Mark target captured in engine
      engine.markCaptured(target.id, frame.id);

      // Persist updated target state
      await persistTargetUpdate(engine, target.id, frame.id);

      // Update state
      setFrames((prev) => [...prev, frame]);
      flashCapture();
      updateProgress();

      // Check completion
      if (engine.isComplete()) {
        await land360Service.updateCapturePointStatus(capturePointId, 'Completed');
        await persistSessionStatus(engine, 'completed');
        engine.completeSession();
        setStatus(S.COMPLETED);
        setTimeout(onComplete, 1500);
      } else {
        const next = engine.advanceToNextTarget(relYaw, devicePitch);
        setCurrentTarget(next);
        setStatus(S.WAITING);
      }
    } catch (err) {
      console.error('Capture failed', err);
      engine.markFailed(target?.id);
      setStatus(S.WAITING);
    } finally {
      capturingRef.current = false;
    }
  }

  // ── Manual capture (fallback / retake) ────────────────────────────────────

  async function handleManualCapture() {
    const engine = engineRef.current;
    if (!engine || capturingRef.current) return;

    // Ensure session exists
    if (!engine.sessionId) {
      const { sessionId: sid } = engine.startSession(capturePointId, 0);
      await persistSessionAndTargets(engine, sid);
      setSessionId(sid);
    }

    const lockAcquired = engine.beginCapture();
    if (!lockAcquired) return;
    capturingRef.current = true;
    setStatus(S.CAPTURING);

    const target = engine.getCurrentTarget() || engine.targets[0];
    if (!target) { capturingRef.current = false; return; }

    try {
      const dataUri = await cameraService.captureFrame();
      const reading = orientationService.getLatestReading();

      const frame = await land360Service.saveFrame(
        engine.sessionId,
        capturePointId,
        target.id,
        {
          sequenceNumber: target.sequenceNumber,
          targetYaw:   target.relativeYaw,
          targetPitch: target.pitch,
          capturedYaw:   reading.heading ?? null,
          capturedPitch: reading.beta    ?? null,
          capturedRoll:  reading.gamma   ?? 0,
          localUri:  dataUri,
          latitude:  gpsData?.latitude ?? null,
          longitude: gpsData?.longitude ?? null,
          gpsAccuracy: gpsData?.accuracy ?? null,
          imageFormat: 'image/jpeg',
          qualityStatus: 'not-evaluated',
          qualityWarnings: [{ check: 'auto_alignment', severity: 'warning', message: 'Manual capture — auto-alignment not verified.' }],
        },
      );

      engine.markCaptured(target.id, frame.id);
      await persistTargetUpdate(engine, target.id, frame.id);

      setFrames((prev) => [...prev, frame]);
      flashCapture();
      updateProgress();

      if (engine.isComplete()) {
        await land360Service.updateCapturePointStatus(capturePointId, 'Completed');
        engine.completeSession();
        setStatus(S.COMPLETED);
        setTimeout(onComplete, 1500);
      } else {
        engine.advanceToNextTarget(null, null);
        setCurrentTarget(engine.getCurrentTarget());
        setStatus(S.MANUAL);
      }
    } catch (err) {
      console.error('Manual capture failed', err);
      engine.markFailed(target?.id);
      setStatus(S.MANUAL);
    } finally {
      capturingRef.current = false;
    }
  }

  // ── Pause / Resume ────────────────────────────────────────────────────────

  async function togglePause() {
    const engine = engineRef.current;
    if (!engine) return;

    if (status === S.PAUSED) {
      engine.status = 'active';
      setStatus(manualMode ? S.MANUAL : S.WAITING);
    } else {
      engine.pauseSession();
      await persistSessionStatus(engine, 'paused');
      setStatus(S.PAUSED);
    }
  }

  // ── Persistence helpers ───────────────────────────────────────────────────

  async function persistSessionAndTargets(engine, sid) {
    const snapshot = engine.getSessionSnapshot();
    await land360Service.saveSession({ ...snapshot, id: sid, capturePointId, status: 'active' });
    await land360Service.saveTargets(sid, engine.targets);
  }

  async function persistTargetUpdate(engine, targetId, frameId) {
    const target = engine.targets.find((t) => t.id === targetId);
    if (!target || !engine.sessionId) return;
    const sid = engine.sessionId;
    await land360Service.updateTarget({
      ...target,
      id: `${sid}_${target.id}`,
      originalTargetId: target.id,
      sessionId: sid,
      capturedFrameId: frameId,
    });
  }

  async function persistSessionStatus(engine, newStatus) {
    const snapshot = engine.getSessionSnapshot();
    await land360Service.saveSession({ ...snapshot, capturePointId, status: newStatus });
  }

  // ── UI helpers ────────────────────────────────────────────────────────────

  function updateProgress() {
    if (engineRef.current) {
      setProgress(engineRef.current.getProgress());
    }
  }

  function flashCapture() {
    setLastCaptureFlash(true);
    setTimeout(() => setLastCaptureFlash(false), 300);
  }

  function computeDotStyle(relYaw, pitch, target) {
    let yawDiff = target.relativeYaw - relYaw;
    while (yawDiff >  180) yawDiff -= 360;
    while (yawDiff < -180) yawDiff += 360;

    const pitchDiff = target.pitch - pitch;
    const pxPerDeg  = 9;
    const xOff = yawDiff  * pxPerDeg;
    const yOff = pitchDiff * pxPerDeg;
    const maxOff = 160;
    const visible = Math.abs(xOff) < maxOff && Math.abs(yOff) < maxOff;

    return {
      x: `calc(50% + ${Math.max(-maxOff, Math.min(maxOff, xOff))}px)`,
      y: `calc(50% - ${Math.max(-maxOff, Math.min(maxOff, yOff))}px)`,
      visible,
      rawYaw: yawDiff,
      rawPitch: pitchDiff,
    };
  }

  // ── Compass arrow ─────────────────────────────────────────────────────────
  // Shows an arrow on the screen edge when target is off-screen

  function OffScreenArrow({ dotS }) {
    if (dotS.visible || !currentTarget) return null;
    const angle = Math.atan2(dotS.rawYaw ?? 0, -(dotS.rawPitch ?? 0)) * 180 / Math.PI;
    return (
      <div
        style={{
          position: 'absolute',
          top: '50%', left: '50%',
          transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-100px)`,
          pointerEvents: 'none',
          color: 'var(--primary-color)',
          fontSize: 28,
          lineHeight: 1,
          filter: 'drop-shadow(0 0 4px rgba(0,0,0,0.7))',
        }}
      >
        ↑
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────

  if (status === S.ERROR) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center p-lg text-white text-center">
        <div className="text-4xl mb-md">⚠️</div>
        <h3 className="mb-sm">Setup Failed</h3>
        <p className="text-secondary text-sm mb-lg">{errorMessage}</p>
        <button className="btn btn-secondary" onClick={onCancel}>Go Back</button>
      </div>
    );
  }

  const ringColor =
    status === S.ALIGNED || status === S.STABLE
      ? 'var(--warning-color, #f59e0b)'
      : status === S.CAPTURING
        ? 'var(--success-color, #22c55e)'
        : 'rgba(255,255,255,0.6)';

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col" id="land360-capture-screen">
      {/* Flash overlay on capture */}
      {lastCaptureFlash && (
        <div
          className="absolute inset-0 z-50 pointer-events-none"
          style={{ background: 'white', opacity: 0.5 }}
        />
      )}

      {/* ── Top bar ── */}
      <div
        className="absolute top-0 left-0 right-0 p-md flex justify-between items-center z-10"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.75), transparent)' }}
      >
        <button
          id="land360-cancel-btn"
          onClick={onCancel}
          style={{ background: 'rgba(0,0,0,0.45)', border: 'none', borderRadius: '50%', padding: 8, cursor: 'pointer' }}
        >
          <X size={22} color="white" />
        </button>

        <div className="text-center">
          <div className="font-bold text-white text-sm">Land 360° Capture</div>
          {recoveredCount > 0 && (
            <div className="text-xs" style={{ color: 'var(--warning-color, #f59e0b)' }}>
              Resumed · {recoveredCount} frames recovered
            </div>
          )}
          {gpsData && (
            <div className="text-xs text-white" style={{ opacity: 0.6 }}>
              GPS ±{Math.round(gpsData.accuracy)}m
            </div>
          )}
        </div>

        <button
          id="land360-pause-btn"
          onClick={togglePause}
          style={{ background: 'rgba(0,0,0,0.45)', border: 'none', borderRadius: '50%', padding: 8, cursor: 'pointer' }}
        >
          {status === S.PAUSED ? <Play size={22} color="white" /> : <Pause size={22} color="white" />}
        </button>
      </div>

      {/* ── Camera view ── */}
      <div className="relative flex-1 bg-gray-900 overflow-hidden flex items-center justify-center">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
          id="land360-video"
        />

        {/* Off-screen direction arrow */}
        <OffScreenArrow dotS={dotStyle} />

        {/* Target dot */}
        {currentTarget && status !== S.PAUSED && status !== S.LOADING && status !== S.CALIBRATE && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: dotStyle.x,
              top: dotStyle.y,
              transform: 'translate(-50%, -50%)',
              transition: 'left 80ms linear, top 80ms linear',
              opacity: dotStyle.visible ? 1 : 0.5,
            }}
          >
            {/* Outer ring */}
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                border: `3px solid ${ringColor}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'border-color 0.15s',
                background:
                  status === S.CAPTURING
                    ? 'rgba(34,197,94,0.25)'
                    : 'transparent',
              }}
            >
              {(status === S.CAPTURING || status === S.COMPLETED) ? (
                <Check size={20} color="white" />
              ) : (
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: ringColor,
                  }}
                />
              )}
            </div>
            {/* Pitch / ring label */}
            <div
              style={{
                textAlign: 'center',
                fontSize: 9,
                color: 'rgba(255,255,255,0.75)',
                marginTop: 3,
                textShadow: '0 1px 3px rgba(0,0,0,0.8)',
              }}
            >
              {currentTarget.ringLabel}
            </div>
          </div>
        )}

        {/* Centre reticle */}
        <div
          className="absolute"
          style={{
            left: '50%', top: '50%',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              width: 48, height: 48,
              borderRadius: '50%',
              border: `2px solid ${ringColor}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'border-color 0.15s',
            }}
          >
            <div style={{ width: 4, height: 4, borderRadius: '50%', background: ringColor }} />
            {/* Crosshairs */}
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, background: 'rgba(255,255,255,0.25)', transform: 'translateX(-50%)' }} />
            <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 1, background: 'rgba(255,255,255,0.25)', transform: 'translateY(-50%)' }} />
          </div>
        </div>

        {/* Paused overlay */}
        {status === S.PAUSED && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.65)' }}
          >
            <Pause size={56} color="white" style={{ marginBottom: 12 }} />
            <div className="font-bold text-white text-lg">Paused</div>
            <button
              className="btn btn-primary mt-md"
              onClick={togglePause}
            >
              <Play size={18} style={{ marginRight: 6 }} /> Resume
            </button>
          </div>
        )}

        {/* Loading overlay */}
        {(status === S.LOADING || status === S.CALIBRATE) && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.65)' }}
          >
            <Loader2 size={40} color="white" className="animate-spin" style={{ marginBottom: 12 }} />
            <div className="text-white text-sm">{STATUS_LABEL[status]}</div>
          </div>
        )}

        {/* Status pill */}
        {status !== S.PAUSED && status !== S.LOADING && status !== S.CALIBRATE && (
          <div
            className="absolute"
            style={{ bottom: 112, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}
          >
            <div
              style={{
                background: `${STATUS_COLOR[status] || 'rgba(0,0,0,0.55)'}cc`,
                backdropFilter: 'blur(6px)',
                borderRadius: 99,
                padding: '6px 18px',
                color: 'white',
                fontWeight: 700,
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {status === S.CAPTURING && <Loader2 size={14} className="animate-spin" />}
              {STATUS_LABEL[status]}
            </div>
          </div>
        )}

        {/* Manual capture button */}
        {manualMode && status !== S.PAUSED && status !== S.COMPLETED && (
          <button
            id="land360-manual-capture-btn"
            onClick={handleManualCapture}
            style={{
              position: 'absolute',
              bottom: 88,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 68,
              height: 68,
              borderRadius: '50%',
              border: '4px solid white',
              background: 'rgba(255,255,255,0.15)',
              backdropFilter: 'blur(4px)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'white' }} />
          </button>
        )}
      </div>

      {/* ── Bottom progress bar ── */}
      <div
        style={{ height: 80, background: 'rgba(0,0,0,0.92)', padding: '12px 16px 16px' }}
        id="land360-progress-bar"
      >
        <div className="flex justify-between text-white mb-xs" style={{ fontSize: 12 }}>
          <span>{progress.captured} / {progress.total} targets captured</span>
          <span className="font-bold">{progress.percentage}%</span>
        </div>
        <div style={{ height: 6, background: 'rgba(255,255,255,0.15)', borderRadius: 99, overflow: 'hidden' }}>
          <div
            style={{
              width: `${progress.percentage}%`,
              height: '100%',
              background: 'var(--primary-color)',
              borderRadius: 99,
              transition: 'width 0.35s ease',
            }}
          />
        </div>
        {currentTarget && status !== S.COMPLETED && status !== S.PAUSED && (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>
            Next: {currentTarget.ringLabel} · yaw {Math.round(currentTarget.relativeYaw)}° pitch {Math.round(currentTarget.pitch)}°
          </div>
        )}
      </div>
    </div>
  );
}
