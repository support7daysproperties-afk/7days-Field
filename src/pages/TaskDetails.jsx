import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function TaskDetails() {
  const navigate = useNavigate();
  const { id } = useParams();

  return (
    <div className="task-details-page pb-xl" style={{ backgroundColor: 'var(--bg-color)', minHeight: '100vh', padding: '16px' }}>
      <header className="flex items-center gap-md mb-md">
        <button onClick={() => navigate(-1)} className="text-primary" style={{ background: 'none', border: 'none', padding: 0 }}>
          <ArrowLeft size={24} />
        </button>
      </header>

      {/* Property Card */}
      <div className="card mb-md" style={{ position: 'relative' }}>
        <div className="flex justify-between items-start mb-xs">
          <span className="text-secondary text-xs font-bold" style={{ letterSpacing: '0.5px' }}>PROPERTY</span>
          <span className="text-secondary text-xs">46</span>
        </div>
        <h1 className="mb-xs" style={{ fontSize: '22px', fontWeight: 'bold' }}>Ooty Tea Estate Land</h1>
        <div className="text-secondary text-sm mb-xs">
          Land • Ooty, Tamil Nadu
        </div>
        <div className="text-secondary text-sm mb-md">
          ID: PROP-001
        </div>

        <div className="p-sm rounded" style={{ backgroundColor: '#f0f7ff', borderLeft: '4px solid var(--primary-color)' }}>
          <h4 className="text-primary text-sm font-bold mb-xs">Admin Instructions</h4>
          <p className="text-sm" style={{ color: '#334155' }}>
            Verify boundaries of the tea estate and ensure no encroachment.
          </p>
        </div>
      </div>

      {/* Assignment Card */}
      <div className="card mb-md">
        <span className="text-secondary text-xs font-bold mb-md block" style={{ letterSpacing: '0.5px' }}>ASSIGNMENT</span>
        
        <div className="flex flex-col">
          <div className="flex justify-between py-sm border-b" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <span className="text-secondary">Status</span>
            <span className="font-bold">Assigned</span>
          </div>
          <div className="flex justify-between py-sm border-b" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <span className="text-secondary">Priority</span>
            <span className="font-bold">High</span>
          </div>
          <div className="flex justify-between py-sm">
            <span className="text-secondary">Assigned</span>
            <span className="font-bold">22/9/2026</span>
          </div>
        </div>
      </div>

      {/* Required Evidence Card */}
      <div className="card mb-xl">
        <span className="text-secondary text-xs font-bold mb-md block" style={{ letterSpacing: '0.5px' }}>REQUIRED EVIDENCE</span>
        
        <div className="flex flex-col gap-sm">
          {[
            'Property exterior photos',
            'Land boundary photos',
            'Access road photo',
            'Surrounding area photos',
            'Property video',
            'GPS verification'
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-sm">
              <div style={{ width: '20px', height: '20px', border: '2px solid #cbd5e1', borderRadius: '4px' }}></div>
              <span className="text-sm" style={{ color: '#334155' }}>{item}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Fixed Bottom Button Container */}
      <div className="fixed bottom-0 left-0 right-0 p-md bg-surface border-t border-color" style={{ paddingBottom: 'calc(16px + env(safe-area-inset-bottom))', zIndex: 10, paddingBottom: '80px' /* buffer for main nav */ }}>
        <button 
          className="btn btn-primary w-full py-md text-md font-bold"
          onClick={() => navigate(`/inspection/${id}`)}
          style={{ borderRadius: '8px' }}
        >
          Continue Inspection
        </button>
      </div>
    </div>
  );
}
