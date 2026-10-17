/**
 * SyncEngine — Fast, Reliable, Bounded-Concurrency Offline-First Synchronization.
 *
 * Full lifecycle per inspection:
 *  STEP 1 — Upsert field_inspections record in Supabase (Establish server identity)
 *  STEP 2 — Upsert field_inspection_media rows (upload_status = pending)
 *  STEP 3 — Ensure Drive folder structure exists (Photos, Videos, Signatures, Plot Area)
 *  STEP 4 — Concurrent upload of media files with bounded concurrency (default: 3)
 *  STEP 4.5 — Upload boundary snapshot (if present)
 *  STEP 5 — Write optional inspection summary JSON to Drive
 *  STEP 6 — Verify all files are confirmed, mark inspection sync_status = SYNCED
 *
 * Media state machine:
 *   queued → authorizing → uploading → confirming → uploaded
 *                                                  → retry_wait
 *                                                  → failed
 */

import { supabase } from '../../lib/supabase';
import MediaRepository from './MediaRepository';
import InspectionRepository from './InspectionRepository';
import SyncJobRepository from './SyncJobRepository';
import BoundaryRepository from './BoundaryRepository';
import ConnectivityService from './ConnectivityService';
import GoogleDriveService from '../GoogleDriveService';

/**
 * Lightweight in-memory bounded concurrency worker queue.
 */
class BoundedQueue {
  constructor(concurrency = 3) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }

  add(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this._next();
    });
  }

  _next() {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const { fn, resolve, reject } = this.queue.shift();
      this.running++;
      fn()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          this.running--;
          this._next();
        });
    }
  }
}

class SyncEngine {
  constructor() {
    this.isSyncing = false;
    this.concurrency = 3;
    this._progressListeners = new Set();
    this._inFlightMediaIds = new Set();
    this._activeProgress = new Map(); // mediaId -> { loaded, total, percent, status }

    ConnectivityService.subscribe((isOnline) => {
      if (isOnline && !this.isSyncing) {
        this.startSync();
      }
    });
  }

  setConcurrency(limit) {
    this.concurrency = Math.max(1, Math.min(limit, 6));
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  async enqueueInspection(inspectionId) {
    const existing = await SyncJobRepository.getJobForInspection(inspectionId);
    if (existing && ['SYNCING', 'SYNCED'].includes(existing.status)) return;

    await SyncJobRepository.upsertJob({
      id: existing?.id || crypto.randomUUID(),
      inspection_id: inspectionId,
      status: 'QUEUED',
      attempts: 0,
      last_error: null,
    });

    const inspection = await InspectionRepository.getInspection(inspectionId);
    if (inspection) {
      await InspectionRepository.saveInspection({ ...inspection, sync_status: 'QUEUED' });
    }

    this._notify();

    if (ConnectivityService.online && !this.isSyncing) {
      this.startSync();
    }
  }

  subscribe(callback) {
    this._progressListeners.add(callback);
    return () => this._progressListeners.delete(callback);
  }

  _notify() {
    this._progressListeners.forEach(cb => {
      try { cb(); } catch (e) { console.error('Error in sync listener:', e); }
    });
  }

  getActiveProgress(inspectionId) {
    return Array.from(this._activeProgress.values()).filter(p => p.inspectionId === inspectionId);
  }

  async startSync() {
    if (this.isSyncing) return;
    if (!ConnectivityService.online) return;
    this.isSyncing = true;
    this._notify();
    try {
      await this.processQueue();
    } finally {
      this.isSyncing = false;
      this._notify();
    }
  }

  async processQueue() {
    const jobs = await SyncJobRepository.getPendingJobs();
    for (const job of jobs) {
      if (!ConnectivityService.online) break;
      await this._processJob(job);
    }
  }

  // ─── Job processing ──────────────────────────────────────────────────────────

  async _processJob(job) {
    const inspection = await InspectionRepository.getInspection(job.inspection_id);
    if (!inspection) {
      await SyncJobRepository.upsertJob({ ...job, status: 'FAILED', last_error: 'Inspection not found in local DB' });
      return;
    }

    await SyncJobRepository.upsertJob({ ...job, status: 'SYNCING', attempts: (job.attempts || 0) + 1 });
    await InspectionRepository.saveInspection({ ...inspection, sync_status: 'SYNCING' });
    this._notify();

    let supabaseInspectionId = inspection.server_id || inspection.supabase_id || null;

    try {
      // ── STEP 1: Establish server identity in Supabase ──────────────────────
      supabaseInspectionId = await this._syncInspectionRecord(inspection);

      // ── STEP 2: Upsert media metadata in Supabase ──────────────────────────
      const allMedia = await MediaRepository.getMediaForInspection(inspection.id);
      for (const media of allMedia) {
        await this._upsertMediaRecord(media, supabaseInspectionId, inspection);
      }

      // ── STEP 3: Ensure Google Drive folders exist ──────────────────────────
      let folders;
      try {
        folders = await GoogleDriveService.ensureInspectionFolders({
          propertyId: inspection.property_id,
          propertyName: inspection.property_name,
          inspectionId: inspection.id,
        });
      } catch (driveErr) {
        if (driveErr.code === 'NEEDS_DRIVE_AUTH') {
          await this._markNeedsDriveAuth(job, inspection, driveErr.message);
          return;
        }
        throw driveErr;
      }

      // ── STEP 4: Concurrent media uploads with bounded queue ────────────────
      const unuploadedMedia = allMedia.filter(m => m.original_blob && !['UPLOADED', 'uploaded'].includes(m.sync_status));
      
      const uploadPool = new BoundedQueue(this.concurrency);
      const uploadTasks = unuploadedMedia.map(media => {
        return uploadPool.add(() => this._uploadMediaItem(media, folders, supabaseInspectionId, inspection));
      });

      await Promise.allSettled(uploadTasks);

      // ── STEP 4.5: Upload Boundary Snapshot to Drive (if present) ───────────
      const boundary = await BoundaryRepository.getBoundaryForInspection(inspection.id);
      if (boundary && boundary.snapshot_image && boundary.sync_status !== 'SYNCED' && ConnectivityService.online) {
        try {
          const base64Data = boundary.snapshot_image.split(',')[1];
          const byteCharacters = atob(base64Data);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: 'image/png' });

          const filename = `boundary_snapshot_${inspection.id}.png`;
          const existing = await GoogleDriveService.findExistingFile(filename, folders.boundaryFolder).catch(() => null);
          
          let driveFile = existing;
          if (!driveFile) {
            driveFile = await GoogleDriveService.uploadFile(blob, filename, 'image/png', folders.boundaryFolder);
          }
          
          await BoundaryRepository.saveBoundary({
            ...boundary,
            sync_status: 'SYNCED',
            drive_file_id: driveFile.id,
            drive_web_url: driveFile.webViewLink || driveFile.webContentLink
          });
        } catch (e) {
          console.error('[SyncEngine] Boundary upload failed:', e);
        }
      }

      // ── STEP 5: Write optional inspection summary JSON to Drive ────────────
      try {
        const freshMediaList = await MediaRepository.getMediaForInspection(inspection.id);
        await this._writeDriveSummary(inspection, freshMediaList, folders.inspectionFolder);
      } catch (_e) {
        console.warn('[SyncEngine] Drive summary write non-fatal notice:', _e.message);
      }

      // ── STEP 6: Final verification & mark status ──────────────────────────
      const finalMedia = await MediaRepository.getMediaForInspection(inspection.id);
      const pendingItems = finalMedia.filter(m => m.original_blob && !['UPLOADED', 'uploaded'].includes(m.sync_status));
      const freshBoundary = await BoundaryRepository.getBoundaryForInspection(inspection.id);
      const isBoundaryPending = freshBoundary && freshBoundary.snapshot_image && freshBoundary.sync_status !== 'SYNCED';

      if (pendingItems.length === 0 && !isBoundaryPending) {
        await this._markSynced(job, inspection, supabaseInspectionId);
      } else {
        const failureDetails = pendingItems.map(m => `${m.filename || m.id}: ${m.last_upload_error || 'pending'}`).slice(0, 2).join('; ');
        await this._markPartiallySynced(job, inspection, `${pendingItems.length} file(s) pending (${failureDetails})`, supabaseInspectionId);
      }

    } catch (err) {
      console.error(`[SyncEngine] Job ${job.id} encountered error:`, err);
      if (err.code === 'NETWORK_OFFLINE' || !ConnectivityService.online) {
        await SyncJobRepository.upsertJob({ ...job, status: 'QUEUED', last_error: 'Network connection interrupted. Will retry when online.' });
      } else if (err.code === 'NEEDS_DRIVE_AUTH') {
        await this._markNeedsDriveAuth(job, inspection, err.message);
      } else {
        await SyncJobRepository.upsertJob({ ...job, status: 'FAILED', last_error: err.message || 'Sync failed' });
        await InspectionRepository.saveInspection({ ...inspection, sync_status: 'FAILED' });
        if (supabaseInspectionId) {
          try {
            await supabase
              .from('field_inspections')
              .update({ sync_status: 'FAILED', updated_at: new Date().toISOString() })
              .eq('id', supabaseInspectionId);
          } catch (_e) {}
        }
      }
      this._notify();
    }
  }

  // ─── Single Media Upload Pipeline (Idempotent & Resumable) ─────────────────

  async _uploadMediaItem(media, folders, supabaseInspectionId, inspection) {
    if (!ConnectivityService.online) return false;
    if (this._inFlightMediaIds.has(media.id)) return true; // prevent duplicate parallel workers

    this._inFlightMediaIds.add(media.id);
    const startTime = Date.now();

    const mediaType = media.type || media.mediaType;
    const evidenceType = media.evidenceType || '';
    let targetFolder;
    if (mediaType === 'video') targetFolder = folders.videosFolder;
    else if (mediaType === 'signature') targetFolder = folders.signaturesFolder;
    else targetFolder = folders.photosFolder;

    // Transition state: AUTHORIZING -> UPLOADING
    this._setLocalProgress(media.id, inspection.id, 0, 'authorizing');
    await MediaRepository.saveMedia({
      ...media,
      sync_status: 'uploading',
      upload_status: 'uploading',
      upload_attempts: (media.upload_attempts || 0) + 1,
    });
    this._notify();

    try {
      // 1. IDEMPOTENCY: Check if locally already tagged with drive_file_id
      if (media.remote_asset_id) {
        await this._afterSuccessfulUpload(media, {
          id: media.remote_asset_id,
          webViewLink: media.remote_url,
          webContentLink: media.remote_url,
        }, supabaseInspectionId);
        this._inFlightMediaIds.delete(media.id);
        this._clearLocalProgress(media.id);
        return true;
      }

      // 2. Build stable filename: <categorySlug>_<id>.<ext>
      const ext = (media.mime_type || 'application/octet-stream').split('/')[1]?.split(';')[0] || 'bin';
      const categorySlug = (evidenceType || mediaType || 'media').replace(/\s+/g, '_').toLowerCase();
      const filename = `${categorySlug}_${media.id}.${ext}`;

      // 3. IDEMPOTENCY: Check if file already exists in target Drive folder
      const existing = await GoogleDriveService.findExistingFile(filename, targetFolder).catch(() => null);
      let driveFile = existing;

      if (!driveFile) {
        // 4. Perform upload (Multipart for <5MB, Resumable for >=5MB)
        this._setLocalProgress(media.id, inspection.id, 5, 'uploading');
        
        driveFile = await GoogleDriveService.uploadFile(
          media.original_blob,
          filename,
          media.mime_type || 'application/octet-stream',
          targetFolder,
          (progress) => {
            this._setLocalProgress(media.id, inspection.id, progress.percent || 50, 'uploading');
            this._notify();
          }
        );
      }

      // 5. If geotagged blob exists (location photos), upload separately
      if (media.geotagged_blob && !media.geotagged_asset_id) {
        const geoFilename = `${categorySlug}_${media.id}_geotagged.${ext}`;
        const existingGeo = await GoogleDriveService.findExistingFile(geoFilename, targetFolder).catch(() => null);
        const geoDriveFile = existingGeo || await GoogleDriveService.uploadFile(
          media.geotagged_blob,
          geoFilename,
          media.mime_type || 'image/jpeg',
          targetFolder
        );
        await MediaRepository.saveMedia({
          ...media,
          geotagged_asset_id: geoDriveFile.id,
          geotagged_url: geoDriveFile.webViewLink || geoDriveFile.webContentLink,
        });
      }

      // 6. Transition state: CONFIRMING -> UPLOADED
      this._setLocalProgress(media.id, inspection.id, 95, 'confirming');
      await this._afterSuccessfulUpload(media, driveFile, supabaseInspectionId);

      this._logDiagnostic({
        inspectionId: inspection.id,
        mediaId: media.id,
        type: mediaType,
        size: media.original_blob?.size,
        op: 'upload_complete',
        attempt: (media.upload_attempts || 0) + 1,
        durationMs: Date.now() - startTime,
        status: 'UPLOADED'
      });

      return true;

    } catch (err) {
      const isOffline = (err.code === 'NETWORK_OFFLINE' || !ConnectivityService.online);
      const isTimeout = (err.code === 'TIMEOUT' || err.name === 'AbortError');
      const isAuth = (err.code === 'NEEDS_DRIVE_AUTH');

      console.error(`[SyncEngine] Media upload error for ${media.id}:`, err.message);

      this._logDiagnostic({
        inspectionId: inspection.id,
        mediaId: media.id,
        type: mediaType,
        size: media.original_blob?.size,
        op: 'upload_error',
        attempt: (media.upload_attempts || 0) + 1,
        durationMs: Date.now() - startTime,
        status: isAuth ? 'NEEDS_AUTH' : isOffline ? 'OFFLINE' : 'RETRY_WAIT',
        errorCategory: isAuth ? 'AUTH' : isOffline ? 'NETWORK' : isTimeout ? 'TIMEOUT' : 'SERVER'
      });

      await MediaRepository.saveMedia({
        ...media,
        sync_status: isAuth ? 'FAILED' : 'FAILED',
        upload_status: 'failed',
        last_upload_error: isTimeout ? 'Upload timed out. Will retry.' : isOffline ? 'Connection interrupted.' : err.message,
      });

      if (isAuth) throw err;
      return false;

    } finally {
      this._inFlightMediaIds.delete(media.id);
      this._clearLocalProgress(media.id);
      this._notify();
    }
  }

  async _afterSuccessfulUpload(media, driveFile, supabaseInspectionId) {
    const now = new Date().toISOString();

    // 1. Update local IndexedDB record
    await MediaRepository.saveMedia({
      ...media,
      sync_status: 'UPLOADED',
      upload_status: 'uploaded',
      remote_asset_id: driveFile.id,
      remote_url: driveFile.webViewLink || driveFile.webContentLink,
      uploaded_at: now,
      last_upload_error: null,
    });

    // 2. Update Supabase record idempotently
    try {
      await supabase
        .from('field_inspection_media')
        .update({
          drive_file_id: driveFile.id,
          drive_web_url: driveFile.webViewLink || driveFile.webContentLink,
          uploaded_at: now,
          upload_status: 'uploaded',
        })
        .eq('id', media.id);
    } catch (supabaseErr) {
      console.warn(`[SyncEngine] Warning updating Supabase media ${media.id}:`, supabaseErr.message);
    }
  }

  // ─── Progress Tracking & Safe Diagnostics ───────────────────────────────────

  _setLocalProgress(mediaId, inspectionId, percent, status) {
    this._activeProgress.set(mediaId, {
      mediaId,
      inspectionId,
      percent,
      status,
      timestamp: Date.now()
    });
  }

  _clearLocalProgress(mediaId) {
    this._activeProgress.delete(mediaId);
  }

  _logDiagnostic({ inspectionId, mediaId, type, size, op, attempt, durationMs, status, errorCategory = null }) {
    // Sanitized structured telemetry (no auth tokens, no customer PII)
    const logEntry = {
      event: '7days_sync_diagnostic',
      inspectionId,
      mediaId,
      type,
      sizeBytes: size,
      operation: op,
      attempt,
      durationMs,
      status,
      ...(errorCategory && { errorCategory })
    };
    if (process.env.NODE_ENV !== 'production' || status !== 'UPLOADED') {
      console.log(`[SyncEngine:Diagnostic] ${op}: ${mediaId} (${type}) -> ${status} [${durationMs}ms]`);
    }
  }

  // ─── Supabase Metadata Sync ──────────────────────────────────────────────────

  async _syncInspectionRecord(inspection) {
    const meta = inspection.metadata || {};
    const { data: sessionData } = await supabase.auth.getSession();
    const authUserId = sessionData?.session?.user?.id;

    const isValidUUID = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

    // 1. Resolve supervisor identity (UUID)
    let supervisorId = null;
    if (isValidUUID(inspection.supervisor_id)) {
      supervisorId = inspection.supervisor_id;
    } else if (authUserId) {
      try {
        const cached = localStorage.getItem(`supervisor_profile_${authUserId}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed?.id && isValidUUID(parsed.id)) {
            supervisorId = parsed.id;
          }
        }
      } catch (_) {}

      if (!supervisorId && isValidUUID(authUserId)) {
        supervisorId = authUserId;
      }
    }

    // 2. Resolve or generate server-side inspection UUID identity
    const generateUUID = () => {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    };

    const existingServerId = (isValidUUID(inspection.server_id) && inspection.server_id) ||
                             (isValidUUID(inspection.supabase_id) && inspection.supabase_id) ||
                             (isValidUUID(inspection.id) && inspection.id) ||
                             null;

    const serverId = existingServerId || generateUUID();

    const propertyId = isValidUUID(inspection.property_id) ? inspection.property_id : null;
    const existingTaskId = (isValidUUID(inspection.task_id) && inspection.task_id) ||
                           (isValidUUID(inspection.field_task_id) && inspection.field_task_id) ||
                           null;
    const taskId = existingTaskId || generateUUID();

    // 3. Build payload matching confirmed schema of public.field_inspections:
    // Columns: id, property_id, supervisor_id, task_id, status, sync_status, checklist, remarks, owner_name, owner_phone, consent_given, signature_url, updated_at
    const record = {
      id: serverId,
      property_id: propertyId,
      supervisor_id: supervisorId,
      task_id: taskId,
      status: ['PENDING', 'IN_PROGRESS', 'COMPLETED'].includes(inspection.status) ? inspection.status : 'COMPLETED',
      sync_status: 'UPLOADING',
      checklist: meta.checklist || null,
      remarks: meta.remarks || null,
      owner_name: meta.ownerInfo?.name || null,
      owner_phone: meta.ownerInfo?.phone || null,
      consent_given: Boolean(meta.consent),
      signature_url: meta.signature || null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('field_inspections')
      .upsert(record, { onConflict: 'id' })
      .select('id')
      .single();

    if (error) throw new Error(`Supabase inspection record upsert failed: ${error.message}`);

    const confirmedServerId = data?.id || serverId;

    // Persist confirmed server ID and task ID locally so subsequent retries are strictly idempotent
    inspection.server_id = confirmedServerId;
    inspection.supabase_id = confirmedServerId;
    inspection.task_id = taskId;
    await InspectionRepository.saveInspection({
      ...inspection,
      server_id: confirmedServerId,
      supabase_id: confirmedServerId,
      task_id: taskId,
    });

    return confirmedServerId;
  }

  async _upsertMediaRecord(media, supabaseInspectionId, inspection) {
    const { data: sessionData } = await supabase.auth.getSession();
    const supervisorId = inspection.supervisor_id || sessionData?.session?.user?.id;

    const record = {
      id: media.id,
      inspection_id: supabaseInspectionId,
      property_id: inspection.property_id,
      supervisor_id: supervisorId,
      type: media.type || media.mediaType,
      category: media.evidenceType || null,
      filename: media.filename || null,
      mime_type: media.mime_type || null,
      file_size: media.size || null,
      duration: media.duration || null,
      captured_at: media.captured_at || null,
      latitude: media.latitude || null,
      longitude: media.longitude || null,
      gps_accuracy: media.accuracy || null,
      upload_status: ['UPLOADED', 'uploaded'].includes(media.sync_status) ? 'uploaded' : 'pending',
      drive_file_id: media.remote_asset_id || null,
      drive_web_url: media.remote_url || null,
      uploaded_at: media.uploaded_at || null,
      retry_count: media.upload_attempts || 0,
    };

    try {
      const { error } = await supabase
        .from('field_inspection_media')
        .upsert(record, { onConflict: 'id' });

      if (error && error.code !== 'PGRST205') {
        console.warn(`[SyncEngine] Media upsert notice for ${media.id}:`, error.message);
      }
    } catch (_err) {
      // Non-fatal: Drive is the primary resilient evidence store
    }
  }

  // ─── Drive Summary ───────────────────────────────────────────────────────────

  async _writeDriveSummary(inspection, allMedia, inspectionFolderId) {
    const meta = inspection.metadata || {};
    const summary = {
      inspection_id: inspection.id,
      server_id: inspection.server_id || inspection.supabase_id || null,
      property_id: inspection.property_id,
      property_name: inspection.property_name || null,
      supervisor_id: inspection.supervisor_id || null,
      completed_at: inspection.completed_at || inspection.updated_at,
      location: {
        latitude: inspection.latitude,
        longitude: inspection.longitude,
        accuracy: inspection.gps_accuracy,
        address: inspection.reverse_geocoded_address,
      },
      checklist_summary: meta.checklist,
      remarks: meta.remarks,
      owner_information: meta.ownerInfo,
      owner_consent: meta.consent,
      media_summary: {
        total: allMedia.length,
        photos: allMedia.filter(m => (m.type || m.mediaType) === 'photo').length,
        videos: allMedia.filter(m => (m.type || m.mediaType) === 'video').length,
        signatures: allMedia.filter(m => (m.type || m.mediaType) === 'signature').length,
        uploaded: allMedia.filter(m => ['UPLOADED', 'uploaded'].includes(m.sync_status)).length,
      },
      generated_at: new Date().toISOString(),
    };

    const existing = await GoogleDriveService.findExistingFile('inspection-summary.json', inspectionFolderId).catch(() => null);
    if (existing) return;

    await GoogleDriveService.uploadJson(summary, 'inspection-summary.json', inspectionFolderId);
  }

  // ─── State transitions ───────────────────────────────────────────────────────

  async _markSynced(job, inspection, supabaseInspectionId) {
    const now = new Date().toISOString();

    if (supabaseInspectionId) {
      try {
        await supabase
          .from('field_inspections')
          .update({ sync_status: 'UPLOADED', updated_at: now })
          .eq('id', supabaseInspectionId);
      } catch (err) {
        console.warn('[SyncEngine] Notice updating remote sync_status to UPLOADED:', err.message);
      }
    }

    await InspectionRepository.saveInspection({
      ...inspection,
      server_id: supabaseInspectionId || inspection.server_id,
      supabase_id: supabaseInspectionId || inspection.supabase_id,
      sync_status: 'SYNCED',
      synced_at: now
    });
    await SyncJobRepository.upsertJob({ ...job, status: 'SYNCED', last_error: null });
    this._notify();
  }

  async _markPartiallySynced(job, inspection, reason, supabaseInspectionId) {
    if (supabaseInspectionId) {
      try {
        await supabase
          .from('field_inspections')
          .update({ sync_status: 'FAILED', updated_at: new Date().toISOString() })
          .eq('id', supabaseInspectionId);
      } catch (err) {
        console.warn('[SyncEngine] Notice updating remote sync_status to FAILED:', err.message);
      }
    }
    await InspectionRepository.saveInspection({
      ...inspection,
      server_id: supabaseInspectionId || inspection.server_id,
      supabase_id: supabaseInspectionId || inspection.supabase_id,
      sync_status: 'PARTIALLY_SYNCED'
    });
    await SyncJobRepository.upsertJob({ ...job, status: 'PARTIALLY_SYNCED', last_error: reason });
    this._notify();
  }

  async _markNeedsDriveAuth(job, inspection, message) {
    await InspectionRepository.saveInspection({ ...inspection, sync_status: 'NEEDS_DRIVE_AUTH' });
    await SyncJobRepository.upsertJob({ ...job, status: 'NEEDS_DRIVE_AUTH', last_error: message });
    this._notify();
  }
}

export default new SyncEngine();
