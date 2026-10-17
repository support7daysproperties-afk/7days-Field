import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import GoogleDriveService, { DRIVE_STATUS } from '../services/GoogleDriveService';
import DriveAuthRepository from '../services/offline/DriveAuthRepository';
import DatabaseService from '../services/offline/DatabaseService';
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
   * Restores Google Drive connection state for the authenticated supervisor.
   */
  const restoreDriveConnection = useCallback(async (supervisorUser, providerToken = null) => {
    if (!supervisorUser) return;
    const userId = supervisorUser.id;

    // Check stored authorization metadata in IndexedDB
    const storedAuth = await DriveAuthRepository.getAuth(userId);

    if (storedAuth?.disconnected) {
      // User explicitly disconnected Drive
      GoogleDriveService.setStatus(DRIVE_STATUS.DISCONNECTED);
      return;
    }

    // 1. If Supabase gave us a provider_token on OAuth login, persist and use it
    if (providerToken) {
      const email = supervisorUser.email || storedAuth?.email || null;
      const expiresInSec = 3600;
      GoogleDriveService.setTokenData({
        accessToken: providerToken,
        expiresInSec,
        email: email
      });

      await DriveAuthRepository.saveAuth({
        userId,
        email: email,
        accessToken: providerToken,
        expiresAt: Date.now() + (expiresInSec - 60) * 1000,
        status: DRIVE_STATUS.CONNECTED,
        last_connected_at: new Date().toISOString(),
        disconnected: false,
      });

      // Trigger sync if pending
      setTimeout(() => SyncEngine.startSync(), 1000);
      return;
    }

    // 2. If stored authorization has an access token that is still valid
    if (storedAuth?.accessToken && (!storedAuth.expiresAt || Date.now() < storedAuth.expiresAt)) {
      GoogleDriveService.setTokenData({
        accessToken: storedAuth.accessToken,
        expiresAt: storedAuth.expiresAt,
        email: storedAuth.email || supervisorUser.email
      });
      return;
    }

    // 3. If stored authorization exists and user hasn't explicitly disconnected
    if (storedAuth && !storedAuth.disconnected) {
      // If we already have a valid token in memory or localStorage, keep it active!
      if (GoogleDriveService.isTokenValid()) {
        GoogleDriveService.setStatus(DRIVE_STATUS.CONNECTED, '', storedAuth.email || supervisorUser.email);
        return;
      }

      // Try silent refresh without wiping existing token beforehand
      try {
        await GoogleDriveService.init();
        const tokenRes = await GoogleDriveService._silentTokenRefresh();
        if (tokenRes?.access_token) {
          const expiresInSec = tokenRes.expires_in ? parseInt(tokenRes.expires_in, 10) : 3600;
          GoogleDriveService.setTokenData({
            accessToken: tokenRes.access_token,
            expiresInSec,
            email: storedAuth.email || supervisorUser.email
          });
          await DriveAuthRepository.saveAuth({
            userId,
            email: storedAuth.email || supervisorUser.email,
            accessToken: tokenRes.access_token,
            expiresAt: Date.now() + (expiresInSec - 60) * 1000,
            status: DRIVE_STATUS.CONNECTED,
            last_connected_at: new Date().toISOString(),
            disconnected: false,
          });
        } else {
          // Retain connected state for continuous field work
          GoogleDriveService.setStatus(DRIVE_STATUS.CONNECTED, '', storedAuth.email || supervisorUser.email);
        }
      } catch (err) {
        // Do not force disconnected state if user already authorized Drive!
        // Keep status CONNECTED with email so supervisor can continue working seamlessly without interruption.
        console.warn('[AuthContext] Silent token refresh notice:', err.message);
        GoogleDriveService.setStatus(DRIVE_STATUS.CONNECTED, '', storedAuth.email || supervisorUser.email);
      }
    }
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
      await DatabaseService.setCurrentUser(null);
      return;
    }

    try {
      // Check if a different user was previously active on this device
      const prevUserId = localStorage.getItem('7days_active_user_id');
      if (prevUserId && prevUserId !== sessionUser.id) {
        // Clear previous user's in-memory token & drive connection
        GoogleDriveService.setTokenData({ accessToken: null });
        GoogleDriveService.setStatus(DRIVE_STATUS.DISCONNECTED);
      }

      // Activate user-scoped database partition
      await DatabaseService.setCurrentUser(sessionUser.id);

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
        // Check if we have previously verified this supervisor profile locally
        const cachedProfileStr = localStorage.getItem(`supervisor_profile_${sessionUser.id}`);
        if (cachedProfileStr) {
          try {
            const cachedProfile = JSON.parse(cachedProfileStr);
            setAuthError('');
            const fullUser = { ...sessionUser, supervisorProfile: cachedProfile };
            currentUserRef.current = fullUser;
            setUser(fullUser);
            setAuthenticated(true);
            await restoreDriveConnection(fullUser, providerToken);
            setLoading(false);
            return;
          } catch (e) {
            console.warn('Failed to parse cached profile:', e);
          }
        }

        // Not registered as a field supervisor
        await supabase.auth.signOut();
        setAuthError('Access not authorized. This Google account is not registered as a 7Days Field Supervisor. Please contact the administrator.');
        currentUserRef.current = null;
        setUser(null);
        setAuthenticated(false);
        setLoading(false);
        await DatabaseService.setCurrentUser(null);
        return;
      }

      // Authorized supervisor
      setAuthError('');
      // Cache profile locally for instant offline launches
      try {
        localStorage.setItem(`supervisor_profile_${sessionUser.id}`, JSON.stringify(data));
      } catch (e) {
        console.warn('Could not cache supervisor profile:', e);
      }

      const fullUser = { ...sessionUser, supervisorProfile: data };
      currentUserRef.current = fullUser;
      setUser(fullUser);
      setAuthenticated(true);

      // Restore supervisor-scoped Drive authorization
      await restoreDriveConnection(fullUser, providerToken);
    } catch (err) {
      // Check if we have cached profile for offline/network error scenarios
      const cachedProfileStr = localStorage.getItem(`supervisor_profile_${sessionUser.id}`);
      if (cachedProfileStr && (!navigator.onLine || err?.message?.includes('fetch') || err?.message?.includes('network'))) {
        try {
          const cachedProfile = JSON.parse(cachedProfileStr);
          setAuthError('');
          const fullUser = { ...sessionUser, supervisorProfile: cachedProfile };
          currentUserRef.current = fullUser;
          setUser(fullUser);
          setAuthenticated(true);
          await restoreDriveConnection(fullUser, providerToken);
          setLoading(false);
          return;
        } catch (e) {
          console.warn('Failed to parse cached profile:', e);
        }
      }

      setAuthError('Error verifying your supervisor access. Please check your network and try again.');
      // Do not signOut if network error so offline PWA continues to work
      if (navigator.onLine && !err?.message?.includes('fetch')) {
        await supabase.auth.signOut();
        currentUserRef.current = null;
        setUser(null);
        setAuthenticated(false);
      }
    }
    
    setLoading(false);
  }, [restoreDriveConnection]);


  // Track initialization to avoid redundant duplicate calls
  const isInitializingRef = useRef(false);

  useEffect(() => {
    // Initial session check
    if (!isInitializingRef.current) {
      isInitializingRef.current = true;
      supabase.auth.getSession().then(({ data: { session } }) => {
        checkSupervisorAccess(session?.user, session?.provider_token);
      }).catch((err) => {
        console.error('Session retrieval error:', err);
        setLoading(false);
      });
    }

    // Listen for auth state changes (SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') {
        // Already handled by getSession
        return;
      }
      if (event === 'SIGNED_OUT') {
        currentUserRef.current = null;
        setUser(null);
        setAuthenticated(false);
        setLoading(false);
        GoogleDriveService.setTokenData({ accessToken: null });
        GoogleDriveService.setStatus(DRIVE_STATUS.DISCONNECTED);
        DatabaseService.setCurrentUser(null).catch(() => {});
        return;
      }
      
      // If user changed or signed in afresh
      if (session?.user?.id && session?.user?.id !== currentUserRef.current?.id) {
        setLoading(true);
        checkSupervisorAccess(session?.user, session?.provider_token);
      } else if (session?.provider_token && currentUserRef.current) {
        restoreDriveConnection(currentUserRef.current, session.provider_token);
      }
    });

    return () => subscription.unsubscribe();
  }, [checkSupervisorAccess, restoreDriveConnection]);

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
      const expiresInSec = result.expires_in ? parseInt(result.expires_in, 10) : 3600;

      // Persist supervisor-scoped record with access token so it stays permanently connected
      await DriveAuthRepository.saveAuth({
        userId: activeUser.id,
        email: authorizedEmail,
        accessToken: result.access_token,
        expiresAt: Date.now() + (expiresInSec - 60) * 1000,
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
        accessToken: null,
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
    const activeUserId = currentUserRef.current?.id;
    localStorage.removeItem('pending_drive_onboarding');
    localStorage.removeItem('drive_onboarding_done');
    if (activeUserId) {
      localStorage.removeItem(`supervisor_profile_${activeUserId}`);
      localStorage.removeItem(`drive_onboarding_done_${activeUserId}`);
      localStorage.removeItem(`pending_drive_onboarding_${activeUserId}`);
    }
    localStorage.removeItem('7days_active_user_id');
    GoogleDriveService.setTokenData({ accessToken: null });
    GoogleDriveService.setStatus(DRIVE_STATUS.DISCONNECTED);
    currentUserRef.current = null;
    setUser(null);
    setAuthenticated(false);
    await DatabaseService.setCurrentUser(null);
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
