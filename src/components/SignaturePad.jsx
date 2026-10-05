import { useRef, useState, useEffect, useCallback } from 'react';

export default function SignaturePad({ onSave, onClear, initialSignature = null }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(!!initialSignature);

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resizeCanvas = () => {
      // Save existing image data before resize if there's a signature
      const ctx = canvas.getContext('2d');
      let dataToRestore = null;
      if (hasSignature && canvas.width > 0 && canvas.height > 0) {
        try {
          dataToRestore = ctx.getImageData(0, 0, canvas.width, canvas.height);
        } catch (e) {
          console.error("Could not save image data during resize", e);
        }
      }

      const rect = container.getBoundingClientRect();
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      
      // Set actual internal dimensions based on container layout size and DPR
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      
      // Do NOT use ctx.scale(). We will map coordinates to physical pixels directly.
      ctx.strokeStyle = '#ffffff'; // White ink for dark theme
      ctx.lineWidth = 3 * ratio; // Scale stroke width by DPR
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (dataToRestore) {
        ctx.putImageData(dataToRestore, 0, 0);
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
  }, [hasSignature]);

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
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
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

  return (
    <div className="signature-pad-wrapper flex flex-col gap-md">
      <div 
        ref={containerRef}
        className="relative bg-surface rounded"
        style={{ 
          height: '220px', 
          border: '1px solid var(--border-color)',
          touchAction: 'none', // Ensures browser doesn't try to handle gestures
          overflow: 'hidden' // Hard clipping so strokes never render outside the box visually
        }}
      >
        {/* Placeholder text */}
        {!hasSignature && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-secondary">
            Sign here
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
          className="btn btn-secondary flex-1" 
          onClick={handleClear}
          disabled={!hasSignature}
        >
          Clear
        </button>
        <button 
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
