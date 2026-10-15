/**
 * PhotoSphereCaptureScreen.jsx
 *
 * Full-screen guided Photo Sphere capture screen conforming to n30dyn4m1c/360-photo-app.
 * Connects CameraViewport, CenterReticle, TargetOverlay, CaptureProgress, and CaptureControls
 * through CaptureCoordinator and SphereStitcher.
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import CameraViewport from './components/CameraViewport';
import CenterReticle from './components/CenterReticle';
import TargetOverlay from './components/TargetOverlay';
import CaptureProgress from './components/CaptureProgress';
import CaptureControls from './components/CaptureControls';
import PanoramaViewer from './viewer/PanoramaViewer';

import { CameraAdapter } from './camera/CameraAdapter';
import { OrientationAdapter } from './orientation/OrientationAdapter';
import { SphereTargetPlan } from './targets/SphereTargetPlan';
import { TargetSelection } from './targets/TargetSelection';
import { CaptureCoordinator } from './camera/CaptureCoordinator';
import { SphereStitcher } from './stitching/SphereStitcher';
import { sphereSessionRepository } from './storage/SphereSessionRepository';

export default function PhotoSphereCaptureScreen({
  propertyId = null,
  inspectionId = null,
  supervisorId = null,
  onComplete = () => {},
  onCancel = () => {},
}) {
  const videoRef = useRef(null);

  // Architecture instances
  const cameraAdapterRef = useRef(null);
  const orientationAdapterRef = useRef(null);
  const coordinatorRef = useRef(null);
  const stitcherRef = useRef(null);

  // Screen State
  const [stage, setStage] = useState('initializing'); // 'initializing' | 'capturing' | 'stitching' | 'viewing' | 'error'
  const [errorMessage, setErrorMessage] = useState(null);
  const [viewportDims, setViewportDims] = useState({ width: 0, height: 0 });

  // Live Tracking State
  const [cameraOrientation, setCameraOrientation] = useState({ yaw: 0, pitch: 0, roll: 0, stability: 100 });
  const [coordinatorState, setCoordinatorState] = useState({
    isCapturing: false,
    isPaused: false,
    activeTarget: null,
    isAligned: false,
    dwellProgress: 0,
    capturedCount: 0,
    progress: { total: 0, captured: 0, percentage: 0, isComplete: false, rings: {} },
  });

  // Stitching State
  const [stitchProgress, setStitchProgress] = useState(0);
  const [stitchStatusText, setStitchStatusText] = useState('');
  const [stitchedPanorama, setStitchedPanorama] = useState(null);

  // Initialize camera, orientation, and session
  useEffect(() => {
    let isCancelled = false;

    async function initEngine() {
      try {
        setStage('initializing');

        const camera = new CameraAdapter();
        const orientation = new OrientationAdapter();
        const stitcher = new SphereStitcher();

        cameraAdapterRef.current = camera;
        orientationAdapterRef.current = orientation;
        stitcherRef.current = stitcher;

        // 1. Request orientation permission and start sensor stream
        await orientation.requestPermission();
        orientation.start();

        // 2. Start rear camera
        if (videoRef.current) {
          const optics = await camera.start(videoRef.current);
          stitcher.hfov = optics.hfov;
          stitcher.vfov = optics.vfov;
        }

        // 3. Plan spherical targets based on camera optics
        const plan = new SphereTargetPlan({ hfov: camera.hfov, vfov: camera.vfov });
        const selection = new TargetSelection();

        // 4. Create persistent session record
        const session = await sphereSessionRepository.createSession({
          propertyId,
          inspectionId,
          supervisorId,
          targetPlan: plan.targets,
        });

        if (isCancelled) return;

        // 5. Initialize capture coordinator
        const coordinator = new CaptureCoordinator({
          cameraAdapter: camera,
          orientationAdapter: orientation,
          targetPlan: plan,
          targetSelection: selection,
          sessionId: session.id,
          onStateChange: (newState) => {
            if (!isCancelled) {
              setCoordinatorState((prev) => ({ ...prev, ...newState }));
            }
          },
        });
        coordinatorRef.current = coordinator;

        // 6. Listen for orientation ticks to evaluate auto-capture
        const unsubscribeOrientation = orientation.subscribe((orient) => {
          if (!isCancelled) {
            setCameraOrientation(orient);
            coordinator.tick().catch((tickErr) => {
              console.error('Tick auto-capture error:', tickErr);
            });
          }
        });

        setStage('capturing');

        return () => {
          unsubscribeOrientation();
        };
      } catch (err) {
        console.error('Photo sphere initialization failed:', err);
        if (!isCancelled) {
          setErrorMessage(err.message || 'Camera or sensor initialization error');
          setStage('error');
        }
      }
    }

    initEngine();

    return () => {
      isCancelled = true;
      if (cameraAdapterRef.current) cameraAdapterRef.current.stop();
      if (orientationAdapterRef.current) orientationAdapterRef.current.stop();
    };
  }, [propertyId, inspectionId, supervisorId]);

  // Actions
  const handleManualCapture = useCallback(() => {
    if (coordinatorRef.current) {
      coordinatorRef.current.triggerCapture('manual').catch((err) => {
        alert('Capture error: ' + err.message);
      });
    }
  }, []);

  const handleUndo = useCallback(() => {
    if (coordinatorRef.current) {
      coordinatorRef.current.undoLastCapture();
    }
  }, []);

  const handleTogglePause = useCallback(() => {
    if (coordinatorRef.current) {
      if (coordinatorState.isPaused) {
        coordinatorRef.current.resume();
      } else {
        coordinatorRef.current.pause();
      }
    }
  }, [coordinatorState.isPaused]);

  const handleRestart = useCallback(() => {
    if (window.confirm('Restart session and discard current captures?')) {
      if (coordinatorRef.current) {
        coordinatorRef.current.restart();
      }
    }
  }, []);

  const handleFinish = useCallback(async () => {
    if (!coordinatorRef.current || !stitcherRef.current) return;
    try {
      setStage('stitching');
      const frames = coordinatorRef.current.capturedFrames;
      const result = await stitcherRef.current.stitch(frames, (pct, status) => {
        setStitchProgress(pct);
        setStitchStatusText(status);
      });

      // Save panorama record to IndexedDB
      await sphereSessionRepository.savePanorama({
        sessionId: coordinatorRef.current.sessionId,
        propertyId,
        inspectionId,
        panoramaBlobOrUri: result.dataUri,
        width: result.width,
        height: result.height,
        coveragePercent: result.coveragePercent,
        hasGPanoMetadata: result.hasGPano,
      });

      setStitchedPanorama(result);
      setStage('viewing');
    } catch (stitchErr) {
      console.error('Stitching failed:', stitchErr);
      alert('Stitching error: ' + stitchErr.message);
      setStage('capturing');
    }
  }, [propertyId, inspectionId]);

  // Save final result and exit to parent workflow
  const handleSaveAndReturn = useCallback(() => {
    if (onComplete && stitchedPanorama && coordinatorRef.current) {
      onComplete({
        sessionId: coordinatorRef.current.sessionId,
        panoramaDataUri: stitchedPanorama.dataUri,
        coveragePercent: stitchedPanorama.coveragePercent,
        hasGPano: stitchedPanorama.hasGPano,
        frameCount: coordinatorRef.current.capturedFrames.length,
      });
    }
  }, [onComplete, stitchedPanorama]);

  // ── Render Views ──

  if (stage === 'error') {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: '#0f172a',
          color: '#ffffff',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          textAlign: 'center',
          zIndex: 100,
        }}
      >
        <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '12px' }}>
          Unable to Start 360° Capture
        </div>
        <p style={{ color: 'rgba(255,255,255,0.7)', maxWidth: '340px', marginBottom: '24px' }}>
          {errorMessage || 'Camera access or device orientation sensor could not be started.'}
        </p>
        <button
          onClick={onCancel}
          style={{
            padding: '12px 24px',
            backgroundColor: '#3b82f6',
            border: 'none',
            borderRadius: '12px',
            color: '#ffffff',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Return to Inspection
        </button>
      </div>
    );
  }

  if (stage === 'stitching') {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: '#0a0d14',
          color: '#ffffff',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          zIndex: 100,
        }}
      >
        <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>
          Stitching 360° Photo Sphere
        </div>
        <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', marginBottom: '24px', textAlign: 'center' }}>
          {stitchStatusText || 'Projecting spherical frames...'}
        </div>

        {/* Progress bar */}
        <div
          style={{
            width: '260px',
            height: '8px',
            backgroundColor: 'rgba(255,255,255,0.15)',
            borderRadius: '4px',
            overflow: 'hidden',
            marginBottom: '12px',
          }}
        >
          <div
            style={{
              width: `${stitchProgress}%`,
              height: '100%',
              backgroundColor: '#10b981',
              transition: 'width 0.2s ease',
            }}
          />
        </div>
        <div style={{ fontSize: '12px', color: '#10b981', fontWeight: 600 }}>
          {stitchProgress}%
        </div>
      </div>
    );
  }

  if (stage === 'viewing' && stitchedPanorama) {
    return (
      <PanoramaViewer
        panoramaDataUri={stitchedPanorama.dataUri}
        coveragePercent={stitchedPanorama.coveragePercent}
        hasGPano={stitchedPanorama.hasGPano}
        onBack={() => setStage('capturing')}
        onSaveAndReturn={handleSaveAndReturn}
      />
    );
  }

  return (
    <CameraViewport
      videoRef={videoRef}
      onViewportMeasured={setViewportDims}
    >
      {/* 1. Progress & Guidance Header */}
      <CaptureProgress
        progress={coordinatorState.progress}
        currentOrientation={cameraOrientation}
        activeTarget={coordinatorState.activeTarget}
        isAligned={coordinatorState.isAligned}
        onClose={onCancel}
      />

      {/* 2. Fixed Center Reticle */}
      <CenterReticle
        isAligned={coordinatorState.isAligned}
        dwellProgress={coordinatorState.dwellProgress}
        isCapturing={coordinatorState.isCapturing}
        viewportWidth={viewportDims.width}
        viewportHeight={viewportDims.height}
      />

      {/* 3. Moving Targets & Offscreen Guide */}
      <TargetOverlay
        targets={coordinatorRef.current?.targetPlan?.targets || []}
        activeTarget={coordinatorState.activeTarget}
        cameraOrientation={cameraOrientation}
        hfov={cameraAdapterRef.current?.hfov || 65}
        vfov={cameraAdapterRef.current?.vfov || 50}
        viewportWidth={viewportDims.width}
        viewportHeight={viewportDims.height}
      />

      {/* 4. Shutter & Capture Controls */}
      <CaptureControls
        isCapturing={coordinatorState.isCapturing}
        isPaused={coordinatorState.isPaused}
        capturedCount={coordinatorState.capturedCount}
        isComplete={coordinatorState.progress.isComplete}
        onManualCapture={handleManualCapture}
        onUndo={handleUndo}
        onTogglePause={handleTogglePause}
        onRestart={handleRestart}
        onFinish={handleFinish}
      />
    </CameraViewport>
  );
}
