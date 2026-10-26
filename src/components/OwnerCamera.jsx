import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, RotateCcw, X, Check, RefreshCw, AlertCircle, Upload } from 'lucide-react';
import useBackHandler from '../hooks/useBackHandler';

/**
 * OwnerCamera.jsx
 *
 * Dedicated camera component for capturing property owner/representative
 * photographs for identity verification and consent records.
 *
 * Features:
 * - Live camera stream with front/rear camera toggle (selfie vs portrait)
 * - Viewfinder overlay guiding the supervisor to frame the owner's face
 * - Instant snapshot capture with review ("Use Photo" vs "Retake")
 * - Geotagging and timestamp imprint
 * - Android Back button / Back gesture dismissal
 * - Device file/gallery upload fallback
 */
export default function OwnerCamera({ onPhotoCaptured, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);

  const [stream, setStream] = useState(null);
  const [facingMode, setFacingMode] = useState('environment'); // 'environment' (rear) or 'user' (front)
  const [cameraError, setCameraError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState(null);
  const [previewBlob, setPreviewBlob] = useState(null);

  // Android Back button closes camera safely (priority 110)
  useBackHandler('owner_camera_back', () => {
    handleClose();
    return true;
  }, 110, true);

  const stopTracks = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => {
        try { track.stop(); } catch (_) {}
      });
    }
  }, [stream]);

  const startCamera = useCallback(async (currentMode = facingMode) => {
    setCameraError(null);
    stopTracks();

    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('Camera access not supported on this device/browser.');
      return;
    }

    try {
      let mediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: currentMode },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        });
      } catch (_) {
        // Fallback without specific constraints
        mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      console.error('Owner camera initialization error:', err);
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
        setCameraError('Camera permission blocked. Please allow camera access in your settings.');
      } else {
        setCameraError('Unable to access camera. You can also upload a photo from your device.');
      }
    }
  }, [facingMode, stopTracks]);

  useEffect(() => {
    startCamera(facingMode);
    return () => {
      stopTracks();
    };
  }, [facingMode]);

  const handleFlipCamera = () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
  };

  const handleCapture = () => {
    if (!videoRef.current || isProcessing) return;
    setIsProcessing(true);

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current || document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;

      const ctx = canvas.getContext('2d');
      // If user facing, mirror image for natural selfie feel
      if (facingMode === 'user') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Reset transform if mirrored
      if (facingMode === 'user') {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }

      // Add neat watermark badge at bottom
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      const bannerText = `7DAYS FIELD • OWNER VERIFICATION • ${dateStr} ${timeStr}`;

      const bannerHeight = Math.round(canvas.height * 0.045);
      const fontSize = Math.max(12, Math.round(bannerHeight * 0.5));
      ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
      ctx.fillRect(0, canvas.height - bannerHeight, canvas.width, bannerHeight);

      ctx.fillStyle = '#f8fafc';
      ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillText(bannerText, 16, canvas.height - (bannerHeight / 2));

      canvas.toBlob((blob) => {
        setIsProcessing(false);
        if (blob) {
          const url = URL.createObjectURL(blob);
          setPreviewBlob(blob);
          setPreviewDataUrl(url);
          stopTracks();
        }
      }, 'image/jpeg', 0.9);
    } catch (err) {
      console.error('Snapshot capture error:', err);
      setIsProcessing(false);
    }
  };

  const handleAcceptPhoto = () => {
    if (!previewBlob || !previewDataUrl) return;
    stopTracks();
    onPhotoCaptured(previewBlob, previewDataUrl);
  };

  const handleRetake = () => {
    if (previewDataUrl) {
      try { URL.revokeObjectURL(previewDataUrl); } catch (_) {}
    }
    setPreviewDataUrl(null);
    setPreviewBlob(null);
    startCamera(facingMode);
  };

  const handleClose = () => {
    stopTracks();
    if (previewDataUrl) {
      try { URL.revokeObjectURL(previewDataUrl); } catch (_) {}
    }
    onClose();
  };

  const handleFileFallback = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    stopTracks();
    onPhotoCaptured(file, url);
  };

  return (
    <div 
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: '#000000',
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <input 
        ref={fileInputRef} 
        type="file" 
        accept="image/*" 
        capture="user" 
        style={{ display: 'none' }} 
        onChange={handleFileFallback} 
      />

      {/* Top Header Bar */}
      <div 
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          paddingTop: 'calc(var(--safe-area-top, 24px) + 12px)',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 100%)'
        }}
      >
        <button
          onClick={handleClose}
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            backgroundColor: 'rgba(0,0,0,0.4)',
            border: '1px solid rgba(255,255,255,0.2)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer'
          }}
          aria-label="Close"
        >
          <X size={20} />
        </button>

        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#ffffff', fontWeight: 700, fontSize: '15px' }}>
            Owner Photograph
          </div>
          <div style={{ color: '#94a3b8', fontSize: '11px', marginTop: '2px' }}>
            Identity & Consent Verification
          </div>
        </div>

        {!previewDataUrl && (
          <button
            onClick={handleFlipCamera}
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              backgroundColor: 'rgba(0,0,0,0.4)',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}
            aria-label="Flip Camera"
            title="Switch between front and back camera"
          >
            <RefreshCw size={18} />
          </button>
        )}
        {previewDataUrl && <div style={{ width: '40px' }} />}
      </div>

      {/* Viewport Area */}
      <div 
        style={{
          flex: 1,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0b1329',
          overflow: 'hidden'
        }}
      >
        {previewDataUrl ? (
          <img 
            src={previewDataUrl} 
            alt="Owner Preview" 
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              backgroundColor: '#000000'
            }} 
          />
        ) : cameraError ? (
          <div 
            style={{ 
              padding: '32px 24px', 
              textAlign: 'center', 
              color: '#ffffff', 
              maxWidth: '320px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px'
            }}
          >
            <AlertCircle size={44} color="#ef4444" />
            <div style={{ fontWeight: 600, fontSize: '16px' }}>Camera Unavailable</div>
            <div style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.5 }}>
              {cameraError}
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                marginTop: '12px',
                padding: '12px 20px',
                backgroundColor: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer'
              }}
            >
              <Upload size={16} /> Choose From Device / Camera App
            </button>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: facingMode === 'user' ? 'scaleX(-1)' : 'none'
              }}
            />

            {/* Oval Portrait Guide Frame */}
            <div 
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: 'min(72vw, 280px)',
                height: 'min(95vw, 360px)',
                borderRadius: '50%',
                border: '2px dashed rgba(255, 255, 255, 0.65)',
                boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.45)',
                pointerEvents: 'none',
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'center',
                paddingBottom: '24px'
              }}
            >
              <span 
                style={{
                  backgroundColor: 'rgba(0,0,0,0.65)',
                  color: '#ffffff',
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '4px 12px',
                  borderRadius: '12px',
                  letterSpacing: '0.3px',
                  whiteSpace: 'nowrap'
                }}
              >
                Frame Owner Face Here
              </span>
            </div>
          </>
        )}
      </div>

      {/* Bottom Controls Bar */}
      <div 
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-around',
          padding: '24px 20px',
          paddingBottom: 'calc(var(--safe-area-bottom, 16px) + 20px)',
          background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 100%)'
        }}
      >
        {previewDataUrl ? (
          <div style={{ display: 'flex', gap: '16px', width: '100%', maxWidth: '340px' }}>
            <button
              onClick={handleRetake}
              style={{
                flex: 1,
                padding: '12px 18px',
                borderRadius: '10px',
                backgroundColor: 'rgba(255, 255, 255, 0.15)',
                color: '#ffffff',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                fontWeight: 600,
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                cursor: 'pointer'
              }}
            >
              <RotateCcw size={16} /> Retake
            </button>
            <button
              onClick={handleAcceptPhoto}
              style={{
                flex: 1,
                padding: '12px 18px',
                borderRadius: '10px',
                backgroundColor: '#16a34a',
                color: '#ffffff',
                border: 'none',
                fontWeight: 700,
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(22, 163, 74, 0.4)'
              }}
            >
              <Check size={18} strokeWidth={2.5} /> Use Photo
            </button>
          </div>
        ) : !cameraError ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', position: 'relative' }}>
            {/* Gallery fallback small button on the left */}
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                position: 'absolute',
                left: '20px',
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                backgroundColor: 'rgba(255,255,255,0.15)',
                border: '1px solid rgba(255,255,255,0.25)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer'
              }}
              title="Pick photo from device"
            >
              <Upload size={18} />
            </button>

            {/* Shutter Button */}
            <button
              onClick={handleCapture}
              disabled={isProcessing}
              style={{
                width: '74px',
                height: '74px',
                borderRadius: '50%',
                backgroundColor: '#ffffff',
                border: '4px solid rgba(255,255,255,0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 0 20px rgba(255,255,255,0.3)',
                transition: 'transform 0.1s ease'
              }}
              aria-label="Capture Photo"
            >
              <div 
                style={{
                  width: '58px',
                  height: '58px',
                  borderRadius: '50%',
                  border: '2px solid #000000',
                  backgroundColor: isProcessing ? '#ef4444' : '#ffffff'
                }} 
              />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
