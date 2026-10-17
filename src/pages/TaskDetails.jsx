import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useBackHandler } from '../hooks/useBackHandler';
import { navigationService } from '../services/NavigationService';

export default function TaskDetails() {
  const navigate = useNavigate();
  const { id } = useParams();

  useBackHandler('task_details_back', () => {
    navigationService.goBack('/tasks');
    return true;
  }, 10);

  return (
    <div className="task-details-page pb-xl" style={{ backgroundColor: 'var(--bg-color)', minHeight: '100vh', padding: '16px', paddingTop: 'calc(var(--safe-area-top, 36px) + 14px)' }}>
      <header className="flex items-center gap-md mb-md">
        <button onClick={() => navigationService.goBack('/tasks')} className="text-primary" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <ArrowLeft size={24} />
        </button>
      </header>

      {/* Property Card */}
      <div className="card mb-md" style={{ position: 'relative', padding: '18px' }}>
        <div className="flex justify-between items-start mb-xs">
          <span className="text-secondary text-xs font-bold" style={{ letterSpacing: '0.5px', textTransform: 'uppercase' }}>PROPERTY OVERVIEW</span>
          <span className="text-secondary text-xs font-mono">PROP-001</span>
        </div>
        <h1 className="mb-xs" style={{ fontSize: '18px', fontWeight: 700, margin: '4px 0 8px 0', color: 'var(--text-primary)' }}>Ooty Tea Estate Land</h1>
        <div className="text-secondary text-sm mb-md">
          Agricultural Land • Ooty, Tamil Nadu
        </div>

        <div className="p-md rounded-lg" style={{ backgroundColor: 'rgba(37, 99, 235, 0.08)', border: '1px solid rgba(37, 99, 235, 0.25)', borderRadius: '10px' }}>
          <h4 className="text-sm font-bold mb-xs" style={{ color: 'var(--primary-color)', margin: '0 0 4px 0' }}>Supervisor Instructions</h4>
          <p className="text-sm m-0" style={{ color: 'var(--text-primary)', lineHeight: 1.5 }}>
            Verify boundaries of the tea estate, survey terrain markers, and confirm no unrecorded encroachment.
          </p>
        </div>
      </div>

      {/* Assignment Card */}
      <div className="card mb-md" style={{ padding: '16px' }}>
        <span className="text-secondary text-xs font-bold mb-sm block" style={{ letterSpacing: '0.5px', textTransform: 'uppercase' }}>ASSIGNMENT STATUS</span>
        
        <div className="flex flex-col">
          <div className="flex justify-between py-sm" style={{ borderBottom: '1px solid var(--border-color)', fontSize: '14px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Status</span>
            <span style={{ fontWeight: 600, color: 'var(--primary-color)' }}>Assigned</span>
          </div>
          <div className="flex justify-between py-sm" style={{ borderBottom: '1px solid var(--border-color)', fontSize: '14px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Priority</span>
            <span style={{ fontWeight: 600, color: 'var(--warning-color)' }}>High Priority</span>
          </div>
          <div className="flex justify-between py-sm" style={{ fontSize: '14px', paddingTop: '10px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Assigned Date</span>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>22/09/2026</span>
          </div>
        </div>
      </div>

      {/* Required Evidence Card */}
      <div className="card mb-xl" style={{ padding: '16px' }}>
        <span className="text-secondary text-xs font-bold mb-sm block" style={{ letterSpacing: '0.5px', textTransform: 'uppercase' }}>REQUIRED EVIDENCE CHECKLIST</span>
        
        <div className="flex flex-col gap-sm">
          {[
            'Property exterior photos',
            'Land boundary GPS points',
            'Access road & entry photo',
            'Surrounding area panoramas',
            'Property perimeter video',
            'Location coordinates verification'
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-sm" style={{ fontSize: '14px' }}>
              <div style={{ width: '18px', height: '18px', border: '1.5px solid var(--border-color)', borderRadius: '4px', backgroundColor: 'var(--surface-light)' }}></div>
              <span style={{ color: 'var(--text-primary)' }}>{item}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Fixed Bottom Button Container */}
      <div style={{ 
        position: 'fixed', 
        bottom: 0, 
        left: 0, 
        right: 0, 
        width: '100%',
        maxWidth: '480px',
        margin: '0 auto',
        padding: '16px', 
        paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))', 
        backgroundColor: 'rgba(20, 24, 33, 0.96)', 
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderTop: '1px solid var(--border-color)', 
        zIndex: 100,
        boxSizing: 'border-box'
      }}>
        <button 
          className="btn btn-primary w-full"
          onClick={() => navigate(`/inspection/${id}`)}
          style={{ minHeight: '48px', fontSize: '15px', fontWeight: 700, borderRadius: '10px' }}
        >
          Continue Inspection
        </button>
      </div>
    </div>
  );
}
