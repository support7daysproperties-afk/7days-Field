import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { Loader2, HardDrive, CheckCircle2, AlertTriangle } from 'lucide-react';
import GoogleDriveService from '../services/GoogleDriveService';


export default function Login() {
  const { authError, authenticated, driveAuthorized, authorizeDrive } = useAuth();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  // For the Drive step
  const [driveStatus, setDriveStatus] = useState('idle');
  const [driveErrorMsg, setDriveErrorMsg] = useState('');

  useEffect(() => {
    if (authenticated && driveAuthorized) {
      navigate('/', { replace: true });
    }
  }, [authenticated, driveAuthorized, navigate]);

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setError('');
    
    try {
      localStorage.setItem('pending_drive_onboarding', 'true');
      
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: window.location.origin, 
            scopes: 'https://www.googleapis.com/auth/drive.file',
            queryParams: {
              access_type: 'offline',
              prompt: 'consent',
            }
          }
        });
        
        if (error) throw error;
    } catch (err) {
      setError(err.message || 'Failed to sign in with Google');
      setIsLoading(false);
    }
  };

  const handleDriveConnect = async () => {
    setDriveStatus('loading');
    setDriveErrorMsg('');
    try {
      await GoogleDriveService.init();
      await GoogleDriveService.requestDriveAccess();
      await GoogleDriveService.getOrCreateFolder('7Days Field');
      authorizeDrive();
      setDriveStatus('success');
    } catch (err) {
      console.error(err);
      setDriveStatus('error');
      if (err?.message?.includes('origin_mismatch') || err?.message?.includes('redirect_uri_mismatch')) {
        setDriveErrorMsg('Google Drive could not be connected because the application URL is not registered correctly.');
      } else {
        setDriveErrorMsg(err?.message || 'Connection failed. Please try again.');
      }
    }
  };

  const handleDriveSkip = () => {
    navigate('/', { replace: true });
  };

  return (
    <div 
      style={{ 
        minHeight: '100vh',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        position: 'relative',
        overflow: 'hidden',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
        color: '#ffffff'
      }}
    >
      {/* Decorative background elements */}
      <div style={{ position: 'absolute', top: '-10%', left: '-10%', width: '40%', height: '40%', borderRadius: '50%', background: '#3b82f6', opacity: 0.2, filter: 'blur(100px)' }}></div>
      <div style={{ position: 'absolute', bottom: '-10%', right: '-10%', width: '40%', height: '40%', borderRadius: '50%', background: '#8b5cf6', opacity: 0.2, filter: 'blur(100px)' }}></div>

      <div 
        style={{ 
          width: '100%',
          maxWidth: '400px',
          padding: '32px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          position: 'relative',
          zIndex: 10,
          background: 'rgba(30, 41, 59, 0.7)', 
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderRadius: '24px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
        }}
      >
        
        {/* Animated Logo Container */}
        <div 
          style={{
            width: '80px',
            height: '80px',
            borderRadius: '20px',
            marginBottom: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontWeight: 'bold',
            fontSize: '32px',
            position: 'relative',
            overflow: 'hidden',
            background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
            boxShadow: '0 10px 25px -5px rgba(59, 130, 246, 0.5)'
          }}
        >
          <div style={{ position: 'absolute', inset: 0, backgroundColor: 'white', opacity: 0.15 }}></div>
          <span style={{ position: 'relative', zIndex: 10, letterSpacing: '-1px' }}>7D</span>
        </div>

        {(!authenticated) ? (
          <>
            <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '8px', color: 'white', margin: '0 0 8px 0' }}>
              Field Supervisor
            </h1>
            
            <p style={{ fontSize: '14px', marginBottom: '32px', color: '#94a3b8', margin: '0 0 32px 0' }}>
              Secure access to properties and inspections.
            </p>

            {(error || authError) && (
              <div 
                style={{ 
                  width: '100%',
                  padding: '16px',
                  borderRadius: '8px',
                  marginBottom: '24px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  textAlign: 'left',
                  fontSize: '14px',
                  background: 'rgba(239, 68, 68, 0.1)', 
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#f87171' 
                }}
              >
                <svg style={{ width: '20px', height: '20px', marginRight: '8px', flexShrink: 0 }} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"></path>
                </svg>
                <span>{error || authError}</span>
              </div>
            )}

            <button 
              onClick={handleGoogleLogin}
              disabled={isLoading}
              style={{ 
                width: '100%',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '8px',
                padding: '14px 24px',
                borderRadius: '12px',
                fontWeight: '600',
                fontSize: '16px',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                background: '#ffffff',
                color: '#0f172a',
                border: 'none',
                boxShadow: '0 4px 14px 0 rgba(255, 255, 255, 0.2)'
              }}
            >
              {isLoading ? (
                <Loader2 size={20} className="text-slate-800" style={{ animation: 'spin 1s linear infinite' }} />
              ) : (
                <>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Continue with Google
                </>
              )}
            </button>
            
            <p style={{ fontSize: '12px', marginTop: '24px', opacity: 0.5, color: '#cbd5e1' }}>
              Authorized personnel only.
            </p>
          </>
        ) : (
          /* Drive Authorization Step directly inside Login */
          <>
            <div className="w-16 h-16 rounded-full bg-slate-800 mb-6 flex items-center justify-center border border-slate-700">
              {driveStatus === 'loading' ? (
                <Loader2 size={32} className="text-blue-400 animate-spin" />
              ) : driveStatus === 'success' ? (
                <CheckCircle2 size={32} className="text-emerald-400" />
              ) : driveStatus === 'error' ? (
                <AlertTriangle size={32} className="text-red-400" />
              ) : (
                <HardDrive size={32} className="text-blue-400" />
              )}
            </div>
            
            <h1 style={{ fontSize: '22px', fontWeight: 'bold', marginBottom: '8px', color: 'white' }}>
              Connect Google Drive
            </h1>
            <p style={{ fontSize: '14px', marginBottom: '24px', color: '#94a3b8' }}>
              Keep your inspection files safely connected to your Drive.
            </p>

            {driveStatus === 'error' && (
              <div className="w-full bg-red-500 bg-opacity-20 text-red-400 p-3 rounded-md mb-6 text-sm border border-red-500/50">
                {driveErrorMsg}
              </div>
            )}

            <button 
              onClick={handleDriveConnect}
              disabled={driveStatus === 'loading'}
              style={{ 
                width: '100%',
                padding: '12px 24px',
                borderRadius: '8px',
                fontWeight: '600',
                background: '#3b82f6',
                color: 'white',
                border: 'none',
                marginBottom: '12px',
                cursor: 'pointer'
              }}
            >
              {driveStatus === 'loading' ? 'Connecting...' : driveStatus === 'error' ? 'Try Again' : 'Connect Drive'}
            </button>
            <button 
              onClick={handleDriveSkip}
              disabled={driveStatus === 'loading'}
              style={{ 
                width: '100%',
                padding: '12px 24px',
                borderRadius: '8px',
                fontWeight: '600',
                background: 'transparent',
                color: '#cbd5e1',
                border: '1px solid #475569',
                cursor: 'pointer'
              }}
            >
              Skip for now
            </button>
          </>
        )}

      </div>
    </div>
  );
}
