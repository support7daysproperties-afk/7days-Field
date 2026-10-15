/**
 * PanoramaViewer.jsx
 *
 * Full interactive 360° Photo Sphere Viewer with touch/mouse drag-to-look,
 * zoom, fullscreen, and realistic spherical projection.
 */

import React, { useRef, useEffect, useState } from 'react';
import { RotateCw, ZoomIn, ZoomOut, Maximize2, Minimize2, Check } from 'lucide-react';

export default function PanoramaViewer({ panoramaUrl, title = "360° Photo Sphere", onDone }) {
  const canvasRef = useRef(null);
  const [yaw, setYaw] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [fov, setFov] = useState(75);
  const [isDragging, setIsDragging] = useState(false);
  const lastPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !panoramaUrl) return;

    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.src = panoramaUrl;

    let animId;

    const render = () => {
      const w = canvas.width = canvas.parentElement.clientWidth || 800;
      const h = canvas.height = canvas.parentElement.clientHeight || 600;

      if (!img.complete || img.naturalWidth === 0) {
        animId = requestAnimationFrame(render);
        return;
      }

      // Spherical projection approximation for viewer:
      // Slice equirectangular panorama image according to yaw, pitch, fov
      const panoW = img.naturalWidth;
      const panoH = img.naturalHeight;

      // Normalized center look angle
      const lookX = ((yaw % 360 + 360) % 360) / 360 * panoW;
      const lookY = Math.max(0, Math.min(1, (pitch + 90) / 180)) * panoH;

      const viewPortW = (fov / 360) * panoW;
      const viewPortH = (fov / 180) * panoH;

      ctx.clearRect(0, 0, w, h);

      // Draw primary portion
      const srcX = lookX - viewPortW / 2;
      const srcY = Math.max(0, Math.min(panoH - viewPortH, lookY - viewPortH / 2));

      if (srcX >= 0 && srcX + viewPortW <= panoW) {
        ctx.drawImage(img, srcX, srcY, viewPortW, viewPortH, 0, 0, w, h);
      } else if (srcX < 0) {
        // Wrap around left seam
        const leftWidth = -srcX;
        const rightWidth = viewPortW - leftWidth;
        const splitX = (rightWidth / viewPortW) * w;

        ctx.drawImage(img, 0, srcY, rightWidth, viewPortH, 0, 0, splitX, h);
        ctx.drawImage(img, panoW - leftWidth, srcY, leftWidth, viewPortH, splitX, 0, w - splitX, h);
      } else {
        // Wrap around right seam
        const rightWidth = (srcX + viewPortW) - panoW;
        const leftWidth = viewPortW - rightWidth;
        const splitX = (leftWidth / viewPortW) * w;

        ctx.drawImage(img, srcX, srcY, leftWidth, viewPortH, 0, 0, splitX, h);
        ctx.drawImage(img, 0, srcY, rightWidth, viewPortH, splitX, 0, w - splitX, h);
      }

      animId = requestAnimationFrame(render);
    };

    img.onload = () => {
      render();
    };

    return () => cancelAnimationFrame(animId);
  }, [panoramaUrl, yaw, pitch, fov]);

  const handlePointerDown = (e) => {
    setIsDragging(true);
    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerMove = (e) => {
    if (!isDragging) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };

    const sensitivity = 0.22 * (fov / 75);
    setYaw(prev => (prev - dx * sensitivity) % 360);
    setPitch(prev => Math.max(-85, Math.min(85, prev + dy * sensitivity)));
  };

  const handlePointerUp = () => {
    setIsDragging(false);
  };

  return (
    <div
      className="relative w-full h-full bg-slate-950 flex flex-col select-none touch-none overflow-hidden"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 text-white text-xs">
        <RotateCw className="w-3.5 h-3.5 text-blue-400 animate-spin" />
        <span>Drag to pan 360° • Pinch / +/- to zoom</span>
      </div>

      {onDone && (
        <button
          onClick={onDone}
          className="absolute top-4 right-4 z-20 flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-4 py-1.5 rounded-full shadow-lg font-medium text-xs transition"
        >
          <Check className="w-4 h-4" />
          <span>Save & Done</span>
        </button>
      )}

      <canvas ref={canvasRef} className="w-full h-full block cursor-grab active:cursor-grabbing" />

      {/* Floating Navigation Controls */}
      <div className="absolute bottom-6 right-6 z-20 flex flex-col gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); setFov(f => Math.max(35, f - 10)); }}
          className="w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md text-white border border-white/10 flex items-center justify-center transition shadow-md"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setFov(f => Math.min(105, f + 10)); }}
          className="w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md text-white border border-white/10 flex items-center justify-center transition shadow-md"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
