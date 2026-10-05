// Scope: drive.file — only files created/opened by this app
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

// Threshold above which we use resumable upload (5 MB)
const RESUMABLE_THRESHOLD_BYTES = 5 * 1024 * 1024;

class GoogleDriveService {
  constructor() {
    this.tokenClient = null;
    this._accessToken = null;
    this._tokenExpiresAt = null; // timestamp (ms)
    this.isInitialized = false;
    // Listeners waiting for a new token
    this._tokenRefreshCallbacks = [];
    this._tokenRefreshInProgress = false;
  }

  // ─── Token management ──────────────────────────────────────────────────────

  get accessToken() {
    return this._accessToken;
  }

  set accessToken(token) {
    this._accessToken = token;
    if (token) {
      // Google OAuth tokens live ~1 hour; track expiry with a 5-min safety margin
      this._tokenExpiresAt = Date.now() + 55 * 60 * 1000;
    } else {
      this._tokenExpiresAt = null;
    }
  }

  isTokenValid() {
    if (!this._accessToken) return false;
    if (!this._tokenExpiresAt) return true; // provider_token from Supabase – assume valid
    return Date.now() < this._tokenExpiresAt;
  }

  /**
   * Returns a valid access token, or throws with code 'NEEDS_DRIVE_AUTH'
   * if the user needs to re-authorize Drive.
   */
  async getValidToken() {
    if (this.isTokenValid()) return this._accessToken;

    // If a refresh is already in progress, queue up
    if (this._tokenRefreshInProgress) {
      return new Promise((resolve, reject) => {
        this._tokenRefreshCallbacks.push({ resolve, reject });
      });
    }

    // Try to request a new token silently (no prompt)
    try {
      await this._silentTokenRefresh();
      return this._accessToken;
    } catch (err) {
      const authErr = new Error('Google Drive authorization expired. Please reconnect.');
      authErr.code = 'NEEDS_DRIVE_AUTH';
      throw authErr;
    }
  }

  _silentTokenRefresh() {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized || !this.tokenClient) {
        reject(new Error('GIS not initialized'));
        return;
      }
      this._tokenRefreshInProgress = true;

      const originalCallback = this.tokenClient.callback;
      this.tokenClient.callback = (tokenResponse) => {
        this._tokenRefreshInProgress = false;
        if (tokenResponse?.access_token) {
          this.accessToken = tokenResponse.access_token;
          this._tokenRefreshCallbacks.forEach(cb => cb.resolve(this._accessToken));
          this._tokenRefreshCallbacks = [];
          resolve(tokenResponse);
        } else {
          const err = new Error('Failed to silently refresh Drive token');
          this._tokenRefreshCallbacks.forEach(cb => cb.reject(err));
          this._tokenRefreshCallbacks = [];
          reject(err);
        }
        this.tokenClient.callback = originalCallback;
      };

      // prompt: '' means no consent screen if already granted
      this.tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  get clientId() {
    // Hardcoded to ensure we always use the Web Client ID for GIS, 
    // regardless of what is in the .env file.
    return '611802862463-c1ak7q81p66o4nodgfhnlq1dthcrfq3p.apps.googleusercontent.com';
  }

  get apiKey() {
    return import.meta.env.VITE_GOOGLE_API_KEY;
  }

  // ─── Initialization ─────────────────────────────────────────────────────────

  loadGisScript() {
    return new Promise((resolve, reject) => {
      if (window.google?.accounts) { resolve(); return; }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = reject;
      document.body.appendChild(script);
    });
  }

  async init() {
    if (this.isInitialized) return;
    try {
      await this.loadGisScript();
      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to load Google Identity Services', error);
      throw new Error('Could not load Google authentication service.');
    }
  }

  requestDriveAccess() {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) { reject(new Error('GIS not initialized')); return; }
      if (!this.clientId) { reject(new Error('VITE_GOOGLE_CLIENT_ID is not set.')); return; }

      this.tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: SCOPES,
        callback: (tokenResponse) => {
          if (tokenResponse?.access_token) {
            this.accessToken = tokenResponse.access_token;
            resolve(tokenResponse);
          } else {
            reject(new Error('Failed to obtain access token'));
          }
        },
        error_callback: (error) => { reject(error); }
      });

      this.tokenClient.requestAccessToken({ prompt: 'consent' });
    });
  }

  revokeAccess() {
    if (this._accessToken && window.google) {
      window.google.accounts.oauth2.revoke(this._accessToken, () => {
        console.log('Drive access revoked');
      });
    }
    this._accessToken = null;
    this._tokenExpiresAt = null;
  }

  // ─── Folder management ───────────────────────────────────────────────────────

  /**
   * Get or create a Drive folder by name under an optional parent.
   * Uses a stable ID stored in the folder itself to prevent duplicates.
   */
  async getOrCreateFolder(folderName, parentId = null) {
    const token = await this.getValidToken();

    let q = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    if (parentId) q += ` and '${parentId}' in parents`;

    const searchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&spaces=drive&fields=files(id,name)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const searchData = await searchRes.json();
    if (!searchRes.ok) throw new Error(searchData.error?.message || 'Drive search failed');

    if (searchData.files?.length > 0) return searchData.files[0].id;

    const metadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId && { parents: [parentId] })
    };

    const res = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata)
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error?.message || 'Drive folder creation failed');
    return data.id;
  }

  /**
   * Build the full inspection folder structure and return folder IDs.
   * My Drive / 7Days Field / Inspections / <propertyLabel> / <inspectionId>
   *   Photos / Videos / Signatures / Other
   */
  async ensureInspectionFolders({ propertyId, propertyName, inspectionId }) {
    const root = await this.getOrCreateFolder('7Days Field');
    const inspectionsRoot = await this.getOrCreateFolder('Inspections', root);
    const propertyLabel = propertyName
      ? `${propertyName} - ${propertyId}`.substring(0, 60)
      : `Property - ${propertyId}`;
    const propertyFolder = await this.getOrCreateFolder(propertyLabel, inspectionsRoot);
    const inspectionFolder = await this.getOrCreateFolder(inspectionId, propertyFolder);

    const [photosFolder, videosFolder, signaturesFolder, otherFolder] = await Promise.all([
      this.getOrCreateFolder('Photos', inspectionFolder),
      this.getOrCreateFolder('Videos', inspectionFolder),
      this.getOrCreateFolder('Signatures', inspectionFolder),
      this.getOrCreateFolder('Other', inspectionFolder),
    ]);

    return { root, inspectionsRoot, propertyFolder, inspectionFolder, photosFolder, videosFolder, signaturesFolder, otherFolder };
  }

  /**
   * Check if a file with the given name already exists under a parent folder.
   * Returns the existing file's { id, webViewLink } or null.
   */
  async findExistingFile(filename, parentFolderId) {
    const token = await this.getValidToken();
    const q = `name='${filename}' and '${parentFolderId}' in parents and trashed=false`;
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,webViewLink)&spaces=drive`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    if (!res.ok) return null;
    return data.files?.[0] || null;
  }

  // ─── Upload ──────────────────────────────────────────────────────────────────

  /**
   * Upload a file to Drive. Automatically chooses resumable for large files.
   * @param {Blob} fileBlob
   * @param {string} filename
   * @param {string} mimeType
   * @param {string} parentFolderId
   * @param {function} onProgress  - called with { loaded, total, percent }
   * @returns {{ id, webViewLink, webContentLink }}
   */
  async uploadFile(fileBlob, filename, mimeType, parentFolderId, onProgress = null) {
    if (fileBlob.size >= RESUMABLE_THRESHOLD_BYTES) {
      return this.uploadFileResumable(fileBlob, filename, mimeType, parentFolderId, onProgress);
    }
    return this.uploadFileMultipart(fileBlob, filename, mimeType, parentFolderId);
  }

  async uploadFileMultipart(fileBlob, filename, mimeType, parentFolderId) {
    const token = await this.getValidToken();

    const metadata = {
      name: filename,
      mimeType,
      parents: [parentFolderId]
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', fileBlob);

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,webContentLink',
      { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }
    );
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error?.message || 'Drive multipart upload failed');
    return data;
  }

  /**
   * Resumable upload — safe for large videos on mobile networks.
   * Uploads in 5 MB chunks with retry on each chunk.
   */
  async uploadFileResumable(fileBlob, filename, mimeType, parentFolderId, onProgress = null) {
    const token = await this.getValidToken();

    // Step 1: Initiate session
    const metadata = { name: filename, mimeType, parents: [parentFolderId] };
    const initRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink,webContentLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
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
    let fileData = null; // { id, webViewLink }

    while (offset < fileBlob.size) {
      const chunk = fileBlob.slice(offset, offset + CHUNK_SIZE);
      const end = Math.min(offset + CHUNK_SIZE, fileBlob.size) - 1;

      const chunkRes = await this._uploadChunkWithRetry(uploadUrl, chunk, offset, end, fileBlob.size, token);

      if (chunkRes.status === 200 || chunkRes.status === 201) {
        // Upload complete
        fileData = await chunkRes.json();
        break;
      } else if (chunkRes.status === 308) {
        // Incomplete — advance offset
        const rangeHeader = chunkRes.headers.get('Range');
        if (rangeHeader) {
          const match = rangeHeader.match(/bytes=0-(\d+)/);
          if (match) offset = parseInt(match[1]) + 1;
          else offset = end + 1;
        } else {
          offset = end + 1;
        }
        if (onProgress) onProgress({ loaded: offset, total: fileBlob.size, percent: Math.round((offset / fileBlob.size) * 100) });
      } else {
        const errBody = await chunkRes.json().catch(() => ({}));
        throw new Error(errBody.error?.message || `Chunk upload failed with status ${chunkRes.status}`);
      }
    }

    if (!fileData) throw new Error('Resumable upload completed but no file data returned');
    if (onProgress) onProgress({ loaded: fileBlob.size, total: fileBlob.size, percent: 100 });
    return fileData;
  }

  async _uploadChunkWithRetry(uploadUrl, chunk, start, end, total, token, maxRetries = 3) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Content-Type': 'application/octet-stream',
          },
          body: chunk
        });
        // 308, 200, 201 are all valid
        if (res.status === 308 || res.status === 200 || res.status === 201) return res;
        if (res.status === 503 || res.status === 500) {
          // Retry on server errors
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
          continue;
        }
        return res; // Return other statuses for caller to handle
      } catch (netErr) {
        if (attempt === maxRetries) throw netErr;
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }
  }

  // ─── Utility ──────────────────────────────────────────────────────────────────

  async uploadJson(data, filename, parentFolderId) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    return this.uploadFileMultipart(blob, filename, 'application/json', parentFolderId);
  }
}

export default new GoogleDriveService();
