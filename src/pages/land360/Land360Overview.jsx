/**
 * Land360Overview.jsx  –  Phase 2
 *
 * Orchestrator for the Land 360° capture step.
 * Shows the list of capture points, launches the capture screen,
 * and shows the review panel after capture.
 */

import { useState, useCallback } from 'react';
import {
  Camera, Plus, CheckCircle, Navigation, Eye,
} from 'lucide-react';
import { land360Service } from '../../services/Land360Service';
import Land360Capture from './Land360Capture';
import Land360Review from './Land360Review';
import { DEFAULT_CAPTURE_CONFIG } from '../../lib/land360/CaptureConfig';

// ── Status helpers ─────────────────────────────────────────────────────────

function pointStatusColor(status) {
  if (status === 'Completed') return 'var(--success-color, #22c55e)';
  if (status === 'In Progress') return 'var(--warning-color, #f59e0b)';
  return 'var(--text-secondary)';
}

function pointStatusIcon(status) {
  if (status === 'Completed') return <CheckCircle size={20} style={{ color: 'var(--success-color, #22c55e)' }} />;
  if (status === 'In Progress') return <Navigation size={20} style={{ color: 'var(--warning-color, #f59e0b)' }} />;
  return <Navigation size={20} style={{ color: 'var(--text-secondary)' }} />;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function Land360Overview({ inspectionId, points, onPointsUpdated, onNext }) {
  const [mode, setMode]             = useState('list');    // list | capture | review
  const [activePointId, setActivePointId] = useState(null);
  const [retakeTargetId, setRetakeTargetId] = useState(null);

  // Frames and targets for the active capture point (loaded for review)
  const [reviewData, setReviewData] = useState({ targets: [], frames: [] });

  // ── Handlers ───────────────────────────────────────────────────────────────

  const refreshPoints = useCallback(async () => {
    const updated = await land360Service.getCapturePointsForInspection(inspectionId);
    onPointsUpdated(updated);
  }, [inspectionId, onPointsUpdated]);

  const handleAddPoint = async () => {
    const newPoint = await land360Service.createCapturePoint(inspectionId, {
      name: `Capture Point ${points.length + 1}`,
      type: 'General',
      latitude: null,
      longitude: null,
    });
    await refreshPoints();
    setActivePointId(newPoint.id);
    setRetakeTargetId(null);
    setMode('capture');
  };

  const handleStartCapture = (pointId) => {
    setActivePointId(pointId);
    setRetakeTargetId(null);
    setMode('capture');
  };

  const handleCaptureComplete = async () => {
    await refreshPoints();
    // Load review data for the completed point
    const session = await land360Service.getLatestSessionForCapturePoint(activePointId);
    if (session) {
      const targets = await land360Service.getTargetsForSession(session.id);
      const frames  = await land360Service.getActiveFramesForSession(session.id);
      const normalised = targets.map((t) => ({ ...t, id: t.originalTargetId || t.id }));
      setReviewData({ targets: normalised, frames });
    }
    setMode('review');
  };

  const handleCaptureCancel = async () => {
    await refreshPoints();
    setMode('list');
    setActivePointId(null);
  };

  const handleRetake = (targetId) => {
    setRetakeTargetId(targetId);
    setMode('capture');
  };

  const handleContinueCapture = () => {
    setRetakeTargetId(null);
    setMode('capture');
  };

  const handleOpenReview = async (pointId) => {
    setActivePointId(pointId);
    const session = await land360Service.getLatestSessionForCapturePoint(pointId);
    if (session) {
      const targets = await land360Service.getTargetsForSession(session.id);
      const frames  = await land360Service.getActiveFramesForSession(session.id);
      const normalised = targets.map((t) => ({ ...t, id: t.originalTargetId || t.id }));
      setReviewData({ targets: normalised, frames });
    }
    setMode('review');
  };

  // ── Render: Capture screen ─────────────────────────────────────────────────

  if (mode === 'capture' && activePointId) {
    return (
      <Land360Capture
        capturePointId={activePointId}
        retakeTargetId={retakeTargetId}
        onComplete={handleCaptureComplete}
        onCancel={handleCaptureCancel}
      />
    );
  }

  // ── Render: Review screen ──────────────────────────────────────────────────

  if (mode === 'review') {
    return (
      <Land360Review
        targets={reviewData.targets}
        frames={reviewData.frames}
        config={DEFAULT_CAPTURE_CONFIG}
        onRetake={handleRetake}
        onContinueCapture={handleContinueCapture}
        onBack={() => setMode('list')}
      />
    );
  }

  // ── Render: List ───────────────────────────────────────────────────────────

  const completedCount = points.filter((p) => p.status === 'Completed').length;
  const allComplete = points.length > 0 && completedCount === points.length;

  return (
    <div className="flex flex-col gap-md">
      {/* Hero card */}
      <div className="card text-center p-lg">
        <Camera size={48} className="mx-auto mb-md" style={{ color: 'var(--primary-color)' }} />
        <h3 className="mb-sm">Land 360° Capture</h3>
        <p className="text-secondary text-sm mb-lg">
          Capture guided spherical panoramas of the property surroundings.
          Point your camera at each highlighted target and hold still — frames
          are captured automatically.
        </p>
        <button
          id="land360-add-point-btn"
          className="btn btn-primary flex justify-center items-center gap-sm"
          onClick={handleAddPoint}
        >
          <Plus size={20} /> Add Capture Point
        </button>
      </div>

      {/* Points list */}
      {points.length > 0 && (
        <div className="card" style={{ padding: 16 }}>
          <div className="flex justify-between items-center mb-md">
            <h3>Capture Points</h3>
            <span className="text-xs text-secondary">
              {completedCount}/{points.length} complete
            </span>
          </div>
          <div className="flex flex-col gap-sm">
            {points.map((point) => (
              <div
                key={point.id}
                className="flex justify-between items-center p-sm rounded-lg"
                style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)' }}
              >
                <div className="flex items-center gap-sm">
                  {pointStatusIcon(point.status)}
                  <div>
                    <div className="font-bold text-sm">{point.name}</div>
                    <div className="text-xs text-secondary" style={{ color: pointStatusColor(point.status) }}>
                      {point.status}
                    </div>
                  </div>
                </div>
                <div className="flex gap-xs">
                  {point.status === 'Completed' && (
                    <button
                      className="btn btn-secondary text-xs"
                      style={{ padding: '4px 10px', height: 'auto' }}
                      onClick={() => handleOpenReview(point.id)}
                      id={`land360-review-btn-${point.id}`}
                    >
                      <Eye size={13} style={{ marginRight: 4 }} /> Review
                    </button>
                  )}
                  {point.status !== 'Completed' && (
                    <button
                      className="btn btn-primary text-xs"
                      style={{ padding: '4px 10px', height: 'auto' }}
                      onClick={() => handleStartCapture(point.id)}
                      id={`land360-capture-btn-${point.id}`}
                    >
                      <Camera size={13} style={{ marginRight: 4 }} />
                      {point.status === 'In Progress' ? 'Resume' : 'Start'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Next step button */}
      {allComplete && (
        <button
          id="land360-next-btn"
          className="btn btn-primary mt-sm"
          onClick={onNext}
        >
          Next <span style={{ marginLeft: 6 }}>→</span>
        </button>
      )}
      {!allComplete && points.length > 0 && (
        <button
          className="btn btn-secondary mt-sm text-sm"
          onClick={onNext}
        >
          Skip for now
        </button>
      )}
    </div>
  );
}
