import React, { useState } from 'react';
import { Eye, Smartphone, Glasses, RotateCcw, CheckCircle2, ChevronRight, Image as ImageIcon } from 'lucide-react';
import VRViewer from './VRViewer';
import MotionSensorViewer from './MotionSensorViewer';

/**
 * PanoramaResultScreen.jsx
 *
 * Screen displayed after successful spherical capture and genuine stitching.
 * Requirements:
 * - Shows generated panorama preview.
 * - Prominently displays:
 *   Button 1: VR View
 *   Button 2: Motion Sensor View
 * - Both buttons operate on the same generated panorama.
 * - Processing / resolution quality metrics.
 * - Option to inspect captured raw photographs.
 * - Retake or confirm & save session.
 */
export default function PanoramaResultScreen({
  panoramaData,
  frames = [],
  onRetake,
  onSave,
  onCancel,
}) {
  const [activeViewer, setActiveViewer] = useState(null); // 'vr' | 'motion' | null
  const [showRawPhotos, setShowRawPhotos] = useState(false);

  const { url, width, height } = panoramaData;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: '#0a0f1d',
        zIndex: 90,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        color: '#f8fafc',
      }}
    >
      {/* Top Header */}
      <div
        style={{
          padding: '16px 20px',
          backgroundColor: '#111827',
          borderBottom: '1px solid #1f2937',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CheckCircle2 size={20} color="#10b981" />
          <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0 }}>
            Photo Sphere Generated
          </h2>
        </div>
        <button
          onClick={onCancel}
          style={{
            background: 'none',
            border: 'none',
            color: '#94a3b8',
            fontSize: '14px',
            cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>

      <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', flex: 1, maxWidth: '720px', margin: '0 auto', width: '100%' }}>
        {/* Equirectangular Panorama Preview Banner */}
        <div
          style={{
            borderRadius: '12px',
            overflow: 'hidden',
            border: '1px solid #334155',
            backgroundColor: '#020617',
            position: 'relative',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
          }}
        >
          <img
            src={url}
            alt="Stitched Equirectangular Panorama"
            style={{ width: '100%', aspectRatio: '2/1', objectFit: 'cover', display: 'block' }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: '8px',
              right: '12px',
              backgroundColor: 'rgba(0, 0, 0, 0.75)',
              padding: '4px 10px',
              borderRadius: '6px',
              fontSize: '11px',
              color: '#94a3b8',
              letterSpacing: '0.05em',
            }}
          >
            360° × 180° EQUIRECTANGULAR • {width} × {height}
          </div>
        </div>

        {/* Section: Two Dedicated Viewing Action Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Interactive Viewing Modes
          </span>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {/* Button 1: VR View */}
            <button
              onClick={() => setActiveViewer('vr')}
              style={{
                backgroundColor: '#581c87',
                backgroundImage: 'linear-gradient(135deg, #7c3aed, #4c1d95)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '12px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '10px',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(124, 58, 237, 0.35)',
                transition: 'transform 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-2px)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
            >
              <div
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.15)',
                  padding: '10px',
                  borderRadius: '50%',
                  display: 'flex',
                }}
              >
                <Glasses size={28} />
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontWeight: 'bold', fontSize: '16px' }}>VR View</div>
                <div style={{ fontSize: '11px', opacity: 0.85, marginTop: '2px' }}>
                  Cardboard & Headset
                </div>
              </div>
            </button>

            {/* Button 2: Motion Sensor View */}
            <button
              onClick={() => setActiveViewer('motion')}
              style={{
                backgroundColor: '#0284c7',
                backgroundImage: 'linear-gradient(135deg, #0284c7, #0369a1)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '12px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '10px',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(2, 132, 199, 0.35)',
                transition: 'transform 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-2px)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
            >
              <div
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.15)',
                  padding: '10px',
                  borderRadius: '50%',
                  display: 'flex',
                }}
              >
                <Smartphone size={28} />
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontWeight: 'bold', fontSize: '16px' }}>Motion Sensor View</div>
                <div style={{ fontSize: '11px', opacity: 0.85, marginTop: '2px' }}>
                  Look by moving phone
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* Quality & Metadata Card */}
        <div
          style={{
            backgroundColor: '#1e293b',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid #334155',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            fontSize: '13px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #334155', paddingBottom: '8px' }}>
            <span style={{ color: '#94a3b8' }}>Stitched Photographs</span>
            <span style={{ fontWeight: 'bold' }}>{frames.length} captures</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #334155', paddingBottom: '8px' }}>
            <span style={{ color: '#94a3b8' }}>Output Dimensions</span>
            <span style={{ fontWeight: 'bold' }}>{width} × {height} px (2:1)</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#94a3b8' }}>Projection</span>
            <span style={{ fontWeight: 'bold', color: '#38bdf8' }}>Full 360° × 180° Equirectangular</span>
          </div>
        </div>

        {/* Option to Review Original Photographs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button
            onClick={() => setShowRawPhotos(!showRawPhotos)}
            style={{
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '8px',
              padding: '12px 16px',
              color: '#e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '500',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ImageIcon size={18} color="#94a3b8" />
              <span>Review original photographs ({frames.length})</span>
            </div>
            <ChevronRight
              size={18}
              style={{
                transform: showRawPhotos ? 'rotate(90deg)' : 'none',
                transition: 'transform 0.2s',
              }}
            />
          </button>

          {showRawPhotos && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
                gap: '8px',
                padding: '12px',
                backgroundColor: '#0f172a',
                borderRadius: '8px',
                maxHeight: '220px',
                overflowY: 'auto',
                border: '1px solid #1e293b',
              }}
            >
              {frames.map((f, i) => (
                <div key={i} style={{ position: 'relative', borderRadius: '4px', overflow: 'hidden' }}>
                  <img
                    src={f.blob ? URL.createObjectURL(f.blob) : ''}
                    alt={`Frame ${i + 1}`}
                    style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', display: 'block' }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      backgroundColor: 'rgba(0,0,0,0.65)',
                      fontSize: '9px',
                      padding: '2px',
                      textAlign: 'center',
                    }}
                  >
                    #{i + 1}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Action Controls: Retake vs Confirm & Save */}
        <div
          style={{
            marginTop: 'auto',
            paddingTop: '20px',
            display: 'flex',
            gap: '12px',
          }}
        >
          <button
            onClick={onRetake}
            style={{
              flex: 1,
              backgroundColor: '#1e293b',
              color: '#e2e8f0',
              border: '1px solid #475569',
              borderRadius: '10px',
              padding: '14px',
              fontWeight: '600',
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              cursor: 'pointer',
            }}
          >
            <RotateCcw size={18} /> Retake
          </button>

          <button
            onClick={onSave}
            style={{
              flex: 2,
              backgroundColor: '#10b981',
              backgroundImage: 'linear-gradient(135deg, #10b981, #059669)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '10px',
              padding: '14px',
              fontWeight: 'bold',
              fontSize: '15px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(16, 185, 129, 0.4)',
            }}
          >
            <CheckCircle2 size={18} /> Confirm & Save
          </button>
        </div>
      </div>

      {/* Render Active Spherical Viewer on Demand */}
      {activeViewer === 'vr' && (
        <VRViewer panoramaUrl={url} onClose={() => setActiveViewer(null)} />
      )}

      {activeViewer === 'motion' && (
        <MotionSensorViewer panoramaUrl={url} onClose={() => setActiveViewer(null)} />
      )}
    </div>
  );
}
