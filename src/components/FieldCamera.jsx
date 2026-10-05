import { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, X, RotateCcw, MapPin, Navigation, CheckCircle, AlertTriangle } from 'lucide-react';
import { EvidenceService } from '../services/EvidenceService';

export default function FieldCamera({ evidenceType = 'Location Verification', taskId, onSave, onCancel }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  
  const [stream, setStream] = useState(null);
  const [cameraError, setCameraError] = useState(null);
  const [facingMode, setFacingMode] = useState('environment');
  const [capturedPhotoUrl, setCapturedPhotoUrl] = useState(null);
  const [geotaggedPhotoUrl, setGeotaggedPhotoUrl] = useState(null);
  
  const [zoom, setZoom] = useState(1);
  const [zoomCapabilities, setZoomCapabilities] = useState({ min: 1, max: 5, step: 0.1 });
  const [isDigitalZoom, setIsDigitalZoom] = useState(false);
  
  const originalBlobRef = useRef(null);
  const geotaggedBlobRef = useRef(null);
  
  const [liveLocation, setLiveLocation] = useState({
    loading: true, lat: null, lon: null, accuracy: null, timestamp: null, error: null
  });

  const [saving, setSaving] = useState(false);
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

  const handleCapture = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    setIsProcessing(true);
    
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
      originalBlobRef.current = blob;
      const originalDataUrl = URL.createObjectURL(blob);
      setCapturedPhotoUrl(originalDataUrl);
      
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        setStream(null);
      }
      
      if (evidenceType === 'Location Verification') {
        // Fetch address at capture time to save API limits
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
           } catch(e) {
             console.warn("Reverse geocoding failed", e);
           }
        }
        await generateGeotaggedImage(originalDataUrl, { ...liveLocation, address: addressDetails });
      }
      setIsProcessing(false);
    }, 'image/jpeg', 0.9);
  };

  const generateGeotaggedImage = (originalUrl, loc) => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        
        // Setup metrics
        const padding = 12;
        const boxMargin = 12;
        
        // Define overlay box size
        const overlayWidth = canvas.width - (boxMargin * 2);
        
        // We will calculate height dynamically based on lines
        const lines = [];
        if (loc.lat) {
          lines.push({ text: loc.address ? loc.address.short : 'Unknown Location', font: 'bold 16px sans-serif', color: 'white' });
          
          if (loc.address && loc.address.full) {
            // Very basic word wrap for full address
            const words = loc.address.full.split(' ');
            let currentLine = '';
            for (let i = 0; i < words.length; i++) {
              const testLine = currentLine + words[i] + ' ';
              ctx.font = '14px sans-serif';
              const metrics = ctx.measureText(testLine);
              if (metrics.width > overlayWidth - 24 && i > 0) {
                lines.push({ text: currentLine, font: '14px sans-serif', color: '#eaeaea' });
                currentLine = words[i] + ' ';
              } else {
                currentLine = testLine;
              }
            }
            lines.push({ text: currentLine, font: '14px sans-serif', color: '#eaeaea' });
          }
          
          lines.push({ text: `Lat ${loc.lat.toFixed(6)}°  Long ${loc.lon.toFixed(6)}°`, font: 'bold 14px sans-serif', color: 'white' });
          
          const d = new Date(loc.timestamp);
          const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
          const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
          // Format GMT offset
          const offset = -d.getTimezoneOffset();
          const sign = offset >= 0 ? '+' : '-';
          const pad = (num) => String(Math.abs(num)).padStart(2, '0');
          const gmtStr = `GMT${sign}${pad(Math.floor(offset / 60))}:${pad(offset % 60)}`;
          
          lines.push({ text: `${dateStr} ${timeStr} ${gmtStr}`, font: '14px sans-serif', color: 'white' });
        } else {
          lines.push({ text: 'GPS Location Unavailable', font: 'bold 16px sans-serif', color: 'white' });
        }

        const lineHeight = 22;
        const boxHeight = (lines.length * lineHeight) + 20;
        const startY = canvas.height - boxHeight - boxMargin;

        // Draw Rounded Rectangle
        const radius = 12;
        ctx.fillStyle = 'rgba(60, 45, 10, 0.75)'; // A dark brownish/olive tint to match reference
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
        
        // Draw 7DAYS PROPERTIES Tag above the box
        const tagWidth = 240;
        const tagHeight = 36;
        const tagY = startY - tagHeight + 8;
        const tagX = canvas.width - tagWidth - boxMargin;
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.beginPath();
        ctx.moveTo(tagX + radius, tagY);
        ctx.lineTo(tagX + tagWidth - radius, tagY);
        ctx.quadraticCurveTo(tagX + tagWidth, tagY, tagX + tagWidth, tagY + radius);
        ctx.lineTo(tagX + tagWidth, tagY + tagHeight);
        ctx.lineTo(tagX, tagY + tagHeight);
        ctx.lineTo(tagX, tagY + radius);
        ctx.quadraticCurveTo(tagX, tagY, tagX + radius, tagY);
        ctx.closePath();
        ctx.fill();
        
        ctx.fillStyle = 'white';
        ctx.font = 'bold 15px sans-serif';
        ctx.fillText('🏢 7DAYS PROPERTIES', tagX + 16, tagY + 24);
        
        // Draw Text Lines
        let currentY = startY + 26;
        lines.forEach(line => {
          ctx.fillStyle = line.color;
          ctx.font = line.font;
          ctx.fillText(line.text, boxMargin + 16, currentY);
          currentY += lineHeight;
        });
        
        canvas.toBlob((blob) => {
          geotaggedBlobRef.current = blob;
          setGeotaggedPhotoUrl(URL.createObjectURL(blob));
          resolve();
        }, 'image/jpeg', 0.9);
      };
      img.src = originalUrl;
    });
  };

  const handleRetake = () => {
    if (capturedPhotoUrl) URL.revokeObjectURL(capturedPhotoUrl);
    if (geotaggedPhotoUrl) URL.revokeObjectURL(geotaggedPhotoUrl);
    setCapturedPhotoUrl(null);
    setGeotaggedPhotoUrl(null);
    originalBlobRef.current = null;
    geotaggedBlobRef.current = null;
    startCamera();
    if (evidenceType === 'Location Verification') {
      startLocationWatcher();
    }
  };

  const handleSave = async () => {
    setSaving(true);
    await EvidenceService.saveEvidence({
      taskId,
      evidenceType,
      mediaType: 'photo',
      original_blob: originalBlobRef.current,
      geotagged_blob: geotaggedBlobRef.current,
      mime_type: 'image/jpeg',
      size: originalBlobRef.current.size,
      latitude: liveLocation.lat,
      longitude: liveLocation.lon,
      accuracy: liveLocation.accuracy,
      location_captured_at: liveLocation.timestamp || new Date().getTime(),
      captured_at: new Date().toISOString()
    });
    setSaving(false);
    onSave();
  };

  if (!capturedPhotoUrl) {
    return (
      <div className="fixed inset-0 bg-black z-50 flex flex-col" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', zIndex: 100 }}>
        {/* Header */}
        <div className="flex justify-between items-center p-md" style={{ padding: '16px', color: 'white' }}>
          <button onClick={onCancel} className="text-white" style={{ background: 'none', border: 'none' }}><X size={28} /></button>
          <span className="font-medium">{evidenceType}</span>
          <button onClick={toggleCamera} className="text-white" style={{ background: 'none', border: 'none' }}><RotateCcw size={24} /></button>
        </div>

        {/* Live GPS Status */}
        {evidenceType === 'Location Verification' && (
          <div className="absolute w-full z-10 flex justify-center mt-2" style={{ top: '60px' }}>
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
        
        {/* Preview */}
        <div className="flex-1 relative flex items-center justify-center bg-black" style={{ minHeight: 0, overflow: 'hidden' }}>
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
        
        {/* Controls */}
        <div className="flex flex-col items-center justify-end pb-safe bg-black w-full" style={{ padding: '16px 32px 32px 32px', paddingBottom: 'calc(32px + env(safe-area-inset-bottom))' }}>
          {zoomCapabilities && (
            <div className="w-full flex flex-col items-center mb-lg" style={{ gap: '8px', maxWidth: '300px' }}>
               <span style={{color: 'white', fontSize: '14px', fontWeight: 'bold'}}>{zoom.toFixed(1)}x</span>
               <div className="w-full flex items-center gap-sm">
                 <span style={{color: '#aaa', fontSize: '12px', fontWeight: 'bold'}}>1x</span>
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
                 <span style={{color: '#aaa', fontSize: '12px', fontWeight: 'bold'}}>{zoomCapabilities.max}x</span>
               </div>
            </div>
          )}
          
          <button 
            disabled={!!cameraError || isProcessing}
            onClick={handleCapture}
            style={{
              width: '72px', height: '72px', borderRadius: '50%', 
              backgroundColor: 'white', border: '4px solid #aaa',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: cameraError ? 'not-allowed' : 'pointer'
            }}
          >
            {isProcessing ? 
              <div style={{ width: '24px', height: '24px', border: '3px solid black', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div> 
              : <div style={{ width: '56px', height: '56px', borderRadius: '50%', border: '2px solid black' }}></div>
            }
          </button>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Render Review Screen
  return (
    <div className="fixed inset-0 bg-surface z-50 flex flex-col overflow-y-auto" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'var(--bg-color)', zIndex: 100 }}>
      <div className="p-md bg-surface-color border-b border-color" style={{ padding: '16px', backgroundColor: 'var(--surface-color)', borderBottom: '1px solid var(--border-color)' }}>
        <h2 className="text-center" style={{ fontSize: '18px' }}>PHOTO PREVIEW</h2>
      </div>

      <div className="flex-1 p-md" style={{ padding: '16px' }}>
        <div className="card" style={{ padding: '8px', marginBottom: '16px', backgroundColor: '#000' }}>
          <img src={geotaggedPhotoUrl || capturedPhotoUrl} alt="Captured Evidence" style={{ width: '100%', borderRadius: '8px', display: 'block' }} />
        </div>

        <div className="card">
          <div className="flex flex-col gap-sm">
            {evidenceType === 'Location Verification' && (
              <>
                <div className="flex items-center gap-sm py-xs">
                  {!liveLocation.lat ? <AlertTriangle size={20} className="text-warning"/> : <CheckCircle size={20} className="text-success"/>}
                  <span className="font-medium text-sm">{!liveLocation.lat ? 'Location unavailable' : 'Location captured'}</span>
                </div>
                {liveLocation.lat && (
                  <>
                    <div className="flex items-center gap-sm py-xs text-sm text-secondary">
                      <CheckCircle size={16} /> Accuracy: ±{Math.round(liveLocation.accuracy)} m
                    </div>
                    <div className="flex items-center gap-sm py-xs text-sm text-secondary">
                      <CheckCircle size={16} /> GPS coordinates available
                    </div>
                  </>
                )}
              </>
            )}
            {evidenceType !== 'Location Verification' && (
              <div className="flex items-center gap-sm py-xs">
                <CheckCircle size={20} className="text-success"/>
                <span className="font-medium text-sm">Photo Captured Successfully</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-md flex gap-md bg-surface-color border-t border-color pb-safe" style={{ padding: '16px', display: 'flex', gap: '16px', backgroundColor: 'var(--surface-color)', borderTop: '1px solid var(--border-color)', paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}>
        <button className="btn btn-secondary flex-1" onClick={handleRetake} disabled={saving}>
          <RotateCcw size={18} /> Retake
        </button>
        <button className="btn btn-primary flex-1" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Confirm & Save'}
        </button>
      </div>
    </div>
  );
}
