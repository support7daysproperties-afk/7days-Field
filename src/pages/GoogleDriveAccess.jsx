import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { HardDrive, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import GoogleDriveService from '../services/GoogleDriveService';
import { Capacitor } from '@capacitor/core';
import { supabase } from '../lib/supabase';

export default function GoogleDriveAccess() {
  const navigate = useNavigate();
  const { driveAuthorized, authorizeDrive, intendedRoute, setIntendedRoute } = useAuth();
  
  const [status, setStatus] = useState('idle'); // idle, loading, success, error
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    // Clear the pending flag so they can navigate away if they choose "Not now"
    localStorage.removeItem('pending_drive_onboarding');

    // If already authorized, we should check if they explicitly clicked to manage connection.
    // For now, if we land here and it's connected, we stay to show status, or they can navigate away.
    GoogleDriveService.init().catch(err => {
      setStatus('error');
      setErrorMessage('Failed to load Google services. Please check your connection.');
    });
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

  const handleConnect = async () => {
    setStatus('loading');
    setErrorMessage('');
    
    try {
      if (Capacitor.isNativePlatform()) {
        // GIS fails in WebViews with invalid_client. We must use the browser OAuth flow
        // to show the Google Drive permission screen. Supabase handles @capacitor/browser natively!
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            scopes: 'https://www.googleapis.com/auth/drive.file',
            redirectTo: window.location.origin, 
            skipBrowserRedirect: false // Explicitly allow Supabase to open the system browser
          }
        });
        if (error) throw error;
      } else {
        await GoogleDriveService.requestDriveAccess();
        // Test the API and lazy-create the root application folder to verify it works
        await GoogleDriveService.getOrCreateFolder('7Days Field');
        authorizeDrive();
        setStatus('success');
      }
    } catch (error) {
      console.error(error);
      setStatus('error');
      // Human readable error handling
      if (error?.message?.includes('origin_mismatch') || error?.message?.includes('redirect_uri_mismatch')) {
        setErrorMessage('Google Drive could not be connected because the application URL is not registered correctly. Please try again or contact the administrator.');
      } else {
        setErrorMessage(error?.message || 'Connection cancelled or failed. Please try again.');
      }
    }
  };

  const handleNotNow = () => {
    handleContinue();
  };

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-md" style={{ backgroundColor: 'var(--bg-color)' }}>
      <div className="card w-full max-w-md p-xl flex flex-col items-center animate-fade-in" style={{ backgroundColor: 'var(--surface-color)' }}>
        
        <div className="w-16 h-16 rounded-full bg-surface mb-lg flex items-center justify-center" style={{ backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)' }}>
          {status === 'loading' ? (
            <Loader2 size={32} className="text-primary animate-spin" />
          ) : (status === 'success' || driveAuthorized) ? (
            <CheckCircle2 size={32} className="text-success" />
          ) : status === 'error' ? (
            <AlertTriangle size={32} className="text-danger" />
          ) : (
            <HardDrive size={32} className="text-primary" />
          )}
        </div>

        <h1 className="text-xl font-bold mb-sm text-text text-center">
          {(status === 'success' || driveAuthorized) ? 'Google Drive connected' : 'Connect your Google Drive'}
        </h1>
        
        <p className="text-secondary text-sm mb-lg text-center">
          {(status === 'success' || driveAuthorized)
            ? 'Inspection files can now be securely uploaded to your Drive.'
            : 'Keep your inspection files safely connected to your Google Drive.'}
        </p>

        {status === 'error' && (
          <div className="w-full bg-danger bg-opacity-10 text-danger p-md rounded-md mb-xl text-sm border border-danger">
            {errorMessage}
          </div>
        )}

        <div className="w-full flex flex-col gap-md mt-auto">
          {(status === 'success' || driveAuthorized) ? (
            <>
              <button className="btn btn-primary w-full" onClick={handleContinue}>
                Continue to Application
              </button>
              <button className="btn btn-outline w-full text-danger border-danger" onClick={() => { GoogleDriveService.revokeAccess(); authorizeDrive(false); setStatus('idle'); }}>
                Disconnect Drive
              </button>
            </>
          ) : (
            <>
              <button 
                className="btn btn-primary w-full flex justify-center items-center gap-sm" 
                onClick={handleConnect}
                disabled={status === 'loading'}
              >
                {status === 'loading' && <Loader2 size={16} className="animate-spin" />}
                {status === 'error' ? 'Try Again' : 'Continue with Google'}
              </button>
              
              <button 
                className="btn btn-outline w-full text-secondary border-color" 
                onClick={handleNotNow}
                disabled={status === 'loading'}
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
