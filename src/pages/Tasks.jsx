import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Calendar, ArrowRight, Plus, AlertCircle, CheckCircle, ClipboardList, Share2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import InspectionRepository from '../services/offline/InspectionRepository';
import DatabaseService from '../services/offline/DatabaseService';
import ConnectivityService from '../services/offline/ConnectivityService';
import SyncEngine from '../services/offline/SyncEngine';
import useBackHandler from '../hooks/useBackHandler';
import ShareInspectionModal from '../components/ShareInspectionModal';

export default function Tasks() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [inspections, setInspections] = useState([]);
  const [filter, setFilter] = useState('All'); // All, Active, Drafts, Completed, Pending Sync
  const [isLoading, setIsLoading] = useState(true);
  const [selectedShareInspection, setSelectedShareInspection] = useState(null);

  // On tasks tab, back returns to dashboard
  useBackHandler(
    'tasks_tab_back',
    () => {
      navigate('/', { replace: false });
      return true;
    },
    10,
    true
  );

  useEffect(() => {
    loadInspections();

    const unsubDb = DatabaseService.subscribe(() => {
      loadInspections();
    });

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        loadInspections();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', loadInspections);

    return () => {
      unsubDb();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', loadInspections);
    };
  }, [user?.id]);

  const loadInspections = async () => {
    setIsLoading(true);
    try {
      const data = await InspectionRepository.getAllInspections();
      // Sort by updated_at descending
      data.sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime());
      setInspections(data);

      if (user && (ConnectivityService.online || navigator?.onLine)) {
        SyncEngine.syncRemoteInspections(user).catch(() => {});
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const getFilteredInspections = () => {
    switch (filter) {
      case 'Active':
        return inspections.filter(i => i.status === 'IN_PROGRESS' || i.status === 'PAUSED' || i.status === 'REVIEW');
      case 'Drafts':
        return inspections.filter(i => i.status === 'DRAFT');
      case 'Completed':
        return inspections.filter(i => i.status === 'COMPLETED');
      case 'Pending Sync':
        return inspections.filter(i => i.sync_status === 'LOCAL_ONLY' || i.sync_status === 'SYNC_FAILED' || i.sync_status === 'PARTIALLY_SYNCED');
      default:
        return inspections;
    }
  };

  const filteredInspections = getFilteredInspections();

  const getStatusDisplay = (inspection) => {
    if (inspection.sync_status === 'LOCAL_ONLY' || inspection.sync_status === 'SYNC_FAILED') {
      return { label: 'SYNC WAIT', className: 'badge-warning', icon: <AlertCircle size={12} /> };
    }
    if (inspection.status === 'COMPLETED') {
      return { label: 'DONE ✓', className: 'badge-success', icon: <CheckCircle size={12} /> };
    }
    if (inspection.status === 'DRAFT') {
      return { label: 'DRAFT', className: 'badge-secondary' };
    }
    return { label: 'ACTIVE', className: 'badge-primary' };
  };
  
  const getProgress = (inspection) => {
    // Basic completion heuristic based on status if we don't have accurate % yet
    if (inspection.status === 'COMPLETED') return 100;
    if (inspection.status === 'DRAFT') return 0;
    // Calculate from checklist if present
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
    <div className="tasks-page" style={{ paddingBottom: '32px' }}>
      <header className="mb-md flex justify-between items-center" style={{ paddingTop: '2px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)', margin: 0 }}>
            Field Inspections
          </h1>
          <p className="text-xs text-secondary" style={{ margin: '2px 0 0' }}>
            {inspections.length} total • Track, review & resume property surveys
          </p>
        </div>
        <button 
          className="btn btn-primary btn-sm flex items-center gap-xs"
          onClick={() => navigate('/create-inspection')}
          style={{ width: 'auto', padding: '6px 14px' }}
        >
          <Plus size={15} /> <span>New</span>
        </button>
      </header>

      {/* ── Filter Chips ── */}
      <div 
        className="flex gap-xs mb-md overflow-x-auto" 
        style={{ paddingBottom: '4px', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
      >
        {['All', 'Active', 'Drafts', 'Completed', 'Pending Sync'].map(f => {
          const isActive = filter === f;
          return (
            <button 
              key={f}
              onClick={() => setFilter(f)}
              className="badge"
              style={{ 
                backgroundColor: isActive ? 'var(--primary-transparent)' : 'var(--surface-color)', 
                color: isActive ? 'var(--primary-light)' : 'var(--text-secondary)',
                border: isActive ? '1px solid var(--primary-border)' : '1px solid var(--border-color)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                padding: '6px 12px',
                fontSize: '12px',
                borderRadius: 'var(--radius-md)',
                fontWeight: isActive ? 600 : 500,
                transition: 'all 0.15s ease'
              }}
            >
              {f}
            </button>
          );
        })}
      </div>

      {/* ── Inspection Cards List ── */}
      <div className="flex flex-col gap-sm">
        {isLoading ? (
          <div className="card text-center text-secondary py-xl" style={{ borderStyle: 'dashed' }}>
            Loading field records...
          </div>
        ) : filteredInspections.length === 0 ? (
          <div className="card text-center flex flex-col items-center" style={{ padding: '40px 20px', borderStyle: 'dashed' }}>
            <div style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              backgroundColor: 'var(--surface-raised)',
              border: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '12px',
              color: 'var(--text-tertiary)'
            }}>
              <ClipboardList size={22} />
            </div>
            <h3 className="mb-xs" style={{ fontSize: '15px', color: 'var(--text-primary)', fontWeight: '600' }}>
              No {filter === 'All' ? '' : `${filter.toLowerCase()} `}inspections found
            </h3>
            {filter === 'Pending Sync' ? (
              <p className="text-xs text-secondary mb-0">All local records are synchronized with the cloud.</p>
            ) : filter === 'Drafts' ? (
              <p className="text-xs text-secondary mb-0">No unfinished drafts stored on this device.</p>
            ) : filter === 'Completed' ? (
              <p className="text-xs text-secondary mb-0">No finalized inspections recorded yet.</p>
            ) : (
              <>
                <p className="text-xs text-secondary mb-md" style={{ maxWidth: '300px' }}>
                  Your workspace is clean and fresh. Start your first site survey whenever you arrive at the property.
                </p>
                <button 
                  className="btn btn-primary btn-sm" 
                  style={{ width: 'auto', display: 'inline-flex', padding: '8px 18px' }}
                  onClick={() => navigate('/create-inspection')}
                >
                  <Plus size={14} /> Start New Inspection
                </button>
              </>
            )}
          </div>
        ) : (
          filteredInspections.map(inspection => {
            const statusDisplay = getStatusDisplay(inspection);
            const progress = getProgress(inspection);
            
            return (
              <div 
                key={inspection.id} 
                className="card card-interactive" 
                style={{ marginBottom: 0, padding: '14px 16px' }}
                onClick={() => navigate(`/inspection/${inspection.id}`)}
              >
                <div className="flex justify-between items-start mb-xs">
                  <div style={{ flex: 1, minWidth: 0, paddingRight: '10px' }}>
                    <div className="flex items-center gap-xs mb-2xs">
                      <span className="text-xs font-bold text-primary truncate" style={{ maxWidth: '140px' }}>
                        {inspection.id}
                      </span>
                      <span className="text-tertiary text-xs">•</span>
                      <span className="text-xs text-tertiary truncate">
                        {inspection.inspection_type || 'Standard'}
                      </span>
                    </div>
                    <h3 className="truncate" style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-primary)', margin: 0 }}>
                      {inspection.title || 'Untitled Inspection'}
                    </h3>
                    <div className="flex items-center gap-xs text-xs text-secondary mt-2xs">
                      <MapPin size={12} color="var(--primary-light)" style={{ flexShrink: 0 }} />
                      <span className="truncate">{inspection.location_name || 'Location pending'}</span>
                    </div>
                  </div>
                  <span className={`badge ${statusDisplay.className}`} style={{ flexShrink: 0, fontSize: '10px' }}>
                    {statusDisplay.icon} {statusDisplay.label}
                  </span>
                </div>

                {inspection.status !== 'COMPLETED' && inspection.status !== 'DRAFT' && (
                  <div className="mt-sm mb-xs" style={{ backgroundColor: 'var(--surface-light)', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                    <div className="flex justify-between text-xs mb-2xs">
                      <span className="text-secondary">Progress</span>
                      <span className="font-bold text-primary">{progress}%</span>
                    </div>
                    <div className="progress-bar" style={{ height: '4px' }}>
                      <div className="progress-fill" style={{ width: `${progress}%` }}></div>
                    </div>
                  </div>
                )}
                
                <div className="flex items-center justify-between mt-sm pt-xs" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <span className="text-xs text-tertiary">
                    {inspection.status === 'COMPLETED' ? 'Completed' : 'Updated'} · {formatDate(inspection.updated_at || inspection.created_at)}
                  </span>
                  
                  <div className="flex items-center gap-xs">
                    {inspection.status === 'COMPLETED' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedShareInspection(inspection);
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          padding: '4px 10px',
                          borderRadius: '6px',
                          backgroundColor: 'var(--surface-raised, #181d28)',
                          border: '1px solid var(--border-color, #2a3447)',
                          color: 'var(--text-primary)',
                          fontSize: '11px',
                          fontWeight: '600',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <Share2 size={12} color="var(--primary-light)" />
                        <span>Share</span>
                      </button>
                    )}

                    <span 
                      className="text-xs font-semibold text-primary flex items-center gap-2xs"
                      style={{ color: 'var(--primary-light)' }}
                    >
                      {inspection.status === 'DRAFT' ? 'Continue Setup' : 
                       inspection.status === 'COMPLETED' ? 'View Details' : 'Continue'} <ArrowRight size={13} />
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Share Inspection Modal ── */}
      {selectedShareInspection && (
        <ShareInspectionModal
          inspection={selectedShareInspection}
          onClose={() => setSelectedShareInspection(null)}
          onNavigateToSync={() => navigate('/sync')}
        />
      )}
    </div>
  );
}
