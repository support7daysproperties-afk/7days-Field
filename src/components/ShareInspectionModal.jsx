import { useState } from 'react';
import {
  Share2, Copy, Check, ExternalLink, AlertTriangle, RefreshCw, X, Loader2, CheckCircle2, ShieldCheck
} from 'lucide-react';
import ShareService, { SHARE_STATE } from '../services/platform/ShareService';
import SyncEngine from '../services/offline/SyncEngine';

export default function ShareInspectionModal({ inspection, onClose, onNavigateToSync }) {
  const [isSharing, setIsSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [isStartingSync, setIsStartingSync] = useState(false);

  if (!inspection) return null;

  const shareCheck = ShareService.getInspectionShareState(inspection);
  const propName = inspection.property_name || inspection.title || 'Property Inspection';
  const insId = inspection.id || 'N/A';
  const folderUrl = shareCheck.folderUrl || inspection.drive_folder_url;

  const handleNativeShare = async () => {
    setIsSharing(true);
    setError(null);
    try {
      const result = await ShareService.shareInspection(inspection);
      if (result?.method === 'clipboard' || result?.method === 'clipboard_fallback') {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
      if (result?.success && result?.method === 'native') {
        // Native share sheet opened successfully
        onClose();
      }
    } catch (err) {
      console.error('Share action error:', err);
      setError(err?.message || 'Could not launch share sheet. Try copying the link directly.');
    } finally {
      setIsSharing(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      await ShareService.copyInspectionLink(inspection, { copyFullMessage: false });
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.error('Copy link error:', err);
      setError('Could not copy link to clipboard');
    }
  };

  const handleSyncNow = async () => {
    setIsStartingSync(true);
    try {
      await SyncEngine.enqueueInspection(inspection.id);
      SyncEngine.startSync().catch(() => {});
      if (onNavigateToSync) {
        onNavigateToSync();
      }
      onClose();
    } catch (err) {
      console.error('Failed to trigger sync:', err);
      setError('Failed to start sync. Please visit the Sync tab.');
      setIsStartingSync(false);
    }
  };

  return (
    <div 
      className="share-modal-overlay"
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '0',
      }}
    >
      <div 
        className="share-modal-card"
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '480px',
          backgroundColor: 'var(--surface-color, #181d28)',
          borderTopLeftRadius: '20px',
          borderTopRightRadius: '20px',
          border: '1px solid var(--border-color, #2a3447)',
          borderBottom: 'none',
          padding: '20px',
          paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
          boxShadow: '0 -10px 25px rgba(0,0,0,0.5)',
          animation: 'slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              backgroundColor: 'var(--primary-transparent, rgba(37, 99, 235, 0.15))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--primary-light, #60a5fa)',
            }}>
              <Share2 size={18} />
            </div>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-primary, #f8fafc)', margin: 0 }}>
                Share Inspection
              </h2>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary, #94a3b8)' }}>
                Google Drive folder link
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-tertiary, #64748b)',
              padding: '6px',
              cursor: 'pointer',
              borderRadius: '50%',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Inspection Details Card */}
        <div style={{
          backgroundColor: 'var(--surface-raised, #0f131a)',
          borderRadius: '12px',
          padding: '12px 14px',
          border: '1px solid var(--border-subtle, #232b3b)',
          marginBottom: '16px',
        }}>
          <div style={{ fontSize: '11px', color: 'var(--primary-light, #60a5fa)', fontWeight: '700', marginBottom: '2px' }}>
            {insId}
          </div>
          <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary, #f8fafc)', marginBottom: '6px' }}>
            {propName}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-secondary, #94a3b8)' }}>
            <ShieldCheck size={12} style={{ color: 'var(--success-color, #22c55e)' }} />
            <span>Read-only viewer link • Verified supervisor record</span>
          </div>
        </div>

        {/* State Banner: Ready vs Pending */}
        {shareCheck.canShare ? (
          <div>
            {/* Status indicator */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 12px',
              borderRadius: '8px',
              backgroundColor: 'rgba(34, 197, 94, 0.1)',
              border: '1px solid rgba(34, 197, 94, 0.25)',
              fontSize: '12px',
              color: 'var(--success-color, #22c55e)',
              marginBottom: '14px',
            }}>
              <CheckCircle2 size={15} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, fontWeight: '500' }}>
                {shareCheck.state === SHARE_STATE.OFFLINE_READY
                  ? 'Ready to share (offline cached link)'
                  : 'Ready to share • Synced to Google Drive'}
              </span>
            </div>

            {/* Folder URL Preview */}
            {folderUrl && (
              <div style={{
                padding: '8px 12px',
                borderRadius: '8px',
                backgroundColor: 'var(--surface-raised, #0f131a)',
                border: '1px solid var(--border-color, #2a3447)',
                fontSize: '11px',
                color: 'var(--text-secondary, #94a3b8)',
                marginBottom: '16px',
                wordBreak: 'break-all',
                fontFamily: 'monospace',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
              }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {folderUrl}
                </span>
                <a
                  href={folderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--primary-light, #60a5fa)', display: 'inline-flex', flexShrink: 0 }}
                  title="Open in Drive"
                >
                  <ExternalLink size={13} />
                </a>
              </div>
            )}

            {/* Error notice if share failed */}
            {error && (
              <div style={{
                padding: '8px 12px',
                borderRadius: '8px',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                fontSize: '12px',
                color: 'var(--danger-color, #ef4444)',
                marginBottom: '14px',
              }}>
                {error}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleNativeShare}
                disabled={isSharing}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '12px',
                  fontWeight: '600',
                  fontSize: '14px',
                }}
              >
                {isSharing ? (
                  <>
                    <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                    <span>Preparing Share Link…</span>
                  </>
                ) : (
                  <>
                    <Share2 size={16} />
                    <span>Share via Apps (WhatsApp, Gmail, etc.)</span>
                  </>
                )}
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCopyLink}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '11px',
                  fontSize: '13px',
                }}
              >
                {copied ? (
                  <>
                    <Check size={15} style={{ color: 'var(--success-color, #22c55e)' }} />
                    <span style={{ color: 'var(--success-color, #22c55e)' }}>Folder Link Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy size={15} />
                    <span>Copy Folder Link</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div>
            {/* Warning: Sync Required */}
            <div style={{
              padding: '14px',
              borderRadius: '12px',
              backgroundColor: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              marginBottom: '16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <AlertTriangle size={18} style={{ color: 'var(--warning-color, #f59e0b)', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <h4 style={{ fontSize: '13px', fontWeight: '700', color: 'var(--warning-color, #f59e0b)', margin: '0 0 4px 0' }}>
                    Sync Required Before Sharing
                  </h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary, #94a3b8)', margin: 0, lineHeight: 1.45 }}>
                    Inspection upload is still pending. Sync the inspection before sharing.
                  </p>
                </div>
              </div>

              <div style={{
                marginTop: '10px',
                paddingTop: '8px',
                borderTop: '1px solid rgba(245, 158, 11, 0.15)',
                fontSize: '11px',
                color: 'var(--text-tertiary, #64748b)',
                display: 'flex',
                justifyContent: 'space-between',
              }}>
                <span>Status:</span>
                <span style={{ fontWeight: '600', color: 'var(--warning-color, #f59e0b)' }}>
                  {inspection.sync_status === 'FAILED' ? 'Upload Failed' :
                   inspection.sync_status === 'PARTIALLY_SYNCED' ? 'Partially Synced' :
                   inspection.sync_status === 'LOCAL_ONLY' ? 'Saved Locally' : 'Sync Pending'}
                </span>
              </div>
            </div>

            {error && (
              <div style={{
                padding: '8px 12px',
                borderRadius: '8px',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                fontSize: '12px',
                color: 'var(--danger-color, #ef4444)',
                marginBottom: '14px',
              }}>
                {error}
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
                style={{ flex: 1, padding: '11px', fontSize: '13px' }}
              >
                Close
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSyncNow}
                disabled={isStartingSync}
                style={{
                  flex: 1.5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '11px',
                  fontSize: '13px',
                  fontWeight: '600',
                }}
              >
                {isStartingSync ? (
                  <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
                ) : (
                  <RefreshCw size={15} />
                )}
                <span>Sync Now</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
