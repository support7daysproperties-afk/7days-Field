import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import GoogleDriveService from '../services/GoogleDriveService';
import SyncEngine from '../services/offline/SyncEngine';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  
  const [driveAuthorized, setDriveAuthorized] = useState(false);
  const [intendedRoute, setIntendedRoute] = useState(null);

  const checkSupervisorAccess = async (sessionUser) => {
    if (!sessionUser) {
      setUser(null);
      setAuthenticated(false);
      setLoading(false);
      return;
    }

    try {
      // Check if user is an authorized Field Supervisor
      const { data, error } = await supabase
        .from('field_supervisors')
        .select('*')
        .eq('auth_user_id', sessionUser.id)
        .maybeSingle();

      if (error) {
        console.error('Error checking supervisor access:', error);
        throw error;
      }

      if (!data) {
        // Not a field supervisor
        await supabase.auth.signOut();
        setAuthError('Access not authorized. This Google account is not registered as a 7Days Field Supervisor. Please contact the administrator.');
        setUser(null);
        setAuthenticated(false);
      } else {
        // Authorized
        setAuthError('');
        setUser({ ...sessionUser, supervisorProfile: data });
        setAuthenticated(true);
      }
    } catch (err) {
      setAuthError('Error verifying your supervisor access. Please try again.');
      await supabase.auth.signOut();
      setUser(null);
      setAuthenticated(false);
    }
    
    setLoading(false);
  };

  useEffect(() => {
    // Check active sessions and sets the user
    supabase.auth.getSession().then(({ data: { session } }) => {
      checkSupervisorAccess(session?.user);
      
      // We no longer rely on provider_token from Supabase for Drive Auth,
      // as we want to handle Drive OAuth via GIS as a second step.
      if (sessionStorage.getItem('drive_connected') === 'true') {
        setDriveAuthorized(true);
      }
    });

    // Listen for changes on auth state
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setLoading(true);
      checkSupervisorAccess(session?.user);
      
      if (!session) {
        setDriveAuthorized(false);
      } else if (sessionStorage.getItem('drive_connected') === 'true') {
        setDriveAuthorized(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const authorizeDrive = (authorized = true) => {
    setDriveAuthorized(authorized);
    if (authorized) {
      sessionStorage.setItem('drive_connected', 'true');
      // Resume any pending/NEEDS_DRIVE_AUTH sync jobs now that Drive is available
      setTimeout(() => SyncEngine.startSync(), 500);
    } else {
      sessionStorage.removeItem('drive_connected');
    }
  };

  const refreshDriveToken = async () => {
    try {
      await GoogleDriveService.init();
      const tokenResponse = await GoogleDriveService.requestDriveAccess();
      setDriveAuthorized(true);
      sessionStorage.setItem('drive_connected', 'true');
      setTimeout(() => SyncEngine.startSync(), 500);
      return tokenResponse;
    } catch (err) {
      console.error('Drive token refresh failed:', err);
      throw err;
    }
  };

  const disconnectDrive = () => {
    setDriveAuthorized(false);
    sessionStorage.removeItem('drive_connected');
  };

  const signOut = async () => {
    GoogleDriveService.revokeAccess();
    setDriveAuthorized(false);
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{
      authenticated,
      user,
      loading,
      authError,
      setAuthError,
      signOut,
      driveAuthorized,
      authorizeDrive,
      disconnectDrive,
      refreshDriveToken,
      intendedRoute,
      setIntendedRoute
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
