/**
 * CenterReticle.jsx
 *
 * Fixed center reticle rendered at the exact mathematical center of the
 * measured camera viewport.
 *
 * Visual states:
 * - Idle / Unaligned: Sleek, high-contrast white ring with center aiming dot.
 * - Approaching target: Warms toward green with visual pulsing.
 * - Aligned & Dwell Hold: Bright emerald green ring with continuous SVG dwell arc
 *   indicating progress toward automatic capture.
 */

import React from 'react';

export default function CenterReticle({
  isAligned = false,
  dwellProgress = 0,
  isCapturing = false,
  viewportWidth = 0,
  viewportHeight = 0,
}) {
  const size = 72; // Diameter in pixels
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - dwellProgress * circumference;

  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: `${size}px`,
        height: `${size}px`,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 20,
      }}
      id="photo-sphere-center-reticle"
    >
      <svg
        width={size}
        height={size}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          transform: 'rotate(-90deg)',
          transition: 'all 0.15s ease-out',
        }}
      >
        {/* Background track circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={isAligned ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255, 255, 255, 0.35)'}
          strokeWidth="3.5"
        />

        {/* Dynamic Dwell Arc */}
        {dwellProgress > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#10b981"
            strokeWidth="4"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.05s linear' }}
          />
        )}
      </svg>

      {/* Center Target Dot */}
      <div
        style={{
          width: isAligned ? '12px' : '8px',
          height: isAligned ? '12px' : '8px',
          borderRadius: '50%',
          backgroundColor: isCapturing
            ? '#3b82f6'
            : isAligned
            ? '#10b981'
            : '#ffffff',
          boxShadow: isAligned
            ? '0 0 12px #10b981, 0 0 20px #10b981'
            : '0 0 6px rgba(0,0,0,0.8)',
          transition: 'all 0.15s ease-in-out',
          transform: isCapturing ? 'scale(1.4)' : 'scale(1)',
        }}
      />

      {/* Crosshairs */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '4px',
          right: '4px',
          height: '1px',
          backgroundColor: isAligned ? 'rgba(16, 185, 129, 0.4)' : 'rgba(255, 255, 255, 0.25)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '4px',
          bottom: '4px',
          width: '1px',
          backgroundColor: isAligned ? 'rgba(16, 185, 129, 0.4)' : 'rgba(255, 255, 255, 0.25)',
        }}
      />
    </div>
  );
}
