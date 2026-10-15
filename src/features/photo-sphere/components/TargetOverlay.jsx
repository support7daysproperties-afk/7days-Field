/**
 * TargetOverlay.jsx
 *
 * Implements the EXACT HUD and visual elements shown in the reference video:
 * - High-performance 60fps requestAnimationFrame continuous render loop
 * - Handles device pixel ratio and dynamic resizing so it NEVER draws blank
 * - Fixed Center Aiming Circle with rectangular viewfinder framing bracket
 * - Vivid Blue Target Dot with pulsing glow and specular highlight
 * - Dynamic off-screen chevron arrows guiding the user to rotate towards target
 * - Dwell progress arc around center reticle when aligned
 * - Stitched frame preview wireframe patches
 */

import React, { useRef, useEffect } from 'react';
import { SphereProjection } from '../orientation/SphereProjection.js';

export default function TargetOverlay({
  orientationRef, // Pass as ref or object for zero-overhead 60fps reads
  plan,
  activeIndex,
  capturedSet,
  alignmentGateState,
  isCapturing,
  capturedFrames = []
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let animId;

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = window.innerWidth;
      const height = window.innerHeight;

      // Always ensure canvas resolution matches physical screen pixels
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const centerX = width / 2;
      const centerY = height / 2;
      const focalPx = SphereProjection.focalLengthPx(width, height, 65, 80);

      // Read current orientation
      const currentOrientation = orientationRef?.current || {
        cameraBasis: {
          right: { x: 1, y: 0, z: 0 },
          up: { x: 0, y: 1, z: 0 },
          forward: { x: 0, y: 0, z: 1 }
        }
      };
      const cameraBasis = currentOrientation.cameraBasis;

      // ── 1. DRAW FIXED RECTANGULAR VIEWFINDER BRACKET & CENTER RETICLE (FROM VIDEO) ──
      // In the reference video: A white rectangular guide frame centered on screen
      const boxW = Math.min(width * 0.46, 220);
      const boxH = Math.min(height * 0.32, 280);

      ctx.save();
      ctx.beginPath();
      ctx.rect(centerX - boxW / 2, centerY - boxH / 2, boxW, boxH);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
      ctx.shadowBlur = 4;
      ctx.stroke();

      // Fixed Center Aiming Circle
      const reticleRadius = 36;
      const isAligned = alignmentGateState?.isAligned;
      const progress = alignmentGateState?.progress || 0;

      ctx.beginPath();
      ctx.arc(centerX, centerY, reticleRadius, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = isAligned ? 'rgba(59, 130, 246, 0.95)' : 'rgba(255, 255, 255, 0.8)';
      ctx.stroke();

      // Dwell Progress Arc (fills around circle as phone is held steady)
      if (progress > 0) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, reticleRadius + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#2563EB'; // Royal Blue
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // Center crosshair dot
      ctx.beginPath();
      ctx.arc(centerX, centerY, 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fill();
      ctx.restore();

      // ── 2. DRAW CAPTURED PATCHES AS 3D WIREFRAME SQUARES (FROM VIDEO) ──
      if (capturedFrames.length > 0) {
        ctx.save();
        capturedFrames.forEach(frame => {
          const proj = SphereProjection.projectTargetToScreen(
            { yawDegrees: frame.yawDegrees, pitchDegrees: frame.pitchDegrees },
            cameraBasis,
            width,
            height,
            focalPx
          );

          if (proj.isInFront && !proj.isOffScreen) {
            ctx.beginPath();
            ctx.rect(proj.screenX - 25, proj.screenY - 32, 50, 64);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.fillStyle = 'rgba(37, 99, 235, 0.15)';
            ctx.fill();
            ctx.stroke();
          }
        });
        ctx.restore();
      }

      // ── 3. DRAW BLUE TARGET DOT & GUIDANCE (CORE VIDEO FEATURE) ──
      if (plan && plan.targets) {
        const activeTarget = plan.targets[activeIndex];

        // Draw uncaptured target dots faintly
        plan.targets.forEach((target, index) => {
          if (capturedSet.has(index) || index === activeIndex) return;

          const proj = SphereProjection.projectTargetToScreen(target, cameraBasis, width, height, focalPx);
          if (proj.isInFront && !proj.isOffScreen) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(proj.screenX, proj.screenY, 12, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.lineWidth = 1.5;
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }
        });

        // Draw Active Solid Blue Target Dot
        if (activeTarget && !capturedSet.has(activeIndex)) {
          const activeProj = SphereProjection.projectTargetToScreen(activeTarget, cameraBasis, width, height, focalPx);

          if (activeProj.isInFront && !activeProj.isOffScreen) {
            // Inside Viewport: Solid Blue Dot with Glow
            const dotRadius = isAligned ? 30 : 25;

            ctx.save();
            ctx.shadowColor = '#3B82F6';
            ctx.shadowBlur = 18;

            // Outer ring
            ctx.beginPath();
            ctx.arc(activeProj.screenX, activeProj.screenY, dotRadius + 6, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(59, 130, 246, 0.7)';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Main Blue Dot (Matches reference video)
            ctx.beginPath();
            ctx.arc(activeProj.screenX, activeProj.screenY, dotRadius, 0, Math.PI * 2);
            ctx.fillStyle = '#2563EB'; // Vibrant Royal Blue
            ctx.fill();

            // Inner specular white dot
            ctx.beginPath();
            ctx.arc(activeProj.screenX, activeProj.screenY, 8, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
            ctx.fill();

            ctx.restore();
          } else {
            // Outside Viewport: Directional chevron guide arrow pointing toward target
            ctx.save();
            const angle = activeProj.angleRad;
            const arrowRadius = Math.min(centerX, centerY) * 0.78;
            const arrowX = centerX + Math.cos(angle) * arrowRadius;
            const arrowY = centerY + Math.sin(angle) * arrowRadius;

            ctx.translate(arrowX, arrowY);
            ctx.rotate(angle);

            // Glowing chevron arrow
            ctx.shadowColor = '#2563EB';
            ctx.shadowBlur = 12;

            ctx.beginPath();
            ctx.moveTo(-18, -14);
            ctx.lineTo(8, 0);
            ctx.lineTo(-18, 14);
            ctx.lineWidth = 4.5;
            ctx.strokeStyle = '#3B82F6';
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.stroke();

            // Accompanying blue dot
            ctx.beginPath();
            ctx.arc(-28, 0, 9, 0, Math.PI * 2);
            ctx.fillStyle = '#2563EB';
            ctx.fill();

            ctx.restore();
          }
        }
      }

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [plan, activeIndex, capturedSet, alignmentGateState, capturedFrames]);

  return (
    <div className="absolute inset-0 pointer-events-none select-none z-20">
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ width: '100vw', height: '100vh' }}
      />

      {/* Shutter Exposure Flash Effect */}
      {isCapturing && (
        <div className="absolute inset-0 bg-white/70 animate-ping duration-150 pointer-events-none z-30" />
      )}
    </div>
  );
}
