/**
 * Land360Overview.jsx
 *
 * Workflow orchestrator for 360° Photo Sphere capture inside InspectionSession.
 * Delegates 100% of 360° capture and stitching to the new, decoupled
 * PhotoSphereCaptureScreen module (src/features/photo-sphere/).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Camera, Plus, CheckCircle, Navigation, Eye } from 'lucide-react';
import { land360Service } from '../../services/Land360Service';
import { PhotoSphereCaptureScreen, PanoramaViewer } from '../../features/photo-sphere';

export default function Land360Overview({ inspectionId, points = [], onPointsUpdated, onNext }) {
  const [mode, setMode] = useState('list'); // 'list' | 'capture' | 'viewer'
  const [activePointId, setActivePointId] = useState(null);
  const [viewingPanoramaUri, setViewingPanoramaUri] = useState(null);
  const [viewingCoverage, setViewingCoverage] = useState(100);

  const refreshPoints = useCallback(async () => {
    if (!inspectionId) return;
    const updated = await land360Service.getCapturePointsForInspection(inspectionId);
    if (onPointsUpdated) {
      onPointsUpdated(updated);
    }
  }, [inspectionId, onPointsUpdated]);

  const handleAddPoint = async () => {
    try {
      const targetInspectionId = inspectionId || 'temp_inspection';
      const newPoint = await land360Service.createCapturePoint(targetInspectionId, {
        name: `Viewpoint ${points.length + 1}`,
        type: '360 Photo Sphere',
        latitude: null,
        longitude: null,
      });
      await refreshPoints();
      setActivePointId(newPoint.id);
      setMode('capture');
    } catch (err) {
      console.error('Failed to create capture point:', err);
      setActivePointId(`cp_${Date.now()}`);
      setMode('capture');
    }
  };

  const handleStartCapture = (pointId) => {
    setActivePointId(pointId);
    setMode('capture');
  };

  const handleCaptureComplete = async (result) => {
    if (activePointId) {
      await land360Service.updateCapturePointStatus(activePointId, 'Completed');
    }
    await refreshPoints();
    setMode('list');
  };

  const handleViewPoint = async (point) => {
    // Check if panorama is already stored
    setActivePointId(point.id);
    setViewingPanoramaUri(point.panoramaUri || null);
    setViewingCoverage(point.coveragePercent || 100);
    setMode('viewer');
  };

  // ── Mode: Capture ──
  if (mode === 'capture') {
    return (
      <PhotoSphereCaptureScreen
        inspectionId={inspectionId}
        propertyId={activePointId}
        onComplete={handleCaptureComplete}
        onCancel={() => {
          refreshPoints();
          setMode('list');
        }}
      />
    );
  }

  // ── Mode: Viewer ──
  if (mode === 'viewer' && viewingPanoramaUri) {
    return (
      <PanoramaViewer
        panoramaDataUri={viewingPanoramaUri}
        coveragePercent={viewingCoverage}
        onBack={() => setMode('list')}
        onSaveAndReturn={() => setMode('list')}
      />
    );
  }

  // ── Mode: List ──
  const completedCount = points.filter((p) => p.status === 'Completed').length;

  return (
    <div className="land360-overview" style={{ paddingBottom: '32px' }}>
      <div className="card mb-md">
        <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>
          360° Photo Sphere Capture
        </h3>
        <p className="text-secondary text-sm mb-md">
          Capture high-fidelity spherical panoramas with real orientation tracking, centered reticle, and guided auto-capture.
        </p>

        <button
          className="btn btn-primary"
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
          onClick={handleAddPoint}
          id="add-360-viewpoint-btn"
        >
          <Plus size={18} /> Add 360° Viewpoint
        </button>
      </div>

      <div className="points-list mb-lg">
        <div className="flex justify-between items-center mb-sm">
          <span className="text-sm font-bold text-secondary">
            VIEWPOINTS ({points.length})
          </span>
          {points.length > 0 && (
            <span className="text-xs text-secondary">
              {completedCount} of {points.length} completed
            </span>
          )}
        </div>

        {points.length === 0 ? (
          <div className="card text-center p-lg" style={{ opacity: 0.85 }}>
            <Camera size={36} className="text-secondary mx-auto mb-sm" />
            <p className="text-sm text-secondary mb-md">No 360° viewpoints added yet.</p>
            <button className="btn btn-secondary text-sm" onClick={handleAddPoint}>
              Add First Viewpoint
            </button>
          </div>
        ) : (
          points.map((point, index) => {
            const isCompleted = point.status === 'Completed';
            return (
              <div
                key={point.id}
                className="card mb-sm flex justify-between items-center"
                style={{ padding: '14px 16px' }}
              >
                <div>
                  <div className="font-bold text-sm flex items-center gap-xs">
                    {point.name || `Viewpoint ${index + 1}`}
                  </div>
                  <div
                    className="text-xs flex items-center gap-xs mt-xs"
                    style={{
                      color: isCompleted ? 'var(--success-color, #10b981)' : 'var(--text-secondary)',
                      fontWeight: 500,
                    }}
                  >
                    {isCompleted ? <CheckCircle size={13} /> : <Navigation size={13} />}
                    {point.status || 'Not Captured'}
                  </div>
                </div>

                <div className="flex gap-xs">
                  {isCompleted ? (
                    <button
                      className="btn btn-secondary text-xs"
                      style={{ padding: '6px 12px' }}
                      onClick={() => handleStartCapture(point.id)}
                    >
                      <Camera size={14} style={{ marginRight: '4px' }} /> Retake
                    </button>
                  ) : (
                    <button
                      className="btn btn-primary text-xs"
                      style={{ padding: '6px 12px' }}
                      onClick={() => handleStartCapture(point.id)}
                    >
                      <Camera size={14} style={{ marginRight: '4px' }} /> Capture
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {points.length > 0 && (
        <button
          className="btn btn-primary"
          style={{ width: '100%', padding: '14px', fontWeight: '600' }}
          onClick={onNext}
          id="continue-to-evidence-btn"
        >
          Continue to Evidence
        </button>
      )}
    </div>
  );
}
