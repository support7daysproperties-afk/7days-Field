/**
 * CaptureProgress.jsx
 *
 * Real-time capture progress header and spherical coverage indicator.
 * Displays total count, percentage, current ring, and clear guidance tips.
 */

import React from 'react';
import { Compass, CheckCircle2, AlertCircle } from 'lucide-react';

export default function CaptureProgress({
  progress = { total: 0, captured: 0, percentage: 0, isComplete: false, rings: {} },
  currentOrientation = { yaw: 0, pitch: 0, roll: 0, stability: 100 },
  activeTarget = null,
  isAligned = false,
  onClose,
}) {
  const getGuidanceText = () => {
    if (progress.isComplete) {
      return 'Sphere complete! Tap Finish to stitch panorama.';
    }
    if (isAligned) {
      return 'Hold steady for auto-capture...';
    }
    if (activeTarget) {
      const ringText =
        activeTarget.ringLabel === 'equator'
          ? 'horizon'
          : activeTarget.ringLabel === 'upper'
          ? 'sky ring'
          : activeTarget.ringLabel === 'lower'
          ? 'ground ring'
          : activeTarget.ringLabel;
      return `Align circle with target (${ringText})`;
    }
    return 'Point camera to start capturing';
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        padding: '16px 20px',
        background: 'linear-gradient(to bottom, rgba(10, 13, 20, 0.9) 0%, rgba(10, 13, 20, 0.4) 75%, transparent 100%)',
        zIndex: 30,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
      id="photo-sphere-progress-bar"
    >
      {/* Top Bar: Title, Counts, Close */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              padding: '4px 10px',
              borderRadius: '12px',
              backgroundColor: 'rgba(255, 255, 255, 0.15)',
              backdropFilter: 'blur(8px)',
              fontSize: '13px',
              fontWeight: 700,
              color: '#ffffff',
            }}
          >
            {progress.captured} / {progress.total}
          </div>
          <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.8)', fontWeight: 500 }}>
            {progress.percentage}% Covered
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255, 255, 255, 0.8)',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
            padding: '4px 8px',
          }}
          id="photo-sphere-close-btn"
        >
          Cancel
        </button>
      </div>

      {/* Progress Track */}
      <div
        style={{
          width: '100%',
          height: '4px',
          backgroundColor: 'rgba(255, 255, 255, 0.2)',
          borderRadius: '2px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${progress.percentage}%`,
            height: '100%',
            backgroundColor: progress.isComplete ? '#10b981' : '#3b82f6',
            transition: 'width 0.3s ease',
          }}
        />
      </div>

      {/* Guidance Banner */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '6px 14px',
          borderRadius: '20px',
          backgroundColor: isAligned
            ? 'rgba(16, 185, 129, 0.9)'
            : 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(10px)',
          border: isAligned
            ? '1px solid #10b981'
            : '1px solid rgba(255, 255, 255, 0.15)',
          color: '#ffffff',
          fontSize: '13px',
          fontWeight: 600,
          textAlign: 'center',
          alignSelf: 'center',
          boxShadow: isAligned ? '0 0 12px rgba(16, 185, 129, 0.5)' : 'none',
          transition: 'all 0.2s ease',
        }}
      >
        {getGuidanceText()}
      </div>
    </div>
  );
}
