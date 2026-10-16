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
    localStorage.setItem('drive_onboarding_done', 'true');
    localStorage.removeItem('pending_drive_onboarding');
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
      if (error?.code === 'USER_CANCELLED') {
        setErrorMessage("Drive authorization was cancelled. You can connect Google Drive whenever you're ready.");
      } else if (error?.message?.includes('origin_mismatch') || error?.message?.includes('redirect_uri_mismatch')) {
        setErrorMessage('Google Drive could not be connected because the application URL is not registered in Google Cloud Console.');
      } else {
        setErrorMessage(error?.message || 'Connection failed. Please try again.');
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
    <div className="min-h-screen flex flex-col items-center justify-center p-md" style={{ backgroundColor: 'var(--bg-color)', minHeight: '100vh', padding: '16px' }}>
      <div className="card w-full max-w-md p-xl flex flex-col items-center animate-fade-in" style={{ backgroundColor: 'var(--surface-color)', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)', padding: '24px' }}>
        
        {/* Status Icon */}
        <div className="w-16 h-16 rounded-full mb-lg flex items-center justify-center" style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: 'var(--surface-light)', border: '1px solid var(--border-color)', marginBottom: '16px' }}>
          {loading ? (
            <Loader2 size={30} className="animate-spin" style={{ color: 'var(--primary-color)' }} />
          ) : driveAuthorized ? (
            <CheckCircle2 size={30} style={{ color: 'var(--success-color)' }} />
          ) : driveStatus === DRIVE_STATUS.RECONNECT_REQUIRED ? (
            <AlertTriangle size={30} style={{ color: 'var(--warning-color)' }} />
          ) : driveStatus === DRIVE_STATUS.ERROR ? (
            <AlertTriangle size={30} style={{ color: 'var(--danger-color)' }} />
          ) : (
            <HardDrive size={30} style={{ color: 'var(--primary-color)' }} />
          )}
        </div>

        {/* Title */}
        <h1 className="text-xl font-bold mb-xs text-center" style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 6px 0', color: 'var(--text-primary)' }}>
          {driveAuthorized ? 'Google Drive Connected' : driveStatus === DRIVE_STATUS.RECONNECT_REQUIRED ? 'Drive Re-authentication Needed' : 'Connect Google Drive Storage'}
        </h1>
        
        {/* Subtitle / Email status */}
        <p className="text-secondary text-sm mb-md text-center" style={{ margin: '0 0 20px 0', fontSize: '13px', lineHeight: 1.5 }}>
          {driveAuthorized ? (
            <span>
              Connected as <strong style={{ color: 'var(--text-primary)' }}>{driveEmail || supervisorEmail}</strong>
            </span>
          ) : driveStatus === DRIVE_STATUS.RECONNECT_REQUIRED ? (
            <span>Your Google Drive session has expired or requires renewal. Reconnect to resume media uploads.</span>
          ) : (
            <span>Authorize 7Days Field to securely upload and sync captured photos, videos, and signatures directly to Google Drive.</span>
          )}
        </p>

        {/* Account Mismatch Notice */}
        {driveAuthorized && isDifferentAccount && (
          <div style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: '10px',
            backgroundColor: 'rgba(37, 99, 235, 0.08)',
            border: '1px solid rgba(37, 99, 235, 0.25)',
            marginBottom: '16px',
            fontSize: '12px',
            lineHeight: '1.4'
          }}>
            <div style={{ fontWeight: '600', color: 'var(--primary-color)', marginBottom: '4px' }}>
              Different Google Account Connected
            </div>
            <div style={{ color: 'var(--text-secondary)' }}>
              App login: <strong style={{ color: 'var(--text-primary)' }}>{supervisorEmail}</strong><br/>
              Drive storage: <strong style={{ color: 'var(--text-primary)' }}>{driveEmail}</strong>
            </div>
          </div>
        )}

        {/* Error alert */}
        {errorMessage && (
          <div style={{ width: '100%', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger-color)', padding: '12px 14px', borderRadius: '10px', marginBottom: '16px', fontSize: '13px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
            {errorMessage}
          </div>
        )}

        {/* Action Buttons */}
        <div className="w-full flex flex-col gap-sm" style={{ width: '100%', gap: '10px' }}>
          {driveAuthorized ? (
            <>
              <button className="btn btn-primary w-full" onClick={handleContinue} style={{ minHeight: '44px', fontWeight: 600 }}>
                Continue to Field Work
              </button>
              
              <button
                className="btn btn-secondary w-full flex items-center justify-center gap-xs"
                style={{ minHeight: '40px', fontSize: '13px', fontWeight: 600 }}
                onClick={() => handleConnect(true)}
                disabled={loading}
              >
                <RefreshCw size={15} /> Switch Google Account
              </button>

              <button
                className="btn btn-secondary w-full flex items-center justify-center gap-xs"
                style={{ minHeight: '40px', fontSize: '13px', color: 'var(--danger-color)', borderColor: 'rgba(239, 68, 68, 0.3)', backgroundColor: 'transparent' }}
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
                style={{ minHeight: '44px', fontWeight: 700 }}
              >
                {loading && <Loader2 size={16} className="animate-spin" />}
                {driveStatus === DRIVE_STATUS.RECONNECT_REQUIRED ? 'Reconnect Google Drive' : 'Connect with Google Drive'}
              </button>
              
              <button 
                className="btn btn-secondary w-full" 
                onClick={handleContinue}
                disabled={loading}
                style={{ minHeight: '40px', fontSize: '13px', color: 'var(--text-secondary)' }}
              >
                Skip for Now (Local Only)
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
