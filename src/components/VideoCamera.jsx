import { useState, useRef, useEffect, useCallback } from 'react';
import { Video, X, RotateCcw, MapPin, Play, Square, CheckCircle, AlertTriangle, Smartphone } from 'lucide-react';
import { EvidenceService } from '../services/EvidenceService';
import useBackHandler from '../hooks/useBackHandler';

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

  // Dual Orientation Management (Horizontal & Vertical)
  const [manualOrientation, setManualOrientation] = useState(null); // null (auto) | 'portrait' | 'landscape'
  const [isWindowLandscape, setIsWindowLandscape] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth > window.innerHeight;
    }
    return false;
  });
  const [deviceTilt, setDeviceTilt] = useState('portrait'); // 'portrait' | 'landscape'

  // Screen orientation unlock & dynamic listener
  useEffect(() => {
    // Release any previous orientation locks so the phone can freely rotate
    if (typeof window !== 'undefined' && window.screen?.orientation?.unlock) {
      try {
        window.screen.orientation.unlock();
      } catch (_) {}
    }

    const checkWindowOrientation = () => {
      const isLand = window.innerWidth > window.innerHeight || 
        (window.screen?.orientation?.type ? window.screen.orientation.type.includes('landscape') : false);
      setIsWindowLandscape(isLand);
    };

    const handleDeviceOrientation = (event) => {
      const { beta, gamma } = event;
      if (beta === null || gamma === null) return;
      const absG = Math.abs(gamma);
      const absB = Math.abs(beta);
      if (absG > 45 || (absB < 35 && absG > 25)) {
        setDeviceTilt('landscape');
      } else if (absB > 50 && absG < 35) {
        setDeviceTilt('portrait');
      }
    };

    window.addEventListener('resize', checkWindowOrientation);
    window.addEventListener('orientationchange', checkWindowOrientation);
    if (window.screen?.orientation) {
      window.screen.orientation.addEventListener('change', checkWindowOrientation);
    }
    window.addEventListener('deviceorientation', handleDeviceOrientation, true);

    checkWindowOrientation();

    return () => {
      window.removeEventListener('resize', checkWindowOrientation);
      window.removeEventListener('orientationchange', checkWindowOrientation);
      if (window.screen?.orientation) {
        window.screen.orientation.removeEventListener('change', checkWindowOrientation);
      }
      window.removeEventListener('deviceorientation', handleDeviceOrientation, true);
    };
  }, []);

  const isLandscape = manualOrientation !== null 
    ? manualOrientation === 'landscape' 
    : (isWindowLandscape || deviceTilt === 'landscape');

  const toggleOrientationMode = () => {
    setManualOrientation(prev => {
      if (prev === null) {
        return isLandscape ? 'portrait' : 'landscape';
      }
      return prev === 'landscape' ? 'portrait' : 'landscape';
    });
  };

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
          video: {
            facingMode: { ideal: currentFacingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          audio: true
        });
      } catch (audioErr) {
        console.warn('Audio stream failed, falling back to video-only:', audioErr);
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: currentFacingMode },
              width: { ideal: 1920 },
              height: { ideal: 1080 }
            },
            audio: false
          });
        } catch (fallbackErr) {
          mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
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
    
    // Select the best supported mime type for Android Chromium
    let options = {};
    const candidateTypes = [
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4'
    ];
    for (const type of candidateTypes) {
      if (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(type)) {
        options = { mimeType: type };
        break;
      }
    }

    try {
      // Record directly from the camera hardware MediaStream
      const mediaRecorder = new MediaRecorder(stream, options);
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        // Clean up stream tracks after recorder has completely finished writing
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
          setStream(null);
        }
        
        const actualType = mediaRecorder.mimeType || options.mimeType || 'video/webm';
        const blob = new Blob(chunksRef.current, { type: actualType });
        videoBlobRef.current = blob;
        const url = URL.createObjectURL(blob);
        setRecordedVideoUrl(url);
        if (evidenceType === 'Location Verification') {
          obtainLocation(url);
        }
      };
      
      mediaRecorderRef.current = mediaRecorder;
      // Timeslice of 500ms ensures periodic data packets and robust container headers
      mediaRecorder.start(500);
      setIsRecording(true);
      setRecordingTime(0);
      
      const interval = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
      setTimerInterval(interval);
    } catch (err) {
      console.error('Failed to start MediaRecorder:', err);
      setError('Failed to start video recording: ' + err.message);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      setIsRecording(false);
      if (timerInterval) clearInterval(timerInterval);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
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

  // Back from Video Preview returns to live camera without discarding anything else
  useBackHandler(
    'video_preview_back',
    () => {
      handleRetake();
      return true;
    },
    95,
    Boolean(recordedVideoUrl)
  );

  // Back while recording safely finishes/stops recording rather than quitting
  useBackHandler(
    'video_recording_back',
    () => {
      stopRecording();
      return true;
    },
    95,
    isRecording
  );

  const handleSave = async () => {
    if (!videoBlobRef.current) return;
    setSaving(true);
    const mime = videoBlobRef.current.type || 'video/webm';
    await EvidenceService.saveEvidence({
      taskId,
      evidenceType,
      mediaType: 'video',
      original_blob: videoBlobRef.current,
      mime_type: mime,
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

  // 1. LIVE CAMERA VIEWFINDER (Not Review Mode)
  if (!recordedVideoUrl) {
    // A. LANDSCAPE (HORIZONTAL) LIVE VIEW
    if (isLandscape) {
      return (
        <div 
          className="fixed inset-0 bg-black z-50 overflow-hidden select-none" 
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', zIndex: 100 }}
        >
          {/* Edge-to-Edge Viewfinder */}
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {error ? (
              <div className="text-center p-md text-white" style={{ zIndex: 10 }}>
                <AlertTriangle size={44} className="mx-auto mb-md text-warning" style={{ margin: '0 auto 12px auto' }} />
                <p className="mb-md" style={{ maxWidth: '300px' }}>{error}</p>
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
                    position: 'absolute',
                    inset: 0,
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

          {/* Top-Left Floating Header Bar */}
          <div 
            style={{ 
              position: 'absolute', 
              top: 'calc(var(--safe-area-top, 12px) + 8px)', 
              left: 'calc(env(safe-area-inset-left, 0px) + 12px)', 
              zIndex: 40, 
              display: 'flex', 
              alignItems: 'center', 
              gap: '10px' 
            }}
          >
            <button 
              onClick={onCancel} 
              className="text-white" 
              style={{ 
                width: '38px', 
                height: '38px', 
                borderRadius: '50%', 
                backgroundColor: 'rgba(0,0,0,0.55)', 
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255,255,255,0.25)', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                cursor: 'pointer' 
              }} 
              disabled={isRecording}
            >
              <X size={22} />
            </button>

            <div 
              style={{ 
                backgroundColor: 'rgba(0,0,0,0.65)', 
                backdropFilter: 'blur(8px)', 
                border: '1px solid rgba(255,255,255,0.2)', 
                padding: '6px 14px', 
                borderRadius: '20px', 
                color: 'white', 
                fontSize: '13px', 
                fontWeight: 600, 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px' 
              }}
            >
              {isRecording ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ef4444' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#ef4444', display: 'inline-block' }}></span>
                  Recording {formatTime(recordingTime)}
                </span>
              ) : (
                <span>{evidenceType}</span>
              )}
            </div>

            <button
              onClick={toggleOrientationMode}
              disabled={isRecording}
              title="Tap to toggle between Horizontal & Vertical mode"
              style={{
                backgroundColor: 'rgba(0,0,0,0.65)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255,255,255,0.25)',
                padding: '6px 12px',
                borderRadius: '20px',
                color: '#60a5fa',
                fontSize: '12px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer'
              }}
            >
              <Smartphone size={14} style={{ transform: 'rotate(90deg)' }} />
              <span>Horizontal</span>
            </button>
          </div>

          {/* Right-Side Floating Camera Controls Bar (Landscape Optimized) */}
          <div 
            style={{ 
              position: 'absolute', 
              top: 0, 
              right: 0, 
              bottom: 0, 
              width: 'calc(100px + env(safe-area-inset-right, 0px))', 
              zIndex: 40, 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center', 
              justifyContent: 'center', 
              gap: '20px', 
              background: 'linear-gradient(to left, rgba(0,0,0,0.7), transparent)',
              paddingRight: 'env(safe-area-inset-right, 0px)' 
            }}
          >
            {/* Flip Camera Button */}
            <button 
              onClick={toggleCamera} 
              className="text-white" 
              style={{ 
                width: '42px', 
                height: '42px', 
                borderRadius: '50%', 
                backgroundColor: 'rgba(255,255,255,0.2)', 
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255,255,255,0.3)', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                cursor: 'pointer' 
              }} 
              disabled={isRecording}
              title="Switch camera"
            >
              <RotateCcw size={20} />
            </button>

            {/* Shutter / Record Button */}
            {!isRecording ? (
              <button 
                disabled={!!error}
                onClick={startRecording}
                style={{ 
                  width: '72px', 
                  height: '72px', 
                  borderRadius: '50%', 
                  backgroundColor: 'white', 
                  border: '4px solid #aaa', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  cursor: error ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.5)'
                }}
              >
                <div style={{ width: '56px', height: '56px', borderRadius: '50%', backgroundColor: 'var(--danger-color, #ef4444)' }}></div>
              </button>
            ) : (
              <button 
                onClick={stopRecording}
                style={{ 
                  width: '72px', 
                  height: '72px', 
                  borderRadius: '50%', 
                  backgroundColor: 'white', 
                  border: '4px solid #aaa', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.5)'
                }}
              >
                <Square size={24} color="black" fill="black" />
              </button>
            )}

            {/* Zoom Control in Landscape */}
            {!isRecording && zoomCapabilities && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                <span style={{ color: 'white', fontSize: '11px', fontWeight: 'bold' }}>{zoom.toFixed(1)}x</span>
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
                  style={{ width: '64px', accentColor: 'white' }}
                />
              </div>
            )}
          </div>
        </div>
      );
    }

    // B. PORTRAIT (VERTICAL) LIVE VIEW
    return (
      <div className="fixed inset-0 bg-black z-50 flex flex-col" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', zIndex: 100, display: 'flex', flexDirection: 'column' }}>
        {/* Header Bar */}
        <div className="flex justify-between items-center p-md" style={{ padding: '12px 16px', paddingTop: 'calc(var(--safe-area-top, 36px) + 12px)', color: 'white' }}>
          <button onClick={onCancel} className="text-white" style={{ background: 'none', border: 'none' }} disabled={isRecording}><X size={28} /></button>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="font-medium" style={{ fontSize: '14px' }}>
              {isRecording ? (
                <span className="text-danger flex items-center gap-xs" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ef4444' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#ef4444' }}></span> 
                  Recording {formatTime(recordingTime)}
                </span>
              ) : (
                evidenceType
              )}
            </span>
            <button
              onClick={toggleOrientationMode}
              disabled={isRecording}
              title="Tap to switch orientation"
              style={{
                backgroundColor: 'rgba(255,255,255,0.15)',
                border: 'none',
                borderRadius: '16px',
                padding: '4px 10px',
                color: 'white',
                fontSize: '11px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer'
              }}
            >
              <Smartphone size={12} />
              <span>Vertical</span>
            </button>
          </div>

          <button onClick={toggleCamera} className="text-white" style={{ background: 'none', border: 'none' }} disabled={isRecording}><RotateCcw size={24} /></button>
        </div>
        
        {/* Viewfinder Area */}
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
        
        {/* Bottom Controls Bar */}
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
              <div style={{ width: '56px', height: '56px', borderRadius: '50%', backgroundColor: 'var(--danger-color, #ef4444)' }}></div>
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

  // 2. REVIEW VIDEO SCREEN
  // A. LANDSCAPE REVIEW
  if (isLandscape) {
    return (
      <div className="fixed inset-0 bg-surface z-50 flex flex-col" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'var(--bg-color)', zIndex: 100, display: 'flex', flexDirection: 'column' }}>
        <div className="p-sm bg-surface-color border-b border-color flex justify-between items-center" style={{ padding: '8px 16px', backgroundColor: 'var(--surface-color)', borderBottom: '1px solid var(--border-color)' }}>
          <h2 style={{ fontSize: '16px', margin: 0 }}>Review Video ({isLandscape ? 'Horizontal' : 'Vertical'})</h2>
          <span className="badge badge-success text-xs">Ready</span>
        </div>

        <div className="flex-1 flex flex-row gap-md p-md items-center justify-center overflow-hidden" style={{ display: 'flex', flexDirection: 'row', gap: '16px', padding: '12px 16px', minHeight: 0 }}>
          {/* Video Preview on Left */}
          <div style={{ flex: 1.3, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#000', borderRadius: '8px', overflow: 'hidden' }}>
            <video 
              src={recordedVideoUrl} 
              controls 
              playsInline 
              preload="auto"
              style={{ width: '100%', height: '100%', objectFit: 'contain' }} 
            />
          </div>

          {/* Details & Actions on Right */}
          <div style={{ flex: 0.85, maxWidth: '340px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div className="card" style={{ padding: '10px' }}>
              <div className="flex flex-col gap-xs">
                <div className="flex justify-between items-center py-xs border-b border-color">
                  <span className="text-secondary text-xs">Duration</span>
                  <span className="text-xs font-medium">{formatTime(recordingTime)}</span>
                </div>
                
                {evidenceType === 'Location Verification' && (
                  <div className="flex justify-between items-center py-xs border-b border-color">
                    <span className="text-secondary text-xs">Location</span>
                    {locationData.loading ? (
                      <span className="text-primary text-xs">Obtaining GPS...</span>
                    ) : locationData.error ? (
                      <span className="badge badge-warning text-xs">GPS Unavailable</span>
                    ) : (
                      <span className="badge badge-success text-xs">GPS Available</span>
                    )}
                  </div>
                )}
                
                <div className="flex justify-between py-xs">
                  <span className="text-secondary text-xs">Category</span>
                  <span className="text-xs font-medium">{evidenceType}</span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
              <button className="btn btn-secondary flex-1" onClick={handleRetake} disabled={saving} style={{ padding: '10px' }}>
                <RotateCcw size={16} /> Retake
              </button>
              <button className="btn btn-primary flex-1" onClick={handleSave} disabled={saving} style={{ padding: '10px' }}>
                {saving ? 'Saving...' : 'Save Video'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // B. PORTRAIT REVIEW
  return (
    <div className="fixed inset-0 bg-surface z-50 flex flex-col overflow-y-auto" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'var(--bg-color)', zIndex: 100, display: 'flex', flexDirection: 'column' }}>
      <div className="p-md bg-surface-color border-b border-color" style={{ padding: '14px 16px', paddingTop: 'calc(var(--safe-area-top, 36px) + 12px)', backgroundColor: 'var(--surface-color)', borderBottom: '1px solid var(--border-color)' }}>
        <h2 className="text-center" style={{ fontSize: '18px' }}>Review Video</h2>
      </div>

      <div className="flex-1 p-md" style={{ padding: '16px' }}>
        <div className="card" style={{ padding: '8px', marginBottom: '16px' }}>
          <video 
            src={recordedVideoUrl} 
            controls 
            playsInline 
            preload="auto"
            style={{ width: '100%', borderRadius: '8px', display: 'block', maxHeight: '55vh', backgroundColor: '#000' }} 
          />
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
