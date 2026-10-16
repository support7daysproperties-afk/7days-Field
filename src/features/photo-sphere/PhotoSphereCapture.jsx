import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, AlertCircle, Camera, Check, RefreshCw, Undo2, Loader2, ShieldAlert } from 'lucide-react';
import {
  generateSphericalTargets,
  projectTargetToViewport,
  selectNextTarget,
  getUnlockedTargets,
  sphericalToVector,
  createCoverageGrid,
  projectFrameOntoGrid,
  computeCoveragePercent,
  updateFrontierAndGapDots,
  COVERAGE_CONFIG,
} from './PhotoSphereTargets';
import { PhotoSphereOrientation } from './PhotoSphereOrientation';
import { PhotoSphereStitcher } from './PhotoSphereStitcher';
import { photoSphereStorage } from './storage/PhotoSphereStorage';
import AlignmentReticle from './components/AlignmentReticle';
import TargetDotsOverlay from './components/TargetDotsOverlay';
import PanoramaResultScreen from './components/PanoramaResultScreen';
import PhotoSphereDiagnosticsOverlay from './components/PhotoSphereDiagnosticsOverlay';

// Explicit camera lifecycle states
export const CAMERA_STATES = {
  REQUESTING_PERMISSION: 'REQUESTING_PERMISSION',
  INITIALIZING: 'INITIALIZING',
  READY: 'READY',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  ERROR: 'ERROR',
};

/**
 * PhotoSphereCapture.jsx
 *
 * Dedicated Photo Sphere capture experience matching Google Camera Photo Sphere.
 *
 * Requirements:
 * - One single active blue target dot at a time.
 * - Real orientation-driven movement toward stationary center reticle.
 * - Automatic capture and progression to adjacent target.
 * - 360x180 complete spherical coverage preserved.
 */
export default function PhotoSphereCapture({
  taskId,
  onSaveEvidence,
  onClose,
}) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  // Camera & Stream State
  const [cameraState, setCameraState] = useState(CAMERA_STATES.INITIALIZING);
  const [cameraErrorDetails, setCameraErrorDetails] = useState('');
  const [stream, setStream] = useState(null);
  const [viewportSize, setViewportSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  // Orientation & Targets
  const orientationTrackerRef = useRef(null);
  const [orientation, setOrientation] = useState({ yaw: 0, pitch: 0, roll: 0, angularVelocity: 0, isMovingTooFast: false });
  const [targets, setTargets] = useState(() => generateSphericalTargets());
  const [activeTargetId, setActiveTargetId] = useState(null);
  const [capturedFrames, setCapturedFrames] = useState([]);
  const hasInitializedFirstTargetRef = useRef(false);

  // 72x36 Coverage Grid & History Stack for Undo
  const coverageGridRef = useRef(createCoverageGrid());
  const [coveragePercent, setCoveragePercent] = useState(0);
  const historyStackRef = useRef([]);

  // Auto-capture gating
  const [alignmentProgress, setAlignmentProgress] = useState(0); // 0 to 100%
  const [isCapturing, setIsCapturing] = useState(false);
  const isCapturingRef = useRef(false);
  const alignmentStartRef = useRef(null);
  const sessionIdRef = useRef(null);

  // Stitching & Results state
  const [isStitching, setIsStitching] = useState(false);
  const [stitchProgress, setStitchProgress] = useState(0);
  const [stitchStatusText, setStitchStatusText] = useState('');
  const [stitchError, setStitchError] = useState(null);
  const [stitchedPanorama, setStitchedPanorama] = useState(null);

  // Initialize Session
  useEffect(() => {
    let active = true;
    const init = async () => {
      const session = await photoSphereStorage.createSession(taskId, {
        totalTargets: targets.length,
      });
      if (active) {
        sessionIdRef.current = session.id;
      }
    };
    init();
    return () => { active = false; };
  }, [taskId, targets.length]);

  // Camera Initialization Function
  const initializeCamera = useCallback(async () => {
    setCameraState(CAMERA_STATES.INITIALIZING);
    setCameraErrorDetails('');

    // 1. Verify Secure Context (Chrome/Android blocks camera if not HTTPS or localhost)
    if (window.isSecureContext === false) {
      setCameraState(CAMERA_STATES.ERROR);
      setCameraErrorDetails('Camera access requires a secure connection (HTTPS).');
      return;
    }

    // 2. Verify mediaDevices support
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraState(CAMERA_STATES.ERROR);
      setCameraErrorDetails('Camera API is not supported by this browser.');
      return;
    }

    // Stop existing stream tracks if any before re-requesting
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }

    try {
      setCameraState(CAMERA_STATES.REQUESTING_PERMISSION);

      // Strategy 1: Ideal environment camera with HD resolution
      let mediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920, min: 640 },
            height: { ideal: 1080, min: 480 },
          },
          audio: false,
        });
      } catch (hdErr) {
        console.warn('HD camera constraint failed, attempting relaxed constraint:', hdErr);
        // Strategy 2: Exact environment or fallback to simple video: true
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
            audio: false,
          });
        } catch (envErr) {
          console.warn('Environment facingMode failed, falling back to default video:', envErr);
          // Strategy 3: Any available video device
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }
      }

      setStream(mediaStream);

      // Attach to video element
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        
        // Wait for video metadata & playback start to guarantee real feed is live
        await new Promise((resolve) => {
          if (videoRef.current.readyState >= 2) {
            resolve();
          } else {
            videoRef.current.onloadedmetadata = () => resolve();
          }
        });

        await videoRef.current.play();
      }

      setCameraState(CAMERA_STATES.READY);
    } catch (err) {
      console.error('Camera initialization error:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || err.name === 'SecurityError') {
        setCameraState(CAMERA_STATES.PERMISSION_DENIED);
        setCameraErrorDetails('Camera permission was denied in your browser settings.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setCameraState(CAMERA_STATES.ERROR);
        setCameraErrorDetails('No camera found on this device.');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setCameraState(CAMERA_STATES.ERROR);
        setCameraErrorDetails('Camera is in use by another application or tab.');
      } else {
        setCameraState(CAMERA_STATES.ERROR);
        setCameraErrorDetails(err.message || 'Unable to access rear camera.');
      }
    }
  }, [stream]);

  // Mount effect to start camera
  useEffect(() => {
    initializeCamera();

    return () => {
      // Cleanup all media stream tracks on unmount
      if (videoRef.current && videoRef.current.srcObject) {
        const currentTracks = videoRef.current.srcObject.getTracks();
        currentTracks.forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
    };
  }, []); // Run once on mount

  // Update Viewport Dimensions on resize
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setViewportSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Start Orientation Tracker
  useEffect(() => {
    const tracker = new PhotoSphereOrientation((newOrientation) => {
      setOrientation(newOrientation);

      // On first orientation reading (before first capture), calibrate reference frame
      // so initial target 0 is positioned at camera bore sight [0, 0, -1]
      // matching Google Camera LightCycleNative.InitTargets(cameraMatrix)
      if (!hasInitializedFirstTargetRef.current) {
        hasInitializedFirstTargetRef.current = true;
        tracker.setReferenceHeading(newOrientation.rawYaw, newOrientation.rawPitch);
        setActiveTargetId('target_0'); // target_0 is (yaw: 0, pitch: 0) dead center
      }
    });

    tracker.requestPermission().then(() => {
      tracker.start();
    });
    orientationTrackerRef.current = tracker;

    return () => {
      tracker.stop();
    };
  }, []);

  // Capture Current Frame Helper
  const captureFrame = useCallback(async (target) => {
    if (!videoRef.current || isCapturingRef.current || isCapturing || cameraState !== CAMERA_STATES.READY) return null;
    isCapturingRef.current = true;
    setIsCapturing(true);

    try {
      const video = videoRef.current;
      const vWidth = video.videoWidth;
      const vHeight = video.videoHeight;

      // Validate dimensions
      if (!vWidth || !vHeight || vWidth === 0 || vHeight === 0) {
        throw new Error('Video frame not ready');
      }

      const canvas = canvasRef.current || document.createElement('canvas');
      canvas.width = vWidth;
      canvas.height = vHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Create JPEG Blob
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => {
            if (b && b.size > 0) resolve(b);
            else reject(new Error('Captured image is empty'));
          },
          'image/jpeg',
          0.9
        );
      });

      const frameRecord = {
        id: `frame_${target.id}_${Date.now()}`,
        sessionId: sessionIdRef.current,
        targetId: target.id,
        sequenceIndex: target.sequenceIndex,
        yaw: target.yaw,
        pitch: target.pitch,
        roll: orientation.roll,
        blob,
        width: canvas.width,
        height: canvas.height,
        capturedAt: Date.now(),
      };

      // Persist frame to IndexedDB immediately
      await photoSphereStorage.saveFrame(frameRecord);

      // Snapshot for Undo before updating grid
      const prevGrid = new Uint8Array(coverageGridRef.current);
      const prevTargets = targets;

      // Project captured frame onto 72x36 coverage grid
      projectFrameOntoGrid(coverageGridRef.current, target.yaw, target.pitch, 44, 54);
      const newCovPercent = computeCoveragePercent(coverageGridRef.current);
      setCoveragePercent(newCovPercent);

      const nextFrames = [...capturedFrames, frameRecord];
      setCapturedFrames(nextFrames);

      // Update Target State & Frontier expansion
      const { updatedTargets } = updateFrontierAndGapDots(
        targets,
        nextFrames,
        coverageGridRef.current
      );
      setTargets(updatedTargets);

      historyStackRef.current.push({
        prevGrid,
        prevTargets,
        frameRecord,
      });
      if (historyStackRef.current.length > 20) historyStackRef.current.shift();

      // Set reference heading & pitch if this was first capture
      if (orientationTrackerRef.current && orientationTrackerRef.current.referenceHeading === null) {
        orientationTrackerRef.current.setReferenceHeading(orientation.rawYaw, orientation.rawPitch);
      }

      // Advance to the NEXT single target using 3D angular proximity & circular sweep
      const nextTarget = selectNextTarget(
        updatedTargets,
        target,
        orientation.yaw,
        orientation.pitch,
        coverageGridRef.current
      );

      if (nextTarget) {
        setActiveTargetId(nextTarget.id);
      } else {
        // Complete sphere captured!
        setActiveTargetId(null);
      }

      return frameRecord;
    } catch (err) {
      console.error('Frame capture failed', err);
    } finally {
      isCapturingRef.current = false;
      setIsCapturing(false);
      alignmentStartRef.current = null;
      setAlignmentProgress(0);
    }
  }, [cameraState, capturedFrames, isCapturing, orientation.pitch, orientation.rawPitch, orientation.rawYaw, orientation.roll, orientation.yaw, targets]);

  // Project targets onto viewport and Check Alignment Tick
  const isCameraReady = cameraState === CAMERA_STATES.READY;

  // 1. Get all unlocked target dots using 52° frontier unlocking & coverage grid
  const unlockedRawTargets = isCameraReady
    ? getUnlockedTargets(targets, capturedFrames, coverageGridRef.current)
    : [];

  // 2. Project each unlocked target in physical 3D space onto the 2D viewport
  const projectedUnlockedTargets = unlockedRawTargets.map((t) => ({
    ...t,
    worldVector: sphericalToVector(t.yaw, t.pitch),
    projected: projectTargetToViewport(
      t.yaw,
      t.pitch,
      orientation.yaw,
      orientation.pitch,
      viewportSize.width,
      viewportSize.height,
      65,
      orientation.roll || 0
    ),
  }));

  // 3. Find the target closest to the camera bore sight (optical center)
  let activeTarget = null;
  let minAngularDist = 999;
  projectedUnlockedTargets.forEach((t) => {
    if (!t.projected.isBehind && t.projected.angularDistance < minAngularDist) {
      minAngularDist = t.projected.angularDistance;
      activeTarget = t;
    }
  });

  // Fallback to activeTargetId if user was already focusing one
  if (!activeTarget && projectedUnlockedTargets.length > 0) {
    activeTarget = projectedUnlockedTargets.find((t) => t.id === activeTargetId) || projectedUnlockedTargets[0];
  }

  const activeDist = activeTarget ? activeTarget.projected.angularDistance : 999;
  const isTooFast =
    (orientation.angularVelocity > COVERAGE_CONFIG.MAX_ANGULAR_VELOCITY) ||
    orientation.isMovingTooFast;
  const isAligned =
    isCameraReady &&
    activeTarget &&
    activeDist <= COVERAGE_CONFIG.ALIGNMENT_THRESHOLD_DEG;

  // Compute diagnostic capture decision reason for live HUD
  const captureDecision = {
    accepted: false,
    reason: 'Waiting for camera ready',
  };
  if (!isCameraReady) {
    captureDecision.reason = 'Camera not ready';
  } else if (!activeTarget) {
    captureDecision.reason = 'No active target in range';
  } else if (isCapturing || isCapturingRef.current) {
    captureDecision.reason = 'Capture in progress';
  } else if (isTooFast) {
    captureDecision.reason = `Moving too fast (${orientation.angularVelocity}°/s > ${COVERAGE_CONFIG.MAX_ANGULAR_VELOCITY}°/s)`;
  } else if (!isAligned) {
    captureDecision.reason = `Aligning dot (${Math.round(activeDist * 10) / 10}° > ${COVERAGE_CONFIG.ALIGNMENT_THRESHOLD_DEG}°)`;
  } else if (alignmentProgress < 100) {
    captureDecision.reason = `Holding steady (${alignmentProgress}%)`;
  } else {
    captureDecision.accepted = true;
    captureDecision.reason = 'Aligned & steady: trigger capture';
  }

  // Auto-capture logic when aligned and steady
  useEffect(() => {
    if (!isCameraReady || !activeTarget || isCapturingRef.current || isCapturing || isStitching || stitchedPanorama) {
      alignmentStartRef.current = null;
      setAlignmentProgress(0);
      return;
    }

    // Moving too fast breaks steady lock
    if (isTooFast) {
      alignmentStartRef.current = null;
      setAlignmentProgress(0);
      return;
    }

    if (isAligned) {
      const now = performance.now();
      if (!alignmentStartRef.current) {
        alignmentStartRef.current = now;
      }
      const elapsed = now - alignmentStartRef.current;
      const requiredHoldMs = COVERAGE_CONFIG.HOLD_DURATION_MS; // 320ms hold steady matching index.html
      const progress = Math.min(100, Math.round((elapsed / requiredHoldMs) * 100));
      setAlignmentProgress(progress);

      if (elapsed >= requiredHoldMs) {
        captureFrame(activeTarget);
      }
    } else {
      alignmentStartRef.current = null;
      setAlignmentProgress(0);
    }
  }, [activeTarget, captureFrame, isAligned, isCameraReady, isCapturing, isStitching, isTooFast, stitchedPanorama]);

  // Trigger Stitching Pipeline
  const handleStartStitching = async () => {
    if (capturedFrames.length === 0) return;
    setIsStitching(true);
    setStitchError(null);
    setStitchProgress(0.05);
    setStitchStatusText('Initializing Photo Sphere stitcher...');

    try {
      const result = await PhotoSphereStitcher.stitch(
        capturedFrames,
        { width: 2048 },
        (progress, text) => {
          setStitchProgress(progress);
          setStitchStatusText(text);
        }
      );

      // Save panorama record in storage
      const panoRecord = await photoSphereStorage.savePanorama({
        sessionId: sessionIdRef.current,
        inspectionId: taskId,
        blob: result.blob,
        width: result.width,
        height: result.height,
        isCompleteSphere: result.isCompleteSphere,
        metadata: {
          frameCount: capturedFrames.length,
          stitchedAt: Date.now(),
        },
      });

      setStitchedPanorama({
        id: panoRecord.id,
        url: result.url,
        blob: result.blob,
        width: result.width,
        height: result.height,
      });
    } catch (err) {
      console.error('Stitching failed', err);
      setStitchError(err.message || 'Failed to stitch spherical panorama');
    } finally {
      setIsStitching(false);
    }
  };

  // Undo last capture with coverage grid rollback
  const handleUndo = () => {
    if (capturedFrames.length === 0) return;
    const lastEntry = historyStackRef.current.pop();
    const lastFrame = capturedFrames[capturedFrames.length - 1];

    if (lastEntry && lastEntry.prevGrid) {
      coverageGridRef.current.set(lastEntry.prevGrid);
      setCoveragePercent(computeCoveragePercent(coverageGridRef.current));
    }

    const remainingFrames = capturedFrames.slice(0, -1);
    setCapturedFrames(remainingFrames);

    if (lastEntry && lastEntry.prevTargets) {
      setTargets(lastEntry.prevTargets);
    } else {
      setTargets((prev) =>
        prev.map((t) => (t.id === lastFrame.targetId ? { ...t, status: 'pending', captured: false } : t))
      );
    }
    setActiveTargetId(lastFrame.targetId);
  };

  // Retake entire sphere
  const handleRetake = () => {
    setStitchedPanorama(null);
    setCapturedFrames([]);
    coverageGridRef.current = createCoverageGrid();
    historyStackRef.current = [];
    setCoveragePercent(0);
    setTargets(generateSphericalTargets());
    setActiveTargetId('target_0');
    hasInitializedFirstTargetRef.current = false;
    if (orientationTrackerRef.current) {
      orientationTrackerRef.current.referenceHeading = null;
    }
  };

  // Save evidence and close
  const handleConfirmSave = () => {
    if (onSaveEvidence && stitchedPanorama) {
      onSaveEvidence({
        mediaType: 'photo_sphere',
        evidenceType: '360 Photo Sphere',
        blob: stitchedPanorama.blob,
        url: stitchedPanorama.url,
        framesCount: capturedFrames.length,
        sessionId: sessionIdRef.current,
      });
    }
    onClose();
  };

  // If panorama is ready, render the Panorama Result Screen
  if (stitchedPanorama) {
    return (
      <PanoramaResultScreen
        panoramaData={stitchedPanorama}
        frames={capturedFrames}
        onRetake={handleRetake}
        onSave={handleConfirmSave}
        onCancel={onClose}
      />
    );
  }

  const capturedCount = capturedFrames.length;
  const totalCount = targets.length;
  const remainingCount = targets.filter((t) => !t.captured && t.status !== 'captured').length;
  const progressPercent = Math.round((capturedCount / totalCount) * 100);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: '#000000',
        zIndex: 85,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Hidden processing canvas */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Live Camera Viewfinder Element */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: isCameraReady ? 'block' : 'none',
        }}
      />

      {/* Top Header Overlay */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: '16px 20px',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: '#ffffff',
          zIndex: 30,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: isCameraReady ? '#3b82f6' : '#94a3b8',
              boxShadow: isCameraReady ? '0 0 8px #3b82f6' : 'none',
            }}
          />
          <span style={{ fontSize: '15px', fontWeight: 'bold', letterSpacing: '0.02em' }}>
            PHOTO SPHERE
          </span>
        </div>

        {/* HUD Pill: Coverage & Dots Left */}
        {isCameraReady && (
          <div
            style={{
              background: 'rgba(16, 16, 16, 0.82)',
              backdropFilter: 'blur(10px)',
              padding: '6px 14px',
              borderRadius: '999px',
              fontSize: '12px',
              fontWeight: '600',
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
              border: '1px solid rgba(255, 255, 255, 0.18)',
            }}
          >
            <span style={{ color: '#60a5fa' }}>{coveragePercent}% Captured</span>
            <span style={{ color: 'rgba(255, 255, 255, 0.3)' }}>•</span>
            <span>
              {remainingCount === 0
                ? 'Sphere Sealed!'
                : capturedFrames.length === 0
                ? 'Center Dot Ready'
                : `${remainingCount} Dots Left`}
            </span>
          </div>
        )}

        <button
          onClick={onClose}
          style={{
            background: 'rgba(255, 255, 255, 0.15)',
            border: 'none',
            color: '#ffffff',
            borderRadius: '50%',
            width: '38px',
            height: '38px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <X size={20} />
        </button>
      </div>

      {/* Instruction Banner */}
      {isCameraReady && (
        <div
          style={{
            position: 'absolute',
            top: '70px',
            left: '50%',
            transform: 'translateX(-50%)',
            textAlign: 'center',
            fontSize: '13px',
            fontWeight: '600',
            color: 'rgba(255, 255, 255, 0.95)',
            textShadow: '0 2px 8px rgba(0, 0, 0, 0.9)',
            pointerEvents: 'none',
            zIndex: 35,
            backgroundColor: isTooFast
              ? 'rgba(239, 68, 68, 0.88)'
              : isAligned
              ? 'rgba(37, 99, 235, 0.85)'
              : 'rgba(18, 18, 18, 0.8)',
            backdropFilter: 'blur(8px)',
            padding: '7px 18px',
            borderRadius: '20px',
            border: '1px solid rgba(255, 255, 255, 0.18)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
            maxWidth: '90%',
            transition: 'all 0.2s ease',
          }}
        >
          {coveragePercent >= 99
            ? '360° Complete! Tap the checkmark ✓'
            : capturedFrames.length === 0
            ? 'To start, keep center dot inside circle'
            : isTooFast
            ? 'Slow down — hold steady'
            : isAligned && alignmentProgress > 0
            ? 'Hold steady...'
            : 'Aim camera at the next dot to unlock that surface'}
        </div>
      )}

      {/* ── STATE: INITIALIZING / REQUESTING PERMISSION ── */}
      {(cameraState === CAMERA_STATES.INITIALIZING || cameraState === CAMERA_STATES.REQUESTING_PERMISSION) && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#0a0f1d',
            zIndex: 25,
            padding: '24px',
            color: '#ffffff',
          }}
        >
          <Loader2 size={44} color="#3b82f6" style={{ animation: 'spin 1s linear infinite', marginBottom: '16px' }} />
          <h3 style={{ fontSize: '17px', fontWeight: 'bold', marginBottom: '6px' }}>
            Initializing Rear Camera...
          </h3>
          <p style={{ fontSize: '13px', color: '#94a3b8', textAlign: 'center' }}>
            Requesting camera stream and setting up viewfinder.
          </p>
        </div>
      )}

      {/* ── STATE: PERMISSION DENIED ── */}
      {cameraState === CAMERA_STATES.PERMISSION_DENIED && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#0f172a',
            zIndex: 25,
            padding: '28px',
            color: '#ffffff',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '16px',
            }}
          >
            <ShieldAlert size={36} color="#ef4444" />
          </div>
          <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px' }}>
            Camera Permission Required
          </h3>
          <p style={{ fontSize: '14px', color: '#94a3b8', marginBottom: '24px', maxWidth: '320px', lineHeight: 1.5 }}>
            Photo Sphere mode needs access to your rear camera to capture spherical photographs.
            Please allow camera access in your browser settings.
          </p>
          <div style={{ display: 'flex', gap: '12px', width: '100%', maxWidth: '300px' }}>
            <button
              onClick={onClose}
              style={{
                flex: 1,
                padding: '12px',
                borderRadius: '8px',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                border: 'none',
                color: '#ffffff',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={initializeCamera}
              style={{
                flex: 2,
                padding: '12px',
                borderRadius: '8px',
                backgroundColor: '#2563eb',
                border: 'none',
                color: '#ffffff',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <RefreshCw size={16} /> Allow Camera
            </button>
          </div>
        </div>
      )}

      {/* ── STATE: CAMERA ERROR ── */}
      {cameraState === CAMERA_STATES.ERROR && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#0f172a',
            zIndex: 25,
            padding: '28px',
            color: '#ffffff',
            textAlign: 'center',
          }}
        >
          <AlertCircle size={44} color="#f59e0b" style={{ marginBottom: '16px' }} />
          <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px' }}>
            Camera Unavailable
          </h3>
          <p style={{ fontSize: '14px', color: '#94a3b8', marginBottom: '24px', maxWidth: '320px', lineHeight: 1.5 }}>
            {cameraErrorDetails || 'Unable to open camera stream. Another application may be using the camera.'}
          </p>
          <button
            onClick={initializeCamera}
            style={{
              padding: '12px 24px',
              borderRadius: '8px',
              backgroundColor: '#2563eb',
              border: 'none',
              color: '#ffffff',
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <RefreshCw size={16} /> Retry Camera
          </button>
        </div>
      )}

      {/* ── ONLY RENDER CAPTURE GUIDANCE WHEN CAMERA IS READY ── */}
      {isCameraReady && (
        <>
          {/* Motion Stability Warning: "Hold camera still / Moving too fast" */}
          {/* Motion Warning Alert - Displayed when angular speed exceeds stable tracking threshold */}
          {orientation.isMovingTooFast && (
            <div
              style={{
                position: 'absolute',
                top: '76px',
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: 'rgba(239, 68, 68, 0.9)',
                color: '#ffffff',
                padding: '8px 18px',
                borderRadius: '20px',
                fontSize: '13px',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                zIndex: 35,
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                animation: 'pulse 1s infinite',
              }}
            >
              <AlertCircle size={16} />
              <span>Hold camera still • Moving too fast</span>
            </div>
          )}

          {/* Blue Target Dots: Unlocked 3D floating marbles pinned in physical space */}
          <TargetDotsOverlay
            targets={projectedUnlockedTargets}
            activeTarget={activeTarget}
            viewportWidth={viewportSize.width}
            viewportHeight={viewportSize.height}
          />

          {/* Stationary Center Alignment Reticle */}
          <AlignmentReticle
            isAligned={isAligned}
            isTooFast={orientation.isMovingTooFast}
            progress={alignmentProgress}
          />

          {/* Development / Diagnostics Live HUD */}
          <PhotoSphereDiagnosticsOverlay
            orientation={orientation}
            activeTarget={activeTarget}
            unlockedCount={projectedUnlockedTargets.length}
            totalTargets={targets.length}
            capturedCount={capturedFrames.length}
            viewportSize={viewportSize}
            alignmentProgress={alignmentProgress}
            captureDecision={captureDecision}
            isCameraReady={isCameraReady}
          />
        </>
      )}

      {/* Shutter flash animation on capture */}
      {isCapturing && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: '#ffffff',
            opacity: 0.8,
            zIndex: 25,
            pointerEvents: 'none',
            animation: 'flash 0.2s ease-out forwards',
          }}
        />
      )}

      {/* Bottom Floating Control Panel (Only active when camera is READY) */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '20px 24px 32px 24px',
          background: 'linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.4), transparent)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '16px',
          zIndex: 30,
          opacity: isCameraReady ? 1 : 0.4,
          pointerEvents: isCameraReady ? 'auto' : 'none',
        }}
      >
        {/* Progress Bar & Counter */}
        <div style={{ width: '100%', maxWidth: '340px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              color: '#ffffff',
              fontSize: '12px',
              fontWeight: 'bold',
              marginBottom: '6px',
            }}
          >
            <span>Spherical Coverage</span>
            <span>
              {coveragePercent}% Covered ({capturedCount} photos taken)
            </span>
          </div>

          <div
            style={{
              height: '6px',
              backgroundColor: 'rgba(255, 255, 255, 0.25)',
              borderRadius: '3px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${coveragePercent}%`,
                backgroundColor: coveragePercent >= 99 ? '#10b981' : '#3b82f6',
                borderRadius: '3px',
                transition: 'width 0.25s ease',
              }}
            />
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          {/* Undo Button */}
          <button
            onClick={handleUndo}
            disabled={!isCameraReady || capturedCount === 0 || isStitching}
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.15)',
              border: 'none',
              color: capturedCount > 0 ? '#ffffff' : '#64748b',
              width: '46px',
              height: '46px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: capturedCount > 0 ? 'pointer' : 'not-allowed',
            }}
            title="Undo last capture"
          >
            <Undo2 size={20} />
          </button>

          {/* Manual Capture Shutter Fallback */}
          <button
            onClick={() => {
              if (isCameraReady && activeTarget) {
                captureFrame(activeTarget);
              }
            }}
            disabled={!isCameraReady || isCapturing || isStitching}
            style={{
              width: '70px',
              height: '70px',
              borderRadius: '50%',
              backgroundColor: isCameraReady ? '#ffffff' : '#94a3b8',
              border: '4px solid rgba(255, 255, 255, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: isCameraReady ? 'pointer' : 'not-allowed',
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.5)',
            }}
          >
            <div
              style={{
                width: '54px',
                height: '54px',
                borderRadius: '50%',
                border: '2px solid #000000',
              }}
            />
          </button>

          {/* Stitch / Finish Button (available once 1+ shots or complete) */}
          <button
            onClick={handleStartStitching}
            disabled={!isCameraReady || capturedCount < 1 || isStitching}
            style={{
              backgroundColor: capturedCount >= 1 ? '#10b981' : 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              color: capturedCount >= 1 ? '#ffffff' : '#64748b',
              height: '46px',
              padding: '0 16px',
              borderRadius: '24px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 'bold',
              fontSize: '13px',
              cursor: capturedCount >= 1 ? 'pointer' : 'not-allowed',
              boxShadow: capturedCount >= 1 ? '0 4px 12px rgba(16, 185, 129, 0.4)' : 'none',
            }}
            title="Generate stitched panorama"
          >
            <Check size={18} />
            <span>Finish</span>
          </button>
        </div>
      </div>

      {/* Stitching Processing Modal */}
      {isStitching && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(10, 15, 29, 0.92)',
            zIndex: 60,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            color: '#ffffff',
          }}
        >
          <div
            style={{
              width: '56px',
              height: '56px',
              border: '4px solid rgba(59, 130, 246, 0.3)',
              borderTopColor: '#3b82f6',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              marginBottom: '20px',
            }}
          />

          <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px' }}>
            Stitching Photo Sphere...
          </h3>

          <p style={{ fontSize: '14px', color: '#94a3b8', textAlign: 'center', marginBottom: '20px' }}>
            {stitchStatusText}
          </p>

          <div
            style={{
              width: '100%',
              maxWidth: '300px',
              height: '6px',
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              borderRadius: '3px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.round(stitchProgress * 100)}%`,
                height: '100%',
                backgroundColor: '#3b82f6',
                borderRadius: '3px',
                transition: 'width 0.2s',
              }}
            />
          </div>
        </div>
      )}

      {/* Stitching Error Dialog */}
      {stitchError && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            zIndex: 70,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            color: '#ffffff',
          }}
        >
          <div
            style={{
              backgroundColor: '#1e293b',
              padding: '24px',
              borderRadius: '12px',
              maxWidth: '400px',
              textAlign: 'center',
              border: '1px solid #ef4444',
            }}
          >
            <AlertCircle size={40} color="#ef4444" style={{ margin: '0 auto 12px auto' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '8px' }}>
              Stitching Failed
            </h3>
            <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px' }}>
              {stitchError}. Your {capturedFrames.length} captured photographs are safely preserved in storage.
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setStitchError(null)}
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: '#334155',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Back to Session
              </button>
              <button
                onClick={handleStartStitching}
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Retry Stitching
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes flash {
          0% { opacity: 0.8; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
