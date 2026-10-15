/**
 * PanoramaViewer.jsx
 *
 * Interactive 360° Photo Sphere equirectangular viewer.
 * Supports:
 * - Touch pan and mouse drag around 360° azimuth and -90°/+90° pitch
 * - Pinch-to-zoom / wheel zoom
 * - Download / Export
 * - Partial coverage warning banner
 * - Returning to workflow or retaking session
 */

import React, { useRef, useEffect, useState } from 'react';
import { ArrowLeft, Download, RefreshCw, ZoomIn, ZoomOut, Check } from 'lucide-react';

export default function PanoramaViewer({
  panoramaDataUri,
  coveragePercent = 100,
  hasGPano = false,
  onBack,
  onSaveAndReturn,
}) {
  const canvasRef = useRef(null);
  const [yaw, setYaw] = useState(0); // degrees
  const [pitch, setPitch] = useState(0); // degrees
  const [fov, setFov] = useState(75); // zoom degrees
  const [image, setImage] = useState(null);

  const isDraggingRef = useRef(false);
  const lastMousePosRef = useRef({ x: 0, y: 0 });

  // Load panorama image
  useEffect(() => {
    if (!panoramaDataUri) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setImage(img);
    img.src = panoramaDataUri;
  }, [panoramaDataUri]);

  // Render view onto canvas
  useEffect(() => {
    if (!image || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(0, 0, width, height);

    // Approximate rectilinear projection window from equirectangular texture
    // Convert yaw (-180..180) to image X coordinate
    const imgW = image.width;
    const imgH = image.height;

    const normYaw = (yaw + 180) % 360;
    const centerX = (normYaw / 360) * imgW;
    const centerY = ((90 - pitch) / 180) * imgH;

    const sliceW = (fov / 360) * imgW;
    const sliceH = ((fov * (height / width)) / 180) * imgH;

    // Draw center crop or wrap around
    const srcX = centerX - sliceW / 2;
    const srcY = Math.max(0, Math.min(imgH - sliceH, centerY - sliceH / 2));

    if (srcX < 0) {
      // Wraps around left edge
      const w1 = -srcX;
      const w2 = sliceW - w1;
      ctx.drawImage(image, imgW - w1, srcY, w1, sliceH, 0, 0, (w1 / sliceW) * width, height);
      ctx.drawImage(image, 0, srcY, w2, sliceH, (w1 / sliceW) * width, 0, (w2 / sliceW) * width, height);
    } else if (srcX + sliceW > imgW) {
      // Wraps around right edge
      const w1 = imgW - srcX;
      const w2 = sliceW - w1;
      ctx.drawImage(image, srcX, srcY, w1, sliceH, 0, 0, (w1 / sliceW) * width, height);
      ctx.drawImage(image, 0, srcY, w2, sliceH, (w1 / sliceW) * width, 0, (w2 / sliceW) * width, height);
    } else {
      ctx.drawImage(image, srcX, srcY, sliceW, sliceH, 0, 0, width, height);
    }
  }, [image, yaw, pitch, fov]);

  // Resize canvas to match display size
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Touch and Mouse Drag Listeners
  const handleStart = (clientX, clientY) => {
    isDraggingRef.current = true;
    lastMousePosRef.current = { x: clientX, y: clientY };
  };

  const handleMove = (clientX, clientY) => {
    if (!isDraggingRef.current) return;
    const dx = clientX - lastMousePosRef.current.x;
    const dy = clientY - lastMousePosRef.current.y;
    lastMousePosRef.current = { x: clientX, y: clientY };

    // Move angles proportionally
    setYaw((prev) => (prev - dx * 0.25 + 360) % 360);
    setPitch((prev) => Math.max(-85, Math.min(85, prev + dy * 0.25)));
  };

  const handleEnd = () => {
    isDraggingRef.current = false;
  };

  const handleDownload = () => {
    if (!panoramaDataUri) return;
    const a = document.createElement('a');
    a.href = panoramaDataUri;
    a.download = `photosphere_${Date.now()}.jpg`;
    a.click();
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: '#0a0d14',
        overflow: 'hidden',
        zIndex: 100,
        touchAction: 'none',
      }}
      id="photo-sphere-panorama-viewer"
    >
      {/* 360 Interactive Canvas */}
      <canvas
        ref={canvasRef}
        onMouseDown={(e) => handleStart(e.clientX, e.clientY)}
        onMouseMove={(e) => handleMove(e.clientX, e.clientY)}
        onMouseUp={handleEnd}
        onMouseLeave={handleEnd}
        onTouchStart={(e) => {
          if (e.touches.length === 1) {
            handleStart(e.touches[0].clientX, e.touches[0].clientY);
          }
        }}
        onTouchMove={(e) => {
          if (e.touches.length === 1) {
            handleMove(e.touches[0].clientX, e.touches[0].clientY);
          }
        }}
        onTouchEnd={handleEnd}
        style={{ width: '100%', height: '100%', cursor: 'grab' }}
      />

      {/* Top Header */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: '16px 20px',
          background: 'linear-gradient(to bottom, rgba(10, 13, 20, 0.85) 0%, transparent 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 10,
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: 'rgba(255, 255, 255, 0.15)',
            border: 'none',
            borderRadius: '50%',
            width: '40px',
            height: '40px',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
          title="Back"
          id="panorama-viewer-back-btn"
        >
          <ArrowLeft size={20} />
        </button>

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#ffffff' }}>
            360° Photo Sphere
          </div>
          <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.7)' }}>
            {coveragePercent}% Covered {hasGPano ? '• GPano Ready' : ''}
          </div>
        </div>

        <button
          onClick={handleDownload}
          style={{
            background: 'rgba(255, 255, 255, 0.15)',
            border: 'none',
            borderRadius: '50%',
            width: '40px',
            height: '40px',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
          title="Export / Download JPEG"
          id="panorama-viewer-download-btn"
        >
          <Download size={20} />
        </button>
      </div>

      {/* Partial Coverage Warning Banner */}
      {coveragePercent < 80 && (
        <div
          style={{
            position: 'absolute',
            top: '72px',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '6px 14px',
            borderRadius: '16px',
            backgroundColor: 'rgba(245, 158, 11, 0.9)',
            color: '#000000',
            fontSize: '12px',
            fontWeight: 600,
            zIndex: 10,
          }}
        >
          Partial Sphere ({coveragePercent}%) — Some angles uncaptured
        </div>
      )}

      {/* Bottom Floating Bar */}
      <div
        style={{
          position: 'absolute',
          bottom: '24px',
          left: '20px',
          right: '20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          zIndex: 10,
        }}
      >
        <button
          onClick={() => setFov((f) => Math.max(40, f - 15))}
          style={{
            padding: '10px 14px',
            borderRadius: '20px',
            backgroundColor: 'rgba(255, 255, 255, 0.15)',
            border: '1px solid rgba(255, 255, 255, 0.25)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            cursor: 'pointer',
          }}
          title="Zoom in"
        >
          <ZoomIn size={16} />
        </button>

        <button
          onClick={() => setFov((f) => Math.min(100, f + 15))}
          style={{
            padding: '10px 14px',
            borderRadius: '20px',
            backgroundColor: 'rgba(255, 255, 255, 0.15)',
            border: '1px solid rgba(255, 255, 255, 0.25)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            cursor: 'pointer',
          }}
          title="Zoom out"
        >
          <ZoomOut size={16} />
        </button>

        <button
          onClick={onSaveAndReturn}
          style={{
            padding: '12px 24px',
            borderRadius: '24px',
            backgroundColor: '#10b981',
            border: 'none',
            color: '#ffffff',
            fontWeight: 700,
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(16, 185, 129, 0.4)',
          }}
          id="panorama-viewer-save-btn"
        >
          <Check size={18} strokeWidth={2.5} />
          Save & Attach to Inspection
        </button>
      </div>
    </div>
  );
}
