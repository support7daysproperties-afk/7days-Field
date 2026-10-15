/**
 * TargetOverlay.jsx
 *
 * Implements the exact HUD and visual elements shown in the reference video:
 * - Fixed center aiming circle with framing bracket guide
 * - Real-time animated blue target dot moving according to device attitude
 * - Dynamic edge chevrons / arrows pointing toward off-screen targets
 * - Smooth dwell progress arc filling around center reticle when aligned
 * - Visual flash / haptic shutter feedback
 */

import React, { useRef, useEffect } from 'react';
import { SphereProjection } from '../orientation/SphereProjection.js';

export default function TargetOverlay({
  orientation,
  plan,
  activeIndex,
  capturedSet,
  alignmentGateState,
  isCapturing,
  onTargetClick
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width = canvas.parentElement.clientWidth || window.innerWidth;
    const height = canvas.height = canvas.parentElement.clientHeight || window.innerHeight;

    ctx.clearRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;
    const focalPx = SphereProjection.focalLengthPx(width, height, 65, 80);

    const cameraBasis = orientation.cameraBasis;

    // 1. Draw Fixed Center Aiming Reticle (Google Camera Photo Sphere Style)
    const reticleRadius = 38;
    const isAligned = alignmentGateState?.isAligned;
    const progress = alignmentGateState?.progress || 0;

    // Center Outer Ring (White / Translucent)
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, reticleRadius, 0, Math.PI * 2);
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = isAligned ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.7)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 6;
    ctx.stroke();

    // Dwell Progress Ring (fills around center ring as user holds steady)
    if (progress > 0) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, reticleRadius + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#2563EB'; // Vibrant Royal Blue
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Center Crosshair / Aiming Mark
    ctx.beginPath();
    ctx.arc(centerX, centerY, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fill();
    ctx.restore();

    // 2. Project and Draw Targets on Viewport
    if (plan && plan.targets) {
      const activeTarget = plan.targets[activeIndex];

      // Draw all nearby uncaptured targets faintly
      plan.targets.forEach((target, index) => {
        if (capturedSet.has(index)) return; // already captured

        const projection = SphereProjection.projectTargetToScreen(target, cameraBasis, width, height, focalPx);

        if (index === activeIndex) return; // Active target is drawn prominently below

        // Only draw pending target if in front and within screen margin
        if (projection.isInFront && !projection.isOffScreen) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(projection.screenX, projection.screenY, 14, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
          ctx.lineWidth = 2;
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        }
      });

      // 3. Draw Active Blue Target Dot (Source of Truth from Reference Video)
      if (activeTarget && !capturedSet.has(activeIndex)) {
        const activeProj = SphereProjection.projectTargetToScreen(activeTarget, cameraBasis, width, height, focalPx);

        if (activeProj.isInFront && !activeProj.isOffScreen) {
          // Inside Screen Viewport
          const dotRadius = isAligned ? 28 : 24;

          ctx.save();
          // Subtle glow
          ctx.shadowColor = '#3B82F6';
          ctx.shadowBlur = 16;

          // Outer pulsing ring
          ctx.beginPath();
          ctx.arc(activeProj.screenX, activeProj.screenY, dotRadius + 6, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)';
          ctx.lineWidth = 2;
          ctx.stroke();

          // Main Solid Blue Dot
          ctx.beginPath();
          ctx.arc(activeProj.screenX, activeProj.screenY, dotRadius, 0, Math.PI * 2);
          ctx.fillStyle = '#2563EB'; // Vivid Reference Blue
          ctx.fill();

          // Inner Specular Dot / Center core
          ctx.beginPath();
          ctx.arc(activeProj.screenX, activeProj.screenY, 7, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.fill();

          ctx.restore();
        } else {
          // Off-screen -> Directional Indicator Arrow / Chevron pointing toward target
          ctx.save();
          const angle = activeProj.angleRad;
          const arrowDist = Math.min(centerX, centerY) * 0.82;
          const arrowX = centerX + Math.cos(angle) * arrowDist;
          const arrowY = centerY + Math.sin(angle) * arrowDist;

          ctx.translate(arrowX, arrowY);
          ctx.rotate(angle);

          // Draw Chevron
          ctx.beginPath();
          ctx.moveTo(-16, -14);
          ctx.lineTo(8, 0);
          ctx.lineTo(-16, 14);
          ctx.lineWidth = 4;
          ctx.strokeStyle = '#3B82F6';
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.shadowColor = '#1D4ED8';
          ctx.shadowBlur = 10;
          ctx.stroke();

          // Small Blue Dot near Arrow
          ctx.beginPath();
          ctx.arc(-26, 0, 8, 0, Math.PI * 2);
          ctx.fillStyle = '#2563EB';
          ctx.fill();

          ctx.restore();
        }
      }
    }

  }, [orientation, plan, activeIndex, capturedSet, alignmentGateState]);

  return (
    <div className="absolute inset-0 pointer-events-none select-none z-20">
      <canvas ref={canvasRef} className="w-full h-full block" />

      {/* Shutter Exposure Flash Effect */}
      {isCapturing && (
        <div className="absolute inset-0 bg-white/70 animate-ping duration-150 pointer-events-none z-30" />
      )}
    </div>
  );
}
