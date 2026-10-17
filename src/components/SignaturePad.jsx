import { useRef, useState, useEffect } from 'react';
import { Maximize2, Minimize2, RotateCcw, Check } from 'lucide-react';

export default function SignaturePad({ onSave, onClear, initialSignature = null }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(!!initialSignature);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const savedDataUrlRef = useRef(null);

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resizeCanvas = () => {
      // Save existing image data before resize if there's a signature
      const ctx = canvas.getContext('2d');
      if (hasSignature && canvas.width > 0 && canvas.height > 0) {
        try {
          savedDataUrlRef.current = canvas.toDataURL();
        } catch (e) {
          console.error("Could not save image data during resize", e);
        }
      }

      const rect = container.getBoundingClientRect();
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      
      // Set actual internal dimensions based on container layout size and DPR
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      
      ctx.strokeStyle = '#ffffff'; // White ink for dark theme
      ctx.lineWidth = 3 * ratio; // Scale stroke width by DPR
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (savedDataUrlRef.current) {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0);
        };
        img.src = savedDataUrlRef.current;
      }
    };

    // Use ResizeObserver for robust layout changes
    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
    });
    resizeObserver.observe(container);
    
    // Prevent scrolling while touching the canvas
    const preventScroll = (e) => e.preventDefault();
    canvas.addEventListener('touchstart', preventScroll, { passive: false });
    canvas.addEventListener('touchmove', preventScroll, { passive: false });
    
    return () => {
      resizeObserver.disconnect();
      canvas.removeEventListener('touchstart', preventScroll);
      canvas.removeEventListener('touchmove', preventScroll);
    };
  }, [hasSignature, isFullScreen]);

  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    // Calculate scale factors in case CSS dimensions differ from internal dimensions
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const startDrawing = (e) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { x, y } = getCoordinates(e);
    
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
    setHasSignature(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { x, y } = getCoordinates(e);
    
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (isDrawing) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.closePath();
      setIsDrawing(false);
    }
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    savedDataUrlRef.current = null;
    setHasSignature(false);
    if (onClear) onClear();
  };

  const handleSave = () => {
    if (!hasSignature) return;
    const canvas = canvasRef.current;
    canvas.toBlob((blob) => {
      const dataUrl = URL.createObjectURL(blob);
      onSave(dataUrl, blob);
    }, 'image/png');
  };

  const handleOpenFullScreen = () => {
    if (hasSignature && canvasRef.current) {
      try {
        savedDataUrlRef.current = canvasRef.current.toDataURL();
      } catch (e) {}
    }
    setIsFullScreen(true);
  };

  const handleExitFullScreen = () => {
    if (hasSignature && canvasRef.current) {
      try {
        savedDataUrlRef.current = canvasRef.current.toDataURL();
      } catch (e) {}
    }
    setIsFullScreen(false);
  };

  // Full Screen Mode View
  if (isFullScreen) {
    return (
      <div 
        className="fixed inset-0 z-50 flex flex-col animate-fade-in"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 10002,
          backgroundColor: 'var(--bg-color)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* Top Header */}
        <div 
          style={{
            padding: '12px 16px',
            backgroundColor: 'var(--surface-color)',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
              Owner Signature (Full Screen)
            </h3>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              Sign with finger or stylus • Rotate phone for more space
            </span>
          </div>
          <button
            type="button"
            onClick={handleExitFullScreen}
            className="btn btn-secondary"
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              borderRadius: '8px'
            }}
          >
            <Minimize2 size={15} /> Exit Full Screen
          </button>
        </div>

        {/* Canvas Area */}
        <div 
          ref={containerRef}
          style={{
            flex: 1,
            margin: '12px 16px',
            backgroundColor: 'var(--surface-color)',
            border: '1.5px dashed rgba(59, 130, 246, 0.4)',
            borderRadius: '12px',
            touchAction: 'none',
            overflow: 'hidden',
            position: 'relative'
          }}
        >
          {!hasSignature && (
            <div 
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
                color: 'var(--text-secondary)'
              }}
            >
              <span style={{ fontSize: '18px', fontWeight: 500, opacity: 0.7 }}>Sign anywhere in this space</span>
              <span style={{ fontSize: '12px', marginTop: '4px', opacity: 0.5 }}>Rotate device horizontally if more width is needed</span>
            </div>
          )}

          <div 
            style={{ 
              position: 'absolute', 
              bottom: '50px', 
              left: '30px', 
              right: '30px', 
              height: '1px', 
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              pointerEvents: 'none',
              display: 'flex',
              justifyContent: 'flex-end'
            }}
          >
            <span style={{ fontSize: '10px', color: 'rgba(255, 255, 255, 0.35)', marginTop: '4px' }}>
              Signature Line
            </span>
          </div>

          <canvas
            ref={canvasRef}
            className="cursor-crosshair"
            style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none' }}
            onPointerDown={startDrawing}
            onPointerMove={draw}
            onPointerUp={stopDrawing}
            onPointerCancel={stopDrawing}
            onPointerLeave={stopDrawing}
          />
        </div>

        {/* Bottom Actions */}
        <div 
          style={{
            padding: '14px 16px',
            backgroundColor: 'var(--surface-color)',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            gap: '12px',
            paddingBottom: 'calc(14px + env(safe-area-inset-bottom))'
          }}
        >
          <button 
            type="button"
            className="btn btn-secondary" 
            onClick={handleClear}
            disabled={!hasSignature}
            style={{ flex: 1, padding: '12px', fontSize: '14px', borderRadius: '8px' }}
          >
            <RotateCcw size={15} style={{ marginRight: '6px' }} /> Clear
          </button>
          <button 
            type="button"
            className="btn btn-primary" 
            onClick={() => {
              handleSave();
              setIsFullScreen(false);
            }}
            disabled={!hasSignature}
            style={{ flex: 2, padding: '12px', fontSize: '14px', fontWeight: 700, borderRadius: '8px' }}
          >
            <Check size={16} strokeWidth={3} style={{ marginRight: '6px' }} /> Save & Apply
          </button>
        </div>
      </div>
    );
  }

  // Standard (Embedded) Mode View
  return (
    <div className="signature-pad-wrapper flex flex-col gap-md">
      <div 
        ref={containerRef}
        className="relative bg-surface rounded"
        style={{ 
          height: '220px', 
          border: '1px solid var(--border-color)',
          touchAction: 'none',
          overflow: 'hidden',
          position: 'relative'
        }}
      >
        {/* Full Screen button overlay in corner */}
        <button
          type="button"
          onClick={handleOpenFullScreen}
          title="Sign in Full Screen"
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            zIndex: 10,
            backgroundColor: 'rgba(30, 41, 59, 0.85)',
            border: '1px solid rgba(59, 130, 246, 0.4)',
            borderRadius: '6px',
            color: '#60a5fa',
            padding: '5px 10px',
            fontSize: '12px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            cursor: 'pointer',
            backdropFilter: 'blur(4px)',
            boxShadow: '0 2px 6px rgba(0,0,0,0.3)'
          }}
        >
          <Maximize2 size={13} strokeWidth={2.5} /> Full Screen
        </button>

        {/* Placeholder text */}
        {!hasSignature && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-secondary">
            <span style={{ fontSize: '14px', fontWeight: 500 }}>Sign here</span>
            <span style={{ fontSize: '11px', marginTop: '2px', opacity: 0.6 }}>or tap Full Screen for more space</span>
          </div>
        )}
        
        {/* Subtle Baseline */}
        <div 
          className="absolute pointer-events-none" 
          style={{ 
            bottom: '40px', left: '20px', right: '20px', 
            height: '1px', backgroundColor: 'var(--border-color)', opacity: 0.5 
          }}
        ></div>

        <canvas
          ref={canvasRef}
          className="cursor-crosshair"
          style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none' }}
          onPointerDown={startDrawing}
          onPointerMove={draw}
          onPointerUp={stopDrawing}
          onPointerCancel={stopDrawing}
          onPointerLeave={stopDrawing}
        />
      </div>

      <div className="flex gap-sm">
        <button 
          type="button"
          className="btn btn-secondary flex-1" 
          onClick={handleClear}
          disabled={!hasSignature}
        >
          Clear
        </button>
        <button 
          type="button"
          className="btn btn-secondary flex-1" 
          onClick={handleOpenFullScreen}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            color: '#60a5fa',
            border: '1px solid rgba(59, 130, 246, 0.35)',
            backgroundColor: 'rgba(37, 99, 235, 0.08)'
          }}
        >
          <Maximize2 size={14} /> Full Screen
        </button>
        <button 
          type="button"
          className="btn btn-primary flex-1" 
          onClick={handleSave}
          disabled={!hasSignature}
        >
          Save & Continue
        </button>
      </div>
    </div>
  );
}
