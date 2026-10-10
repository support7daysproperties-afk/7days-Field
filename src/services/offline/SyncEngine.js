/**
 * SyncEngine — Full offline-first synchronization lifecycle.
 *
 * Flow per inspection:
 *  STEP 1 — Upsert field_inspections record in Supabase
 *  STEP 2 — Upsert field_inspection_media rows (upload_status = pending)
 *  STEP 3 — Ensure Drive folder structure exists
 *  STEP 4 — Upload each media file; update Supabase record with drive_file_id after each
 *  STEP 5 — Verify all required data is present
 *  STEP 6 — Mark inspection sync_status = SYNCED
 *
 * Sync states (inspection):
 *   LOCAL_ONLY → QUEUED → SYNCING → SYNCED
 *                                  → PARTIALLY_SYNCED
 *                                  → FAILED
 *                                  → NEEDS_DRIVE_AUTH
 *
 * Sync states (media):
 *   PENDING_UPLOAD → UPLOADING → UPLOADED
 *                              → FAILED
 */

import { supabase } from '../../lib/supabase';
import MediaRepository from './MediaRepository';
import InspectionRepository from './InspectionRepository';
import SyncJobRepository from './SyncJobRepository';
import BoundaryRepository from './BoundaryRepository';
import ConnectivityService from './ConnectivityService';
import GoogleDriveService from '../GoogleDriveService';

class SyncEngine {
  constructor() {
    this.isSyncing = false;
    this._progressListeners = new Set();

    ConnectivityService.subscribe((isOnline) => {
      if (isOnline && !this.isSyncing) {
        this.startSync();
      }
    });
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Queue an inspection for sync. Call this right after the supervisor presses Submit.
   */
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

    // Update inspection sync_status locally
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
    this._progressListeners.forEach(cb => cb());
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

    try {
      // ── STEP 1: Upsert inspection record in Supabase ──────────────────────
      const supabaseInspectionId = await this._syncInspectionRecord(inspection);

      // ── STEP 2: Upsert media rows in Supabase (metadata only, no blobs) ───
      const allMedia = await MediaRepository.getMediaForInspection(inspection.id);
      for (const media of allMedia) {
        await this._upsertMediaRecord(media, supabaseInspectionId, inspection);
      }

      // ── STEP 3: Ensure Drive folder structure ─────────────────────────────
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

      // ── STEP 4: Upload each media file to Drive ───────────────────────────
      let allUploaded = true;
      for (const media of allMedia) {
        if (!ConnectivityService.online) { allUploaded = false; break; }
        if (media.sync_status === 'UPLOADED') continue; // idempotent: already done
        if (!media.original_blob) continue; // no blob to upload

        const uploaded = await this._uploadMedia(media, folders, supabaseInspectionId);
        if (!uploaded) allUploaded = false;
      }

      // ── STEP 4.5: Upload Boundary Snapshot to Drive ────────────────────────
      const boundary = await BoundaryRepository.getBoundaryForInspection(inspection.id);
      if (boundary && boundary.snapshot_image && boundary.sync_status !== 'SYNCED' && ConnectivityService.online) {
        try {
          // Convert base64 data URL to Blob
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
          console.error('Boundary upload failed:', e);
          allUploaded = false;
        }
      }

      // ── STEP 5: Write optional summary JSON to Drive ──────────────────────
      try {
        await this._writeDriveSummary(inspection, allMedia, folders.inspectionFolder);
      } catch (_e) {
        // Non-critical — don't fail the sync over the summary file
        console.warn('Drive summary write failed (non-fatal):', _e.message);
      }

      // ── STEP 6: Final verification & mark status ──────────────────────────
      const freshMedia = await MediaRepository.getMediaForInspection(inspection.id);
      const pendingCount = freshMedia.filter(m => m.original_blob && m.sync_status !== 'UPLOADED').length;
      const freshBoundary = await BoundaryRepository.getBoundaryForInspection(inspection.id);
      const isBoundaryPending = freshBoundary && freshBoundary.snapshot_image && freshBoundary.sync_status !== 'SYNCED';

      if (pendingCount === 0 && !isBoundaryPending) {
        await this._markSynced(job, inspection, supabaseInspectionId);
      } else {
        await this._markPartiallySynced(job, inspection, `${pendingCount} media item(s) and/or boundary still pending`);
      }

    } catch (err) {
      console.error(`[SyncEngine] Job ${job.id} failed:`, err);
      if (err.code === 'NEEDS_DRIVE_AUTH') {
        await this._markNeedsDriveAuth(job, inspection, err.message);
      } else {
        await SyncJobRepository.upsertJob({ ...job, status: 'FAILED', last_error: err.message });
        await InspectionRepository.saveInspection({ ...inspection, sync_status: 'FAILED' });
      }
      this._notify();
    }
  }

  // ─── Supabase Sync ───────────────────────────────────────────────────────────

  async _syncInspectionRecord(inspection) {
    const meta = inspection.metadata || {};
    const { data: sessionData } = await supabase.auth.getSession();
    const authUserId = sessionData?.session?.user?.id;
    const supervisorId = inspection.supervisor_id || authUserId;

    const record = {
      id: inspection.id,
      property_id: inspection.property_id,
      supervisor_id: supervisorId,
      auth_user_id: authUserId,
      status: inspection.status || 'COMPLETED',
      sync_status: 'SYNCING',
      started_at: inspection.created_at,
      completed_at: inspection.completed_at || inspection.updated_at,
      submitted_at: inspection.submitted_at || inspection.updated_at,
      checklist: meta.checklist || null,
      remarks: meta.remarks || null,
      owner_info: meta.ownerInfo || null,
      owner_consent: meta.consent || false,
      signature_data_url: meta.signature || null,
      location_verified: inspection.location_verified || false,
      latitude: inspection.latitude || null,
      longitude: inspection.longitude || null,
      gps_accuracy: inspection.gps_accuracy || null,
      gps_timestamp: inspection.gps_timestamp || null,
      reverse_geocoded_address: inspection.reverse_geocoded_address || null,
      property_name: inspection.property_name || null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('field_inspections')
      .upsert(record, { onConflict: 'id' })
      .select('id')
      .single();

    if (error) throw new Error(`Supabase inspection upsert failed: ${error.message}`);
    return data.id;
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
      upload_status: media.sync_status === 'UPLOADED' ? 'uploaded' : 'pending',
      drive_file_id: media.remote_asset_id || null,
      drive_web_url: media.remote_url || null,
      uploaded_at: media.uploaded_at || null,
      retry_count: media.upload_attempts || 0,
    };

    const { error } = await supabase
      .from('field_inspection_media')
      .upsert(record, { onConflict: 'id' });

    if (error) console.warn(`Media upsert warning for ${media.id}:`, error.message);
  }

  // ─── Drive Upload ────────────────────────────────────────────────────────────

  async _uploadMedia(media, folders, supabaseInspectionId) {
    // Determine target subfolder
    const mediaType = media.type || media.mediaType;
    const evidenceType = media.evidenceType || '';
    let targetFolder;
    if (mediaType === 'video') targetFolder = folders.videosFolder;
    else if (mediaType === 'signature') targetFolder = folders.signaturesFolder;
    else targetFolder = folders.photosFolder;

    // Mark as uploading locally
    await MediaRepository.saveMedia({ ...media, sync_status: 'UPLOADING', upload_attempts: (media.upload_attempts || 0) + 1 });
    this._notify();

    try {
      // IDEMPOTENCY: If drive_file_id already exists in local record, skip upload
      if (media.remote_asset_id) {
        await this._afterSuccessfulUpload(media, {
          id: media.remote_asset_id,
          webViewLink: media.remote_url,
          webContentLink: media.remote_url,
        }, supabaseInspectionId);
        return true;
      }

      // Build stable filename: <evidenceType>_<id>.<ext>
      const ext = (media.mime_type || 'application/octet-stream').split('/')[1] || 'bin';
      const categorySlug = (evidenceType || mediaType || 'media').replace(/\s+/g, '_').toLowerCase();
      const filename = `${categorySlug}_${media.id}.${ext}`;

      // IDEMPOTENCY: Check if file already exists in Drive with this exact name
      const existing = await GoogleDriveService.findExistingFile(filename, targetFolder).catch(() => null);
      let driveFile;
      if (existing) {
        driveFile = existing;
      } else {
        // Upload original blob
        driveFile = await GoogleDriveService.uploadFile(
          media.original_blob,
          filename,
          media.mime_type || 'application/octet-stream',
          targetFolder,
          (progress) => {
            this._notify();
          }
        );
      }

      // If geotagged blob exists (location photos), upload separately
      if (media.geotagged_blob && !media.geotagged_asset_id) {
        const geoFilename = `${categorySlug}_${media.id}_geotagged.${ext}`;
        const existingGeo = await GoogleDriveService.findExistingFile(geoFilename, targetFolder).catch(() => null);
        const geoDriveFile = existingGeo || await GoogleDriveService.uploadFile(
          media.geotagged_blob,
          geoFilename,
          media.mime_type || 'image/jpeg',
          targetFolder
        );
        // Store geotagged IDs in the media record too
        await MediaRepository.saveMedia({
          ...media,
          geotagged_asset_id: geoDriveFile.id,
          geotagged_url: geoDriveFile.webViewLink || geoDriveFile.webContentLink,
        });
      }

      await this._afterSuccessfulUpload(media, driveFile, supabaseInspectionId);
      return true;

    } catch (err) {
      if (err.code === 'NEEDS_DRIVE_AUTH') throw err;
      console.error(`[SyncEngine] Media upload failed for ${media.id}:`, err.message);
      await MediaRepository.saveMedia({
        ...media,
        sync_status: 'FAILED',
        last_upload_error: err.message,
      });
      this._notify();
      return false;
    }
  }

  async _afterSuccessfulUpload(media, driveFile, supabaseInspectionId) {
    const now = new Date().toISOString();

    // Update local record
    await MediaRepository.saveMedia({
      ...media,
      sync_status: 'UPLOADED',
      remote_asset_id: driveFile.id,
      remote_url: driveFile.webViewLink || driveFile.webContentLink,
      uploaded_at: now,
      last_upload_error: null,
    });

    // Update Supabase media record with Drive info
    const { error } = await supabase
      .from('field_inspection_media')
      .update({
        drive_file_id: driveFile.id,
        drive_web_url: driveFile.webViewLink || driveFile.webContentLink,
        uploaded_at: now,
        upload_status: 'uploaded',
      })
      .eq('id', media.id);

    if (error) console.warn(`Could not update drive_file_id in Supabase for media ${media.id}:`, error.message);
    this._notify();
  }

  // ─── Drive Summary ───────────────────────────────────────────────────────────

  async _writeDriveSummary(inspection, allMedia, inspectionFolderId) {
    const meta = inspection.metadata || {};
    const summary = {
      inspection_id: inspection.id,
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
        uploaded: allMedia.filter(m => m.sync_status === 'UPLOADED').length,
      },
      generated_at: new Date().toISOString(),
    };

    // Check if summary already exists to avoid duplicates
    const existing = await GoogleDriveService.findExistingFile('inspection-summary.json', inspectionFolderId).catch(() => null);
    if (existing) return; // already written

    await GoogleDriveService.uploadJson(summary, 'inspection-summary.json', inspectionFolderId);
  }

  // ─── State transitions ───────────────────────────────────────────────────────

  async _markSynced(job, inspection, supabaseInspectionId) {
    const now = new Date().toISOString();

    // Update Supabase
    await supabase
      .from('field_inspections')
      .update({ sync_status: 'SYNCED', updated_at: now })
      .eq('id', supabaseInspectionId);

    // Update local
    await InspectionRepository.saveInspection({ ...inspection, sync_status: 'SYNCED', synced_at: now });
    await SyncJobRepository.upsertJob({ ...job, status: 'SYNCED' });
    this._notify();
  }

  async _markPartiallySynced(job, inspection, reason) {
    await InspectionRepository.saveInspection({ ...inspection, sync_status: 'PARTIALLY_SYNCED' });
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
