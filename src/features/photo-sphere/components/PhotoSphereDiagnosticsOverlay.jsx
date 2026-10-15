import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Terminal } from 'lucide-react';

/**
 * PhotoSphereDiagnosticsOverlay.jsx
 *
 * Development/diagnostic HUD for live verification on mobile devices.
 * Displays raw sensors, coordinate transforms, camera space vectors,
 * alignment error, and capture decision reasons in real time.
 */
export default function PhotoSphereDiagnosticsOverlay({
  orientation,
  activeTarget,
  unlockedCount,
  totalTargets,
  capturedCount,
  viewportSize,
  alignmentProgress,
  captureDecision,
  isCameraReady,
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  // If not enabled or in production, render nothing unless diagnostic query param or dev mode
  const isDevOrDiagnostic =
    import.meta.env.DEV ||
    (typeof window !== 'undefined' && window.location.search.includes('diag=true'));

  if (!isDevOrDiagnostic) return null;

  const raw = orientation.rawSensor || {};
  const proj = activeTarget ? activeTarget.projected : null;
  const camVec = proj ? proj.cameraSpaceVector : [0, 0, 0];

  return (
    <div
      style={{
        position: 'absolute',
        top: '64px',
        left: '8px',
        zIndex: 50,
        backgroundColor: 'rgba(15, 23, 42, 0.88)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(59, 130, 246, 0.4)',
        borderRadius: '8px',
        color: '#f8fafc',
        fontFamily: 'monospace',
        fontSize: '11px',
        maxWidth: isExpanded ? '320px' : '180px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
        pointerEvents: 'auto',
      }}
    >
      {/* Header bar */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          cursor: 'pointer',
          backgroundColor: 'rgba(30, 41, 59, 0.9)',
          borderTopLeftRadius: '7px',
          borderTopRightRadius: '7px',
          borderBottom: isExpanded ? '1px solid rgba(59, 130, 246, 0.3)' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Terminal size={13} color="#60a5fa" />
          <span style={{ fontWeight: 'bold', color: '#60a5fa' }}>DIAGNOSTICS</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ color: orientation.isMovingTooFast ? '#ef4444' : '#10b981', fontWeight: 'bold' }}>
            {orientation.isMovingTooFast ? 'FAST' : 'STEADY'}
          </span>
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </div>

      {/* Compact View */}
      {!isExpanded && (
        <div style={{ padding: '6px 10px', lineHeight: '1.4' }}>
          <div>Yaw: {orientation.yaw}° (P: {orientation.pitch}°)</div>
          <div>Err: {proj ? `${Math.round(proj.angularDistance * 10) / 10}°` : 'N/A'}</div>
          <div>Prog: {alignmentProgress}%</div>
        </div>
      )}

      {/* Expanded View */}
      {isExpanded && (
        <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '380px', overflowY: 'auto' }}>
          {/* Raw Sensors */}
          <div>
            <div style={{ color: '#93c5fd', fontWeight: 'bold' }}>1. Raw Sensors (DeviceOrientation)</div>
            <div>alpha (yaw): {raw.alpha ?? 'N/A'}°</div>
            <div>beta (pitch): {raw.beta ?? 'N/A'}°</div>
            <div>gamma (roll): {raw.gamma ?? 'N/A'}°</div>
            <div>screen angle: {orientation.screenOrientationAngle ?? 0}°</div>
          </div>

          {/* Calibrated Frame */}
          <div>
            <div style={{ color: '#93c5fd', fontWeight: 'bold' }}>2. Calibrated Frame (Bore Sight)</div>
            <div>relYaw: {orientation.yaw}° (rawYaw: {orientation.rawYaw}°)</div>
            <div>relPitch: {orientation.pitch}° (rawPitch: {orientation.rawPitch}°)</div>
            <div>angVel: {orientation.angularVelocity}°/s</div>
            <div>movingTooFast: {orientation.isMovingTooFast ? 'TRUE' : 'FALSE'}</div>
          </div>

          {/* Active Target & Projection */}
          <div>
            <div style={{ color: '#93c5fd', fontWeight: 'bold' }}>3. Target & Projection</div>
            <div>Target ID: {activeTarget ? activeTarget.id : 'None'} ({unlockedCount} unlocked)</div>
            <div>World (Y, P): {activeTarget ? `${activeTarget.yaw}°, ${activeTarget.pitch}°` : 'N/A'}</div>
            <div>Cam Vector: [{camVec.join(', ')}]</div>
            <div>isBehind: {proj ? (proj.isBehind ? 'YES' : 'NO') : 'N/A'}</div>
            <div>Screen (x, y): {proj ? `${Math.round(proj.x)}, ${Math.round(proj.y)}` : 'N/A'}</div>
            <div>Viewport: {viewportSize.width} x {viewportSize.height}</div>
            <div>Angular Error: {proj ? `${Math.round(proj.angularDistance * 10) / 10}°` : 'N/A'}</div>
          </div>

          {/* Gating & Decision */}
          <div>
            <div style={{ color: '#93c5fd', fontWeight: 'bold' }}>4. Capture Decision Gating</div>
            <div>Camera Ready: {isCameraReady ? 'YES' : 'NO'}</div>
            <div>Aligned (≤3°): {proj && proj.angularDistance <= 3.0 ? 'YES' : 'NO'}</div>
            <div>Stability Hold: {alignmentProgress}% (280ms)</div>
            <div style={{ color: captureDecision.accepted ? '#10b981' : '#f59e0b', fontWeight: 'bold' }}>
              Decision: {captureDecision.reason}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
