import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { HardDrive, CheckCircle2, AlertTriangle, Loader2, RefreshCw, LogOut, Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { DRIVE_STATUS } from '../services/GoogleDriveService';

export default function GoogleDriveAccess() {
  const navigate = useNavigate();
  const {
    user,
    driveAuthorized,
    driveStatus,
    driveEmail,
    connectDrive,
    disconnectDrive,
    intendedRoute,
    setIntendedRoute
  } = useAuth();
  
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    localStorage.removeItem('pending_drive_onboarding');
  }, []);

  const handleContinue = () => {
    if (intendedRoute) {
      const route = intendedRoute;
      setIntendedRoute(null);
      navigate(route, { replace: true });
    } else {
      navigate('/', { replace: true });
    }
  };

  const handleConnect = async (forcePrompt = false) => {
    setLoading(true);
    setErrorMessage('');
    
    try {
      await connectDrive({ prompt: forcePrompt ? 'select_account consent' : 'consent' });
      setLoading(false);
    } catch (error) {
      console.error('Drive connection error:', error);
      setLoading(false);
      if (error?.message?.includes('origin_mismatch') || error?.message?.includes('redirect_uri_mismatch')) {
        setErrorMessage('Google Drive could not be connected because the application URL is not registered in Google Cloud Console.');
      } else {
        setErrorMessage(error?.message || 'Connection cancelled or failed. Please try again.');
      }
    }
  };

  const handleDisconnect = async () => {
    if (window.confirm('Disconnect Google Drive? Uploads will pause and be safely queued on this device.')) {
      setLoading(true);
      await disconnectDrive();
      setLoading(false);
    }
  };

  // Determine email mismatch warning if supervisor Supabase email != Drive authorized email
  const supervisorEmail = user?.email || '';
  const isDifferentAccount = driveEmail && supervisorEmail && driveEmail.toLowerCase() !== supervisorEmail.toLowerCase();

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-md" style={{ backgroundColor: 'var(--bg-color)' }}>
      <div className="card w-full max-w-md p-xl flex flex-col items-center animate-fade-in" style={{ backgroundColor: 'var(--surface-color)', borderRadius: '16px', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)' }}>
        
        {/* Status Icon */}
        <div className="w-16 h-16 rounded-full mb-lg flex items-center justify-center" style={{ backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
          {loading ? (
            <Loader2 size={32} className="text-primary animate-spin" />
          ) : driveAuthorized ? (
            <CheckCircle2 size={32} style={{ color: 'var(--success-color)' }} />
          ) : driveStatus === DRIVE_STATUS.RECONNECT_REQUIRED ? (
            <AlertTriangle size={32} style={{ color: 'var(--warning-color)' }} />
          ) : driveStatus === DRIVE_STATUS.ERROR ? (
            <AlertTriangle size={32} style={{ color: 'var(--danger-color)' }} />
          ) : (
            <HardDrive size={32} className="text-primary" />
          )}
        </div>

        {/* Title */}
        <h1 className="text-xl font-bold mb-xs text-text text-center" style={{ margin: '0 0 6px 0' }}>
          {driveAuthorized ? 'Google Drive Connected' : driveStatus === DRIVE_STATUS.RECONNECT_REQUIRED ? 'Drive Needs Attention' : 'Connect Google Drive'}
        </h1>
        
        {/* Subtitle / Email status */}
        <p className="text-secondary text-sm mb-md text-center" style={{ margin: '0 0 16px 0' }}>
          {driveAuthorized ? (
            <span>
              Connected as <strong style={{ color: 'var(--text-color)' }}>{driveEmail || supervisorEmail}</strong>
            </span>
          ) : driveStatus === DRIVE_STATUS.RECONNECT_REQUIRED ? (
            <span>Your Google Drive authorization expired or was revoked. Reconnect to resume uploads.</span>
          ) : (
            <span>Authorize 7Days Field to securely upload inspection media and photos directly to Drive.</span>
          )}
        </p>

        {/* Account Mismatch Notice */}
        {driveAuthorized && isDifferentAccount && (
          <div style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: '10px',
            backgroundColor: 'rgba(59, 130, 246, 0.08)',
            border: '1px solid rgba(59, 130, 246, 0.25)',
            marginBottom: '16px',
            fontSize: '12px',
            lineHeight: '1.4'
          }}>
            <div style={{ fontWeight: '600', color: '#3b82f6', marginBottom: '4px' }}>
              Different Google Account Connected
            </div>
            <div style={{ color: 'var(--text-secondary)' }}>
              App login: <strong>{supervisorEmail}</strong><br/>
              Drive storage: <strong>{driveEmail}</strong>
            </div>
          </div>
        )}

        {/* Error alert */}
        {errorMessage && (
          <div className="w-full bg-danger bg-opacity-10 text-danger p-md rounded-md mb-md text-sm border border-danger" style={{ marginBottom: '16px' }}>
            {errorMessage}
          </div>
        )}

        {/* Action Buttons */}
        <div className="w-full flex flex-col gap-sm mt-auto" style={{ gap: '10px' }}>
          {driveAuthorized ? (
            <>
              <button className="btn btn-primary w-full" onClick={handleContinue} style={{ height: '44px' }}>
                Continue to Application
              </button>
              
              <button
                className="btn btn-outline w-full flex items-center justify-center gap-xs"
                style={{ height: '40px', fontSize: '13px' }}
                onClick={() => handleConnect(true)}
                disabled={loading}
              >
                <RefreshCw size={15} /> Switch Google Account
              </button>

              <button
                className="btn btn-outline w-full text-danger border-danger flex items-center justify-center gap-xs"
                style={{ height: '40px', fontSize: '13px', color: 'var(--danger-color)', borderColor: 'var(--danger-color)' }}
                onClick={handleDisconnect}
                disabled={loading}
              >
                <LogOut size={15} /> Disconnect Drive
              </button>
            </>
          ) : (
            <>
              <button 
                className="btn btn-primary w-full flex justify-center items-center gap-sm" 
                onClick={() => handleConnect(false)}
                disabled={loading}
                style={{ height: '44px' }}
              >
                {loading && <Loader2 size={16} className="animate-spin" />}
                {driveStatus === DRIVE_STATUS.RECONNECT_REQUIRED ? 'Reconnect Google Drive' : 'Connect with Google'}
              </button>
              
              <button 
                className="btn btn-outline w-full text-secondary" 
                onClick={handleContinue}
                disabled={loading}
                style={{ height: '40px' }}
              >
                Not now
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
