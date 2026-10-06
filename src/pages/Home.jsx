import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ArrowRight, User, MapPin, CheckCircle, AlertCircle, Calendar } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import InspectionRepository from '../services/offline/InspectionRepository';

export default function Home() {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [inspections, setInspections] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadInspections();
  }, []);

  const loadInspections = async () => {
    setIsLoading(true);
    try {
      const data = await InspectionRepository.getAllInspections();
      data.sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime());
      setInspections(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };
  
  const name = user?.supervisorProfile?.name || 'Field Supervisor';
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;

  // Stats
  const activeInspections = inspections.filter(i => i.status === 'IN_PROGRESS' || i.status === 'PAUSED' || i.status === 'REVIEW');
  const completedInspections = inspections.filter(i => i.status === 'COMPLETED');
  const pendingSyncInspections = inspections.filter(i => i.sync_status === 'LOCAL_ONLY' || i.sync_status === 'SYNC_FAILED' || i.sync_status === 'PARTIALLY_SYNCED');
  
  // Current inspection (most recently updated active one)
  const currentInspection = activeInspections.length > 0 ? activeInspections[0] : null;
  
  // Recent 3 inspections
  const recentInspections = inspections.slice(0, 3);

  const getProgress = (inspection) => {
    if (inspection.status === 'COMPLETED') return 100;
    if (inspection.status === 'DRAFT') return 0;
    const checklist = inspection.metadata?.checklist || {};
    const total = Object.keys(checklist).length;
    if (total === 0) return 10;
    const completed = Object.values(checklist).filter(Boolean).length;
    return Math.round((completed / total) * 100);
  };
  
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
  };

  return (
    <div className="home-page" style={{ paddingBottom: '100px' }}>
      <header className="mb-lg flex justify-between items-start">
        <div>
          <h1 className="text-secondary" style={{ fontSize: '16px', fontWeight: '500' }}>Good morning,</h1>
          <h2 style={{ fontSize: '28px' }}>{name}</h2>
        </div>
        
        <div 
          className="bg-primary flex items-center justify-center overflow-hidden cursor-pointer shadow-sm" 
          style={{ width: '48px', height: '48px', borderRadius: '50%', border: '2px solid var(--surface-color)' }}
          onClick={() => navigate('/profile')}
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <User size={24} className="text-white" />
          )}
        </div>
      </header>

      {/* Primary Action */}
      <section className="mb-lg">
        <div 
          className="card bg-primary text-white cursor-pointer" 
          style={{ border: 'none', padding: '24px 20px' }}
          onClick={() => navigate('/create-inspection')}
        >
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-white mb-xs" style={{ fontSize: '20px' }}>Start a new field inspection</h3>
              <p style={{ opacity: 0.9, fontSize: '14px', margin: 0 }}>Create a task and begin your inspection</p>
            </div>
          </div>
          <div className="mt-md pt-md flex items-center justify-between" style={{ borderTop: '1px solid rgba(255,255,255,0.2)' }}>
            <div className="flex items-center gap-sm font-bold" style={{ fontSize: '16px' }}>
              <Plus size={20} /> New Inspection
            </div>
            <ArrowRight size={20} />
          </div>
        </div>
      </section>

      {/* Quick Stats (2x2 grid) */}
      <section className="mb-lg">
        <h3 className="mb-sm text-sm text-secondary font-bold" style={{ letterSpacing: '0.5px' }}>INSPECTIONS</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div className="card text-center py-md">
            <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{inspections.length}</div>
            <div className="text-xs text-secondary mt-xs">Total</div>
          </div>
          <div className="card text-center py-md" style={{ borderBottom: '3px solid var(--primary-color)' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{activeInspections.length}</div>
            <div className="text-xs text-secondary mt-xs">Active</div>
          </div>
          <div className="card text-center py-md" style={{ borderBottom: '3px solid var(--success-color)' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{completedInspections.length}</div>
            <div className="text-xs text-secondary mt-xs">Done</div>
          </div>
          <div className="card text-center py-md" style={{ borderBottom: '3px solid var(--warning-color)' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{pendingSyncInspections.length}</div>
            <div className="text-xs text-secondary mt-xs">Sync</div>
          </div>
        </div>
      </section>

      {/* Current Inspection */}
      <section className="mb-lg">
        <h3 className="mb-sm text-sm text-secondary font-bold" style={{ letterSpacing: '0.5px' }}>CURRENT INSPECTION</h3>
        
        {currentInspection ? (
          <div className="card" style={{ borderLeft: '4px solid var(--primary-color)' }}>
            <div className="flex justify-between mb-sm">
              <div>
                <h3 className="mb-xs" style={{ fontSize: '18px' }}>{currentInspection.title}</h3>
                <div className="flex items-center gap-xs text-secondary text-sm">
                  <MapPin size={14} />
                  <span>{currentInspection.location_name || 'Location not specified'}</span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-sm mb-md text-sm text-secondary">
              <CheckCircle size={16} className="text-primary" />
              <span>{currentInspection.inspection_type}</span>
            </div>
            
            <div className="mb-md">
              <div className="flex justify-between text-xs mb-xs">
                <span className="text-secondary">Inspection progress</span>
                <span className="font-bold">{getProgress(currentInspection)}%</span>
              </div>
              <div className="progress-bar" style={{ height: '8px', backgroundColor: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
                <div className="progress-fill" style={{ width: `${getProgress(currentInspection)}%`, height: '100%', backgroundColor: 'var(--primary-color)' }}></div>
              </div>
            </div>
            
            <button 
              className="btn btn-primary w-full flex justify-center items-center gap-sm"
              onClick={() => navigate(`/inspection/${currentInspection.id}`)}
            >
              Continue Inspection <ArrowRight size={18} />
            </button>
          </div>
        ) : (
          <div className="card text-center py-xl">
            <h3 className="mb-xs" style={{ fontSize: '16px' }}>No inspection in progress</h3>
            <p className="text-secondary text-sm mb-md">Start a new field inspection when you're ready.</p>
            <button className="btn btn-outline" onClick={() => navigate('/create-inspection')}>
              + New Inspection
            </button>
          </div>
        )}
      </section>

      {/* Sync Status */}
      <section className="mb-lg">
        <div className="card" style={{ backgroundColor: pendingSyncInspections.length > 0 ? '#fffbeb' : '#f0fdf4', border: 'none' }}>
          <div className="flex items-start gap-md">
            <div className={`p-sm rounded-full ${pendingSyncInspections.length > 0 ? 'bg-warning text-white' : 'bg-success text-white'}`}>
              {pendingSyncInspections.length > 0 ? <AlertCircle size={20} /> : <CheckCircle size={20} />}
            </div>
            <div>
              <h4 className="font-bold mb-xs" style={{ color: 'var(--text-color)' }}>
                {pendingSyncInspections.length > 0 ? `${pendingSyncInspections.length} inspections waiting to sync` : 'All inspections synced'}
              </h4>
              <p className="text-sm text-secondary mb-sm">
                {pendingSyncInspections.length > 0 
                  ? 'Photos and inspection data are safely stored on this device.' 
                  : 'Your field data is up to date and safely stored.'}
              </p>
              {pendingSyncInspections.length > 0 && (
                <button 
                  className="btn btn-sm" 
                  style={{ backgroundColor: 'white', color: 'var(--text-color)', border: '1px solid var(--border-color)' }}
                  onClick={() => navigate('/sync')}
                >
                  Open Sync
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Recent Inspections */}
      {recentInspections.length > 0 && (
        <section>
          <div className="flex justify-between items-center mb-sm">
            <h3 className="text-sm text-secondary font-bold" style={{ letterSpacing: '0.5px' }}>RECENT INSPECTIONS</h3>
            <span className="text-primary text-sm font-medium cursor-pointer" onClick={() => navigate('/tasks')}>See all →</span>
          </div>
          
          <div className="flex flex-col gap-sm">
            {recentInspections.map(ins => (
              <div 
                key={ins.id} 
                className="card flex justify-between items-center cursor-pointer" 
                style={{ padding: '16px', marginBottom: 0 }}
                onClick={() => navigate(`/inspection/${ins.id}`)}
              >
                <div>
                  <h4 className="font-bold mb-xs" style={{ fontSize: '15px' }}>{ins.title}</h4>
                  <div className="text-xs text-secondary flex items-center gap-xs">
                    <Calendar size={12} /> {ins.inspection_type}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`badge ${ins.status === 'COMPLETED' ? 'badge-success' : ins.status === 'IN_PROGRESS' ? 'badge-primary' : 'badge-secondary'}`} style={{ fontSize: '10px', marginBottom: '4px' }}>
                    {ins.status.replace('_', ' ')}
                  </div>
                  <div className="text-xs text-secondary">{formatDate(ins.updated_at || ins.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
