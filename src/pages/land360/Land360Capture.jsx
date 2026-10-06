import { useState, useEffect, useRef } from 'react';
import { Camera, X, Check, Loader2 } from 'lucide-react';
import { cameraService } from '../../services/platform/CameraService';
import { orientationService } from '../../services/platform/OrientationService';
import { targetEngine } from '../../lib/land360/TargetEngine';
import { land360Service } from '../../services/Land360Service';
import { locationService } from '../../services/platform/LocationService';

export default function Land360Capture({ capturePointId, onComplete, onCancel }) {
  const videoRef = useRef(null);
  const [status, setStatus] = useState('PREPARING'); // PREPARING, CALIBRATING, WAITING, ALIGNED, STABLE, CAPTURING, COMPLETED
  const [progress, setProgress] = useState({ captured: 0, total: 0, percentage: 0 });
  const [currentTarget, setCurrentTarget] = useState(null);
  const [orientation, setOrientation] = useState({ heading: 0, pitch: 0 });
  const [gpsData, setGpsData] = useState(null);

  // Initialize
  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        await cameraService.initialize(videoRef.current);
        const hasPerm = await orientationService.requestPermission();
        if (!hasPerm) {
          alert('Motion access is required for guided 360° capture.');
          return;
        }
        
        try {
          const loc = await locationService.getCurrentPosition();
          if (mounted) setGpsData(loc);
        } catch (err) {
          console.warn("GPS not available", err);
        }

        targetEngine.generateTargets();
        
        orientationService.addListener(handleOrientationUpdate);
        orientationService.startListening();

        if (mounted) {
          updateProgress();
          setStatus('WAITING');
        }
      } catch (err) {
        console.error(err);
        alert('Failed to initialize capture');
        onCancel();
      }
    };
    init();

    return () => {
      mounted = false;
      cameraService.stop();
      orientationService.removeListener(handleOrientationUpdate);
      orientationService.stopListening();
    };
  }, []);

  const handleOrientationUpdate = async (reading) => {
    setOrientation({ heading: reading.heading, pitch: reading.beta });
    
    // Check if we are currently trying to capture, skip if already processing
    setStatus((prevStatus) => {
      if (prevStatus === 'CAPTURING' || prevStatus === 'COMPLETED') return prevStatus;
      
      const target = targetEngine.getCurrentTarget();
      if (!target) {
        return 'COMPLETED'; // all done
      }
      
      // We flip pitch for display/math convenience
      const isAligned = targetEngine.isAligned(reading.heading, reading.beta, target, 8);
      
      if (isAligned) {
        // If stable enough, capture
        if (reading.stability < 3) {
          // Trigger capture in next tick to avoid blocking state
          setTimeout(() => triggerCapture(reading.heading, reading.beta), 50);
          return 'CAPTURING';
        } else {
          return 'ALIGNED';
        }
      } else {
        return 'WAITING';
      }
    });
  };

  const triggerCapture = async (currentHeading, currentPitch) => {
    try {
      const target = targetEngine.getCurrentTarget();
      if (!target) return;

      const dataUri = await cameraService.captureFrame();
      
      await land360Service.saveFrame(
        capturePointId,
        target.heading,
        target.pitch,
        currentHeading,
        currentPitch,
        0, // roll
        dataUri,
        gpsData
      );

      targetEngine.markTargetCaptured(target.id);
      updateProgress();
      
      // Add brief success tick mark flash here
      
      const nextTarget = targetEngine.getCurrentTarget();
      if (!nextTarget) {
        await land360Service.updateCapturePointStatus(capturePointId, 'Completed');
        setStatus('COMPLETED');
        setTimeout(() => {
          onComplete();
        }, 1500);
      } else {
        setStatus('WAITING');
      }

    } catch (err) {
      console.error("Failed to capture", err);
      setStatus('WAITING'); // retry
    }
  };

  const updateProgress = () => {
    setProgress(targetEngine.getProgress());
    setCurrentTarget(targetEngine.getCurrentTarget());
  };

  // Math for target dot position on screen
  const calculateDotPosition = () => {
    if (!currentTarget) return { x: '50%', y: '50%', visible: false };

    // Simple projection: 1 degree diff = 5px movement (tweakable)
    let headingDiff = currentTarget.heading - orientation.heading;
    // Normalize to -180 to 180
    while (headingDiff > 180) headingDiff -= 360;
    while (headingDiff < -180) headingDiff += 360;

    const pitchDiff = currentTarget.pitch - orientation.pitch;

    const pxPerDegree = 10;
    
    // Center is 50% / 50%
    // If target is to the right (positive headingDiff), dot should be right of center.
    let xOffset = headingDiff * pxPerDegree;
    let yOffset = pitchDiff * pxPerDegree;

    // Limit to screen edges
    const maxOffset = 150; 
    const visible = Math.abs(xOffset) < maxOffset && Math.abs(yOffset) < maxOffset;
    
    // Clamp for visual feedback when off-screen
    xOffset = Math.max(-maxOffset, Math.min(maxOffset, xOffset));
    yOffset = Math.max(-maxOffset, Math.min(maxOffset, yOffset));

    return {
      x: `calc(50% + ${xOffset}px)`,
      y: `calc(50% - ${yOffset}px)`, // subtract because pitch positive is up, css y positive is down
      visible
    };
  };

  const dotStyle = calculateDotPosition();

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="absolute top-0 left-0 right-0 p-md flex justify-between items-center bg-gradient-to-b from-black/70 to-transparent z-10 text-white">
        <button onClick={onCancel} className="p-xs bg-black/40 rounded-full">
          <X size={24} />
        </button>
        <div className="font-bold text-center">
          <div>Land 360° Capture</div>
          <div className="text-xs opacity-70">
            {gpsData ? `GPS ±${Math.round(gpsData.accuracy)}m` : 'Finding GPS...'}
          </div>
        </div>
        <div className="w-8"></div>
      </div>

      <div className="relative flex-1 bg-gray-900 overflow-hidden flex items-center justify-center">
        <video 
          ref={videoRef}
          autoPlay 
          playsInline 
          muted 
          className="absolute inset-0 w-full h-full object-cover"
        />

        {/* Reticle */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="w-12 h-12 border-2 border-white/50 rounded-full relative flex items-center justify-center">
            <div className="w-1 h-1 bg-white rounded-full"></div>
            {/* Crosshairs */}
            <div className="absolute top-0 bottom-0 left-1/2 w-[1px] bg-white/30 -ml-[0.5px]"></div>
            <div className="absolute left-0 right-0 top-1/2 h-[1px] bg-white/30 -mt-[0.5px]"></div>
          </div>
        </div>

        {/* Target Dot */}
        {currentTarget && (
          <div 
            className="absolute pointer-events-none flex flex-col items-center justify-center transition-all duration-75"
            style={{ 
              left: dotStyle.x, 
              top: dotStyle.y,
              opacity: dotStyle.visible ? 1 : 0.5,
              transform: 'translate(-50%, -50%)'
            }}
          >
            <div className={`w-8 h-8 rounded-full border-4 flex items-center justify-center
              ${status === 'ALIGNED' ? 'border-warning bg-warning/30' : 
                status === 'CAPTURING' ? 'border-success bg-success' : 'border-primary bg-primary/40'}`}>
              {(status === 'CAPTURING' || status === 'COMPLETED') && <Check size={16} className="text-white" />}
            </div>
          </div>
        )}
        
        {/* Offscreen directional hints could be added here */}

        {/* Status Overlay */}
        <div className="absolute bottom-32 left-0 right-0 text-center">
          <div className={`inline-block px-4 py-2 rounded-full font-bold text-white shadow-lg backdrop-blur-md
            ${status === 'WAITING' ? 'bg-black/50' : 
              status === 'ALIGNED' ? 'bg-warning/80' : 
              status === 'CAPTURING' ? 'bg-success/90' : 'bg-primary/80'}`}>
            {status === 'WAITING' && 'Rotate to Target...'}
            {status === 'ALIGNED' && 'Hold Still'}
            {status === 'CAPTURING' && 'Capturing...'}
            {status === 'COMPLETED' && 'Capture Complete!'}
            {status === 'PREPARING' && <span className="flex items-center gap-2"><Loader2 className="animate-spin" size={16}/> Preparing...</span>}
          </div>
        </div>
      </div>

      <div className="h-24 bg-black p-md pb-8">
        <div className="flex justify-between text-white text-sm mb-xs">
          <span>{progress.captured} / {progress.total} targets</span>
          <span>{Math.round(progress.percentage)}%</span>
        </div>
        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
          <div 
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progress.percentage}%` }}
          />
        </div>
      </div>
    </div>
  );
}
