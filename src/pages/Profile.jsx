import { useState } from 'react';
import { User, LogOut, Smartphone, HardDrive, CheckCircle2, XCircle, ChevronRight, Trash2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import DatabaseService from '../services/offline/DatabaseService';
import useBackHandler from '../hooks/useBackHandler';

export default function Profile() {
  const navigate = useNavigate();
  const { user, signOut, driveAuthorized, driveStatus, driveEmail } = useAuth();
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Close reset cache confirmation modal on back press
  useBackHandler(
    'profile_reset_confirm',
    () => {
      setShowResetConfirm(false);
      return true;
    },
    110,
    showResetConfirm
  );

  // On profile tab, back returns to dashboard
  useBackHandler(
    'profile_tab_back',
    () => {
      navigate('/', { replace: false });
      return true;
    },
    10,
    !showResetConfirm
  );
  
  const name = user?.supervisorProfile?.name || 'Field Supervisor';
  const email = user?.email || 'N/A';
  const phone = user?.supervisorProfile?.phone || 'Not provided';
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch (err) {
      console.warn('Sign out error:', err);
      navigate('/login', { replace: true });
    }
  };

  const handleResetCache = async () => {
    setIsResetting(true);
    try {
      await DatabaseService.clearCurrentDatabase();
      // Re-initialize empty partition
      await DatabaseService.init();
      setShowResetConfirm(false);
      window.location.reload();
    } catch (err) {
      console.error('Failed to clear local cache:', err);
      alert('Failed to reset storage. Please try again.');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="profile-page pb-xl" style={{ backgroundColor: 'var(--bg-color)', minHeight: '100vh', padding: '16px', paddingBottom: '100px' }}>
      <header className="mb-lg text-center mt-md">
        <div style={{ 
          width: '72px', 
          height: '72px', 
          borderRadius: '50%', 
          backgroundColor: 'rgba(37, 99, 235, 0.15)', 
          border: '2px solid rgba(37, 99, 235, 0.4)',
          margin: '0 auto', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          marginBottom: '12px',
          overflow: 'hidden'
        }}>
          {avatarUrl ? (
            <img src={avatarUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <User size={34} style={{ color: 'var(--primary-color)' }} />
          )}
        </div>
        <h2 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 4px 0', color: 'var(--text-primary)' }}>{name}</h2>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '20px', backgroundColor: 'rgba(16, 185, 129, 0.1)', color: 'var(--success-color)', fontSize: '12px', fontWeight: 600 }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--success-color)' }} />
          Field Supervisor • Authorized
        </div>
      </header>

      <div className="card mb-md" style={{ padding: '16px' }}>
        <h3 className="mb-sm text-xs font-bold text-secondary" style={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}>ACCOUNT DETAILS</h3>
        <div className="flex flex-col">
          <div className="flex justify-between py-sm" style={{ borderBottom: '1px solid var(--border-color)', fontSize: '14px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Email</span>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{email}</span>
          </div>
          <div className="flex justify-between py-sm" style={{ fontSize: '14px', paddingTop: '10px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Phone</span>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{phone}</span>
          </div>
        </div>
      </div>

      <div className="card mb-md" style={{ padding: '16px' }}>
        <h3 className="mb-sm text-xs font-bold text-secondary" style={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}>CLOUD INTEGRATIONS</h3>
        <div 
          className="flex justify-between items-center py-sm cursor-pointer" 
          onClick={() => navigate('/google-drive-access')}
          style={{ transition: 'all 0.2s ease', minHeight: '44px' }}
        >
          <div className="flex items-center gap-sm">
            <div style={{ width: '36px', height: '36px', borderRadius: '8px', backgroundColor: 'var(--surface-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-color)' }}>
              <HardDrive size={18} style={{ color: 'var(--primary-color)' }} />
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>Google Drive Storage</div>
              {driveEmail ? (
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  {driveEmail}
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  Required for evidence syncing
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-xs">
            {driveAuthorized ? (
              <div className="flex items-center gap-xs text-sm font-medium" style={{ color: 'var(--success-color)' }}>
                <CheckCircle2 size={16} />
                <span>Connected</span>
              </div>
            ) : driveStatus === 'RECONNECT_REQUIRED' ? (
              <div className="flex items-center gap-xs text-sm font-medium" style={{ color: 'var(--warning-color)' }}>
                <span>Reconnect</span>
              </div>
            ) : (
              <div className="flex items-center gap-xs text-sm font-medium" style={{ color: 'var(--danger-color)' }}>
                <XCircle size={16} />
                <span>Not Connected</span>
              </div>
            )}
            <ChevronRight size={16} style={{ color: 'var(--text-secondary)', marginLeft: '4px' }} />
          </div>
        </div>
      </div>

      <div className="card mb-lg" style={{ padding: '16px' }}>
        <h3 className="mb-sm text-xs font-bold text-secondary" style={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}>APPLICATION & STORAGE</h3>
        <div className="flex justify-between py-sm" style={{ borderBottom: '1px solid var(--border-color)', fontSize: '14px' }}>
          <div className="flex items-center gap-sm">
            <Smartphone size={16} style={{ color: 'var(--text-secondary)' }} />
            <span style={{ color: 'var(--text-secondary)' }}>Storage Partition</span>
          </div>
          <span style={{ fontWeight: 600, color: 'var(--success-color)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <ShieldCheck size={14} /> Account Private
          </span>
        </div>
        <div className="flex justify-between py-sm" style={{ borderBottom: '1px solid var(--border-color)', fontSize: '14px' }}>
          <span style={{ color: 'var(--text-secondary)' }}>Database</span>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>IndexedDB (Isolated)</span>
        </div>
        <div className="flex justify-between py-sm" style={{ borderBottom: '1px solid var(--border-color)', fontSize: '14px' }}>
          <span style={{ color: 'var(--text-secondary)' }}>Build Version</span>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>1.0.0 (PWA)</span>
        </div>
        <div className="flex justify-between items-center py-sm" style={{ fontSize: '14px', paddingTop: '10px' }}>
          <div>
            <div style={{ color: 'var(--text-secondary)' }}>Reset Device Cache</div>
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Wipes local drafts before device handover</div>
          </div>
          <button 
            className="btn btn-secondary btn-sm"
            onClick={() => setShowResetConfirm(true)}
            style={{ width: 'auto', padding: '4px 10px', fontSize: '12px', color: 'var(--warning-color)', borderColor: 'var(--warning-border)' }}
          >
            Clear Cache
          </button>
        </div>
      </div>

      <button 
        className="btn btn-secondary w-full" 
        onClick={handleSignOut}
        style={{
          color: 'var(--danger-color)',
          borderColor: 'rgba(239, 68, 68, 0.3)',
          backgroundColor: 'rgba(239, 68, 68, 0.05)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          fontWeight: 600,
          minHeight: '44px'
        }}
      >
        <LogOut size={18} />
        Log Out Session
      </button>

      {/* ── Clear Cache Confirmation Modal ── */}
      {showResetConfirm && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          padding: '20px'
        }}>
          <div className="card" style={{ maxWidth: '360px', width: '100%', padding: '20px', borderRadius: '16px', border: '1px solid var(--border-color)' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              backgroundColor: 'rgba(245, 158, 11, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--warning-color)',
              marginBottom: '12px'
            }}>
              <AlertTriangle size={22} />
            </div>
            <h3 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '8px' }}>
              Reset Local Storage?
            </h3>
            <p className="text-xs text-secondary mb-lg" style={{ lineHeight: 1.5 }}>
              This will clear all local drafts and cached evidence stored on this device for your account. Already synchronized surveys in the cloud will not be affected.
            </p>
            <div className="flex gap-sm">
              <button 
                className="btn btn-secondary flex-1"
                onClick={() => setShowResetConfirm(false)}
                disabled={isResetting}
              >
                Cancel
              </button>
              <button 
                className="btn btn-primary flex-1"
                onClick={handleResetCache}
                disabled={isResetting}
                style={{ backgroundColor: 'var(--danger-color)', borderColor: 'var(--danger-color)' }}
              >
                {isResetting ? 'Clearing...' : 'Clear Storage'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
