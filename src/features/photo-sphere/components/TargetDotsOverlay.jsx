import React from 'react';

/**
 * TargetDotsOverlay.jsx
 *
 * Renders the spherical blue target dots over the camera viewfinder.
 * Each dot moves in real-time according to actual device orientation
 * (relative yaw and pitch) using perspective projection math.
 *
 * Highlights the active next target with an expanding pulse animation.
 */
export default function TargetDotsOverlay({ targets, activeTargetId }) {
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
      {targets.map((t) => {
        if (!t.projected || !t.projected.visible) return null;

        const isActive = t.id === activeTargetId;
        const isCaptured = t.status === 'captured';
        const dist = t.projected.angularDistance;

        // Size scales subtly with proximity (closer dots appear slightly larger)
        const baseSize = isActive ? 28 : 22;
        const scale = Math.max(0.7, Math.min(1.3, 1.4 - dist / 50));
        const finalSize = baseSize * scale;

        // Color: Google Camera signature blue dot (#2563eb or #38bdf8), green if captured
        const dotBg = isCaptured
          ? 'linear-gradient(135deg, #10b981, #059669)'
          : isActive
          ? 'linear-gradient(135deg, #60a5fa, #2563eb)'
          : 'rgba(59, 130, 246, 0.7)';

        const dotBorder = isCaptured
          ? '2px solid #34d399'
          : isActive
          ? '2px solid #ffffff'
          : '1.5px solid rgba(255, 255, 255, 0.7)';

        return (
          <div
            key={t.id}
            style={{
              position: 'absolute',
              left: `${t.projected.x}px`,
              top: `${t.projected.y}px`,
              width: `${finalSize}px`,
              height: `${finalSize}px`,
              transform: 'translate(-50%, -50%)',
              borderRadius: '50%',
              background: dotBg,
              border: dotBorder,
              boxShadow: isActive
                ? '0 0 16px rgba(59, 130, 246, 0.9), 0 0 6px rgba(255, 255, 255, 0.8)'
                : '0 2px 6px rgba(0, 0, 0, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'transform 0.05s linear',
            }}
          >
            {/* Center core */}
            <div
              style={{
                width: isActive ? '8px' : '6px',
                height: isActive ? '8px' : '6px',
                borderRadius: '50%',
                backgroundColor: '#ffffff',
              }}
            />

            {/* Ripple pulse animation for active target */}
            {isActive && (
              <div
                style={{
                  position: 'absolute',
                  inset: '-8px',
                  borderRadius: '50%',
                  border: '2px solid rgba(96, 165, 250, 0.6)',
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
