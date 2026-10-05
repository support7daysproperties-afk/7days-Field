import { User, LogOut, Smartphone, HardDrive, CheckCircle2, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Profile() {
  const { user, signOut, driveAuthorized } = useAuth();
  
  const name = user?.supervisorProfile?.name || 'Field Supervisor';
  const email = user?.email || 'N/A';
  const phone = user?.supervisorProfile?.phone || 'Not provided';
  return (
    <div className="profile-page">
      <header className="mb-lg text-center mt-md">
        <div style={{ width: '80px', height: '80px', borderRadius: '50%', backgroundColor: 'var(--primary-color)', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
          <User size={40} className="text-white" />
        </div>
        <h2>{name}</h2>
        <p className="text-secondary mt-xs">Field Supervisor • Authorized</p>
      </header>

      <div className="card mb-md">
        <h3 className="mb-sm text-sm text-secondary">ACCOUNT</h3>
        <div className="flex flex-col gap-sm">
          <div className="flex justify-between py-sm" style={{ borderBottom: '1px solid var(--border-color)' }}>
            <span>Email</span>
            <span className="text-secondary">{email}</span>
          </div>
          <div className="flex justify-between py-sm">
            <span>Phone</span>
            <span className="text-secondary">{phone}</span>
          </div>
        </div>
      </div>

      <div className="card mb-md">
        <h3 className="mb-sm text-sm text-secondary">INTEGRATIONS</h3>
        <div className="flex justify-between items-center py-sm">
          <div className="flex items-center gap-sm">
            <HardDrive size={18} className="text-secondary" />
            <span>Google Drive</span>
          </div>
          {driveAuthorized ? (
            <div className="flex items-center gap-xs text-success text-sm font-medium">
              <CheckCircle2 size={16} />
              <span>Connected</span>
            </div>
          ) : (
            <div className="flex items-center gap-xs text-danger text-sm font-medium">
              <XCircle size={16} />
              <span>Not Connected</span>
            </div>
          )}
        </div>
      </div>

      <div className="card mb-lg">
        <h3 className="mb-sm text-sm text-secondary">APP</h3>
        <div className="flex justify-between py-sm" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div className="flex items-center gap-sm">
            <Smartphone size={18} className="text-secondary" />
            <span>Storage Used</span>
          </div>
          <span className="text-secondary">1.2 GB</span>
        </div>
        <div className="flex justify-between py-sm">
          <span className="text-secondary pl-lg">App Version</span>
          <span className="text-secondary">1.0.0 (PWA)</span>
        </div>
      </div>

      <button className="btn btn-secondary text-danger mb-xl" onClick={signOut}>
        <LogOut size={18} />
        Log Out
      </button>
    </div>
  );
}
