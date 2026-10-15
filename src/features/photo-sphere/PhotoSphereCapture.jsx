import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, AlertCircle, Camera, Check, RefreshCw, Undo2, ArrowLeft } from 'lucide-react';
import {
  generateSphericalTargets,
  projectTargetToViewport,
  angularDistance,
} from './PhotoSphereTargets';
import { PhotoSphereOrientation } from './PhotoSphereOrientation';
import { PhotoSphereStitcher } from './PhotoSphereStitcher';
import { photoSphereStorage } from './storage/PhotoSphereStorage';
import AlignmentReticle from './components/AlignmentReticle';
import TargetDotsOverlay from './components/TargetDotsOverlay';
import PanoramaResultScreen from './components/PanoramaResultScreen';

/**
 * PhotoSphereCapture.jsx
 *
 * Dedicated Photo Sphere capture experience matching Google Camera Photo Sphere.
 *
 * Requirements:
 * - Live camera preview
 * - Stationary center alignment reticle (4 quadrants animating inwards)
 * - Blue target dots guiding user toward next capture directions
 * - Real-time device-orientation tracking (DeviceOrientationEvent)
 * - Automatic capture when target is accurately aligned (< 3.5°) and phone is steady
 * - Clear warning when device moves too fast ("Hold camera still / Moving too fast")
 * - Full spherical 360° x 180° progression (horizon, upper, zenith, lower, nadir)
 * - Visible progress indicator & safe cancel
 * - Safe persistence of raw captures in IndexedDB before and during stitching
 * - Genuine equirectangular panorama stitching
 * - Post-stitching Panorama Result Screen with VR View & Motion Sensor View buttons
 */
export default function PhotoSphereCapture({
  taskId,
  onSaveEvidence,
  onClose,
}) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  // Stream & Hardware
  const [stream, setStream] = useState(null);
  const [cameraError, setCameraError] = useState(null);
  const [viewportSize, setViewportSize] = useState({ width: window.innerWidth, height: window.innerHeight });

  // Orientation & Targets
  const orientationTrackerRef = useRef(null);
  const [orientation, setOrientation] = useState({ yaw: 0, pitch: 0, roll: 0, angularVelocity: 0, isMovingTooFast: false });
  const [targets, setTargets] = useState(() => generateSphericalTargets());
  const [activeTargetId, setActiveTargetId] = useState('target_0');
  const [capturedFrames, setCapturedFrames] = useState([]);

  // Auto-capture gating
  const [alignmentProgress, setAlignmentProgress] = useState(0); // 0 to 100%
  const [isCapturing, setIsCapturing] = useState(false);
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

  // Start Camera Stream
  useEffect(() => {
    let mediaStream = null;

    const startCamera = async () => {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });

        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.play().catch(console.error);
        }
      } catch (err) {
        console.error('Camera access error:', err);
        setCameraError('Unable to access rear camera. Please ensure camera permissions are allowed.');
      }
    };

    startCamera();

    return () => {
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

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
    if (!videoRef.current || isCapturing) return null;
    setIsCapturing(true);

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current || document.createElement('canvas');
      canvas.width = video.videoWidth || 1920;
      canvas.height = video.videoHeight || 1080;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Create JPEG Blob
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));

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

      // Update Target State
      setTargets((prev) =>
        prev.map((t) => (t.id === target.id ? { ...t, status: 'captured' } : t))
      );

      setCapturedFrames((prev) => [...prev, frameRecord]);

      // Set reference heading if this was first capture
      if (orientationTrackerRef.current && orientationTrackerRef.current.referenceHeading === null) {
        orientationTrackerRef.current.setReferenceHeading(orientation.rawYaw);
      }

      // Advance to next target (nearest pending target)
      const nextPending = targets.find(
        (t) => t.id !== target.id && t.status === 'pending'
      );
      if (nextPending) {
        setActiveTargetId(nextPending.id);
      } else {
        // All targets captured!
        setActiveTargetId(null);
      }

      return frameRecord;
    } catch (err) {
      console.error('Frame capture failed', err);
    } finally {
      setIsCapturing(false);
      alignmentStartRef.current = null;
      setAlignmentProgress(0);
    }
  }, [isCapturing, orientation.rawYaw, orientation.roll, targets]);

  // Project targets onto viewport and Check Alignment Tick
  const projectedTargets = targets.map((t) => {
    const proj = projectTargetToViewport(
      t.yaw,
      t.pitch,
      orientation.yaw,
      orientation.pitch,
      viewportSize.width,
      viewportSize.height,
      65
    );
    return { ...t, projected: proj };
  });

  const activeTarget = projectedTargets.find((t) => t.id === activeTargetId);
  const activeDist = activeTarget ? activeTarget.projected.angularDistance : 999;
  const isAligned = activeTarget && activeDist <= 3.8; // aligned within 3.8 degrees

  // Auto-capture logic when aligned and steady
  useEffect(() => {
    if (!activeTarget || isCapturing || isStitching || stitchedPanorama) {
      alignmentStartRef.current = null;
      setAlignmentProgress(0);
      return;
    }

    // Moving too fast breaks steady lock
    if (orientation.isMovingTooFast) {
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
      const requiredHoldMs = 280; // hold steady for 280ms
      const progress = Math.min(100, Math.round((elapsed / requiredHoldMs) * 100));
      setAlignmentProgress(progress);

      if (elapsed >= requiredHoldMs) {
        captureFrame(activeTarget);
      }
    } else {
      alignmentStartRef.current = null;
      setAlignmentProgress(0);
    }
  }, [activeTarget, captureFrame, isAligned, isCapturing, isStitching, orientation.isMovingTooFast, stitchedPanorama]);

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

  // Undo last capture
  const handleUndo = () => {
    if (capturedFrames.length === 0) return;
    const lastFrame = capturedFrames[capturedFrames.length - 1];
    setCapturedFrames((prev) => prev.slice(0, -1));
    setTargets((prev) =>
      prev.map((t) => (t.id === lastFrame.targetId ? { ...t, status: 'pending' } : t))
    );
    setActiveTargetId(lastFrame.targetId);
  };

  // Retake entire sphere
  const handleRetake = () => {
    setStitchedPanorama(null);
    setCapturedFrames([]);
    setTargets(generateSphericalTargets());
    setActiveTargetId('target_0');
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

      {/* Live Camera Viewfinder */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
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
              backgroundColor: '#3b82f6',
              boxShadow: '0 0 8px #3b82f6',
            }}
          />
          <span style={{ fontSize: '15px', fontWeight: 'bold', letterSpacing: '0.02em' }}>
            PHOTO SPHERE
          </span>
        </div>

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

      {/* Camera Error Message Banner */}
      {cameraError && (
        <div
          style={{
            position: 'absolute',
            top: '80px',
            left: '20px',
            right: '20px',
            backgroundColor: 'rgba(239, 68, 68, 0.95)',
            color: '#ffffff',
            padding: '12px 16px',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '14px',
            zIndex: 40,
          }}
        >
          <AlertCircle size={20} />
          <span>{cameraError}</span>
        </div>
      )}

      {/* Motion Stability Warning: "Hold camera still / Moving too fast" */}
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

      {/* Blue Target Dots Layer */}
      <TargetDotsOverlay targets={projectedTargets} activeTargetId={activeTargetId} />

      {/* Stationary Center Alignment Reticle */}
      <AlignmentReticle
        isAligned={isAligned}
        isTooFast={orientation.isMovingTooFast}
        progress={alignmentProgress}
      />

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

      {/* Bottom Floating Control Panel */}
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
              {capturedCount} / {totalCount} photos ({progressPercent}%)
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
                width: `${progressPercent}%`,
                backgroundColor: '#3b82f6',
                borderRadius: '3px',
                transition: 'width 0.2s ease',
              }}
            />
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          {/* Undo Button */}
          <button
            onClick={handleUndo}
            disabled={capturedCount === 0 || isStitching}
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
              if (activeTarget) {
                captureFrame(activeTarget);
              }
            }}
            disabled={isCapturing || isStitching}
            style={{
              width: '70px',
              height: '70px',
              borderRadius: '50%',
              backgroundColor: '#ffffff',
              border: '4px solid rgba(255, 255, 255, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
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

          {/* Stitch / Finish Button (available once 3+ shots or complete) */}
          <button
            onClick={handleStartStitching}
            disabled={capturedCount < 3 || isStitching}
            style={{
              backgroundColor: capturedCount >= 3 ? '#10b981' : 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              color: capturedCount >= 3 ? '#ffffff' : '#64748b',
              height: '46px',
              padding: '0 16px',
              borderRadius: '24px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 'bold',
              fontSize: '13px',
              cursor: capturedCount >= 3 ? 'pointer' : 'not-allowed',
              boxShadow: capturedCount >= 3 ? '0 4px 12px rgba(16, 185, 129, 0.4)' : 'none',
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
