import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  ArrowRight,
  User,
  MapPin,
  CheckCircle2,
  AlertCircle,
  Calendar,
  CloudOff,
  RefreshCw,
  HardDrive,
  Compass,
  Clock
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import InspectionRepository from '../services/offline/InspectionRepository';
import ConnectivityService from '../services/offline/ConnectivityService';

export default function Home() {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [inspections, setInspections] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    loadInspections();
    const unsub = ConnectivityService.subscribe(({ online }) => {
      setIsOnline(online);
    });
    return unsub;
  }, []);

  const loadInspections = async () => {
    setIsLoading(true);
    try {
      const data = await InspectionRepository.getAllInspections();
      data.sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime());
      setInspections(data);
    } catch (err) {
      console.error('Failed to load inspections:', err);
    } finally {
      setIsLoading(false);
    }
  };
  
  const name = user?.supervisorProfile?.name || 'Field Supervisor';
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;

  // Real data calculations
  const activeInspections = inspections.filter(i => i.status === 'IN_PROGRESS' || i.status === 'PAUSED' || i.status === 'REVIEW');
  const completedInspections = inspections.filter(i => i.status === 'COMPLETED');
  const pendingSyncInspections = inspections.filter(i => i.sync_status === 'LOCAL_ONLY' || i.sync_status === 'SYNC_FAILED' || i.sync_status === 'PARTIALLY_SYNCED');
  
  // Current active inspection
  const currentInspection = activeInspections.length > 0 ? activeInspections[0] : null;
  
  // Recent 3 inspections
  const recentInspections = inspections.slice(0, 3);

  // Time-appropriate compact greeting
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const getProgress = (inspection) => {
    if (inspection.status === 'COMPLETED') return 100;
    if (inspection.status === 'DRAFT') return 0;
    const checklist = inspection.metadata?.checklist || {};
    const total = Object.keys(checklist).length;
    if (total === 0) return 15;
    const completed = Object.values(checklist).filter(Boolean).length;
    return Math.round((completed / total) * 100);
  };
  
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
  };

  return (
    <div className="home-page" style={{ paddingBottom: '24px' }}>
      
      {/* ── Compact Operational Header ── */}
      <header className="flex justify-between items-center mb-md" style={{ paddingTop: '2px' }}>
        <div>
          <div className="text-xs text-tertiary font-medium">
            {getGreeting()} • {isOnline ? 'Online' : 'Offline'}
          </div>
          <h1 style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)', marginTop: '2px' }}>
            {name}
          </h1>
        </div>
        
        <div 
          className="flex items-center justify-center cursor-pointer" 
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            backgroundColor: 'var(--surface-raised)',
            border: '1px solid var(--border-color)',
            overflow: 'hidden',
            flexShrink: 0
          }}
          onClick={() => navigate('/profile')}
          title="Account profile"
          aria-label="Account profile"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <User size={20} color="var(--text-secondary)" />
          )}
        </div>
      </header>

      {/* ── Primary Action: New Field Inspection ── */}
      <section className="mb-md">
        <div 
          className="card card-interactive"
          style={{
            backgroundColor: 'var(--surface-raised)',
            borderColor: 'var(--primary-border)',
            padding: '14px 16px',
            boxShadow: '0 4px 14px -3px rgba(37, 99, 235, 0.25)',
            position: 'relative',
            overflow: 'hidden'
          }}
          onClick={() => navigate('/create-inspection')}
        >
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: '4px',
            backgroundColor: 'var(--primary-color)'
          }} />
          <div className="flex justify-between items-center">
            <div style={{ paddingLeft: '4px' }}>
              <div className="flex items-center gap-xs mb-2xs">
                <span className="badge badge-primary" style={{ padding: '2px 6px', fontSize: '10px' }}>NEW</span>
                <h2 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-primary)', margin: 0 }}>
                  Start Field Inspection
                </h2>
              </div>
              <p className="text-xs text-secondary" style={{ margin: 0 }}>
                Survey property boundary, geotag photos & complete checklist
              </p>
            </div>
            <div 
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                backgroundColor: 'var(--primary-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                flexShrink: 0,
                marginLeft: '12px'
              }}
            >
              <Plus size={20} />
            </div>
          </div>
        </div>
      </section>

      {/* ── Compact 4-Column Statistics Strip ── */}
      <section className="mb-md">
        <div className="section-header">
          <span className="section-title">Overview</span>
          <button className="section-action" onClick={() => navigate('/tasks')}>
            All Tasks <ArrowRight size={12} />
          </button>
        </div>
        
        <div className="stats-grid">
          <div className="stat-tile" onClick={() => navigate('/tasks')}>
            <span className="stat-value">{inspections.length}</span>
            <span className="stat-label">Total</span>
          </div>
          <div className="stat-tile" onClick={() => navigate('/tasks')}>
            <span className="stat-value" style={{ color: activeInspections.length > 0 ? '#60a5fa' : 'var(--text-primary)' }}>
              {activeInspections.length}
            </span>
            <span className="stat-label">Active</span>
          </div>
          <div className="stat-tile" onClick={() => navigate('/tasks')}>
            <span className="stat-value" style={{ color: completedInspections.length > 0 ? '#34d399' : 'var(--text-primary)' }}>
              {completedInspections.length}
            </span>
            <span className="stat-label">Done</span>
          </div>
          <div className="stat-tile" onClick={() => navigate('/sync')}>
            <span className="stat-value" style={{ color: pendingSyncInspections.length > 0 ? '#fbbf24' : 'var(--text-tertiary)' }}>
              {pendingSyncInspections.length}
            </span>
            <span className="stat-label">Sync</span>
          </div>
        </div>
      </section>

      {/* ── Current Active Inspection ── */}
      <section className="mb-md">
        <div className="section-header">
          <span className="section-title">Active Inspection</span>
          {currentInspection && (
            <span className="text-xs text-secondary">
              Updated {formatDate(currentInspection.updated_at || currentInspection.created_at)}
            </span>
          )}
        </div>
        
        {currentInspection ? (
          <div className="card" style={{ borderColor: 'var(--primary-border)' }}>
            <div className="flex justify-between items-start mb-sm">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="flex items-center gap-xs mb-xs">
                  <span className="badge badge-primary">
                    {currentInspection.status.replace('_', ' ')}
                  </span>
                  <span className="text-xs text-tertiary">
                    {currentInspection.id}
                  </span>
                </div>
                <h3 className="truncate" style={{ fontSize: '16px', fontWeight: '700', marginBottom: '4px' }}>
                  {currentInspection.title || 'Untitled Inspection'}
                </h3>
                <div className="flex items-center gap-xs text-xs text-secondary">
                  <MapPin size={13} color="var(--primary-light)" style={{ flexShrink: 0 }} />
                  <span className="truncate">
                    {currentInspection.location_name || 'Site location pending capture'}
                  </span>
                </div>
              </div>
            </div>
            
            <div className="mb-md" style={{ backgroundColor: 'var(--surface-light)', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
              <div className="flex justify-between text-xs mb-xs">
                <span className="text-secondary font-medium">Field Completion</span>
                <span className="font-bold text-primary">{getProgress(currentInspection)}%</span>
              </div>
              <div className="progress-bar" style={{ height: '6px' }}>
                <div className="progress-fill" style={{ width: `${getProgress(currentInspection)}%` }}></div>
              </div>
            </div>
            
            <button 
              className="btn btn-primary"
              onClick={() => navigate(`/inspection/${currentInspection.id}`)}
              style={{ minHeight: '40px', fontSize: '13px' }}
            >
              Continue Inspection <ArrowRight size={16} />
            </button>
          </div>
        ) : (
          <div className="card text-center" style={{ padding: '24px 16px', borderStyle: 'dashed' }}>
            <Compass size={28} color="var(--text-tertiary)" style={{ margin: '0 auto 8px' }} />
            <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '4px' }}>
              No Active Inspection
            </div>
            <p className="text-xs text-secondary mb-md" style={{ maxWidth: '280px', margin: '0 auto 14px' }}>
              All assigned inspections are up to date. Start a new inspection when you reach the site.
            </p>
            <button 
              className="btn btn-secondary btn-sm" 
              style={{ width: 'auto', display: 'inline-flex' }}
              onClick={() => navigate('/create-inspection')}
            >
              <Plus size={14} /> New Inspection
            </button>
          </div>
        )}
      </section>

      {/* ── Offline & Sync Status Banner (Dark High-Contrast Theme) ── */}
      <section className="mb-md">
        <div 
          className="card" 
          style={{
            backgroundColor: pendingSyncInspections.length > 0 ? 'rgba(245, 158, 11, 0.08)' : 'rgba(16, 185, 129, 0.08)',
            borderColor: pendingSyncInspections.length > 0 ? 'var(--warning-border)' : 'var(--success-border)',
            padding: '12px 14px'
          }}
        >
          <div className="flex items-center justify-between gap-sm">
            <div className="flex items-center gap-sm" style={{ flex: 1, minWidth: 0 }}>
              <div 
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  backgroundColor: pendingSyncInspections.length > 0 ? 'var(--warning-transparent)' : 'var(--success-transparent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: pendingSyncInspections.length > 0 ? 'var(--warning-color)' : 'var(--success-color)',
                  flexShrink: 0
                }}
              >
                {pendingSyncInspections.length > 0 ? <RefreshCw size={16} /> : <CheckCircle2 size={16} />}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>
                  {pendingSyncInspections.length > 0
                    ? `${pendingSyncInspections.length} Inspection${pendingSyncInspections.length !== 1 ? 's' : ''} Pending Sync`
                    : 'Storage & Sync Up to Date'}
                </div>
                <div className="text-xs text-secondary truncate">
                  {pendingSyncInspections.length > 0 
                    ? 'Saved locally • Tap to sync when online' 
                    : 'All field records verified and backed up'}
                </div>
              </div>
            </div>

            <button 
              className="btn btn-secondary btn-sm"
              style={{
                width: 'auto',
                padding: '6px 12px',
                fontSize: '12px',
                flexShrink: 0,
                borderColor: pendingSyncInspections.length > 0 ? 'var(--warning-border)' : 'var(--border-color)',
                color: pendingSyncInspections.length > 0 ? '#fbbf24' : 'var(--text-primary)'
              }}
              onClick={() => navigate('/sync')}
            >
              Open Sync
            </button>
          </div>
        </div>
      </section>

      {/* ── Recent Inspections List ── */}
      {recentInspections.length > 0 && (
        <section>
          <div className="section-header">
            <span className="section-title">Recent Inspections</span>
            <span className="section-action" onClick={() => navigate('/tasks')}>
              View all ({inspections.length}) <ArrowRight size={12} />
            </span>
          </div>
          
          <div className="flex flex-col gap-sm">
            {recentInspections.map(ins => (
              <div 
                key={ins.id} 
                className="card card-interactive flex justify-between items-center" 
                style={{ padding: '12px 14px', marginBottom: 0 }}
                onClick={() => navigate(`/inspection/${ins.id}`)}
              >
                <div style={{ flex: 1, minWidth: 0, paddingRight: '12px' }}>
                  <div className="flex items-center gap-xs mb-2xs">
                    <span className="text-xs font-bold text-primary truncate" style={{ maxWidth: '120px' }}>
                      {ins.id}
                    </span>
                    <span className="text-tertiary text-xs">•</span>
                    <span className="text-xs text-tertiary truncate">
                      {ins.inspection_type || 'Standard'}
                    </span>
                  </div>
                  <h4 className="truncate" style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>
                    {ins.title || 'Untitled Inspection'}
                  </h4>
                  <div className="text-xs text-secondary flex items-center gap-xs mt-2xs">
                    <MapPin size={11} color="var(--text-tertiary)" />
                    <span className="truncate">{ins.location_name || 'Location unrecorded'}</span>
                  </div>
                </div>

                <div className="text-right" style={{ flexShrink: 0 }}>
                  <div 
                    className={`badge ${
                      ins.status === 'COMPLETED'
                        ? 'badge-success'
                        : ins.status === 'IN_PROGRESS'
                          ? 'badge-primary'
                          : 'badge-secondary'
                    }`}
                    style={{ fontSize: '10px', marginBottom: '3px' }}
                  >
                    {ins.status.replace('_', ' ')}
                  </div>
                  <div className="text-xs text-tertiary">
                    {formatDate(ins.updated_at || ins.created_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

