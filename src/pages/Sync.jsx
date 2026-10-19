import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2, RefreshCw, AlertTriangle, Wifi, WifiOff,
  CloudOff, Upload, Image as ImageIcon, Video, FileSignature,
  ChevronDown, ChevronUp, HardDrive, RotateCcw, Clock,
  AlertCircle, Loader2, XCircle, Share2
} from 'lucide-react';
import InspectionRepository from '../services/offline/InspectionRepository';
import MediaRepository from '../services/offline/MediaRepository';
import SyncJobRepository from '../services/offline/SyncJobRepository';
import ConnectivityService from '../services/offline/ConnectivityService';
import SyncEngine from '../services/offline/SyncEngine';
import DatabaseService from '../services/offline/DatabaseService';
import { useAuth } from '../context/AuthContext';
import useBackHandler from '../hooks/useBackHandler';
import ShareInspectionModal from '../components/ShareInspectionModal';

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  LOCAL_ONLY:      { label: 'Saved Locally',        color: 'var(--text-secondary)', icon: CloudOff,      bg: 'rgba(100,116,139,0.1)' },
  QUEUED:          { label: 'Queued for Sync',       color: 'var(--primary-color)',  icon: Clock,         bg: 'rgba(99,102,241,0.1)' },
  SYNCING:         { label: 'Syncing…',              color: 'var(--primary-color)',  icon: RefreshCw,     bg: 'rgba(99,102,241,0.1)' },
  PARTIALLY_SYNCED:{ label: 'Partially Synced',      color: 'var(--warning-color)',  icon: AlertTriangle, bg: 'rgba(245,158,11,0.1)' },
  SYNCED:          { label: 'Fully Synced',          color: 'var(--success-color)',  icon: CheckCircle2,  bg: 'rgba(34,197,94,0.1)' },
  FAILED:          { label: 'Sync Failed',           color: 'var(--danger-color)',   icon: XCircle,       bg: 'rgba(239,68,68,0.1)' },
  NEEDS_DRIVE_AUTH:{ label: 'Drive Auth Needed',     color: 'var(--warning-color)',  icon: HardDrive,     bg: 'rgba(245,158,11,0.1)' },
};

function SyncStatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.LOCAL_ONLY;
  const Icon = cfg.icon;
  const isSpinning = status === 'SYNCING';
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      padding: '4px 10px', borderRadius: '20px',
      backgroundColor: cfg.bg, color: cfg.color, fontSize: '12px', fontWeight: '600'
    }}>
      <Icon size={12} style={isSpinning ? { animation: 'spin 1s linear infinite' } : {}} />
      {cfg.label}
    </div>
  );
}

function MediaProgressBar({ uploaded, total, uploading = 0 }) {
  const pct = total === 0 ? 100 : Math.round((uploaded / total) * 100);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
        <span>{uploaded} / {total} files uploaded</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {uploading > 0 && (
            <span style={{ color: 'var(--primary-color)', fontWeight: '600', fontSize: '10px' }}>
              ({uploading} uploading concurrently)
            </span>
          )}
          <span style={{ fontWeight: '700' }}>{pct}%</span>
        </div>
      </div>
      <div style={{ height: '5px', backgroundColor: 'var(--bg-color)', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: '3px',
          backgroundColor: pct === 100 ? 'var(--success-color)' : 'var(--primary-color)',
          transition: 'width 0.3s ease'
        }} />
      </div>
    </div>
  );
}

function InspectionCard({ inspection, mediaForInspection, job, onRetry, onConnectDrive, onShare }) {
  const [expanded, setExpanded] = useState(inspection.sync_status !== 'SYNCED');

  const totalMedia = mediaForInspection.length;
  const uploadedMedia = mediaForInspection.filter(m => ['UPLOADED', 'uploaded'].includes(m.sync_status)).length;
  const uploadingMedia = mediaForInspection.filter(m => ['UPLOADING', 'uploading', 'authorizing', 'confirming'].includes(m.sync_status)).length;
  const failedMedia = mediaForInspection.filter(m => ['FAILED', 'failed', 'retry_wait'].includes(m.sync_status));
  const photos = mediaForInspection.filter(m => (m.type || m.mediaType) === 'photo');
  const videos = mediaForInspection.filter(m => (m.type || m.mediaType) === 'video');
  const signatures = mediaForInspection.filter(m => (m.type || m.mediaType) === 'signature');

  const meta = inspection.metadata || {};
  const propName = inspection.property_name || `Property ${inspection.property_id || inspection.id}`;

  return (
    <div style={{
      border: '1px solid var(--border-color)',
      borderRadius: '12px',
      overflow: 'hidden',
      backgroundColor: 'var(--surface-color)',
      marginBottom: '12px'
    }}>
      {/* Header */}
      <div
        style={{ padding: '14px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}
        onClick={() => setExpanded(e => !e)}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: '700', fontSize: '15px', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {propName}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <SyncStatusBadge status={inspection.sync_status} />
            {totalMedia > 0 && (
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                {photos.length > 0 && `${photos.length} photos`}
                {videos.length > 0 && ` • ${videos.length} videos`}
                {signatures.length > 0 && ` • ${signatures.length} sig`}
              </span>
            )}
          </div>
        </div>
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onShare && onShare(inspection);
            }}
            style={{
              padding: '5px 10px',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              backgroundColor: 'var(--surface-raised, #181d28)',
              color: 'var(--text-primary)',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
            title="Share Drive Folder"
          >
            <Share2 size={13} color="var(--primary-light)" />
            <span>Share</span>
          </button>
          <div style={{ color: 'var(--text-secondary)' }}>
            {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </div>
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border-color)' }}>
          <div style={{ paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>

            {/* Upload progress */}
            {totalMedia > 0 && <MediaProgressBar uploaded={uploadedMedia} total={totalMedia} uploading={uploadingMedia} />}

            {/* Checklist rows */}
            {[
              { label: 'Inspection details & server identity', done: ['SYNCED', 'SYNCING', 'PARTIALLY_SYNCED'].includes(inspection.sync_status) },
              { label: 'Checklist items verified', done: !!(meta.checklist && Object.values(meta.checklist).some(Boolean)) },
              { label: 'Owner information confirmed', done: !!(meta.ownerInfo?.name) },
              { label: 'Consent & Signature captured', done: !!(meta.consent && meta.signature) },
            ].map(({ label, done }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                {done ? <CheckCircle2 size={14} style={{ color: 'var(--success-color)', flexShrink: 0 }} />
                       : <div style={{ width: '14px', height: '14px', borderRadius: '50%', border: '2px solid var(--border-color)', flexShrink: 0 }} />}
                <span style={{ color: done ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{label}</span>
              </div>
            ))}

            {/* Per-media type rows */}
            {photos.length > 0 && (
              <MediaTypeRow icon={ImageIcon} label="Photos" items={photos} />
            )}
            {videos.length > 0 && (
              <MediaTypeRow icon={Video} label="Videos" items={videos} />
            )}
            {signatures.length > 0 && (
              <MediaTypeRow icon={FileSignature} label="Signatures" items={signatures} />
            )}

            {/* Error details */}
            {failedMedia.length > 0 && (
              <div style={{ padding: '8px 10px', borderRadius: '8px', backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', fontSize: '12px', color: 'var(--danger-color)' }}>
                <div style={{ fontWeight: '600', marginBottom: '2px' }}>{failedMedia.length} item(s) pending or interrupted</div>
                {failedMedia[0]?.last_upload_error && <div style={{ opacity: 0.8 }}>{failedMedia[0].last_upload_error}</div>}
              </div>
            )}

            {job?.last_error && !['SYNCED', 'SYNCING', 'QUEUED'].includes(inspection.sync_status) && (
              <div style={{ padding: '8px 10px', borderRadius: '8px', backgroundColor: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', fontSize: '12px', color: 'var(--warning-color)' }}>
                <div style={{ fontWeight: '600', marginBottom: '2px' }}>Notice:</div>
                <div>{job.last_error}</div>
              </div>
            )}

            {/* Action buttons */}
            {inspection.sync_status === 'NEEDS_DRIVE_AUTH' && (
              <button className="btn btn-primary w-full flex items-center justify-center gap-sm" style={{ fontSize: '13px' }} onClick={onConnectDrive}>
                <HardDrive size={16} /> Connect Google Drive
              </button>
            )}

            {['FAILED', 'PARTIALLY_SYNCED', 'QUEUED'].includes(inspection.sync_status) && (
              <button className="btn btn-primary w-full flex items-center justify-center gap-sm" style={{ fontSize: '13px' }} onClick={onRetry}>
                <RotateCcw size={16} /> {inspection.sync_status === 'QUEUED' ? 'Start Upload Now' : 'Retry Failed Files'}
              </button>
            )}

            {inspection.sync_status === 'SYNCED' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '12px', color: 'var(--success-color)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><CheckCircle2 size={12}/> Synced to Field database</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><CheckCircle2 size={12}/> Uploaded to Google Drive</span>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary w-full flex items-center justify-center gap-xs"
                  style={{ fontSize: '13px', padding: '9px 12px' }}
                  onClick={() => onShare && onShare(inspection)}
                >
                  <Share2 size={14} color="var(--primary-light)" />
                  <span>Share Google Drive Folder</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MediaTypeRow({ icon: Icon, label, items }) {
  const uploaded = items.filter(m => ['UPLOADED', 'uploaded'].includes(m.sync_status)).length;
  const uploading = items.filter(m => ['UPLOADING', 'uploading', 'authorizing', 'confirming'].includes(m.sync_status)).length;
  const failed = items.filter(m => ['FAILED', 'failed', 'retry_wait'].includes(m.sync_status)).length;
  const allDone = uploaded === items.length && items.length > 0;

  let statusColor = 'var(--text-secondary)';
  let statusText = `${uploaded}/${items.length} uploaded`;
  if (allDone) { statusColor = 'var(--success-color)'; statusText = `${items.length} uploaded ✓`; }
  else if (uploading > 0) { statusColor = 'var(--primary-color)'; statusText = `Uploading (${uploading} active)…`; }
  else if (failed > 0) { statusColor = 'var(--danger-color)'; statusText = `${failed} failed`; }

  return (
    <div style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
        {allDone ? <CheckCircle2 size={14} style={{ color: 'var(--success-color)', flexShrink: 0 }} /> : <Icon size={14} style={{ color: statusColor, flexShrink: 0 }} />}
        <span style={{ flex: 1 }}>{label}</span>
        <span style={{ color: statusColor, fontWeight: '600', fontSize: '11px' }}>{statusText}</span>
      </div>
      {failed > 0 && items.filter(m => ['FAILED', 'failed', 'retry_wait'].includes(m.sync_status)).map(m => (
        <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0 2px 22px', fontSize: '11px', color: 'var(--text-secondary)' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '220px' }}>
            {m.filename || `${m.evidenceType || m.type || 'media'} (${m.id.substring(0, 8)})`}
          </span>
          <span style={{ color: 'var(--danger-color)', fontSize: '10px' }}>
            {m.last_upload_error || 'Failed'}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function Sync() {
  const navigate = useNavigate();
  const { driveAuthorized, driveEmail, driveStatus, setIntendedRoute } = useAuth();
  const [inspections, setInspections] = useState([]);
  const [mediaMap, setMediaMap] = useState({});
  const [jobMap, setJobMap] = useState({});
  const [isOnline, setIsOnline] = useState(ConnectivityService.online);
  const [isSyncing, setIsSyncing] = useState(SyncEngine.isSyncing);
  const [selectedShareInspection, setSelectedShareInspection] = useState(null);

  // On sync tab, back returns to dashboard
  useBackHandler(
    'sync_tab_back',
    () => {
      navigate('/', { replace: false });
      return true;
    },
    10,
    true
  );

  const loadData = useCallback(async () => {
    const allInspections = await InspectionRepository.getAllInspections();
    // Newest first
    allInspections.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
    setInspections(allInspections);

    const newMediaMap = {};
    for (const ins of allInspections) {
      newMediaMap[ins.id] = await MediaRepository.getMediaForInspection(ins.id);
    }
    setMediaMap(newMediaMap);

    const allJobs = await SyncJobRepository.getAllJobs();
    const newJobMap = {};
    for (const job of allJobs) {
      if (!newJobMap[job.inspection_id] ||
          new Date(job.updated_at) > new Date(newJobMap[job.inspection_id].updated_at)) {
        newJobMap[job.inspection_id] = job;
      }
    }
    setJobMap(newJobMap);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const interval = setInterval(loadData, 2000);
    return () => clearInterval(interval);
  }, [loadData]);

  useEffect(() => {
    const unsubDb = DatabaseService.subscribe(() => {
      loadData();
    });

    const unsubConn = ConnectivityService.subscribe((status) => {
      const isOnlineBool = typeof status === 'boolean' ? status : Boolean(status?.online ?? navigator.onLine);
      setIsOnline(isOnlineBool);
    });

    const unsubSync = SyncEngine.subscribe(() => {
      setIsSyncing(SyncEngine.isSyncing);
      loadData();
    });

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        loadData();
        ConnectivityService.checkConnectivity();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', loadData);

    return () => {
      unsubDb();
      unsubConn();
      unsubSync();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', loadData);
    };
  }, [loadData]);

  const handleSyncNow = async () => {
    await ConnectivityService.checkConnectivity();
    await SyncEngine.startSync(true);
  };

  const handleRetry = async (inspectionId) => {
    // Clear local error immediately in UI state
    setJobMap(prev => ({
      ...prev,
      [inspectionId]: { ...(prev[inspectionId] || {}), last_error: null, status: 'QUEUED' }
    }));
    await ConnectivityService.checkConnectivity();
    await SyncEngine.enqueueInspection(inspectionId);
    await SyncEngine.startSync(true);
  };

  const handleConnectDrive = (inspectionId) => {
    setIntendedRoute(`/sync`);
    navigate('/google-drive-access');
  };

  // Stats
  const synced = inspections.filter(i => i.sync_status === 'SYNCED').length;
  const syncing = inspections.filter(i => ['SYNCING', 'QUEUED'].includes(i.sync_status)).length;
  const needsDrive = inspections.filter(i => i.sync_status === 'NEEDS_DRIVE_AUTH').length;
  const failed = inspections.filter(i => ['FAILED', 'PARTIALLY_SYNCED'].includes(i.sync_status)).length;
  const pending = inspections.filter(i => ['LOCAL_ONLY', 'QUEUED'].includes(i.sync_status)).length;

  return (
    <div style={{ paddingBottom: '100px' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <header style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>Sync Center</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', margin: '2px 0 0 0' }}>
            Field database & Google Drive
          </p>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '600',
          color: isOnline ? 'var(--success-color)' : 'var(--danger-color)'
        }}>
          {isOnline ? <><Wifi size={16}/> Online</> : <><WifiOff size={16}/> Offline</>}
        </div>
      </header>

      {/* Summary card */}
      <div style={{
        padding: '18px', borderRadius: '14px', marginBottom: '16px',
        backgroundColor: 'var(--surface-color)',
        border: '1px solid var(--border-color)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '11px', fontWeight: '700', marginBottom: '4px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
              Queue Overview
            </div>
            <div style={{ color: 'var(--text-primary)', fontSize: '24px', fontWeight: '800' }}>{inspections.length} <span style={{ fontSize: '14px', fontWeight: '500', color: 'var(--text-secondary)' }}>Total Inspections</span></div>
          </div>
          <div style={{
            width: '40px', height: '40px', borderRadius: '10px',
            backgroundColor: 'var(--surface-light)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid var(--border-color)'
          }}>
            <RefreshCw
              size={18}
              style={{
                color: isSyncing ? 'var(--primary-color)' : 'var(--text-secondary)',
                animation: isSyncing ? 'spin 1s linear infinite' : 'none'
              }}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '14px' }}>
          {[
            { label: 'Synced', value: synced, color: 'var(--success-color)' },
            { label: 'Syncing', value: syncing, color: 'var(--primary-color)' },
            { label: 'Drive', value: needsDrive, color: 'var(--warning-color)' },
            { label: 'Failed', value: failed, color: 'var(--danger-color)' },
          ].map(s => (
            <div key={s.label} style={{ textAlign: 'center', padding: '10px 6px', borderRadius: '10px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
              <div style={{ color: s.color, fontSize: '18px', fontWeight: '800' }}>{s.value}</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '11px', fontWeight: '500', marginTop: '2px' }}>{s.label}</div>
            </div>
          ))}
        </div>

        <button
          onClick={handleSyncNow}
          disabled={(!isOnline && !navigator?.onLine) || isSyncing}
          className="btn btn-primary"
          style={{
            width: '100%', padding: '12px', borderRadius: '10px',
            fontWeight: '700', fontSize: '14px',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            minHeight: '44px'
          }}
        >
          {isSyncing ? <><Loader2 size={16} className="animate-spin" /> Syncing in background…</> : <><Upload size={16} /> Sync Queue Now</>}
        </button>
      </div>

      {/* Drive status banner */}
      {driveAuthorized ? (
        <div style={{
          padding: '12px 16px', borderRadius: '12px', marginBottom: '16px',
          backgroundColor: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <HardDrive size={18} style={{ color: 'var(--success-color)', flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: '600', fontSize: '13px' }}>Google Drive connected</div>
              {driveEmail && (
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Connected as <strong>{driveEmail}</strong>
                </div>
              )}
            </div>
          </div>
          <button
            onClick={() => { setIntendedRoute('/sync'); navigate('/google-drive-access'); }}
            style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'transparent', color: 'var(--text-secondary)', fontSize: '11px', cursor: 'pointer' }}
          >
            Manage
          </button>
        </div>
      ) : (
        <div style={{
          padding: '14px 16px', borderRadius: '12px', marginBottom: '16px',
          backgroundColor: driveStatus === 'RECONNECT_REQUIRED' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
          border: driveStatus === 'RECONNECT_REQUIRED' ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(245,158,11,0.3)',
          display: 'flex', alignItems: 'center', gap: '12px'
        }}>
          <HardDrive size={20} style={{ color: driveStatus === 'RECONNECT_REQUIRED' ? 'var(--danger-color)' : 'var(--warning-color)', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: '600', fontSize: '13px', marginBottom: '2px' }}>
              {driveStatus === 'RECONNECT_REQUIRED' ? 'Drive connection needs attention' : 'Google Drive not connected'}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              {driveStatus === 'RECONNECT_REQUIRED' ? 'Reconnect Google Drive to resume media uploads' : 'Connect to enable media uploads'}
            </div>
          </div>
          <button
            onClick={() => { setIntendedRoute('/sync'); navigate('/google-drive-access'); }}
            style={{
              padding: '6px 12px', borderRadius: '8px', border: 'none',
              backgroundColor: driveStatus === 'RECONNECT_REQUIRED' ? 'var(--danger-color)' : 'var(--warning-color)',
              color: 'white', fontSize: '12px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap'
            }}
          >
            {driveStatus === 'RECONNECT_REQUIRED' ? 'Reconnect' : 'Connect'}
          </button>
        </div>
      )}

      {/* Offline banner */}
      {!isOnline && (
        <div style={{
          padding: '12px 16px', borderRadius: '12px', marginBottom: '16px',
          backgroundColor: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.3)',
          display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: 'var(--text-secondary)'
        }}>
          <WifiOff size={16} style={{ flexShrink: 0 }} />
          Offline — inspections saved locally, sync will resume when connected.
        </div>
      )}

      {/* Inspection cards */}
      {inspections.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-secondary)' }}>
          <CloudOff size={40} style={{ marginBottom: '12px', opacity: 0.4 }} />
          <div style={{ fontWeight: '600', marginBottom: '4px' }}>No inspections yet</div>
          <div style={{ fontSize: '13px' }}>Complete an inspection to see it here</div>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', letterSpacing: '0.5px', marginBottom: '10px' }}>
            INSPECTIONS ({inspections.length})
          </div>
          {inspections.map(ins => (
            <InspectionCard
              key={ins.id}
              inspection={ins}
              mediaForInspection={mediaMap[ins.id] || []}
              job={jobMap[ins.id] || null}
              onRetry={() => handleRetry(ins.id)}
              onConnectDrive={() => handleConnectDrive(ins.id)}
              onShare={setSelectedShareInspection}
            />
          ))}
        </div>
      )}

      {/* ── Share Modal ── */}
      {selectedShareInspection && (
        <ShareInspectionModal
          inspection={selectedShareInspection}
          onClose={() => setSelectedShareInspection(null)}
        />
      )}
    </div>
  );
}
