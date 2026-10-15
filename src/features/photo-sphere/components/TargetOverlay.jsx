/**
 * TargetOverlay.jsx
 *
 * Renders moving spherical targets and off-screen directional indicators
 * across the camera preview.
 *
 * Requirements:
 * - Fixed center reticle stays stationary; targets move across screen as phone turns.
 * - Targets are projected using camera FOV and live (yaw, pitch, roll).
 * - Off-screen targets show perimeter chevrons/pointers with guiding direction.
 * - Completed targets display green checkmarks/solid fill.
 * - Active target pulses with distinct visual focus.
 */

import React from 'react';
import { projectTargetToViewport } from '../orientation/OrientationMath';
import { Check, ChevronRight } from 'lucide-react';

export default function TargetOverlay({
  targets = [],
  activeTarget = null,
  cameraOrientation = { yaw: 0, pitch: 0, roll: 0 },
  hfov = 65,
  vfov = 50,
  viewportWidth = 0,
  viewportHeight = 0,
}) {
  if (!viewportWidth || !viewportHeight || targets.length === 0) {
    return null;
  }

  // Project active target first to determine on/off screen status
  let activeProjection = null;
  if (activeTarget) {
    activeProjection = projectTargetToViewport({
      targetYaw: activeTarget.yaw,
      targetPitch: activeTarget.pitch,
      cameraYaw: cameraOrientation.yaw,
      cameraPitch: cameraOrientation.pitch,
      cameraRoll: cameraOrientation.roll,
      hfov,
      vfov,
      viewportWidth,
      viewportHeight,
    });
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        overflow: 'hidden',
        zIndex: 15,
      }}
      id="photo-sphere-target-overlay"
    >
      {/* 1. Render All On-Screen Targets */}
      {targets.map((target) => {
        const isActive = activeTarget && activeTarget.id === target.id;
        const isCaptured = target.status === 'captured';

        // Project target into viewport coordinates
        const proj = projectTargetToViewport({
          targetYaw: target.yaw,
          targetPitch: target.pitch,
          cameraYaw: cameraOrientation.yaw,
          cameraPitch: cameraOrientation.pitch,
          cameraRoll: cameraOrientation.roll,
          hfov,
          vfov,
          viewportWidth,
          viewportHeight,
        });

        // Only draw target markers that are currently on-screen
        if (!proj.isOnScreen) return null;

        const targetSize = isActive ? 44 : 32;

        return (
          <div
            key={target.id}
            style={{
              position: 'absolute',
              left: `${proj.x}px`,
              top: `${proj.y}px`,
              transform: 'translate(-50%, -50%)',
              width: `${targetSize}px`,
              height: `${targetSize}px`,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'transform 0.05s ease-out, border-color 0.2s',
              backgroundColor: isCaptured
                ? 'rgba(16, 185, 129, 0.85)'
                : isActive
                ? 'rgba(59, 130, 246, 0.4)'
                : 'rgba(255, 255, 255, 0.2)',
              border: isActive
                ? '2.5px solid #60a5fa'
                : isCaptured
                ? '2px solid #10b981'
                : '1.5px solid rgba(255, 255, 255, 0.7)',
              boxShadow: isActive
                ? '0 0 16px rgba(96, 165, 250, 0.9), 0 0 4px #ffffff'
                : isCaptured
                ? '0 0 8px rgba(16, 185, 129, 0.7)'
                : '0 0 4px rgba(0,0,0,0.5)',
            }}
          >
            {isCaptured ? (
              <Check size={18} color="#ffffff" strokeWidth={3} />
            ) : (
              <div
                style={{
                  width: isActive ? '12px' : '6px',
                  height: isActive ? '12px' : '6px',
                  borderRadius: '50%',
                  backgroundColor: isActive ? '#ffffff' : 'rgba(255, 255, 255, 0.9)',
                }}
              />
            )}
          </div>
        );
      })}

      {/* 2. Off-Screen Directional Indicator for Active Target */}
      {activeProjection && !activeProjection.isOnScreen && (
        <OffscreenGuide
          indicatorAngle={activeProjection.indicatorAngle}
          viewportWidth={viewportWidth}
          viewportHeight={viewportHeight}
          distanceDeg={activeProjection.distanceDeg}
        />
      )}
    </div>
  );
}

function OffscreenGuide({ indicatorAngle, viewportWidth, viewportHeight, distanceDeg }) {
  const margin = 36;
  const cx = viewportWidth / 2;
  const cy = viewportHeight / 2;

  // Position indicator along the inner boundary of the viewport
  const maxRx = cx - margin;
  const maxRy = cy - margin;

  const cos = Math.cos(indicatorAngle);
  const sin = Math.sin(indicatorAngle);

  // Intersection with rounded viewport ellipse/box
  const scale = 1 / Math.max(Math.abs(cos) / maxRx, Math.abs(sin) / maxRy);
  const indX = cx + cos * scale;
  const indY = cy + sin * scale;
  const deg = (indicatorAngle * 180) / Math.PI;

  return (
    <div
      style={{
        position: 'absolute',
        left: `${indX}px`,
        top: `${indY}px`,
        transform: `translate(-50%, -50%) rotate(${deg}deg)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '6px 10px',
        borderRadius: '20px',
        backgroundColor: 'rgba(59, 130, 246, 0.9)',
        boxShadow: '0 0 16px rgba(59, 130, 246, 0.8), 0 2px 8px rgba(0,0,0,0.6)',
        color: '#ffffff',
      }}
      id="photo-sphere-offscreen-guide"
    >
      <ChevronRight size={24} strokeWidth={3} />
    </div>
  );
}
