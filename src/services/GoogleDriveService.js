import { Capacitor, registerPlugin } from '@capacitor/core';

const NativeGoogleAuth = registerPlugin('NativeGoogleAuth');

// Scope: drive.file — only files created/opened by this app
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

// Threshold above which we use resumable upload (5 MB)
const RESUMABLE_THRESHOLD_BYTES = 5 * 1024 * 1024;


export const DRIVE_STATUS = {
  CHECKING: 'CHECKING',
  CONNECTED: 'CONNECTED',
  TOKEN_REFRESHING: 'TOKEN_REFRESHING',
  OFFLINE: 'OFFLINE',
  RECONNECT_REQUIRED: 'RECONNECT_REQUIRED',
  PERMISSION_REVOKED: 'PERMISSION_REVOKED',
  ACCOUNT_MISMATCH: 'ACCOUNT_MISMATCH',
  CANCELLED: 'CANCELLED',
  ERROR: 'ERROR',
  DISCONNECTED: 'DISCONNECTED',
};

class GoogleDriveService {
  constructor() {
    this.tokenClient = null;
    this._accessToken = null;
    this._tokenExpiresAt = null; // timestamp (ms)
    this._tokenEmail = null;
    this.isInitialized = false;

    // Single-flight lock for token refresh/request
    this._tokenRefreshInProgress = false;
    this._tokenRefreshCallbacks = [];

    // State machine listeners
    this._statusListeners = new Set();
    this._currentStatus = DRIVE_STATUS.DISCONNECTED;
    this._statusDetails = '';

    // Auto-restore cached token from localStorage if valid
    try {
      if (typeof localStorage !== 'undefined') {
        const cached = localStorage.getItem('7days_drive_token');
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.accessToken && (!parsed.expiresAt || Date.now() < parsed.expiresAt)) {
            this._accessToken = parsed.accessToken;
            this._tokenExpiresAt = parsed.expiresAt;
            this._tokenEmail = parsed.email || null;
            this._currentStatus = DRIVE_STATUS.CONNECTED;
          }
        }
      }
    } catch (_e) {}
  }

  // ─── Status & State Machine ──────────────────────────────────────────────────

  getStatus() {
    return {
      status: this._currentStatus,
      email: this._tokenEmail,
      expiresAt: this._tokenExpiresAt,
      details: this._statusDetails,
    };
  }

  setStatus(status, details = '', email = undefined) {
    this._currentStatus = status;
    this._statusDetails = details;
    if (email !== undefined) {
      this._tokenEmail = email;
    }
    this._notifyStatus();
  }

  subscribeStatus(listener) {
    this._statusListeners.add(listener);
    listener(this.getStatus());
    return () => this._statusListeners.delete(listener);
  }

  _notifyStatus() {
    const state = this.getStatus();
    this._statusListeners.forEach((listener) => {
      try {
        listener(state);
      } catch (err) {
        console.error('Error in drive status listener:', err);
      }
    });
  }

  // ─── Token management ──────────────────────────────────────────────────────

  get accessToken() {
    return this._accessToken;
  }

  get tokenEmail() {
    return this._tokenEmail;
  }

  setTokenData({ accessToken, expiresInSec = 3600, expiresAt = null, email = null }) {
    this._accessToken = accessToken || null;
    if (accessToken) {
      if (expiresAt) {
        this._tokenExpiresAt = expiresAt;
      } else {
        // Expire with a 5-minute safety buffer
        const bufferMs = 5 * 60 * 1000;
        const durationMs = Math.max((expiresInSec * 1000) - bufferMs, 60 * 1000);
        this._tokenExpiresAt = Date.now() + durationMs;
      }
      if (email) {
        this._tokenEmail = email;
      }

      // Persist to localStorage for uninterrupted sessions across refreshes & syncs
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('7days_drive_token', JSON.stringify({
            accessToken: this._accessToken,
            expiresAt: this._tokenExpiresAt,
            email: this._tokenEmail,
          }));
        }
      } catch (_e) {}

      this.setStatus(DRIVE_STATUS.CONNECTED, '', this._tokenEmail);
    } else {
      this._tokenExpiresAt = null;
      this._tokenEmail = null;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('7days_drive_token');
        }
      } catch (_e) {}
      this.setStatus(DRIVE_STATUS.DISCONNECTED, '', null);
    }
  }

  isTokenValid() {
    if (!this._accessToken) return false;
    if (!this._tokenExpiresAt) return true;
    return Date.now() < this._tokenExpiresAt;
  }

  /**
   * Returns a valid access token, or throws with code 'NEEDS_DRIVE_AUTH'
   * if the user needs to re-authorize Drive.
   * Employs a single-flight mutex so parallel uploads do not trigger race conditions.
   */
  async getValidToken() {
    if (this.isTokenValid()) return this._accessToken;

    if (!navigator.onLine) {
      this.setStatus(DRIVE_STATUS.OFFLINE, 'Internet connection offline');
      const offlineErr = new Error('Network offline');
      offlineErr.code = 'NETWORK_OFFLINE';
      throw offlineErr;
    }

    // Single-flight queue
    if (this._tokenRefreshInProgress) {
      return new Promise((resolve, reject) => {
        this._tokenRefreshCallbacks.push({ resolve, reject });
      });
    }

    this._tokenRefreshInProgress = true;
    this.setStatus(DRIVE_STATUS.TOKEN_REFRESHING, 'Refreshing Drive access token...');

    try {
      await this.init();
      const tokenResponse = await this._silentTokenRefresh();
      
      const expiresInSec = tokenResponse.expires_in ? parseInt(tokenResponse.expires_in, 10) : 3600;
      this.setTokenData({
        accessToken: tokenResponse.access_token,
        expiresInSec,
        email: this._tokenEmail
      });

      // Verify connection and verify identity if needed
      await this.verifyConnection();

      this._tokenRefreshCallbacks.forEach(cb => cb.resolve(this._accessToken));
      this._tokenRefreshCallbacks = [];
      this._tokenRefreshInProgress = false;
      return this._accessToken;
    } catch (err) {
      this._tokenRefreshInProgress = false;
      const isOffline = !navigator.onLine || err.message?.includes('network') || err.message?.includes('Failed to fetch');
      
      if (isOffline) {
        this.setStatus(DRIVE_STATUS.OFFLINE, 'Network connection unavailable');
        this._tokenRefreshCallbacks.forEach(cb => cb.reject(err));
        this._tokenRefreshCallbacks = [];
        throw err;
      }

      this.setStatus(DRIVE_STATUS.RECONNECT_REQUIRED, err.message || 'Authorization expired');
      const authErr = new Error('Google Drive authorization expired or revoked. Please reconnect.');
      authErr.code = 'NEEDS_DRIVE_AUTH';
      authErr.originalError = err;
      this._tokenRefreshCallbacks.forEach(cb => cb.reject(authErr));
      this._tokenRefreshCallbacks = [];
      throw authErr;
    }
  }

  _silentTokenRefresh() {
    if (Capacitor.isNativePlatform()) {
      return new Promise(async (resolve, reject) => {
        try {
          if (this._accessToken) {
            await NativeGoogleAuth.clearDriveToken({ token: this._accessToken }).catch(() => {});
          }
          const res = await NativeGoogleAuth.getDriveAccessToken();
          if (res?.accessToken) {
            resolve({
              access_token: res.accessToken,
              email: res.email || this._tokenEmail,
              expires_in: res.expiresIn || 3600,
            });
          } else {
            reject(new Error('Native silent Drive renewal returned no token'));
          }
        } catch (err) {
          reject(err);
        }
      });
    }

    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        reject(new Error('GIS not initialized'));
        return;
      }

      if (!this.tokenClient) {
        this._buildTokenClient();
      }

      const originalCallback = this.tokenClient.callback;
      const originalErrorCallback = this.tokenClient.error_callback;

      this.tokenClient.callback = (tokenResponse) => {
        this.tokenClient.callback = originalCallback;
        this.tokenClient.error_callback = originalErrorCallback;
        if (tokenResponse?.access_token) {
          resolve(tokenResponse);
        } else {
          const err = new Error(tokenResponse?.error || 'Failed to silently renew Drive access');
          reject(err);
        }
      };

      this.tokenClient.error_callback = (err) => {
        this.tokenClient.callback = originalCallback;
        this.tokenClient.error_callback = originalErrorCallback;
        reject(err);
      };

      // prompt: '' enables silent renewal without modal when user has previously granted consent
      const requestConfig = { prompt: '' };
      if (this._tokenEmail) {
        requestConfig.hint = this._tokenEmail;
      }
      this.tokenClient.requestAccessToken(requestConfig);
    });
  }

  get clientId() {
    const envId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (envId && envId.includes('.apps.googleusercontent.com')) {
      const cleaned = envId.split('.com')[0] + '.com';
      return cleaned.trim();
    }
    return '611802862463-c1ak7q81p66o4nodgfhnlq1dthcrfq3p.apps.googleusercontent.com';
  }

  get apiKey() {
    return import.meta.env.VITE_GOOGLE_API_KEY;
  }

  // ─── Initialization ─────────────────────────────────────────────────────────

  loadGisScript() {
    return new Promise((resolve, reject) => {
      if (window.google?.accounts?.oauth2) {
        resolve();
        return;
      }
      const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
      if (existing) {
        existing.addEventListener('load', resolve);
        existing.addEventListener('error', reject);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
      document.body.appendChild(script);
    });
  }

  async init() {
    if (Capacitor.isNativePlatform()) {
      this.isInitialized = true;
      return;
    }
    if (this.isInitialized && window.google?.accounts?.oauth2) return;
    try {
      await this.loadGisScript();
      this.isInitialized = true;
      this._buildTokenClient();
    } catch (error) {
      console.error('Failed to load Google Identity Services:', error);
      throw new Error('Could not load Google authentication service.');
    }
  }

  _buildTokenClient(customCallback = null, customErrorCallback = null) {
    if (!window.google?.accounts?.oauth2) return null;
    this.tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: this.clientId,
      scope: SCOPES,
      callback: (tokenResponse) => {
        if (customCallback) customCallback(tokenResponse);
      },
      error_callback: (error) => {
        if (customErrorCallback) customErrorCallback(error);
      }
    });
    return this.tokenClient;
  }

  /**
   * Interactive Drive authorization request.
   * Can pass { loginHint, prompt }
   */
  requestDriveAccess({ loginHint = null, prompt = 'consent' } = {}) {
    if (Capacitor.isNativePlatform()) {
      return new Promise(async (resolve, reject) => {
        try {
          const res = await NativeGoogleAuth.getDriveAccessToken();
          if (res?.accessToken) {
            const expiresInSec = res.expiresIn || 3600;
            const email = res.email || loginHint || this._tokenEmail;

            this.setTokenData({
              accessToken: res.accessToken,
              expiresInSec,
              email,
            });

            this.setStatus(DRIVE_STATUS.CONNECTED, '', email);
            resolve({
              access_token: res.accessToken,
              email,
              expires_in: expiresInSec,
            });
          } else {
            const err = new Error('Native Drive authorization returned no token');
            this.setStatus(DRIVE_STATUS.ERROR, err.message);
            reject(err);
          }
        } catch (err) {
          if (err?.code === 'USER_CANCELLED' || err?.message?.includes('cancelled') || err?.message?.includes('CANCELLED')) {
            this.setStatus(DRIVE_STATUS.CANCELLED, 'Drive authorization was cancelled by the user');
            const cancelErr = new Error('Authorization was cancelled.');
            cancelErr.code = 'USER_CANCELLED';
            reject(cancelErr);
          } else {
            this.setStatus(DRIVE_STATUS.ERROR, err?.message || 'Drive connection error');
            reject(err);
          }
        }
      });
    }

    return new Promise((resolve, reject) => {
      this.init().then(() => {
        if (!this.clientId) {
          reject(new Error('VITE_GOOGLE_CLIENT_ID is not configured.'));
          return;
        }

        this.tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: this.clientId,
          scope: SCOPES,
          callback: async (tokenResponse) => {
            if (tokenResponse?.access_token) {
              const expiresInSec = tokenResponse.expires_in ? parseInt(tokenResponse.expires_in, 10) : 3600;
              this.setTokenData({
                accessToken: tokenResponse.access_token,
                expiresInSec,
              });

              // Fetch user profile from Google to get the authorized Google email
              try {
                const profile = await this.fetchUserProfile(tokenResponse.access_token);
                if (profile?.email) {
                  this._tokenEmail = profile.email;
                }
              } catch (profileErr) {
                console.warn('Could not fetch Google profile email:', profileErr);
                if (loginHint) this._tokenEmail = loginHint;
              }

              this.setStatus(DRIVE_STATUS.CONNECTED, '', this._tokenEmail);
              resolve({
                ...tokenResponse,
                email: this._tokenEmail,
              });
            } else {
              const errorDesc = tokenResponse?.error_description || tokenResponse?.error || 'Failed to obtain access token';
              const isCancelled = errorDesc.includes('cancel') || errorDesc.includes('user_declined') || errorDesc.includes('closed') || errorDesc.includes('access_denied');
              if (isCancelled) {
                this.setStatus(DRIVE_STATUS.CANCELLED, 'Drive authorization was cancelled by the user');
                const cancelErr = new Error('Authorization was cancelled.');
                cancelErr.code = 'USER_CANCELLED';
                reject(cancelErr);
              } else {
                this.setStatus(DRIVE_STATUS.ERROR, errorDesc);
                reject(new Error(errorDesc));
              }
            }
          },
          error_callback: (error) => {
            console.error('GIS Error callback:', error);
            const errType = error?.type || '';
            const isDismissed = errType === 'popup_closed' || errType === 'user_cancel' || error?.message?.includes('closed');
            if (isDismissed) {
              this.setStatus(DRIVE_STATUS.CANCELLED, 'Sign-in popup was closed');
              const cancelErr = new Error('Sign-in popup was closed.');
              cancelErr.code = 'USER_CANCELLED';
              reject(cancelErr);
            } else {
              this.setStatus(DRIVE_STATUS.ERROR, error?.message || 'Drive authorization failed');
              reject(error);
            }
          }
        });

        const reqOptions = { prompt };
        if (loginHint) {
          reqOptions.hint = loginHint;
        }
        this.tokenClient.requestAccessToken(reqOptions);
      }).catch(reject);
    });
  }

  async fetchUserProfile(token) {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      throw new Error('Failed to retrieve user profile from Google');
    }
    return await res.json();
  }

  async verifyConnection() {
    this.setStatus(DRIVE_STATUS.CHECKING);
    try {
      const token = this._accessToken;
      if (!token) throw new Error('No access token available');
      
      const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.status === 401) {
        // Expired or invalid token
        const err = new Error('Token expired');
        err.status = 401;
        throw err;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error?.message || `Google Drive check failed (${res.status})`);
      }

      const data = await res.json();
      if (data.user?.emailAddress) {
        this._tokenEmail = data.user.emailAddress;
      }

      this.setStatus(DRIVE_STATUS.CONNECTED, '', this._tokenEmail);
      return data;
    } catch (err) {
      if (err.status === 401) {
        this.setStatus(DRIVE_STATUS.RECONNECT_REQUIRED, 'Authorization expired');
      } else if (!navigator.onLine) {
        this.setStatus(DRIVE_STATUS.OFFLINE, 'Network offline');
      } else {
        this.setStatus(DRIVE_STATUS.ERROR, err.message);
      }
      throw err;
    }
  }

  revokeAccess() {
    if (this._accessToken && window.google?.accounts?.oauth2) {
      try {
        window.google.accounts.oauth2.revoke(this._accessToken, () => {
          console.log('Drive access token revoked successfully');
        });
      } catch (e) {
        console.warn('Revoke token error:', e);
      }
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('7days_drive_token');
      }
    } catch (_e) {}
    this._accessToken = null;
    this._tokenExpiresAt = null;
    this._tokenEmail = null;
    this.setStatus(DRIVE_STATUS.DISCONNECTED);
  }

  requestAccessToken(options = {}) {
    return this.requestDriveAccess(options);
  }

  // ─── Folder management ───────────────────────────────────────────────────────

  /**
   * Helper that executes a Drive API call with automatic 401 retry, 429 backoff,
   * exponential backoff with jitter, and explicit request timeout via AbortController.
   */
  async _fetchWithRetry(url, options = {}, retries = 2, timeoutMs = 25000) {
    let token = await this.getValidToken();
    let res;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const headers = {
          ...(options.headers || {}),
          Authorization: `Bearer ${token}`,
        };

        res = await fetch(url, {
          ...options,
          headers,
          signal: options.signal || controller.signal,
        });
        clearTimeout(timer);

        if (res.status === 401 && attempt < retries) {
          // Token might have expired during request; force refresh and retry once
          this._accessToken = null;
          this._tokenExpiresAt = null;
          token = await this.getValidToken();
          continue;
        }

        // Handle 429 Too Many Requests / Rate Limiting
        if (res.status === 429 && attempt < retries) {
          const retryAfterHeader = res.headers?.get('Retry-After');
          const delaySec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : (attempt + 1) * 2;
          const jitter = Math.random() * 500;
          await new Promise(r => setTimeout(r, (delaySec * 1000) + jitter));
          continue;
        }

        // Retry transient server errors 408, 500, 502, 503, 504
        if ([408, 500, 502, 503, 504].includes(res.status) && attempt < retries) {
          const backoff = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 400, 8000);
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }

        return res;
      } catch (err) {
        clearTimeout(timer);
        const isTimeout = err.name === 'AbortError' || err.message?.includes('timeout') || err.message?.includes('aborted');
        const isOffline = (typeof navigator !== 'undefined' && !navigator.onLine);

        if (isOffline) {
          this.setStatus(DRIVE_STATUS.OFFLINE, 'Network disconnected');
          const offErr = new Error('Network connection offline');
          offErr.code = 'NETWORK_OFFLINE';
          throw offErr;
        }

        if (attempt === retries) {
          if (isTimeout) {
            const timeoutErr = new Error(`Request timed out after ${timeoutMs}ms`);
            timeoutErr.code = 'TIMEOUT';
            throw timeoutErr;
          }
          throw err;
        }

        // Exponential backoff with jitter for retries
        const backoff = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 8000);
        await new Promise(r => setTimeout(r, backoff));
      }
    }
    return res;
  }

  /**
   * Get or create a Drive folder by name under an optional parent.
   */
  async getOrCreateFolder(folderName, parentId = null, aliases = []) {
    const candidateNames = [folderName, ...(aliases || [])];

    for (const name of candidateNames) {
      let q = `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
      if (parentId) q += ` and '${parentId}' in parents`;

      const searchRes = await this._fetchWithRetry(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&spaces=drive&fields=files(id,name)`
      );
      const searchData = await searchRes.json();
      if (!searchRes.ok) throw new Error(searchData.error?.message || 'Drive search failed');

      if (searchData.files?.length > 0) return searchData.files[0].id;
    }

    const metadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId && { parents: [parentId] })
    };

    const res = await this._fetchWithRetry('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata)
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error?.message || 'Drive folder creation failed');
    return data.id;
  }

  /**
   * Helper to check if a folder exists under a parent.
   */
  async _checkFolderExists(folderName, parentId) {
    try {
      const q = `name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
      const res = await this._fetchWithRetry(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&spaces=drive&fields=files(id,name)`
      );
      const data = await res.json();
      return data.files?.[0]?.id || null;
    } catch {
      return null;
    }
  }

  /**
   * Build the full inspection folder structure and return folder IDs.
   * Clean, easily readable folder structure:
   * 7Days Field
   *   └── Inspections
   *        └── [Property Name]
   *             ├── Data
   *             ├── Photo
   *             ├── Video
   *             ├── Location Verification
   *             ├── Signature
   *             └── Plot Area
   */
  async ensureInspectionFolders({ propertyId, propertyName, inspectionId, inspection = null }) {
    const root = await this.getOrCreateFolder('7Days Field', null, ['7days field', '7DaysField']);
    const inspectionsRoot = await this.getOrCreateFolder('Inspections', root, ['Inspection', 'inspections']);

    const isUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str || '');

    let cleanPropName = (propertyName || inspection?.title || '').trim();
    if (!cleanPropName || isUUID(cleanPropName)) {
      const shortId = propertyId ? (isUUID(propertyId) ? propertyId.slice(0, 8).toUpperCase() : propertyId) : '1';
      cleanPropName = `Property - ${shortId}`;
    }

    // Clean folder label without forbidden characters
    const propertyFolderLabel = cleanPropName.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 60);

    // Support legacy folder names if one already exists
    const legacyAliases = [];
    if (propertyId) {
      legacyAliases.push(`${cleanPropName} - ${propertyId}`.substring(0, 60));
      legacyAliases.push(`Property - ${propertyId}`);
    }

    const propertyFolder = await this.getOrCreateFolder(propertyFolderLabel, inspectionsRoot, legacyAliases);

    // If an existing legacy inspectionId subfolder exists under propertyFolder, reuse it;
    // otherwise the clean propertyFolder itself is the inspectionFolder!
    let inspectionFolder = propertyFolder;
    if (inspectionId && isUUID(inspectionId)) {
      const legacySub = await this._checkFolderExists(inspectionId, propertyFolder);
      if (legacySub) {
        inspectionFolder = legacySub;
      }
    }

    const [dataFolder, photosFolder, videosFolder, locationFolder, signaturesFolder, boundaryFolder] = await Promise.all([
      this.getOrCreateFolder('Data', inspectionFolder, ['data']),
      this.getOrCreateFolder('Photo', inspectionFolder, ['Photos', 'photo', 'photos']),
      this.getOrCreateFolder('Video', inspectionFolder, ['Videos', 'video', 'videos']),
      this.getOrCreateFolder('Location Verification', inspectionFolder, ['location verification', 'Location', 'location']),
      this.getOrCreateFolder('Signature', inspectionFolder, ['Signatures', 'signature', 'signatures']),
      this.getOrCreateFolder('Plot Area', inspectionFolder, ['plot area', 'Plot Area (Property Boundary)', 'PlotArea']),
    ]);

    return {
      root,
      inspectionsRoot,
      propertyFolder,
      inspectionFolder,
      dataFolder,
      photosFolder,
      videosFolder,
      locationFolder,
      signaturesFolder,
      boundaryFolder,
      otherFolder: inspectionFolder
    };
  }

  /**
   * Check if a file with the given name already exists under a parent folder.
   */
  async findExistingFile(filename, parentFolderId) {
    const q = `name='${filename}' and '${parentFolderId}' in parents and trashed=false`;
    const res = await this._fetchWithRetry(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,webViewLink)&spaces=drive`
    );
    const data = await res.json();
    if (!res.ok) return null;
    return data.files?.[0] || null;
  }

  // ─── Upload ──────────────────────────────────────────────────────────────────

  async uploadFile(fileBlob, filename, mimeType, parentFolderId, onProgress = null) {
    if (fileBlob.size >= RESUMABLE_THRESHOLD_BYTES) {
      return this.uploadFileResumable(fileBlob, filename, mimeType, parentFolderId, onProgress);
    }
    return this.uploadFileMultipart(fileBlob, filename, mimeType, parentFolderId);
  }

  async uploadFileMultipart(fileBlob, filename, mimeType, parentFolderId) {
    const metadata = {
      name: filename,
      mimeType,
      parents: [parentFolderId]
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', fileBlob);

    const res = await this._fetchWithRetry(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,webContentLink',
      { method: 'POST', body: form }
    );
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error?.message || 'Drive multipart upload failed');
    return data;
  }

  async uploadFileResumable(fileBlob, filename, mimeType, parentFolderId, onProgress = null) {
    let token = await this.getValidToken();

    // Step 1: Initiate session with retry
    const metadata = { name: filename, mimeType, parents: [parentFolderId] };
    const initRes = await this._fetchWithRetry(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink,webContentLink',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': fileBlob.size,
        },
        body: JSON.stringify(metadata)
      }
    );

    if (!initRes.ok) {
      const err = await initRes.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Failed to initiate resumable upload');
    }

    const uploadUrl = initRes.headers.get('Location');
    if (!uploadUrl) throw new Error('No upload session URL returned from Drive');

    // Step 2: Upload in chunks
    const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB
    let offset = 0;
    let fileData = null;

    while (offset < fileBlob.size) {
      const chunk = fileBlob.slice(offset, offset + CHUNK_SIZE);
      const end = Math.min(offset + CHUNK_SIZE, fileBlob.size) - 1;

      const chunkRes = await this._uploadChunkWithRetry(uploadUrl, chunk, offset, end, fileBlob.size, token);

      if (chunkRes.status === 200 || chunkRes.status === 201) {
        fileData = await chunkRes.json();
        break;
      } else if (chunkRes.status === 308) {
        const rangeHeader = chunkRes.headers.get('Range');
        if (rangeHeader) {
          const match = rangeHeader.match(/bytes=0-(\d+)/);
          if (match) offset = parseInt(match[1], 10) + 1;
          else offset = end + 1;
        } else {
          offset = end + 1;
        }
        if (onProgress) onProgress({ loaded: offset, total: fileBlob.size, percent: Math.round((offset / fileBlob.size) * 100) });
      } else if (chunkRes.status === 401) {
        // Token expired during chunk upload
        this._accessToken = null;
        token = await this.getValidToken();
        continue;
      } else {
        const errBody = await chunkRes.json().catch(() => ({}));
        throw new Error(errBody.error?.message || `Chunk upload failed with status ${chunkRes.status}`);
      }
    }

    if (!fileData) throw new Error('Resumable upload completed but no file data returned');
    if (onProgress) onProgress({ loaded: fileBlob.size, total: fileBlob.size, percent: 100 });
    return fileData;
  }

  async _uploadChunkWithRetry(uploadUrl, chunk, start, end, total, token, maxRetries = 3, chunkTimeoutMs = 60000) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), chunkTimeoutMs);

      try {
        const res = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Content-Type': 'application/octet-stream',
          },
          body: chunk,
          signal: controller.signal
        });
        clearTimeout(timer);

        if (res.status === 308 || res.status === 200 || res.status === 201) return res;

        // Rate limit 429
        if (res.status === 429 && attempt < maxRetries) {
          const retryAfter = res.headers?.get('Retry-After');
          const delaySec = retryAfter ? parseInt(retryAfter, 10) : (attempt + 1) * 2;
          await new Promise(r => setTimeout(r, (delaySec * 1000) + (Math.random() * 500)));
          continue;
        }

        // Server errors
        if ([408, 500, 502, 503, 504].includes(res.status) && attempt < maxRetries) {
          const backoff = Math.min(Math.pow(2, attempt) * 1000 + (Math.random() * 400), 8000);
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }

        return res;
      } catch (netErr) {
        clearTimeout(timer);
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          this.setStatus(DRIVE_STATUS.OFFLINE, 'Upload interrupted: device offline');
          const offErr = new Error('Upload interrupted: device offline');
          offErr.code = 'NETWORK_OFFLINE';
          throw offErr;
        }
        if (attempt === maxRetries) throw netErr;
        const backoff = Math.min(Math.pow(2, attempt) * 1000 + (Math.random() * 500), 8000);
        await new Promise(r => setTimeout(r, backoff));
      }
    }
  }

  async uploadJson(data, filename, parentFolderId) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    return this.uploadFileMultipart(blob, filename, 'application/json', parentFolderId);
  }
}

export default new GoogleDriveService();
