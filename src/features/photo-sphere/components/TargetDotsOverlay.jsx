import React from 'react';
import { Navigation } from 'lucide-react';

/**
 * TargetDotsOverlay.jsx
 *
 * Implements the Google Camera Photo Sphere single-target guidance behavior.
 * - Displays ONLY the single active target dot (the next capture direction).
 * - No scattered grid of dots.
 * - No competing green dots.
 * - When the active target is off-screen, displays a sleek peripheral guidance arrow
 *   indicating the direction the user needs to turn/tilt the phone.
 *
 * @param {object} activeTarget The projected active target object { id, projected: { x, y, visible, angularDistance, dYaw, dPitch } }
 * @param {number} viewportWidth Current viewport width (px)
 * @param {number} viewportHeight Current viewport height (px)
 */
export default function TargetDotsOverlay({ activeTarget, viewportWidth, viewportHeight }) {
  if (!activeTarget || !activeTarget.projected) return null;

  const proj = activeTarget.projected;
  const isVisible = proj.visible;
  const dist = proj.angularDistance;

  // 1. If active target is within the camera field of view, render the single signature GCam blue target dot
  if (isVisible) {
    // Dynamic scale: scales smoothly as the user brings it closer to center
    const baseSize = 28;
    const scale = Math.max(0.75, Math.min(1.3, 1.4 - dist / 50));
    const finalSize = baseSize * scale;

    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          overflow: 'hidden',
          zIndex: 15,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: `${proj.x}px`,
            top: `${proj.y}px`,
            width: `${finalSize}px`,
            height: `${finalSize}px`,
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #60a5fa, #2563eb)',
            border: '2px solid #ffffff',
            boxShadow: '0 0 16px rgba(59, 130, 246, 0.9), 0 0 6px rgba(255, 255, 255, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 0.04s linear',
          }}
        >
          {/* Solid white center core */}
          <div
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: '#ffffff',
            }}
          />

          {/* Gentle pulse ripple */}
          <div
            style={{
              position: 'absolute',
              inset: '-8px',
              borderRadius: '50%',
              border: '2px solid rgba(96, 165, 250, 0.6)',
              animation: 'target-pulse 1.4s infinite ease-out',
            }}
          />
        </div>

        <style>{`
          @keyframes target-pulse {
            0% { transform: scale(0.8); opacity: 0.9; }
            100% { transform: scale(1.6); opacity: 0; }
          }
        `}</style>
      </div>
    );
  }

  // 2. If the active target is off-screen, calculate the angle toward the target
  // and render a subtle edge indicator pointing in that direction.
  // dYaw: positive means target is to the right.
  // dPitch: positive means target is up.
  const angleRad = Math.atan2(-proj.dPitch, proj.dYaw);
  const angleDeg = (angleRad * 180) / Math.PI;

  // Clamp indicator to viewport border
  const margin = 48;
  const centerX = viewportWidth / 2;
  const centerY = viewportHeight / 2;
  const maxRadiusX = centerX - margin;
  const maxRadiusY = centerY - margin;

  const edgeX = centerX + Math.cos(angleRad) * maxRadiusX;
  const edgeY = centerY + Math.sin(angleRad) * maxRadiusY;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 15,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: `${edgeX}px`,
          top: `${edgeY}px`,
          transform: `translate(-50%, -50%) rotate(${angleDeg}deg)`,
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          backgroundColor: 'rgba(37, 99, 235, 0.85)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 0 12px rgba(59, 130, 246, 0.8)',
          border: '1.5px solid rgba(255, 255, 255, 0.9)',
          animation: 'edge-pulse 1.2s infinite ease-in-out',
        }}
      >
        <Navigation size={18} color="#ffffff" style={{ transform: 'rotate(90deg)' }} />
      </div>

      <style>{`
        @keyframes edge-pulse {
          0%, 100% { transform: translate(-50%, -50%) rotate(${angleDeg}deg) scale(0.95); opacity: 0.85; }
          50% { transform: translate(-50%, -50%) rotate(${angleDeg}deg) scale(1.1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
