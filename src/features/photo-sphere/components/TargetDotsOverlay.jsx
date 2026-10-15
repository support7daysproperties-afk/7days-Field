import React from 'react';
import { Navigation } from 'lucide-react';

/**
 * TargetDotsOverlay.jsx
 *
 * Implements the authentic Google Camera Photo Sphere 3D target guidance:
 * - When standing in the 3D space, unlocked blue dots remain pinned in real physical world space.
 * - When turning the camera, dots slide across the screen like real floating marbles.
 * - Active / nearest target dot is highlighted with a gentle pulse ring.
 * - If no unlocked target is currently visible in the camera FOV, an edge guidance indicator
 *   points the user toward the nearest floating marble.
 *
 * @param {Array} targets Projected unlocked target objects [{ id, projected: { x, y, visible, isBehind, angularDistance, dYaw, dPitch } }]
 * @param {object} activeTarget The currently closest/active target
 * @param {number} viewportWidth Current viewport width (px)
 * @param {number} viewportHeight Current viewport height (px)
 */
export default function TargetDotsOverlay({
  targets = [],
  activeTarget = null,
  viewportWidth,
  viewportHeight,
}) {
  if (!targets || targets.length === 0) return null;

  // Filter visible targets that are in front of the camera lens (not culled)
  const visibleTargets = targets.filter((t) => t.projected && t.projected.visible && !t.projected.isBehind);

  // Render on-screen targets
  if (visibleTargets.length > 0) {
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
        {visibleTargets.map((target) => {
          const proj = target.projected;
          const isActive = activeTarget && activeTarget.id === target.id;
          const dist = proj.angularDistance;

          // Scale smoothly as the user brings it closer to center
          const baseSize = isActive ? 28 : 22;
          const scale = Math.max(0.75, Math.min(1.3, 1.4 - dist / 50));
          const finalSize = baseSize * scale;

          return (
            <div
              key={target.id}
              style={{
                position: 'absolute',
                left: `${proj.x}px`,
                top: `${proj.y}px`,
                width: `${finalSize}px`,
                height: `${finalSize}px`,
                transform: 'translate(-50%, -50%)',
                borderRadius: '50%',
                background: isActive
                  ? 'linear-gradient(135deg, #60a5fa, #2563eb)'
                  : 'linear-gradient(135deg, #93c5fd, #3b82f6)',
                border: '2px solid #ffffff',
                boxShadow: isActive
                  ? '0 0 16px rgba(59, 130, 246, 0.95), 0 0 6px rgba(255, 255, 255, 0.8)'
                  : '0 0 10px rgba(59, 130, 246, 0.7), 0 0 4px rgba(255, 255, 255, 0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'transform 0.04s linear',
              }}
            >
              {/* Solid white center core */}
              <div
                style={{
                  width: isActive ? '8px' : '6px',
                  height: isActive ? '8px' : '6px',
                  borderRadius: '50%',
                  backgroundColor: '#ffffff',
                }}
              />

              {/* Gentle pulse ripple on active target */}
              {isActive && (
                <div
                  style={{
                    position: 'absolute',
                    inset: '-8px',
                    borderRadius: '50%',
                    border: '2px solid rgba(96, 165, 250, 0.65)',
                    animation: 'target-pulse 1.4s infinite ease-out',
                  }}
                />
              )}
            </div>
          );
        })}

        <style>{`
          @keyframes target-pulse {
            0% { transform: scale(0.8); opacity: 0.9; }
            100% { transform: scale(1.6); opacity: 0; }
          }
        `}</style>
      </div>
    );
  }

  // If no unlocked targets are currently inside the screen FOV, render an edge guidance arrow
  // pointing towards the nearest active unlocked target
  const guideTarget = activeTarget || targets[0];
  if (!guideTarget || !guideTarget.projected) return null;

  const proj = guideTarget.projected;
  const angleRad = Math.atan2(-proj.dPitch, proj.dYaw);
  const angleDeg = (angleRad * 180) / Math.PI;

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
