import { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, X, RotateCcw, MapPin, Navigation, CheckCircle, AlertTriangle } from 'lucide-react';
import { EvidenceService } from '../services/EvidenceService';

export default function FieldCamera({ 
  evidenceType = 'Location Verification', 
  taskId, 
  initialThumbnail = null,
  initialCount = 0,
  onPhotoCaptured,
  onOpenGallery,
  onSave, 
  onCancel 
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  
  const [stream, setStream] = useState(null);
  const [cameraError, setCameraError] = useState(null);
  const [facingMode, setFacingMode] = useState('environment');
  
  const [zoom, setZoom] = useState(1);
  const [zoomCapabilities, setZoomCapabilities] = useState({ min: 1, max: 5, step: 0.1 });
  const [isDigitalZoom, setIsDigitalZoom] = useState(false);
  
  const [liveLocation, setLiveLocation] = useState({
    loading: true, lat: null, lon: null, accuracy: null, timestamp: null, error: null
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const watchIdRef = useRef(null);

  const startCamera = useCallback(async (currentFacingMode = facingMode) => {
    setCameraError(null);
    if (window.isSecureContext === false) {
      setCameraError('Camera Requires Secure Access. Open using HTTPS or localhost.');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError('No Camera Found or browser not supported.');
      return;
    }
    try {
      let mediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            facingMode: { ideal: currentFacingMode },
            width: { ideal: 4096 },
            height: { ideal: 2160 }
          } 
        });
      } catch (fallbackErr) {
        mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }

      const track = mediaStream.getVideoTracks()[0];
      const capabilities = track.getCapabilities ? track.getCapabilities() : {};
      const maxAllowed = currentFacingMode === 'environment' ? 10 : 5;
      
      if (capabilities.zoom) {
         const maxZoom = Math.min(capabilities.zoom.max, maxAllowed);
         setZoomCapabilities({ min: capabilities.zoom.min || 1, max: maxZoom, step: capabilities.zoom.step || 0.1 });
         setIsDigitalZoom(false);
         setZoom(1);
      } else {
         // Fallback to digital zoom
         setZoomCapabilities({ min: 1, max: maxAllowed, step: 0.1 });
         setIsDigitalZoom(true);
         setZoom(1);
      }
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
        setCameraError('Camera Permission Blocked. Please allow camera access in your browser settings.');
      } else {
        setCameraError('Camera Unavailable. Another application may be using the camera.');
      }
    }
  }, [facingMode]);

  const startLocationWatcher = () => {
    if (!navigator.geolocation) {
      setLiveLocation(prev => ({ ...prev, loading: false, error: 'GPS not supported by device' }));
      return;
    }
    setLiveLocation(prev => ({ ...prev, loading: true, error: null }));
    
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        setLiveLocation({
          loading: false, lat: latitude, lon: longitude, accuracy: accuracy, 
          timestamp: position.timestamp || Date.now(), error: null
        });
      },
      (error) => {
        let errorMsg = 'GPS unavailable';
        if (error.code === 1) errorMsg = 'Location Permission Denied';
        setLiveLocation(prev => ({ ...prev, loading: false, error: errorMsg }));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  };

  useEffect(() => {
    startCamera();
    if (evidenceType === 'Location Verification') {
      startLocationWatcher();
    }
    return () => {
      if (stream) stream.getTracks().forEach(track => track.stop());
      if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, [startCamera, evidenceType]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCamera = () => {
    if (stream) stream.getTracks().forEach(track => track.stop());
    const newMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(newMode);
    startCamera(newMode);
  };

  const [capturedCount, setCapturedCount] = useState(initialCount);
  const [lastThumbnail, setLastThumbnail] = useState(initialThumbnail);
  const [flashAnimation, setFlashAnimation] = useState(false);

  const handleCapture = async () => {
    if (!videoRef.current || !canvasRef.current || isProcessing) return;
    setIsProcessing(true);
    setFlashAnimation(true);
    setTimeout(() => setFlashAnimation(false), 200);
    
    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      
      if (isDigitalZoom && zoom > 1) {
        const sw = video.videoWidth / zoom;
        const sh = video.videoHeight / zoom;
        const sx = (video.videoWidth - sw) / 2;
        const sy = (video.videoHeight - sh) / 2;
        context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      } else {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
      
      canvas.toBlob(async (blob) => {
        if (!blob) {
          setIsProcessing(false);
          return;
        }

        const originalDataUrl = URL.createObjectURL(blob);
        let geotaggedBlob = null;

        if (evidenceType === 'Location Verification') {
          let addressDetails = {
            short: 'Location unavailable',
            full: 'Unknown'
          };
          if (liveLocation.lat) {
            try {
              const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${liveLocation.lat}&lon=${liveLocation.lon}&format=json`);
              const data = await res.json();
              if (data && data.display_name) {
                addressDetails.full = data.display_name;
                const parts = data.display_name.split(', ');
                addressDetails.short = parts.slice(Math.max(parts.length - 4, 0)).join(', ');
              }
            } catch (e) {
              console.warn("Reverse geocoding failed", e);
            }
          }
          geotaggedBlob = await generateGeotaggedImageBlob(originalDataUrl, { ...liveLocation, address: addressDetails });
        }

        // Save immediately into repository
        await EvidenceService.saveEvidence({
          taskId,
          evidenceType,
          mediaType: 'photo',
          original_blob: blob,
          geotagged_blob: geotaggedBlob || blob,
          mime_type: 'image/jpeg',
          size: blob.size,
          latitude: liveLocation.lat,
          longitude: liveLocation.lon,
          accuracy: liveLocation.accuracy,
          location_captured_at: liveLocation.timestamp || new Date().getTime(),
          captured_at: new Date().toISOString()
        });

        // Update thumbnail and count without stopping camera stream
        setLastThumbnail(originalDataUrl);
        setCapturedCount(prev => prev + 1);
        setIsProcessing(false);
        if (onPhotoCaptured) onPhotoCaptured();
      }, 'image/jpeg', 0.9);
    } catch (err) {
      console.error('Capture error:', err);
      setIsProcessing(false);
    }
  };

  const generateGeotaggedImageBlob = (originalUrl, loc) => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        
        // Scale metrics proportionally with canvas resolution
        const baseDim = Math.min(canvas.width, canvas.height);
        const scale = Math.max(0.6, baseDim / 1080);

        const boxMargin = Math.round(16 * scale);
        const boxPadding = Math.round(18 * scale);
        const overlayWidth = canvas.width - (boxMargin * 2);

        const titleFontSize = Math.round(20 * scale);
        const bodyFontSize = Math.round(16 * scale);
        const lineHeight = Math.round(26 * scale);

        const lines = [];
        if (loc.lat) {
          lines.push({ 
            text: loc.address ? loc.address.short : 'Unknown Location', 
            font: `bold ${titleFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`, 
            color: '#ffffff' 
          });
          
          if (loc.address && loc.address.full) {
            const maxTextWidth = overlayWidth - (boxPadding * 2);
            const words = loc.address.full.split(' ');
            let currentLine = '';
            ctx.font = `${bodyFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
            
            for (let i = 0; i < words.length; i++) {
              const testLine = currentLine + words[i] + ' ';
              const metrics = ctx.measureText(testLine);
              if (metrics.width > maxTextWidth && i > 0) {
                lines.push({ 
                  text: currentLine.trim(), 
                  font: `${bodyFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`, 
                  color: '#e2e8f0' 
                });
                currentLine = words[i] + ' ';
              } else {
                currentLine = testLine;
              }
            }
            if (currentLine.trim()) {
              lines.push({ 
                text: currentLine.trim(), 
                font: `${bodyFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`, 
                color: '#e2e8f0' 
              });
            }
          }
          
          lines.push({ 
            text: `Lat ${loc.lat.toFixed(6)}°  Long ${loc.lon.toFixed(6)}°`, 
            font: `bold ${bodyFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`, 
            color: '#ffffff' 
          });
          
          const d = new Date(loc.timestamp || Date.now());
          const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
          const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
          const offset = -d.getTimezoneOffset();
          const sign = offset >= 0 ? '+' : '-';
          const pad = (num) => String(Math.abs(num)).padStart(2, '0');
          const gmtStr = `GMT${sign}${pad(Math.floor(offset / 60))}:${pad(offset % 60)}`;
          
          lines.push({ 
            text: `${dateStr}  ${timeStr}  ${gmtStr}`, 
            font: `${bodyFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`, 
            color: '#f8fafc' 
          });
        } else {
          lines.push({ 
            text: 'GPS Location Unavailable', 
            font: `bold ${titleFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`, 
            color: '#ffffff' 
          });
        }

        const boxHeight = (lines.length * lineHeight) + (boxPadding * 2);
        const startY = canvas.height - boxHeight - boxMargin;

        const radius = Math.round(14 * scale);
        ctx.fillStyle = 'rgba(25, 23, 18, 0.82)';
        ctx.beginPath();
        ctx.moveTo(boxMargin + radius, startY);
        ctx.lineTo(boxMargin + overlayWidth - radius, startY);
        ctx.quadraticCurveTo(boxMargin + overlayWidth, startY, boxMargin + overlayWidth, startY + radius);
        ctx.lineTo(boxMargin + overlayWidth, startY + boxHeight - radius);
        ctx.quadraticCurveTo(boxMargin + overlayWidth, startY + boxHeight, boxMargin + overlayWidth - radius, startY + boxHeight);
        ctx.lineTo(boxMargin + radius, startY + boxHeight);
        ctx.quadraticCurveTo(boxMargin, startY + boxHeight, boxMargin, startY + boxHeight - radius);
        ctx.lineTo(boxMargin, startY + radius);
        ctx.quadraticCurveTo(boxMargin, startY, boxMargin + radius, startY);
        ctx.closePath();
        ctx.fill();
        
        const tagHeight = Math.round(38 * scale);
        const tagFontSize = Math.round(15 * scale);
        ctx.font = `bold ${tagFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        const tagText = '7DAYS PROPERTIES';
        const tagTextWidth = ctx.measureText(tagText).width;
        const tagWidth = tagTextWidth + Math.round(36 * scale);
        const tagY = startY - tagHeight + Math.round(4 * scale);
        const tagX = canvas.width - tagWidth - boxMargin;
        const tagRadius = Math.round(10 * scale);
        
        ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
        ctx.beginPath();
        ctx.moveTo(tagX + tagRadius, tagY);
        ctx.lineTo(tagX + tagWidth - tagRadius, tagY);
        ctx.quadraticCurveTo(tagX + tagWidth, tagY, tagX + tagWidth, tagY + tagRadius);
        ctx.lineTo(tagX + tagWidth, tagY + tagHeight);
        ctx.lineTo(tagX, tagY + tagHeight);
        ctx.lineTo(tagX, tagY + tagRadius);
        ctx.quadraticCurveTo(tagX, tagY, tagX + tagRadius, tagY);
        ctx.closePath();
        ctx.fill();
        
        ctx.fillStyle = '#60a5fa';
        ctx.fillText(tagText, tagX + Math.round(18 * scale), tagY + Math.round(25 * scale));
        
        let currentY = startY + boxPadding + Math.round(16 * scale);
        lines.forEach(line => {
          ctx.fillStyle = line.color;
          ctx.font = line.font;
          ctx.fillText(line.text, boxMargin + boxPadding, currentY);
          currentY += lineHeight;
        });
        
        canvas.toBlob((blob) => {
          resolve(blob);
        }, 'image/jpeg', 0.9);
      };
      img.src = originalUrl;
    });
  };

  const handleOpenGallery = () => {
    if (stream) stream.getTracks().forEach(track => track.stop());
    if (onOpenGallery) {
      onOpenGallery();
    } else if (onCancel) {
      onCancel();
    }
  };

  const handleFinish = () => {
    if (stream) stream.getTracks().forEach(track => track.stop());
    if (onOpenGallery) {
      onOpenGallery();
    } else if (onCancel) {
      onCancel();
    }
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', zIndex: 100 }}>
      {/* Header */}
      <div className="flex justify-between items-center p-md" style={{ padding: '16px', color: 'white', zIndex: 20 }}>
        <button onClick={handleFinish} className="text-white flex items-center gap-xs" style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '20px', padding: '6px 14px', cursor: 'pointer', fontSize: '14px', fontWeight: 600 }}>
          <X size={18} /> Done ({capturedCount})
        </button>
        <span className="font-medium text-sm" style={{ backgroundColor: 'rgba(0,0,0,0.5)', padding: '4px 12px', borderRadius: '14px' }}>
          {evidenceType}
        </span>
        <button onClick={toggleCamera} className="text-white" style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%', width: '38px', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <RotateCcw size={18} />
        </button>
      </div>

      {/* Live GPS Status */}
      {evidenceType === 'Location Verification' && (
        <div className="absolute w-full z-10 flex justify-center mt-2" style={{ top: '64px' }}>
          {liveLocation.loading ? (
             <div className="bg-black bg-opacity-70 text-white px-md py-xs rounded-full flex items-center gap-sm text-sm" style={{ padding: '4px 16px', borderRadius: '16px', backgroundColor: 'rgba(0,0,0,0.6)'}}>
               <div className="spinner" style={{ width: '12px', height: '12px', border: '2px solid white', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
               Acquiring GPS...
             </div>
          ) : liveLocation.error ? (
             <div className="bg-black bg-opacity-70 text-warning px-md py-xs rounded-full flex items-center gap-sm text-sm" style={{ padding: '4px 16px', borderRadius: '16px', backgroundColor: 'rgba(0,0,0,0.6)', color: 'var(--warning-color)'}}>
               <AlertTriangle size={16} /> {liveLocation.error}
             </div>
          ) : (
             <div className="bg-black bg-opacity-70 text-success px-md py-xs rounded-full flex items-center gap-sm text-sm" style={{ padding: '4px 16px', borderRadius: '16px', backgroundColor: 'rgba(0,0,0,0.6)', color: 'var(--success-color)'}}>
               <MapPin size={16} /> Accuracy ±{Math.round(liveLocation.accuracy)}m
             </div>
          )}
        </div>
      )}
      
      {/* Viewport preview */}
      <div className="flex-1 relative flex items-center justify-center bg-black" style={{ minHeight: 0, overflow: 'hidden' }}>
        {flashAnimation && (
          <div style={{ position: 'absolute', inset: 0, backgroundColor: 'white', zIndex: 30, opacity: 0.8, pointerEvents: 'none' }} />
        )}
        {cameraError ? (
          <div className="text-center p-md text-white">
            <AlertTriangle size={48} className="mx-auto mb-md text-warning" style={{ margin: '0 auto 16px auto' }} />
            <p className="mb-md">{cameraError}</p>
            <button className="btn btn-outline text-white border-white mt-md" onClick={startCamera}>Try Again</button>
          </div>
        ) : (
          <>
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              style={{ 
                width: '100%', 
                height: '100%', 
                objectFit: 'cover',
                transform: isDigitalZoom ? `scale(${zoom})` : 'none',
                transformOrigin: 'center center',
                transition: 'transform 0.1s ease-out'
              }} 
            />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
          </>
        )}
      </div>
      
      {/* Controls Bar */}
      <div className="flex flex-col items-center justify-end pb-safe bg-black w-full" style={{ padding: '16px 24px 32px 24px', paddingBottom: 'calc(32px + env(safe-area-inset-bottom))' }}>
        {zoomCapabilities && (
          <div className="w-full flex flex-col items-center mb-md" style={{ gap: '6px', maxWidth: '280px' }}>
             <span style={{color: 'white', fontSize: '13px', fontWeight: 'bold'}}>{zoom.toFixed(1)}x</span>
             <div className="w-full flex items-center gap-sm">
               <span style={{color: '#aaa', fontSize: '11px', fontWeight: 'bold'}}>1x</span>
               <input 
                 type="range" 
                 min={zoomCapabilities.min} 
                 max={zoomCapabilities.max} 
                 step={zoomCapabilities.step}
                 value={zoom}
                 onChange={(e) => {
                   const newZoom = parseFloat(e.target.value);
                   setZoom(newZoom);
                   if (stream && !isDigitalZoom) {
                     const track = stream.getVideoTracks()[0];
                     if (track.applyConstraints) {
                       track.applyConstraints({ advanced: [{ zoom: newZoom }] }).catch(err => console.log('Zoom error', err));
                     }
                   }
                 }}
                 style={{ flex: 1, accentColor: 'white' }}
               />
               <span style={{color: '#aaa', fontSize: '11px', fontWeight: 'bold'}}>{zoomCapabilities.max}x</span>
             </div>
          </div>
        )}
        
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: '320px', padding: '0 12px' }}>
          {/* Photos folder trigger / Last thumbnail preview */}
          <button 
            type="button"
            onClick={handleOpenGallery}
            style={{ 
              width: '48px', 
              height: '48px', 
              borderRadius: '8px', 
              overflow: 'hidden', 
              border: '2px solid rgba(255,255,255,0.6)', 
              backgroundColor: '#1e293b', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              position: 'relative',
              padding: 0,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
              transition: 'transform 0.15s ease'
            }}
            title="Open Photos Gallery"
            aria-label="Open Photos Gallery"
          >
            {lastThumbnail ? (
              <img src={lastThumbnail} alt="Latest Captured" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <Camera size={22} color="#cbd5e1" />
            )}
            {capturedCount > 0 && (
              <span style={{
                position: 'absolute',
                top: '2px',
                right: '2px',
                backgroundColor: 'var(--primary-color)',
                color: 'white',
                fontSize: '10px',
                fontWeight: 700,
                borderRadius: '10px',
                padding: '1px 5px',
                minWidth: '14px',
                textAlign: 'center',
                boxShadow: '0 1px 3px rgba(0,0,0,0.6)'
              }}>
                {capturedCount}
              </span>
            )}
          </button>

          {/* Shutter button */}
          <button 
            disabled={!!cameraError || isProcessing}
            onClick={handleCapture}
            style={{
              width: '74px', height: '74px', borderRadius: '50%', 
              backgroundColor: 'white', border: '4px solid #aaa',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: cameraError ? 'not-allowed' : 'pointer'
            }}
            aria-label="Take Photo"
          >
            {isProcessing ? 
              <div style={{ width: '26px', height: '26px', border: '3px solid black', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div> 
              : <div style={{ width: '58px', height: '58px', borderRadius: '50%', border: '2px solid black' }}></div>
            }
          </button>

          {/* Finish / Done button */}
          <button 
            onClick={handleFinish}
            style={{
              minWidth: '56px',
              padding: '8px 12px',
              borderRadius: '20px',
              backgroundColor: capturedCount > 0 ? 'var(--primary-color)' : 'rgba(255,255,255,0.2)',
              color: 'white',
              border: 'none',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer'
            }}
          >
            Done
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
