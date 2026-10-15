/**
 * Land360Overview.jsx
 *
 * Overview and launcher for 360° Photo Sphere capture points during property inspection.
 */

import React, { useState } from 'react';
import { Camera, Eye, Plus, Trash2, ArrowRight } from 'lucide-react';
import { PhotoSphereCaptureScreen, PanoramaViewer } from '../../features/photo-sphere';

export default function Land360Overview({ inspectionId, points = [], onPointsUpdated, onNext }) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [viewingPoint, setViewingPoint] = useState(null);

  const handleStartCapture = () => {
    setIsCapturing(true);
  };

  const handleCaptureFinish = ({ panoramaUrl, frames }) => {
    const newPoint = {
      id: 'point_' + Date.now(),
      inspection_id: inspectionId,
      name: `Capture Point #${points.length + 1}`,
      panorama_url: panoramaUrl,
      frame_count: frames.length,
      created_at: new Date().toISOString()
    };

    const updated = [...points, newPoint];
    if (onPointsUpdated) onPointsUpdated(updated);
    setIsCapturing(false);
  };

  const handleDelete = (id) => {
    const updated = points.filter(p => p.id !== id);
    if (onPointsUpdated) onPointsUpdated(updated);
  };

  if (isCapturing) {
    return (
      <PhotoSphereCaptureScreen
        onFinish={handleCaptureFinish}
        onCancel={() => setIsCapturing(false)}
      />
    );
  }

  if (viewingPoint) {
    return (
      <div className="fixed inset-0 z-50 bg-black">
        <PanoramaViewer
          panoramaUrl={viewingPoint.panorama_url}
          title={viewingPoint.name}
          onDone={() => setViewingPoint(null)}
        />
      </div>
    );
  }

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Camera className="w-5 h-5 text-blue-400" />
            <span>360° Land Photo Sphere</span>
          </h2>
          <p className="text-xs text-white/60 mt-1">
            Capture immersive 360° spherical panoramas with guided alignment.
          </p>
        </div>

        <button
          onClick={handleStartCapture}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-sm font-medium shadow-md shadow-blue-600/30 transition"
        >
          <Plus className="w-4 h-4" />
          <span>New 360° Capture</span>
        </button>
      </div>

      {points.length === 0 ? (
        <div className="border border-dashed border-white/10 rounded-2xl p-10 text-center flex flex-col items-center justify-center bg-white/[0.02]">
          <div className="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mb-4">
            <Camera className="w-8 h-8" />
          </div>
          <h4 className="text-base font-semibold text-white">No 360° Points Captured Yet</h4>
          <p className="text-xs text-white/50 max-w-sm mt-1 mb-6">
            Stand in the center of the land parcel and follow the live blue target dot to create an interactive 360° photo sphere.
          </p>
          <button
            onClick={handleStartCapture}
            className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-xl text-sm font-medium shadow-md transition"
          >
            Launch 360° Camera
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {points.map((pt) => (
            <div
              key={pt.id}
              className="bg-slate-900 border border-white/10 rounded-xl overflow-hidden shadow-lg flex flex-col"
            >
              <div className="h-44 bg-slate-950 relative overflow-hidden group">
                <img
                  src={pt.panorama_url}
                  alt={pt.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                />
                <div className="absolute inset-0 bg-black/30 group-hover:bg-black/10 transition" />
                <button
                  onClick={() => setViewingPoint(pt)}
                  className="absolute inset-0 m-auto w-12 h-12 rounded-full bg-blue-600/90 text-white flex items-center justify-center shadow-lg hover:scale-110 transition"
                >
                  <Eye className="w-5 h-5" />
                </button>
              </div>

              <div className="p-3.5 flex items-center justify-between bg-slate-900/90 border-t border-white/5">
                <div>
                  <h4 className="text-sm font-semibold text-white">{pt.name}</h4>
                  <span className="text-[11px] text-white/50">
                    {pt.frame_count || 'Sphere'} frames captured
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setViewingPoint(pt)}
                    className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition"
                    title="View 360°"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(pt.id)}
                    className="p-2 text-red-400/80 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {points.length > 0 && onNext && (
        <div className="pt-4 flex justify-end">
          <button
            onClick={onNext}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2.5 rounded-xl font-medium text-sm shadow-md transition"
          >
            <span>Continue Inspection</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
