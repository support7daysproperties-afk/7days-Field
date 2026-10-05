import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2, RefreshCw, AlertTriangle, Wifi, WifiOff,
  CloudOff, Upload, Image as ImageIcon, Video, FileSignature,
  ChevronDown, ChevronUp, HardDrive, RotateCcw, Clock,
  AlertCircle, Loader2, XCircle
} from 'lucide-react';
import InspectionRepository from '../services/offline/InspectionRepository';
import MediaRepository from '../services/offline/MediaRepository';
import SyncJobRepository from '../services/offline/SyncJobRepository';
import ConnectivityService from '../services/offline/ConnectivityService';
import SyncEngine from '../services/offline/SyncEngine';
import { useAuth } from '../context/AuthContext';

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

function MediaProgressBar({ uploaded, total }) {
  const pct = total === 0 ? 100 : Math.round((uploaded / total) * 100);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
        <span>{uploaded} / {total} files uploaded</span>
        <span>{pct}%</span>
      </div>
      <div style={{ height: '4px', backgroundColor: 'var(--bg-color)', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: '2px',
          backgroundColor: pct === 100 ? 'var(--success-color)' : 'var(--primary-color)',
          transition: 'width 0.4s ease'
        }} />
      </div>
    </div>
  );
}

function InspectionCard({ inspection, mediaForInspection, job, onRetry, onConnectDrive }) {
  const [expanded, setExpanded] = useState(inspection.sync_status !== 'SYNCED');

  const totalMedia = mediaForInspection.length;
  const uploadedMedia = mediaForInspection.filter(m => m.sync_status === 'UPLOADED').length;
  const failedMedia = mediaForInspection.filter(m => m.sync_status === 'FAILED');
  const photos = mediaForInspection.filter(m => (m.type || m.mediaType) === 'photo');
  const videos = mediaForInspection.filter(m => (m.type || m.mediaType) === 'video');
  const signatures = mediaForInspection.filter(m => (m.type || m.mediaType) === 'signature');

  const isSpinning = inspection.sync_status === 'SYNCING';

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
        <div style={{ flexShrink: 0, color: 'var(--text-secondary)' }}>
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border-color)' }}>
          <div style={{ paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>

            {/* Upload progress */}
            {totalMedia > 0 && <MediaProgressBar uploaded={uploadedMedia} total={totalMedia} />}

            {/* Checklist rows */}
            {[
              { label: 'Inspection details', done: ['SYNCED', 'SYNCING', 'PARTIALLY_SYNCED'].includes(inspection.sync_status) },
              { label: 'Checklist', done: !!(meta.checklist && Object.values(meta.checklist).some(Boolean)) },
              { label: 'Owner information', done: !!(meta.ownerInfo?.name) },
              { label: 'Consent & Signature', done: !!(meta.consent && meta.signature) },
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
                <div style={{ fontWeight: '600', marginBottom: '2px' }}>{failedMedia.length} upload(s) failed</div>
                {failedMedia[0]?.last_upload_error && <div style={{ opacity: 0.8 }}>{failedMedia[0].last_upload_error}</div>}
              </div>
            )}

            {job?.last_error && inspection.sync_status !== 'SYNCED' && (
              <div style={{ padding: '8px 10px', borderRadius: '8px', backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', fontSize: '12px', color: 'var(--danger-color)' }}>
                {job.last_error}
              </div>
            )}

            {/* Action buttons */}
            {inspection.sync_status === 'NEEDS_DRIVE_AUTH' && (
              <button className="btn btn-primary w-full flex items-center justify-center gap-sm" style={{ fontSize: '13px' }} onClick={onConnectDrive}>
                <HardDrive size={16} /> Connect Google Drive
              </button>
            )}

            {['FAILED', 'PARTIALLY_SYNCED'].includes(inspection.sync_status) && (
              <button className="btn btn-primary w-full flex items-center justify-center gap-sm" style={{ fontSize: '13px' }} onClick={onRetry}>
                <RotateCcw size={16} /> Retry Sync
              </button>
            )}

            {inspection.sync_status === 'SYNCED' && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', fontSize: '12px', color: 'var(--success-color)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><CheckCircle2 size={12}/> Synced to Field database</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><CheckCircle2 size={12}/> Uploaded to Google Drive</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MediaTypeRow({ icon: Icon, label, items }) {
  const uploaded = items.filter(m => m.sync_status === 'UPLOADED').length;
  const uploading = items.filter(m => m.sync_status === 'UPLOADING').length;
  const failed = items.filter(m => m.sync_status === 'FAILED').length;
  const allDone = uploaded === items.length;

  let statusColor = 'var(--text-secondary)';
  let statusText = `${uploaded}/${items.length} uploaded`;
  if (allDone) { statusColor = 'var(--success-color)'; statusText = `${items.length} uploaded`; }
  if (uploading > 0) { statusColor = 'var(--primary-color)'; statusText = `Uploading…`; }
  if (failed > 0) { statusColor = 'var(--danger-color)'; statusText = `${failed} failed`; }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
      {allDone ? <CheckCircle2 size={14} style={{ color: 'var(--success-color)', flexShrink: 0 }} /> : <Icon size={14} style={{ color: statusColor, flexShrink: 0 }} />}
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ color: statusColor, fontWeight: '600', fontSize: '11px' }}>{statusText}</span>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function Sync() {
  const navigate = useNavigate();
  const { driveAuthorized, setIntendedRoute } = useAuth();
  const [inspections, setInspections] = useState([]);
  const [mediaMap, setMediaMap] = useState({});
  const [jobMap, setJobMap] = useState({});
  const [isOnline, setIsOnline] = useState(ConnectivityService.online);
  const [isSyncing, setIsSyncing] = useState(SyncEngine.isSyncing);

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
    const unsub = ConnectivityService.subscribe(setIsOnline);
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = SyncEngine.subscribe(() => {
      setIsSyncing(SyncEngine.isSyncing);
      loadData();
    });
    return unsub;
  }, [loadData]);

  const handleSyncNow = async () => {
    if (!isOnline) return;
    await SyncEngine.startSync();
  };

  const handleRetry = async (inspectionId) => {
    await SyncEngine.enqueueInspection(inspectionId);
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
        padding: '20px', borderRadius: '14px', marginBottom: '20px',
        background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
        border: '1px solid rgba(255,255,255,0.1)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px', fontWeight: '600', marginBottom: '4px', letterSpacing: '0.5px' }}>
              TOTAL INSPECTIONS
            </div>
            <div style={{ color: 'white', fontSize: '28px', fontWeight: '800' }}>{inspections.length}</div>
          </div>
          <RefreshCw
            size={36}
            style={{
              color: 'rgba(255,255,255,0.4)',
              animation: isSyncing ? 'spin 1s linear infinite' : 'none'
            }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '16px' }}>
          {[
            { label: 'Synced', value: synced, color: '#4ade80' },
            { label: 'Syncing', value: syncing, color: '#818cf8' },
            { label: 'Drive', value: needsDrive, color: '#fbbf24' },
            { label: 'Failed', value: failed, color: '#f87171' },
          ].map(s => (
            <div key={s.label} style={{ textAlign: 'center', padding: '8px', borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.08)' }}>
              <div style={{ color: s.color, fontSize: '20px', fontWeight: '800' }}>{s.value}</div>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '10px', marginTop: '2px' }}>{s.label}</div>
            </div>
          ))}
        </div>

        <button
          onClick={handleSyncNow}
          disabled={!isOnline || isSyncing}
          style={{
            width: '100%', padding: '12px', borderRadius: '10px', border: 'none',
            backgroundColor: (isOnline && !isSyncing) ? 'white' : 'rgba(255,255,255,0.2)',
            color: (isOnline && !isSyncing) ? '#1e1b4b' : 'rgba(255,255,255,0.5)',
            fontWeight: '700', fontSize: '14px', cursor: (isOnline && !isSyncing) ? 'pointer' : 'not-allowed',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
          }}
        >
          {isSyncing ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Syncing…</> : <><Upload size={16} /> Sync Now</>}
        </button>
      </div>

      {/* Drive not connected banner */}
      {!driveAuthorized && (
        <div style={{
          padding: '14px 16px', borderRadius: '12px', marginBottom: '16px',
          backgroundColor: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
          display: 'flex', alignItems: 'center', gap: '12px'
        }}>
          <HardDrive size={20} style={{ color: 'var(--warning-color)', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: '600', fontSize: '13px', marginBottom: '2px' }}>Google Drive not connected</div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Connect to enable media uploads</div>
          </div>
          <button
            onClick={() => { setIntendedRoute('/sync'); navigate('/google-drive-access'); }}
            style={{ padding: '6px 12px', borderRadius: '8px', border: 'none', backgroundColor: 'var(--warning-color)', color: 'white', fontSize: '12px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Connect
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
