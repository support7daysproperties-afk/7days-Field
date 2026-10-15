import React from 'react';

/**
 * AlignmentReticle.jsx
 *
 * Center alignment reticle replicating GCam's 4-quadrant alignment ring (gom.java).
 * Stays fixed at the center of the camera preview.
 * Animates inwards and glows green when aligned with a target dot.
 *
 * @param {boolean} isAligned When true, quadrants animate inwards with active indicator
 * @param {boolean} isTooFast When true, shows warning highlight
 * @param {number} progress Progress percentage 0..100 towards capture lock
 */
export default function AlignmentReticle({ isAligned, isTooFast, progress = 0 }) {
  // Reticle dimensions
  const size = 76;
  const quadrantGap = isAligned ? 2 : 7;
  const strokeColor = isTooFast ? '#ef4444' : isAligned ? '#22c55e' : '#ffffff';

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
    >
      {/* Progress ring if holding steady */}
      {progress > 0 && (
        <svg
          style={{
            position: 'absolute',
            width: `${size + 14}px`,
            height: `${size + 14}px`,
            transform: 'rotate(-90deg)',
          }}
        >
          <circle
            cx={(size + 14) / 2}
            cy={(size + 14) / 2}
            r={size / 2 + 3}
            fill="none"
            stroke="#22c55e"
            strokeWidth="3"
            strokeDasharray={Math.PI * (size + 6)}
            strokeDashoffset={(Math.PI * (size + 6)) * (1 - progress / 100)}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.05s linear' }}
          />
        </svg>
      )}

      {/* 4 Quadrants SVG */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        style={{
          transition: 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
          transform: isAligned ? 'scale(0.92)' : 'scale(1)',
          filter: isAligned ? 'drop-shadow(0 0 6px rgba(34, 197, 94, 0.8))' : 'drop-shadow(0 0 3px rgba(0,0,0,0.6))',
        }}
      >
        {/* Top-Right Quadrant */}
        <path
          d={`M ${50 + quadrantGap} 10 A 40 40 0 0 1 90 ${50 - quadrantGap}`}
          fill="none"
          stroke={strokeColor}
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        {/* Bottom-Right Quadrant */}
        <path
          d={`M 90 ${50 + quadrantGap} A 40 40 0 0 1 ${50 + quadrantGap} 90`}
          fill="none"
          stroke={strokeColor}
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        {/* Bottom-Left Quadrant */}
        <path
          d={`M ${50 - quadrantGap} 90 A 40 40 0 0 1 10 ${50 + quadrantGap}`}
          fill="none"
          stroke={strokeColor}
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        {/* Top-Left Quadrant */}
        <path
          d={`M 10 ${50 - quadrantGap} A 40 40 0 0 1 ${50 - quadrantGap} 10`}
          fill="none"
          stroke={strokeColor}
          strokeWidth="3.5"
          strokeLinecap="round"
        />

        {/* Center crosshair dot */}
        <circle
          cx="50"
          cy="50"
          r="2.5"
          fill={strokeColor}
          style={{ transition: 'fill 0.2s' }}
        />
      </svg>
    </div>
  );
}
