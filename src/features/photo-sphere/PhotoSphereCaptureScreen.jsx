/**
 * PhotoSphereCaptureScreen.jsx
 *
 * Full-screen guided 360° Photo Sphere capture experience matching the reference video:
 * - Live camera viewfinder
 * - Center aiming reticle
 * - Physics-driven blue target dot
 * - Automatic shutter capture on alignment & steady hold
 * - Captured frame counter & progress
 * - Dynamic directional guide arrows
 * - Automatic progression until full sphere or user finishes
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import CameraStream from './camera/CameraStream';
import TargetOverlay from './components/TargetOverlay';
import { OrientationTracker } from './orientation/OrientationTracker';
import { SphereTargetPlan } from './targets/SphereTargetPlan';
import { TargetSelection } from './targets/TargetSelection';
import { AlignmentGate } from './camera/AlignmentGate';
import { SphereStitcher } from './stitching/SphereStitcher';
import PanoramaViewer from './viewer/PanoramaViewer';
import { Check, X, Undo, RefreshCw, Layers } from 'lucide-react';

export default function PhotoSphereCaptureScreen({ onFinish, onCancel }) {
  const cameraRef = useRef(null);
  const alignmentGateRef = useRef(new AlignmentGate());
  const trackerRef = useRef(null);

  const [orientation, setOrientation] = useState({
    yawDegrees: 0,
    pitchDegrees: 0,
    rollDegrees: 0,
    hasFix: false,
    cameraBasis: {
      right: { x: 1, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      forward: { x: 0, y: 0, z: 1 }
    }
  });

  const [scope, setScope] = useState('sphere'); // 'ring' or 'sphere'
  const [plan, setPlan] = useState(() => SphereTargetPlan.createPlan('sphere'));
  const [activeIndex, setActiveIndex] = useState(0);
  const [capturedFrames, setCapturedFrames] = useState([]);
  const [capturedSet, setCapturedSet] = useState(new Set());
  const [gateState, setGateState] = useState({ isAligned: false, progress: 0 });
  const [isCapturing, setIsCapturing] = useState(false);
  const [isStitching, setIsStitching] = useState(false);
  const [panoramaUrl, setPanoramaUrl] = useState(null);

  // Initialize Orientation Tracker
  useEffect(() => {
    const tracker = new OrientationTracker((data) => {
      setOrientation(data);
    });
    trackerRef.current = tracker;
    tracker.start();

    return () => {
      tracker.stop();
    };
  }, []);

  // Update target plan when scope changes
  useEffect(() => {
    const newPlan = SphereTargetPlan.createPlan(scope);
    setPlan(newPlan);
    setActiveIndex(0);
    setCapturedFrames([]);
    setCapturedSet(new Set());
  }, [scope]);

  // Audio shutter sound generator using Web Audio API
  const playShutterSound = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.08);

      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } catch (e) {
      // Audio autoplay policy
    }
  }, []);

  // Frame Capture Function
  const handleCapture = useCallback(() => {
    if (!cameraRef.current || isCapturing) return;

    setIsCapturing(true);
    playShutterSound();

    // Haptic feedback on mobile if supported
    if (navigator.vibrate) {
      navigator.vibrate(40);
    }

    setTimeout(() => {
      const dataUrl = cameraRef.current.captureFrame();

      if (dataUrl) {
        const frameData = {
          id: activeIndex,
          dataUrl,
          yawDegrees: orientation.yawDegrees,
          pitchDegrees: orientation.pitchDegrees,
          rollDegrees: orientation.rollDegrees,
          timestamp: Date.now()
        };

        setCapturedFrames((prev) => [...prev, frameData]);
        setCapturedSet((prev) => {
          const nextSet = new Set(prev);
          nextSet.add(activeIndex);

          // Find next target automatically
          const nextIdx = SphereTargetPlan.getNextTargetIndex(plan, activeIndex, nextSet);
          if (nextIdx !== -1) {
            setActiveIndex(nextIdx);
          }
          return nextSet;
        });

        alignmentGateRef.current.reset();
      }

      setIsCapturing(false);
    }, 120);
  }, [activeIndex, orientation, isCapturing, plan, playShutterSound]);

  // Main Alignment & Auto-Capture Loop (Display Rate)
  useEffect(() => {
    if (isCapturing || isStitching || panoramaUrl) return;

    // Check free-form target claim (if user aims close to another uncaptured target)
    const newActive = TargetSelection.selectActiveTarget(plan, orientation, activeIndex, capturedSet);
    if (newActive !== activeIndex) {
      setActiveIndex(newActive);
      alignmentGateRef.current.reset();
    }

    // Evaluate Alignment Gate
    const activeTarget = plan.targets[activeIndex];
    if (activeTarget && !capturedSet.has(activeIndex)) {
      // Calculate angular distance to active target
      const targetDir = {
        x: Math.sin(activeTarget.yawDegrees * Math.PI / 180) * Math.cos(-activeTarget.pitchDegrees * Math.PI / 180),
        y: Math.cos(activeTarget.yawDegrees * Math.PI / 180) * Math.cos(-activeTarget.pitchDegrees * Math.PI / 180),
        z: Math.sin(-activeTarget.pitchDegrees * Math.PI / 180)
      };

      const forward = orientation.cameraBasis.forward;
      const dot = Math.min(Math.max(targetDir.x * forward.x + targetDir.y * forward.y + targetDir.z * forward.z, -1), 1);
      const angleDeg = Math.acos(dot) * (180 / Math.PI);

      const gate = alignmentGateRef.current.update(angleDeg);
      setGateState(gate);

      if (gate.shouldCapture) {
        handleCapture();
      }
    }
  }, [orientation, activeIndex, plan, capturedSet, isCapturing, isStitching, panoramaUrl, handleCapture]);

  // Trigger Panorama Stitching
  const handleStitchPanorama = async () => {
    if (capturedFrames.length === 0) return;
    setIsStitching(true);

    try {
      const url = await SphereStitcher.stitchFrames(capturedFrames);
      setPanoramaUrl(url);
    } catch (err) {
      console.error("Stitching error:", err);
      alert("Stitching failed: " + err.message);
    } finally {
      setIsStitching(false);
    }
  };

  // Undo Last Capture
  const handleUndo = () => {
    if (capturedFrames.length === 0) return;
    const last = capturedFrames[capturedFrames.length - 1];
    setCapturedFrames(prev => prev.slice(0, -1));
    setCapturedSet(prev => {
      const next = new Set(prev);
      next.delete(last.id);
      return next;
    });
    setActiveIndex(last.id);
    alignmentGateRef.current.reset();
  };

  // If final panorama is ready, show interactive 360 viewer
  if (panoramaUrl) {
    return (
      <PanoramaViewer
        panoramaUrl={panoramaUrl}
        onDone={() => {
          if (onFinish) onFinish({ panoramaUrl, frames: capturedFrames });
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col select-none touch-none overflow-hidden font-sans">
      {/* 1. Live Camera Stream */}
      <CameraStream ref={cameraRef} />

      {/* 2. Target HUD Overlay */}
      <TargetOverlay
        orientation={orientation}
        plan={plan}
        activeIndex={activeIndex}
        capturedSet={capturedSet}
        alignmentGateState={gateState}
        isCapturing={isCapturing}
      />

      {/* 3. Top Status Bar & Controls */}
      <div className="absolute top-0 inset-x-0 p-4 flex items-center justify-between z-30 bg-gradient-to-b from-black/80 via-black/30 to-transparent">
        <button
          onClick={onCancel}
          className="w-10 h-10 rounded-full bg-black/50 backdrop-blur-md text-white/90 border border-white/10 flex items-center justify-center hover:bg-black/70 transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Instruction Banner matching Reference Video */}
        <div className="text-center">
          <div className="text-white font-medium text-sm drop-shadow-md tracking-wide">
            {capturedFrames.length === 0
              ? "To start, keep dot inside circle"
              : "Point camera to align blue dot"}
          </div>
          <div className="text-blue-400 text-xs mt-0.5 font-semibold">
            {capturedFrames.length} / {plan.totalCount} Captured
          </div>
        </div>

        {/* Scope Selector (Horizon Ring vs Full Sphere) */}
        <button
          onClick={() => setScope(s => s === 'sphere' ? 'ring' : 'sphere')}
          className="px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-md text-white/90 border border-white/10 text-xs font-medium flex items-center gap-1.5 hover:bg-black/70 transition"
        >
          <Layers className="w-3.5 h-3.5 text-blue-400" />
          <span>{scope === 'sphere' ? 'Full 360°' : 'Horizon Ring'}</span>
        </button>
      </div>

      {/* Stitching Loading Modal */}
      {isStitching && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-md z-40 flex flex-col items-center justify-center text-white">
          <RefreshCw className="w-10 h-10 text-blue-500 animate-spin mb-4" />
          <h3 className="text-lg font-semibold tracking-wide">Stitching 360° Photo Sphere</h3>
          <p className="text-xs text-white/60 mt-1">Blending captured frames into equirectangular panorama...</p>
        </div>
      )}

      {/* 4. Bottom Action Bar */}
      <div className="absolute bottom-0 inset-x-0 p-6 flex items-center justify-between z-30 bg-gradient-to-t from-black/80 via-black/30 to-transparent">
        {/* Undo Button */}
        <button
          onClick={handleUndo}
          disabled={capturedFrames.length === 0}
          className="w-12 h-12 rounded-full bg-black/50 backdrop-blur-md text-white border border-white/10 flex items-center justify-center disabled:opacity-30 hover:bg-black/70 transition"
        >
          <Undo className="w-5 h-5" />
        </button>

        {/* Manual capture trigger fallback if user wants to snap instantly */}
        <button
          onClick={handleCapture}
          className="w-16 h-16 rounded-full border-4 border-white/80 bg-white/20 backdrop-blur-md flex items-center justify-center active:scale-95 transition shadow-lg"
        >
          <div className="w-12 h-12 rounded-full bg-white/90" />
        </button>

        {/* Finish / Stitch Button */}
        <button
          onClick={handleStitchPanorama}
          disabled={capturedFrames.length === 0}
          className="w-12 h-12 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center disabled:opacity-30 shadow-lg shadow-blue-600/30 transition"
        >
          <Check className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
}
