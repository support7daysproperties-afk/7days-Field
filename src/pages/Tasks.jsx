import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Calendar, ArrowRight, Plus, AlertCircle, CheckCircle } from 'lucide-react';
import InspectionRepository from '../services/offline/InspectionRepository';

export default function Tasks() {
  const navigate = useNavigate();
  const [inspections, setInspections] = useState([]);
  const [filter, setFilter] = useState('All'); // All, Active, Drafts, Completed, Pending Sync
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadInspections();
  }, []);

  const loadInspections = async () => {
    setIsLoading(true);
    try {
      const data = await InspectionRepository.getAllInspections();
      // Sort by updated_at descending
      data.sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime());
      setInspections(data);
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
    <div className="tasks-page" style={{ paddingBottom: '80px' }}>
      <header className="mb-md flex justify-between items-center">
        <div>
          <h2 style={{ margin: 0, fontSize: '22px' }}>My Inspections</h2>
          <p className="text-secondary text-sm m-0 mt-xs">Manage and continue your field inspections</p>
        </div>
        <button 
          className="btn btn-primary btn-sm flex items-center gap-xs"
          onClick={() => navigate('/create-inspection')}
          style={{ padding: '8px 12px', borderRadius: '8px' }}
        >
          <Plus size={16} /> <span className="font-medium">New</span>
        </button>
      </header>

      <div className="flex gap-sm mb-lg overflow-x-auto" style={{ paddingBottom: '8px', scrollbarWidth: 'none' }}>
        {['All', 'Active', 'Drafts', 'Completed', 'Pending Sync'].map(f => (
          <button 
            key={f}
            onClick={() => setFilter(f)}
            className={`badge ${filter === f ? 'badge-primary' : ''}`}
            style={{ 
              backgroundColor: filter === f ? '' : 'var(--surface-color)', 
              border: filter === f ? '1px solid transparent' : '1px solid var(--border-color)',
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-md">
        {isLoading ? (
          <div className="text-center p-xl text-secondary">Loading...</div>
        ) : filteredInspections.length === 0 ? (
          <div className="card text-center p-xl flex flex-col items-center">
            <h3 className="mb-sm">No {filter.toLowerCase()} inspections</h3>
            {filter === 'Pending Sync' ? (
              <p className="text-secondary text-sm">Everything is synced ✓</p>
            ) : filter === 'Drafts' ? (
              <p className="text-secondary text-sm">No saved drafts</p>
            ) : filter === 'Completed' ? (
              <p className="text-secondary text-sm">No completed inspections yet</p>
            ) : (
              <>
                <p className="text-secondary text-sm mb-md">Start a new inspection when you're ready.</p>
                <button className="btn btn-primary" onClick={() => navigate('/create-inspection')}>
                  + New Inspection
                </button>
              </>
            )}
          </div>
        ) : (
          filteredInspections.map(inspection => {
            const statusDisplay = getStatusDisplay(inspection);
            const progress = getProgress(inspection);
            
            return (
              <div key={inspection.id} className="card" style={{ marginBottom: 0, border: '1px solid var(--border-color)', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                <div className="flex justify-between items-start mb-sm">
                  <div style={{ maxWidth: '70%' }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 'bold', margin: '0 0 4px 0' }}>{inspection.title}</h3>
                    <div className="flex items-center gap-xs text-secondary text-sm">
                      <MapPin size={14} />
                      <span className="truncate">{inspection.location_name || 'Location not specified'}</span>
                    </div>
                  </div>
                  <span className={`badge ${statusDisplay.className} flex items-center gap-xs`} style={{ fontSize: '10px', letterSpacing: '0.5px', fontWeight: 'bold' }}>
                    {statusDisplay.icon} {statusDisplay.label}
                  </span>
                </div>
                
                <div className="flex items-center gap-xs text-sm mb-md text-secondary">
                  <Calendar size={14} />
                  <span>{inspection.inspection_type}</span>
                </div>

                {inspection.status !== 'COMPLETED' && inspection.status !== 'DRAFT' && (
                  <div className="mb-md">
                    <div className="flex justify-between text-xs mb-xs">
                      <span className="text-secondary">Progress</span>
                      <span className="font-medium">{progress}%</span>
                    </div>
                    <div className="progress-bar" style={{ height: '6px', backgroundColor: 'var(--border-color)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div className="progress-fill" style={{ width: `${progress}%`, height: '100%', backgroundColor: 'var(--primary-color)' }}></div>
                    </div>
                  </div>
                )}
                
                <div className="flex items-center justify-between mt-md pt-sm border-t border-color">
                  <span className="text-xs text-secondary">
                    {inspection.status === 'COMPLETED' ? 'Completed' : 'Last updated'} · {formatDate(inspection.updated_at || inspection.created_at)}
                  </span>
                  
                  <button 
                    className={`btn btn-sm ${inspection.status === 'COMPLETED' ? 'btn-outline' : 'btn-primary'}`}
                    onClick={() => navigate(`/inspection/${inspection.id}`)}
                    style={{ padding: '6px 12px', fontSize: '13px' }}
                  >
                    {inspection.status === 'DRAFT' ? 'Continue Setup' : 
                     inspection.status === 'COMPLETED' ? 'View Inspection' : 'Continue'} <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
