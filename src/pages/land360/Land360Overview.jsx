import { useState } from 'react';
import { Camera, MapPin, Plus, CheckCircle, Navigation } from 'lucide-react';
import { land360Service } from '../../services/Land360Service';
import Land360Capture from './Land360Capture';

export default function Land360Overview({ inspectionId, points, onPointsUpdated, onNext }) {
  const [showCapture, setShowCapture] = useState(false);
  const [activePointId, setActivePointId] = useState(null);

  const handleAddPoint = async () => {
    // In reality, this would open a map to pick a spot. For now we use the current location roughly.
    const newPoint = await land360Service.createCapturePoint(inspectionId, {
      name: `Capture Point ${points.length + 1}`,
      type: 'General',
      latitude: null, // to be updated by capture screen
      longitude: null
    });
    const updated = await land360Service.getCapturePointsForInspection(inspectionId);
    onPointsUpdated(updated);
    
    // Auto start capture for this point
    setActivePointId(newPoint.id);
    setShowCapture(true);
  };

  const handleResume = (id) => {
    setActivePointId(id);
    setShowCapture(true);
  };

  const handleCaptureComplete = async () => {
    setShowCapture(false);
    setActivePointId(null);
    const updated = await land360Service.getCapturePointsForInspection(inspectionId);
    onPointsUpdated(updated);
  };

  if (showCapture && activePointId) {
    return <Land360Capture capturePointId={activePointId} onComplete={handleCaptureComplete} onCancel={() => setShowCapture(false)} />;
  }

  return (
    <div className="flex flex-col gap-md">
      <div className="card text-center p-md">
        <Camera size={48} className="text-primary mx-auto mb-md" />
        <h3 className="mb-sm">Land 360° Capture</h3>
        <p className="text-secondary text-sm mb-lg">
          Capture guided spherical panoramas of the property surroundings.
        </p>
        <button
          className="btn btn-primary flex justify-center items-center gap-sm"
          onClick={handleAddPoint}
        >
          <Plus size={20} /> Add Capture Point
        </button>
      </div>

      {points.length > 0 && (
        <div className="card" style={{ padding: '16px' }}>
          <h3 className="mb-md">Capture Points</h3>
          <div className="flex flex-col gap-sm">
            {points.map((point) => (
              <div key={point.id} className="flex justify-between items-center p-sm bg-bg-color rounded-lg border border-color">
                <div className="flex items-center gap-sm">
                  {point.status === 'Completed' ? (
                    <CheckCircle size={20} className="text-success" />
                  ) : (
                    <Navigation size={20} className="text-warning" />
                  )}
                  <div>
                    <div className="font-bold text-sm">{point.name}</div>
                    <div className="text-xs text-secondary">{point.status}</div>
                  </div>
                </div>
                {point.status !== 'Completed' && (
                  <button className="btn btn-secondary text-xs py-xs" onClick={() => handleResume(point.id)}>
                    Capture
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {points.length > 0 && (
        <button className="btn btn-primary mt-sm" onClick={onNext}>
          Next
        </button>
      )}
    </div>
  );
}
