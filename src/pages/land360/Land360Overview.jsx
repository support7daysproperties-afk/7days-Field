/**
 * Land360Overview.jsx
 *
 * Orchestrator component for the Land 360° capture step inside the inspection workflow.
 * Manages:
 * 1. List of 360° capture points (e.g. Center, Boundaries, Entrance, Interior viewpoints).
 * 2. Launching the guided 360° capture camera.
 * 3. Handling completion, review, and retakes.
 */

import { useState, useCallback, useEffect } from 'react';
import { Camera, Plus, CheckCircle, Navigation, Eye, MapPin } from 'lucide-react';
import { land360Service } from '../../services/Land360Service';
import Land360Capture from './Land360Capture';
import Land360Review from './Land360Review';
import { DEFAULT_CAPTURE_CONFIG } from '../../lib/land360/CaptureConfig';

export default function Land360Overview({ inspectionId, points = [], onPointsUpdated, onNext }) {
  const [mode, setMode] = useState('list'); // 'list' | 'capture' | 'review'
  const [activePointId, setActivePointId] = useState(null);
  const [retakeTargetId, setRetakeTargetId] = useState(null);
  const [reviewData, setReviewData] = useState({ targets: [], frames: [] });

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
        name: `Capture Point ${points.length + 1}`,
        type: 'General',
        latitude: null,
        longitude: null,
      });
      await refreshPoints();
      setActivePointId(newPoint.id);
      setRetakeTargetId(null);
      setMode('capture');
    } catch (err) {
      console.error('Failed to create capture point:', err);
      // Fallback: start capture with a generated point id
      const fallbackId = `cp_${Date.now()}`;
      setActivePointId(fallbackId);
      setRetakeTargetId(null);
      setMode('capture');
    }
  };

  const handleStartCapture = (pointId) => {
    setActivePointId(pointId);
    setRetakeTargetId(null);
    setMode('capture');
  };

  const handleCaptureComplete = async () => {
    await refreshPoints();
    const session = await land360Service.getLatestSessionForCapturePoint(activePointId);
    if (session) {
      const targets = await land360Service.getTargetsForSession(session.id);
      const frames = await land360Service.getActiveFramesForSession(session.id);
      const normalised = targets.map((t) => ({ ...t, id: t.originalTargetId || t.id }));
      setReviewData({ targets: normalised, frames });
    }
    setMode('review');
  };

  const handleReviewPoint = async (pointId) => {
    setActivePointId(pointId);
    const session = await land360Service.getLatestSessionForCapturePoint(pointId);
    if (session) {
      const targets = await land360Service.getTargetsForSession(session.id);
      const frames = await land360Service.getActiveFramesForSession(session.id);
      const normalised = targets.map((t) => ({ ...t, id: t.originalTargetId || t.id }));
      setReviewData({ targets: normalised, frames });
    } else {
      setReviewData({ targets: [], frames: [] });
    }
    setMode('review');
  };

  const handleRetake = (targetId) => {
    setRetakeTargetId(targetId);
    setMode('capture');
  };

  if (mode === 'capture') {
    return (
      <Land360Capture
        capturePointId={activePointId}
        onComplete={handleCaptureComplete}
        onCancel={() => {
          refreshPoints();
          setMode('list');
        }}
        retakeTargetId={retakeTargetId}
      />
    );
  }

  if (mode === 'review') {
    return (
      <Land360Review
        targets={reviewData.targets}
        frames={reviewData.frames}
        config={DEFAULT_CAPTURE_CONFIG}
        onRetake={handleRetake}
        onContinueCapture={() => setMode('capture')}
        onBack={() => {
          refreshPoints();
          setMode('list');
        }}
      />
    );
  }

  // ── Mode: 'list' ──
  const completedCount = points.filter((p) => p.status === 'Completed').length;

  return (
    <div className="land360-overview" style={{ paddingBottom: '32px' }}>
      <div className="card mb-md">
        <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>
          360° Spherical Photo Capture
        </h3>
        <p className="text-secondary text-sm mb-md">
          Capture 360° photo spheres of the land or property using real-time orientation guidance.
        </p>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="btn btn-primary"
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            onClick={handleAddPoint}
            id="add-360-point-btn"
          >
            <Plus size={18} /> Add 360° Viewpoint
          </button>
        </div>
      </div>

      <div className="points-list mb-lg">
        <div className="flex justify-between items-center mb-sm">
          <span className="text-sm font-bold text-secondary">
            CAPTURE POINTS ({points.length})
          </span>
          {points.length > 0 && (
            <span className="text-xs text-secondary">
              {completedCount} of {points.length} captured
            </span>
          )}
        </div>

        {points.length === 0 ? (
          <div className="card text-center p-lg" style={{ opacity: 0.8 }}>
            <Camera size={36} className="text-secondary mx-auto mb-sm" />
            <p className="text-sm text-secondary mb-md">No 360° viewpoints added yet.</p>
            <button className="btn btn-secondary text-sm" onClick={handleAddPoint}>
              Add First Point
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
                    {point.name || `Capture Point ${index + 1}`}
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
                      onClick={() => handleReviewPoint(point.id)}
                    >
                      <Eye size={14} style={{ marginRight: '4px' }} /> Review
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
