import { User, LogOut, Smartphone, HardDrive, CheckCircle2, XCircle, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Profile() {
  const navigate = useNavigate();
  const { user, signOut, driveAuthorized, driveStatus, driveEmail } = useAuth();
  
  const name = user?.supervisorProfile?.name || 'Field Supervisor';
  const email = user?.email || 'N/A';
  const phone = user?.supervisorProfile?.phone || 'Not provided';
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
          marginBottom: '12px' 
        }}>
          <User size={34} style={{ color: 'var(--primary-color)' }} />
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
            <span style={{ color: 'var(--text-secondary)' }}>Local Cache (IndexedDB)</span>
          </div>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Active (Offline Ready)</span>
        </div>
        <div className="flex justify-between py-sm" style={{ fontSize: '14px', paddingTop: '10px' }}>
          <span style={{ color: 'var(--text-secondary)' }}>Build Version</span>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>1.0.0 (PWA)</span>
        </div>
      </div>

      <button 
        className="btn btn-secondary w-full" 
        onClick={signOut}
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
    </div>
  );
}
