import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import GoogleDriveService, { DRIVE_STATUS } from '../services/GoogleDriveService';
import DriveAuthRepository from '../services/offline/DriveAuthRepository';
import SyncEngine from '../services/offline/SyncEngine';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  
  // Google Drive Connection State
  const [driveStatus, setDriveStatus] = useState(DRIVE_STATUS.DISCONNECTED);
  const [driveEmail, setDriveEmail] = useState('');
  const [driveDetails, setDriveDetails] = useState('');
  const [intendedRoute, setIntendedRoute] = useState(null);

  const currentUserRef = useRef(null);

  // Subscribe to GoogleDriveService status changes
  useEffect(() => {
    const unsub = GoogleDriveService.subscribeStatus((state) => {
      setDriveStatus(state.status);
      setDriveEmail(state.email || '');
      setDriveDetails(state.details || '');
    });
    return unsub;
  }, []);

  /**
   * Verify supervisor access in field_supervisors table.
   * If valid, restores supervisor-scoped Drive connection.
   */
  const checkSupervisorAccess = useCallback(async (sessionUser, providerToken = null) => {
    if (!sessionUser) {
      currentUserRef.current = null;
      setUser(null);
      setAuthenticated(false);
      setLoading(false);
      // Clear in-memory token state
      GoogleDriveService.setTokenData({ accessToken: null });
      return;
    }

    try {
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
        // Not registered as a field supervisor
        await supabase.auth.signOut();
        setAuthError('Access not authorized. This Google account is not registered as a 7Days Field Supervisor. Please contact the administrator.');
        currentUserRef.current = null;
        setUser(null);
        setAuthenticated(false);
        setLoading(false);
        return;
      }

      // Authorized supervisor
      setAuthError('');
      const fullUser = { ...sessionUser, supervisorProfile: data };
      currentUserRef.current = fullUser;
      setUser(fullUser);
      setAuthenticated(true);

      // Restore supervisor-scoped Drive authorization
      await restoreDriveConnection(fullUser, providerToken);
    } catch (err) {
      setAuthError('Error verifying your supervisor access. Please try again.');
      await supabase.auth.signOut();
      currentUserRef.current = null;
      setUser(null);
      setAuthenticated(false);
    }
    
    setLoading(false);
  }, []);

  /**
   * Restores Google Drive connection state for the authenticated supervisor.
   */
  const restoreDriveConnection = async (supervisorUser, providerToken = null) => {
    if (!supervisorUser) return;
    const userId = supervisorUser.id;

    // Check stored authorization metadata in IndexedDB
    const storedAuth = await DriveAuthRepository.getAuth(userId);

    if (storedAuth?.disconnected) {
      // User explicitly disconnected Drive
      GoogleDriveService.setStatus(DRIVE_STATUS.DISCONNECTED);
      return;
    }

    // 1. If Supabase gave us a provider_token on OAuth login, we can use it
    if (providerToken) {
      const email = supervisorUser.email || storedAuth?.email || null;
      GoogleDriveService.setTokenData({
        accessToken: providerToken,
        expiresInSec: 3600,
        email: email
      });

      await DriveAuthRepository.saveAuth({
        userId,
        email: email,
        status: DRIVE_STATUS.CONNECTED,
        last_connected_at: new Date().toISOString(),
        disconnected: false,
      });

      // Trigger sync if pending
      setTimeout(() => SyncEngine.startSync(), 1000);
      return;
    }

    // 2. If stored authorization says connected, check/renew with silent GIS
    if (storedAuth && !storedAuth.disconnected) {
      GoogleDriveService.setStatus(DRIVE_STATUS.CHECKING, 'Restoring Drive connection...');
      try {
        await GoogleDriveService.init();
        // Set email hint
        GoogleDriveService.setTokenData({
          accessToken: null,
          email: storedAuth.email || supervisorUser.email,
        });

        // Test silent refresh
        const token = await GoogleDriveService.getValidToken();
        if (token) {
          await DriveAuthRepository.saveAuth({
            userId,
            email: GoogleDriveService.tokenEmail || storedAuth.email,
            status: DRIVE_STATUS.CONNECTED,
            last_connected_at: new Date().toISOString(),
            disconnected: false,
          });
          setTimeout(() => SyncEngine.startSync(), 1000);
        }
      } catch (err) {
        if (!navigator.onLine) {
          GoogleDriveService.setStatus(DRIVE_STATUS.OFFLINE, 'Offline — Drive connection will resume when online');
        } else {
          GoogleDriveService.setStatus(DRIVE_STATUS.RECONNECT_REQUIRED, 'Authorization expired. Reconnect needed.');
        }
      }
    }
  };

  useEffect(() => {
    // Initial session check
    supabase.auth.getSession().then(({ data: { session } }) => {
      checkSupervisorAccess(session?.user, session?.provider_token);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setLoading(true);
      checkSupervisorAccess(session?.user, session?.provider_token);
    });

    return () => subscription.unsubscribe();
  }, [checkSupervisorAccess]);

  /**
   * Connect or Authorize Drive interactively.
   */
  const connectDrive = async ({ prompt = 'consent' } = {}) => {
    const activeUser = currentUserRef.current;
    if (!activeUser) {
      throw new Error('You must be signed in to connect Google Drive.');
    }

    try {
      const result = await GoogleDriveService.requestDriveAccess({
        loginHint: activeUser.email,
        prompt,
      });

      // Verify connection and ensure root folder exists
      await GoogleDriveService.getOrCreateFolder('7Days Field');

      const authorizedEmail = result.email || activeUser.email;

      // Persist supervisor-scoped record
      await DriveAuthRepository.saveAuth({
        userId: activeUser.id,
        email: authorizedEmail,
        status: DRIVE_STATUS.CONNECTED,
        last_connected_at: new Date().toISOString(),
        disconnected: false,
      });

      // Resume pending sync jobs
      setTimeout(() => SyncEngine.startSync(), 500);
      return result;
    } catch (err) {
      console.error('Interactive Drive connect failed:', err);
      throw err;
    }
  };

  /**
   * Explicitly disconnect Drive without affecting application login or local inspections.
   */
  const disconnectDrive = async () => {
    const activeUser = currentUserRef.current;
    GoogleDriveService.revokeAccess();

    if (activeUser) {
      await DriveAuthRepository.saveAuth({
        userId: activeUser.id,
        email: null,
        status: DRIVE_STATUS.DISCONNECTED,
        disconnected: true,
      });
    }
  };

  /**
   * Normal application sign-out.
   * Clears in-memory tokens. Does NOT revoke supervisor's granted authorization,
   * so on next login their connection can be restored seamlessly.
   */
  const signOut = async () => {
    GoogleDriveService.setTokenData({ accessToken: null });
    currentUserRef.current = null;
    setUser(null);
    setAuthenticated(false);
    await supabase.auth.signOut();
  };

  // Backwards compatibility helper: driveAuthorized boolean
  const driveAuthorized = driveStatus === DRIVE_STATUS.CONNECTED;

  return (
    <AuthContext.Provider value={{
      authenticated,
      user,
      loading,
      authError,
      setAuthError,
      signOut,

      // Google Drive State & Actions
      driveAuthorized,
      driveStatus,
      driveEmail: driveEmail || user?.email || '',
      driveDetails,
      connectDrive,
      disconnectDrive,
      refreshDriveToken: connectDrive,
      authorizeDrive: (auth = true) => {
        if (!auth) disconnectDrive();
      },

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
