/**
 * CameraStream.jsx
 *
 * Fullscreen live camera preview supporting environment-facing camera with auto-focus.
 */

import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';

const CameraStream = forwardRef(function CameraStream({ onStreamReady, onError }, ref) {
  const videoRef = useRef(null);
  const [streamActive, setStreamActive] = useState(false);

  useEffect(() => {
    let stream = null;

    async function initCamera() {
      try {
        const constraints = {
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            advanced: [{ zoom: 1 }]
          }
        };

        stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setStreamActive(true);

          // Ensure hardware zoom is set to 1 (unzoomed / widest optical view)
          const track = stream.getVideoTracks()[0];
          if (track && typeof track.getCapabilities === 'function') {
            const capabilities = track.getCapabilities();
            if (capabilities.zoom) {
              try {
                await track.applyConstraints({
                  advanced: [{ zoom: capabilities.zoom.min || 1 }]
                });
              } catch (e) {
                // Ignore if zoom constraint not accepted
              }
            }
          }

          if (onStreamReady) onStreamReady(videoRef.current);
        }
      } catch (err) {
        console.warn("Camera getUserMedia failed or rejected, trying fallback:", err);
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } },
            audio: false
          });
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play();
            setStreamActive(true);
            if (onStreamReady) onStreamReady(videoRef.current);
          }
        } catch (fallbackErr) {
          console.error("Camera access failed:", fallbackErr);
          if (onError) onError(fallbackErr);
        }
      }
    }

    initCamera();

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [onStreamReady, onError]);

  useImperativeHandle(ref, () => ({
    captureFrame: () => {
      const video = videoRef.current;
      if (!video || !streamActive) return null;

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      return canvas.toDataURL('image/jpeg', 0.88);
    }
  }));

  return (
    <div className="absolute inset-0 bg-black overflow-hidden z-0">
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="w-full h-full object-cover"
      />
      {!streamActive && (
        <div className="absolute inset-0 flex items-center justify-center text-white/70 text-sm">
          Initializing Camera Viewfinder...
        </div>
      )}
    </div>
  );
});

export default CameraStream;
