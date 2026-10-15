/**
 * CameraViewport.jsx
 *
 * Full-screen responsive camera preview viewport.
 * Measures exact pixel dimensions of the rendered camera stream to position
 * center reticles and project spherical targets accurately.
 */

import React, { useRef, useEffect, useState } from 'react';

export default function CameraViewport({
  videoRef,
  children,
  onViewportMeasured,
}) {
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const newDims = { width: Math.round(rect.width), height: Math.round(rect.height) };
        setDimensions(newDims);
        if (onViewportMeasured) {
          onViewportMeasured(newDims);
        }
      }
    };

    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);

    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [onViewportMeasured]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: '#000000',
        overflow: 'hidden',
        zIndex: 100,
      }}
      id="photo-sphere-camera-viewport"
    >
      {/* Live Video Preview filling viewport */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
        }}
      />

      {/* Children overlays (CenterReticle, TargetOverlay, Controls, Progress) */}
      {dimensions.width > 0 && dimensions.height > 0 && children}
    </div>
  );
}
