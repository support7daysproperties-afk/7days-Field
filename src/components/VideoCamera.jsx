import { useState, useRef, useEffect, useCallback } from 'react';
import { Video, X, RotateCcw, MapPin, Play, Square, CheckCircle, AlertTriangle } from 'lucide-react';
import { EvidenceService } from '../services/EvidenceService';

const EXPECTED_LAT = 11.41;
const EXPECTED_LON = 76.69;

export default function VideoCamera({ evidenceType = 'Exterior', taskId, onSave, onCancel }) {
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  
  const [stream, setStream] = useState(null);
  const [error, setError] = useState(null);
  const [facingMode, setFacingMode] = useState('environment');
  
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [timerInterval, setTimerInterval] = useState(null);
  
  const [zoom, setZoom] = useState(1);
  const [zoomCapabilities, setZoomCapabilities] = useState({ min: 1, max: 5, step: 0.1 });
  const [isDigitalZoom, setIsDigitalZoom] = useState(false);
  const zoomRef = useRef(1);
  const canvasRef = useRef(null);
  const requestRef = useRef(null);
  
  const [recordedVideoUrl, setRecordedVideoUrl] = useState(null);
  
  const [locationData, setLocationData] = useState({
    loading: false,
    lat: null,
    lon: null,
    accuracy: null,
    status: null,
    distanceKm: null,
    error: null,
    timestamp: null
  });

  const [saving, setSaving] = useState(false);

  const startCamera = useCallback(async (currentFacingMode = facingMode) => {
    setError(null);

    if (window.isSecureContext === false) {
      setError('Camera Requires Secure Access. Open using HTTPS or localhost.');
      return;
    }
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('No Camera Found or browser not supported.');
      return;
    }

    try {
      let mediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: currentFacingMode } },
          audio: true
        });
      } catch (fallbackErr) {
        mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
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
         zoomRef.current = 1;
      } else {
         setZoomCapabilities({ min: 1, max: maxAllowed, step: 0.1 });
         setIsDigitalZoom(true);
         setZoom(1);
         zoomRef.current = 1;
      }
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
        setError('Camera Permission Blocked. Please allow camera access in your browser settings and try again.');
      } else if (err.name === 'NotFoundError') {
        setError('No Camera Found. We couldn\'t find a camera on this device.');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setError('Camera Unavailable. Another application may be using the camera. Close it and try again.');
      } else {
        setError('We couldn\'t start the camera. Please try again.');
      }
    }
  }, [facingMode]);

  useEffect(() => {
    startCamera();
    return () => {
      if (stream) stream.getTracks().forEach(track => track.stop());
      if (timerInterval) clearInterval(timerInterval);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [startCamera]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCamera = () => {
    if (isRecording) return;
    if (stream) stream.getTracks().forEach(track => track.stop());
    const newMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(newMode);
    startCamera(newMode);
  };

  const videoBlobRef = useRef(null);

  const startRecording = () => {
    if (!stream) return;
    chunksRef.current = [];
    
    let recordStream = stream;
    
    if (isDigitalZoom && canvasRef.current && videoRef.current) {
      // Pipe video to canvas for digital zoom recording
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      
      const renderFrame = () => {
        if (!isRecording) return; // will be set immediately after
        if (video.videoWidth && canvas.width) {
          const ctx = canvas.getContext('2d');
          const currentZoom = zoomRef.current;
          const sw = video.videoWidth / currentZoom;
          const sh = video.videoHeight / currentZoom;
          const sx = (video.videoWidth - sw) / 2;
          const sy = (video.videoHeight - sh) / 2;
          ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        }
        requestRef.current = requestAnimationFrame(renderFrame);
      };
      
      requestRef.current = requestAnimationFrame(renderFrame);
      
      // Combine canvas video stream with original audio stream
      const canvasStream = canvas.captureStream(30);
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        canvasStream.addTrack(audioTracks[0]);
      }
      recordStream = canvasStream;
    }

    const options = {};
    if (typeof MediaRecorder.isTypeSupported === 'function') {
      if (MediaRecorder.isTypeSupported('video/mp4')) options.mimeType = 'video/mp4';
      else if (MediaRecorder.isTypeSupported('video/webm')) options.mimeType = 'video/webm';
    }
    const mediaRecorder = new MediaRecorder(recordStream, options);
    
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    
    mediaRecorder.onstop = () => {
      const actualType = mediaRecorder.mimeType || (chunksRef.current[0] && chunksRef.current[0].type) || 'video/mp4';
      const blob = new Blob(chunksRef.current, { type: actualType });
      videoBlobRef.current = blob;
      const url = URL.createObjectURL(blob);
      setRecordedVideoUrl(url);
      if (evidenceType === 'Location Verification') {
        obtainLocation(url); // Get location when recording stops
      }
    };
    
    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start();
    setIsRecording(true);
    setRecordingTime(0);
    
    const interval = setInterval(() => {
      setRecordingTime(prev => prev + 1);
    }, 1000);
    setTimerInterval(interval);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(timerInterval);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (stream) stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const obtainLocation = (videoUrl) => {
    setLocationData(prev => ({ ...prev, loading: true, timestamp: new Date() }));
    
    if (!navigator.geolocation) {
      setLocationData(prev => ({ ...prev, loading: false, error: 'GPS unavailable' }));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        const accuracy = position.coords.accuracy;
        const distance = EvidenceService.calculateDistance(lat, lon, EXPECTED_LAT, EXPECTED_LON);
        const status = EvidenceService.getLocationStatus(distance);
        
        setLocationData({ lat, lon, accuracy, distanceKm: distance, status, loading: false, error: null, timestamp: new Date() });
      },
      (err) => {
        setLocationData(prev => ({ ...prev, loading: false, error: 'GPS unavailable' }));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleRetake = () => {
    if (recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
    setRecordedVideoUrl(null);
    videoBlobRef.current = null;
    setLocationData({ loading: false, lat: null, lon: null, accuracy: null, status: null, distanceKm: null, error: null, timestamp: null });
    startCamera();
  };

  const handleSave = async () => {
    setSaving(true);
    await EvidenceService.saveEvidence({
      taskId,
      evidenceType,
      mediaType: 'video',
      original_blob: videoBlobRef.current,
      mime_type: 'video/webm',
      size: videoBlobRef.current.size,
      duration: recordingTime,
      latitude: locationData.lat,
      longitude: locationData.lon,
      accuracy: locationData.accuracy,
      location_captured_at: locationData.timestamp || new Date().getTime(),
      captured_at: new Date().toISOString()
    });
    setSaving(false);
    onSave();
  };

  if (!recordedVideoUrl) {
    return (
      <div className="fixed inset-0 bg-black z-50 flex flex-col" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', zIndex: 100, display: 'flex', flexDirection: 'column' }}>
        <div className="flex justify-between items-center p-md" style={{ padding: '16px', color: 'white' }}>
          <button onClick={onCancel} className="text-white" style={{ background: 'none', border: 'none' }} disabled={isRecording}><X size={28} /></button>
          <span className="font-medium">{isRecording ? <span className="text-danger flex items-center gap-xs"><span style={{width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--danger-color)'}}></span> Recording {formatTime(recordingTime)}</span> : evidenceType}</span>
          <button onClick={toggleCamera} className="text-white" style={{ background: 'none', border: 'none' }} disabled={isRecording}><RotateCcw size={24} /></button>
        </div>
        
        <div className="flex-1 relative flex items-center justify-center bg-black" style={{ minHeight: 0, overflow: 'hidden' }}>
          {error ? (
            <div className="text-center p-md text-white">
              <AlertTriangle size={48} className="mx-auto mb-md text-warning" style={{ margin: '0 auto 16px auto' }} />
              <p className="mb-md">{error}</p>
              <button className="btn btn-outline text-white border-white" onClick={() => startCamera()}>Try Again</button>
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
                  transform: isDigitalZoom ? `scale(${zoom})` : 'none',
                  transformOrigin: 'center center',
                  transition: 'transform 0.1s ease-out'
                }} 
              />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
            </>
          )}
        </div>
        
        <div className="flex flex-col items-center justify-end pb-safe bg-black w-full" style={{ padding: '16px 32px 32px 32px', paddingBottom: 'calc(32px + env(safe-area-inset-bottom))' }}>
          {!isRecording && zoomCapabilities && (
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
                     zoomRef.current = newZoom;
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

          {!isRecording ? (
            <button 
              disabled={!!error}
              onClick={startRecording}
              style={{ width: '72px', height: '72px', borderRadius: '50%', backgroundColor: 'white', border: '4px solid #aaa', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: error ? 'not-allowed' : 'pointer' }}
            >
              <div style={{ width: '56px', height: '56px', borderRadius: '50%', backgroundColor: 'var(--danger-color)' }}></div>
            </button>
          ) : (
            <button 
              onClick={stopRecording}
              style={{ width: '72px', height: '72px', borderRadius: '50%', backgroundColor: 'white', border: '4px solid #aaa', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <Square size={24} color="black" fill="black" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-surface z-50 flex flex-col overflow-y-auto" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'var(--bg-color)', zIndex: 100, display: 'flex', flexDirection: 'column' }}>
      <div className="p-md bg-surface-color border-b border-color" style={{ padding: '16px', backgroundColor: 'var(--surface-color)', borderBottom: '1px solid var(--border-color)' }}>
        <h2 className="text-center" style={{ fontSize: '18px' }}>Review Video</h2>
      </div>

      <div className="flex-1 p-md" style={{ padding: '16px' }}>
        <div className="card" style={{ padding: '8px', marginBottom: '16px' }}>
          <video src={recordedVideoUrl} controls playsInline style={{ width: '100%', borderRadius: '8px', display: 'block' }} />
        </div>

        <div className="card">
          <div className="flex flex-col gap-sm">
            <div className="flex justify-between items-center py-xs border-b border-color">
              <span className="text-secondary text-sm">Duration</span>
              <span className="text-sm font-medium">{formatTime(recordingTime)}</span>
            </div>
            
            {evidenceType === 'Location Verification' && (
              <div className="flex justify-between items-center py-xs border-b border-color">
                <span className="text-secondary text-sm">Location Status</span>
                {locationData.loading ? (
                  <span className="text-primary text-sm">Obtaining GPS...</span>
                ) : locationData.error ? (
                  <span className="badge badge-warning">GPS Unavailable</span>
                ) : (
                  <span className="badge badge-success">GPS Available</span>
                )}
              </div>
            )}
            
            <div className="flex justify-between py-xs">
              <span className="text-secondary text-sm">Category</span>
              <span className="text-sm font-medium">{evidenceType}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-md flex gap-md bg-surface-color border-t border-color pb-safe" style={{ padding: '16px', display: 'flex', gap: '16px', backgroundColor: 'var(--surface-color)', borderTop: '1px solid var(--border-color)', paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}>
        <button className="btn btn-secondary flex-1" onClick={handleRetake} disabled={saving}>
          <RotateCcw size={18} /> Retake
        </button>
        <button className="btn btn-primary flex-1" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Video'}
        </button>
      </div>
    </div>
  );
}
