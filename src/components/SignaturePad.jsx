import { useRef, useState, useEffect } from 'react';
import { Maximize2, Minimize2, RotateCcw, Check } from 'lucide-react';

export default function SignaturePad({ onSave, onClear, initialSignature = null }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(!!initialSignature);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const savedDataUrlRef = useRef(initialSignature);
  const lastPointRef = useRef(null);

  // Initialize canvas with proper scale and ink style
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resizeCanvas = () => {
      const ctx = canvas.getContext('2d');
      if (hasSignature && canvas.width > 0 && canvas.height > 0) {
        try {
          savedDataUrlRef.current = canvas.toDataURL('image/png');
        } catch (e) {
          console.error('Could not save image data during resize', e);
        }
      }

      const rect = container.getBoundingClientRect();
      const ratio = Math.max(window.devicePixelRatio || 1, 1);

      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;

      // Dark professional ink for maximum clarity and visibility
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 3.5 * ratio;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (savedDataUrlRef.current) {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = savedDataUrlRef.current;
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
    });
    resizeObserver.observe(container);

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
    lastPointRef.current = { x, y };
    setIsDrawing(true);
    setHasSignature(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { x, y } = getCoordinates(e);

    if (lastPointRef.current) {
      // Smooth midpoint curve for authentic, natural handwriting
      const midX = (lastPointRef.current.x + x) / 2;
      const midY = (lastPointRef.current.y + y) / 2;
      ctx.quadraticCurveTo(lastPointRef.current.x, lastPointRef.current.y, midX, midY);
      ctx.stroke();
      lastPointRef.current = { x, y };
    } else {
      ctx.lineTo(x, y);
      ctx.stroke();
      lastPointRef.current = { x, y };
    }
  };

  const stopDrawing = () => {
    if (isDrawing) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.closePath();
      setIsDrawing(false);
      lastPointRef.current = null;
    }
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    savedDataUrlRef.current = null;
    lastPointRef.current = null;
    setHasSignature(false);
    if (onClear) onClear();
  };

  const handleSave = () => {
    if (!hasSignature) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Create an export canvas with solid white background so the signature
    // is crystal clear everywhere: Google Drive, gallery, and PDF reports.
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const expCtx = exportCanvas.getContext('2d');

    // Fill crisp white background
    expCtx.fillStyle = '#ffffff';
    expCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    // Draw the signature strokes
    expCtx.drawImage(canvas, 0, 0);

    const dataUrl = exportCanvas.toDataURL('image/png');
    exportCanvas.toBlob((blob) => {
      if (blob) {
        onSave(dataUrl, blob);
      }
    }, 'image/png');
  };

  const handleOpenFullScreen = () => {
    if (hasSignature && canvasRef.current) {
      try {
        savedDataUrlRef.current = canvasRef.current.toDataURL('image/png');
      } catch (e) {}
    }
    setIsFullScreen(true);
  };

  const handleExitFullScreen = () => {
    if (hasSignature && canvasRef.current) {
      try {
        savedDataUrlRef.current = canvasRef.current.toDataURL('image/png');
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
          backgroundColor: '#0f172a',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* Top Header */}
        <div 
          style={{
            padding: '12px 16px',
            backgroundColor: '#1e293b',
            borderBottom: '1px solid #334155',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#f8fafc' }}>
              Owner Signature (Full Screen)
            </h3>
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>
              Sign with finger or stylus • Rotate phone horizontally for more space
            </span>
          </div>
          <button
            type="button"
            onClick={handleExitFullScreen}
            className="btn btn-secondary"
            style={{
              padding: '8px 14px',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              borderRadius: '8px'
            }}
          >
            <Minimize2 size={16} /> Exit Full Screen
          </button>
        </div>

        {/* Canvas Area with Paper White Background */}
        <div 
          ref={containerRef}
          style={{
            flex: 1,
            margin: '12px 16px',
            backgroundColor: '#ffffff',
            border: '2px solid #cbd5e1',
            borderRadius: '12px',
            touchAction: 'none',
            overflow: 'hidden',
            position: 'relative',
            boxShadow: '0 4px 16px rgba(0,0,0,0.2)'
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
                color: '#64748b'
              }}
            >
              <span style={{ fontSize: '18px', fontWeight: 600, color: '#334155' }}>Sign anywhere in this space</span>
              <span style={{ fontSize: '13px', marginTop: '4px', color: '#94a3b8' }}>Use finger or stylus</span>
            </div>
          )}

          {/* Baseline guide */}
          <div 
            style={{ 
              position: 'absolute', 
              bottom: '50px', 
              left: '30px', 
              right: '30px', 
              height: '1px', 
              backgroundColor: '#cbd5e1',
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <span style={{ fontSize: '16px', fontWeight: 700, color: '#94a3b8', marginTop: '-20px' }}>✕</span>
            <span style={{ fontSize: '12px', fontWeight: 500, color: '#94a3b8', marginTop: '16px' }}>
              Signature of Owner / Representative
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
            backgroundColor: '#1e293b',
            borderTop: '1px solid #334155',
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
        className="relative rounded-lg"
        style={{ 
          height: '220px', 
          backgroundColor: '#ffffff',
          border: '1.5px solid #cbd5e1',
          touchAction: 'none',
          overflow: 'hidden',
          position: 'relative',
          boxShadow: '0 2px 6px rgba(0,0,0,0.1)'
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
            backgroundColor: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            color: '#1e40af',
            padding: '5px 10px',
            fontSize: '12px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            cursor: 'pointer',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}
        >
          <Maximize2 size={13} strokeWidth={2.5} /> Full Screen
        </button>

        {/* Placeholder text */}
        {!hasSignature && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none" style={{ color: '#94a3b8' }}>
            <span style={{ fontSize: '15px', fontWeight: 600, color: '#475569' }}>Sign here</span>
            <span style={{ fontSize: '11px', marginTop: '4px', color: '#94a3b8' }}>Use finger or stylus • or tap Full Screen</span>
          </div>
        )}
        
        {/* Subtle Baseline */}
        <div 
          className="absolute pointer-events-none" 
          style={{ 
            bottom: '40px', left: '20px', right: '20px', 
            height: '1px', backgroundColor: '#e2e8f0',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between'
          }}
        >
          <span style={{ fontSize: '14px', fontWeight: 600, color: '#94a3b8', marginTop: '-18px' }}>✕</span>
          <span style={{ fontSize: '10px', color: '#94a3b8', marginTop: '16px' }}>Signature</span>
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
