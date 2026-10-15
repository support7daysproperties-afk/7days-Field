/**
 * CaptureControls.jsx
 *
 * Shutter button, Undo, Pause/Resume, Restart, and Finish controls.
 *
 * Requirements:
 * - Shutter button is always visible without scrolling.
 * - Prevents duplicate captures while in-flight.
 * - Clear touch targets suitable for outdoor handheld mobile use.
 */

import React from 'react';
import { Camera, RotateCcw, Play, Pause, RefreshCw, Check } from 'lucide-react';

export default function CaptureControls({
  isCapturing = false,
  isPaused = false,
  capturedCount = 0,
  isComplete = false,
  onManualCapture,
  onUndo,
  onTogglePause,
  onRestart,
  onFinish,
}) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '20px 24px 32px 24px',
        background: 'linear-gradient(to top, rgba(10, 13, 20, 0.95) 0%, rgba(10, 13, 20, 0.6) 70%, transparent 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        zIndex: 30,
        gap: '16px',
      }}
      id="photo-sphere-capture-controls"
    >
      {/* Bottom Action Bar */}
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {/* Undo Button */}
        <button
          type="button"
          onClick={onUndo}
          disabled={capturedCount === 0 || isCapturing}
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            backgroundColor: 'rgba(255, 255, 255, 0.15)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: capturedCount > 0 ? '#ffffff' : 'rgba(255, 255, 255, 0.4)',
            cursor: capturedCount > 0 ? 'pointer' : 'not-allowed',
            transition: 'all 0.15s ease',
          }}
          title="Undo last photo"
          id="photo-sphere-undo-btn"
        >
          <RotateCcw size={20} />
        </button>

        {/* Shutter Button */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={onManualCapture}
            disabled={isCapturing}
            style={{
              width: '76px',
              height: '76px',
              borderRadius: '50%',
              backgroundColor: isCapturing ? '#2563eb' : '#ffffff',
              border: '4px solid rgba(255, 255, 255, 0.4)',
              boxShadow: isCapturing
                ? '0 0 24px rgba(37, 99, 235, 0.8)'
                : '0 0 16px rgba(0, 0, 0, 0.6), 0 0 30px rgba(255, 255, 255, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: isCapturing ? 'wait' : 'pointer',
              transition: 'transform 0.1s ease, background-color 0.2s',
              transform: isCapturing ? 'scale(0.92)' : 'scale(1)',
            }}
            title="Capture Photo"
            id="photo-sphere-shutter-btn"
          >
            <Camera size={34} color={isCapturing ? '#ffffff' : '#0f172a'} strokeWidth={2.2} />
          </button>
        </div>

        {/* Finish / Stitch Button or Pause Toggle */}
        {capturedCount >= 3 ? (
          <button
            type="button"
            onClick={onFinish}
            disabled={isCapturing}
            style={{
              height: '48px',
              padding: '0 16px',
              borderRadius: '24px',
              backgroundColor: isComplete ? '#10b981' : '#3b82f6',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              color: '#ffffff',
              fontWeight: 600,
              fontSize: '14px',
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
            }}
            id="photo-sphere-finish-btn"
          >
            <Check size={18} strokeWidth={2.5} />
            <span>Finish</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onTogglePause}
            disabled={isCapturing}
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              backgroundColor: 'rgba(255, 255, 255, 0.15)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255, 255, 255, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              cursor: 'pointer',
            }}
            title={isPaused ? 'Resume' : 'Pause'}
            id="photo-sphere-pause-btn"
          >
            {isPaused ? <Play size={20} /> : <Pause size={20} />}
          </button>
        )}
      </div>
    </div>
  );
}
