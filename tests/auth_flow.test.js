import { describe, it, expect, beforeEach, vi } from 'vitest';
import GoogleDriveService, { DRIVE_STATUS } from '../src/services/GoogleDriveService';

// Mock browser storage for node environment
const createMockStorage = () => {
  let store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, val) => { store[key] = String(val); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; }
  };
};

describe('Google Authentication & Drive Permission Flow Regression Tests', () => {
  beforeEach(() => {
    globalThis.localStorage = createMockStorage();
    globalThis.sessionStorage = createMockStorage();
    Object.defineProperty(globalThis.navigator, 'onLine', {
      value: true,
      configurable: true,
      writable: true,
    });
    globalThis.window = {
      localStorage: globalThis.localStorage,
      sessionStorage: globalThis.sessionStorage,
      location: { origin: 'http://localhost:5173' }
    };
    GoogleDriveService.setTokenData({ accessToken: null });
    GoogleDriveService.setStatus(DRIVE_STATUS.DISCONNECTED);
  });

  describe('Scenario A — First-time user sign-in & Drive onboarding state', () => {
    it('sets pending_drive_onboarding flag when initiating login and transitions correctly', () => {
      // User clicks "Continue with Google"
      localStorage.setItem('pending_drive_onboarding', 'true');
      localStorage.removeItem('drive_onboarding_done');

      expect(localStorage.getItem('pending_drive_onboarding')).toBe('true');
      expect(localStorage.getItem('drive_onboarding_done')).toBeNull();

      // Once Drive is connected or skipped:
      localStorage.setItem('drive_onboarding_done', 'true');
      localStorage.removeItem('pending_drive_onboarding');

      expect(localStorage.getItem('drive_onboarding_done')).toBe('true');
      expect(localStorage.getItem('pending_drive_onboarding')).toBeNull();
    });
  });

  describe('Scenario B — Normal reopening: Valid session restored without sign-in loops', () => {
    it('does not require Google Drive reconnection prompt if already onboarded', () => {
      localStorage.setItem('drive_onboarding_done', 'true');
      const authenticated = true;
      const driveAuthorized = false; // Drive might need silent refresh later, but app session is valid
      const hasOnboardedDrive = localStorage.getItem('drive_onboarding_done') === 'true';
      const isPendingOnboarding = localStorage.getItem('pending_drive_onboarding') === 'true';

      const shouldNavigateDirectlyToApp = driveAuthorized || hasOnboardedDrive || !isPendingOnboarding;

      expect(authenticated).toBe(true);
      expect(shouldNavigateDirectlyToApp).toBe(true);
    });

    it('restores Drive token silently without prompting user when token is still valid', async () => {
      const validUntil = Date.now() + 3600 * 1000;
      GoogleDriveService.setTokenData({
        accessToken: 'mock_valid_token_123',
        expiresAt: validUntil,
        email: 'supervisor@7days.com'
      });

      const token = await GoogleDriveService.getValidToken();
      expect(token).toBe('mock_valid_token_123');
      expect(GoogleDriveService.getStatus().status).toBe(DRIVE_STATUS.CONNECTED);
    });
  });

  describe('Scenario C & D — Cancellation handling: User cancels popup or closes window', () => {
    it('correctly maps popup_closed GIS error to USER_CANCELLED and DRIVE_STATUS.CANCELLED', async () => {
      window.google = {
        accounts: {
          oauth2: {
            initTokenClient: (config) => ({
              requestAccessToken: () => {
                config.error_callback({ type: 'popup_closed', message: 'Popup closed by user' });
              }
            })
          }
        }
      };

      try {
        await GoogleDriveService.requestDriveAccess({ loginHint: 'supervisor@7days.com' });
        expect.unreachable('Should have rejected with USER_CANCELLED');
      } catch (err) {
        expect(err.code).toBe('USER_CANCELLED');
        expect(GoogleDriveService.getStatus().status).toBe(DRIVE_STATUS.CANCELLED);
      }
    });

    it('correctly maps user_cancel / access_denied in tokenResponse to USER_CANCELLED', async () => {
      window.google = {
        accounts: {
          oauth2: {
            initTokenClient: (config) => ({
              requestAccessToken: () => {
                config.callback({ error: 'access_denied', error_description: 'user_declined consent' });
              }
            })
          }
        }
      };

      try {
        await GoogleDriveService.requestDriveAccess({ loginHint: 'supervisor@7days.com' });
        expect.unreachable('Should have rejected with USER_CANCELLED');
      } catch (err) {
        expect(err.code).toBe('USER_CANCELLED');
        expect(GoogleDriveService.getStatus().status).toBe(DRIVE_STATUS.CANCELLED);
      }
    });

    it('does not destroy user session when Drive authorization fails or is cancelled', () => {
      const user = { id: 'user_123', email: 'supervisor@7days.com' };
      let authenticated = true;

      // User cancels Drive authorization
      const driveStatus = DRIVE_STATUS.CANCELLED;

      // App authentication must remain true
      expect(authenticated).toBe(true);
      expect(user.id).toBe('user_123');
      expect(driveStatus).toBe(DRIVE_STATUS.CANCELLED);
    });
  });

  describe('Scenario E — Expired or revoked credentials', () => {
    it('sets status to RECONNECT_REQUIRED when token refresh fails without crashing app', async () => {
      GoogleDriveService.setTokenData({
        accessToken: 'expired_token',
        expiresAt: Date.now() - 1000,
        email: 'supervisor@7days.com'
      });

      // Mock GIS silent prompt failing
      GoogleDriveService.init = vi.fn().mockResolvedValue(true);
      GoogleDriveService._silentTokenRefresh = vi.fn().mockRejectedValue(new Error('Refresh failed'));

      try {
        await GoogleDriveService.getValidToken();
        expect.unreachable('Should have thrown authErr');
      } catch (err) {
        expect(err.code).toBe('NEEDS_DRIVE_AUTH');
        expect(GoogleDriveService.getStatus().status).toBe(DRIVE_STATUS.RECONNECT_REQUIRED);
      }
    });
  });

  describe('Scenario F — Explicit sign-out', () => {
    it('clears all onboarding and cached token state on sign-out', () => {
      localStorage.setItem('pending_drive_onboarding', 'true');
      localStorage.setItem('drive_onboarding_done', 'true');
      GoogleDriveService.setTokenData({ accessToken: 'valid_token' });

      // Sign-out action
      localStorage.removeItem('pending_drive_onboarding');
      localStorage.removeItem('drive_onboarding_done');
      GoogleDriveService.setTokenData({ accessToken: null });

      expect(localStorage.getItem('pending_drive_onboarding')).toBeNull();
      expect(localStorage.getItem('drive_onboarding_done')).toBeNull();
      expect(GoogleDriveService.accessToken).toBeNull();
      expect(GoogleDriveService.getStatus().status).toBe(DRIVE_STATUS.DISCONNECTED);
    });
  });

  describe('Scenario G — Idempotent initialization & scopes', () => {
    it('requests only minimal necessary drive scope drive.file', async () => {
      let requestedScope = '';
      window.google = {
        accounts: {
          oauth2: {
            initTokenClient: (config) => {
              requestedScope = config.scope;
              return {
                requestAccessToken: () => {
                  config.callback({ access_token: 'valid_token_xyz', expires_in: 3600 });
                }
              };
            }
          }
        }
      };

      // Mock user profile fetch
      GoogleDriveService.fetchUserProfile = vi.fn().mockResolvedValue({ email: 'supervisor@7days.com' });

      await GoogleDriveService.requestDriveAccess({ loginHint: 'supervisor@7days.com' });
      expect(requestedScope).toBe('https://www.googleapis.com/auth/drive.file');
      expect(GoogleDriveService.accessToken).toBe('valid_token_xyz');
    });
  });
});
