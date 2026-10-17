import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import SyncEngine from '../src/services/offline/SyncEngine';
import MediaRepository from '../src/services/offline/MediaRepository';
import InspectionRepository from '../src/services/offline/InspectionRepository';
import SyncJobRepository from '../src/services/offline/SyncJobRepository';
import BoundaryRepository from '../src/services/offline/BoundaryRepository';
import ConnectivityService from '../src/services/offline/ConnectivityService';
import GoogleDriveService from '../src/services/GoogleDriveService';
import { supabase } from '../src/lib/supabase';

// Mock IndexedDB stores in memory
const mockInspections = new Map();
const mockMedia = new Map();
const mockJobs = new Map();
const mockBoundaries = new Map();

describe('SyncEngine — Fast, Reliable & Resumable Bounded Concurrency Sync Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockInspections.clear();
    mockMedia.clear();
    mockJobs.clear();
    mockBoundaries.clear();

    // Mock Repositories
    vi.spyOn(InspectionRepository, 'getInspection').mockImplementation(async (id) => mockInspections.get(id));
    vi.spyOn(InspectionRepository, 'saveInspection').mockImplementation(async (ins) => {
      mockInspections.set(ins.id, { ...ins });
      return ins;
    });

    vi.spyOn(MediaRepository, 'getMediaForInspection').mockImplementation(async (inspectionId) => {
      return Array.from(mockMedia.values()).filter(m => m.inspection_id === inspectionId);
    });
    vi.spyOn(MediaRepository, 'saveMedia').mockImplementation(async (media) => {
      mockMedia.set(media.id, { ...media });
      return media;
    });

    vi.spyOn(SyncJobRepository, 'getJobForInspection').mockImplementation(async (inspectionId) => {
      return Array.from(mockJobs.values()).find(j => j.inspection_id === inspectionId) || null;
    });
    vi.spyOn(SyncJobRepository, 'getPendingJobs').mockImplementation(async () => {
      return Array.from(mockJobs.values()).filter(j => ['QUEUED', 'PARTIALLY_SYNCED', 'FAILED'].includes(j.status));
    });
    vi.spyOn(SyncJobRepository, 'upsertJob').mockImplementation(async (job) => {
      mockJobs.set(job.id, { ...job });
      return job;
    });

    vi.spyOn(BoundaryRepository, 'getBoundaryForInspection').mockImplementation(async () => null);

    // Mock Supabase
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: { user: { id: 'test_supervisor_123' } } }
    });
    vi.spyOn(supabase, 'from').mockImplementation(() => ({
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'supabase_ins_123' }, error: null })
        }),
        error: null
      }),
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'supabase_ins_123' }, error: null })
        }),
        error: null
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null })
      })
    }));

    // Mock GoogleDriveService
    vi.spyOn(GoogleDriveService, 'ensureInspectionFolders').mockResolvedValue({
      photosFolder: 'photos_folder_id',
      videosFolder: 'videos_folder_id',
      signaturesFolder: 'signatures_folder_id',
      inspectionFolder: 'inspection_folder_id',
    });

    vi.spyOn(GoogleDriveService, 'findExistingFile').mockResolvedValue(null);
    vi.spyOn(GoogleDriveService, 'uploadJson').mockResolvedValue({ id: 'summary_file_id' });

    ConnectivityService.online = true;
    SyncEngine.concurrency = 3;
    SyncEngine.isSyncing = false;
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  // 1. Six queued files uploaded with bounded concurrency
  it('uploads 6 queued files (4 photos, 1 video, 1 sig) with bounded concurrency (3)', async () => {
    const inspectionId = 'INS-TEST-001';
    mockInspections.set(inspectionId, {
      id: inspectionId,
      property_id: 'PROP-01',
      title: 'Site Inspection',
      sync_status: 'QUEUED',
      metadata: { checklist: { verified: true } }
    });

    const activeConcurrentSet = new Set();
    let maxSeenConcurrency = 0;

    vi.spyOn(GoogleDriveService, 'uploadFile').mockImplementation(async (blob, filename) => {
      activeConcurrentSet.add(filename);
      maxSeenConcurrency = Math.max(maxSeenConcurrency, activeConcurrentSet.size);
      await new Promise(r => setTimeout(r, 20)); // simulate brief transfer
      activeConcurrentSet.delete(filename);
      return { id: `drive_${filename}`, webViewLink: `https://drive.google.com/${filename}` };
    });

    // 4 photos, 1 video, 1 signature
    const files = [
      { id: 'p1', type: 'photo', mime_type: 'image/jpeg', size: 1000 },
      { id: 'p2', type: 'photo', mime_type: 'image/jpeg', size: 1000 },
      { id: 'p3', type: 'photo', mime_type: 'image/jpeg', size: 1000 },
      { id: 'p4', type: 'photo', mime_type: 'image/jpeg', size: 1000 },
      { id: 'v1', type: 'video', mime_type: 'video/mp4', size: 5000000 },
      { id: 's1', type: 'signature', mime_type: 'image/png', size: 500 }
    ];

    for (const f of files) {
      mockMedia.set(f.id, {
        id: f.id,
        inspection_id: inspectionId,
        type: f.type,
        mediaType: f.type,
        original_blob: new Blob(['fake_data'], { type: f.mime_type }),
        sync_status: 'PENDING_UPLOAD',
        upload_attempts: 0
      });
    }

    mockJobs.set('job_1', {
      id: 'job_1',
      inspection_id: inspectionId,
      status: 'QUEUED'
    });

    await SyncEngine.startSync();

    // Verify bounded concurrency: never exceeded concurrency limit (3)
    expect(maxSeenConcurrency).toBeLessThanOrEqual(3);
    expect(maxSeenConcurrency).toBeGreaterThan(1);

    // Verify all 6 files are marked UPLOADED
    const allMedia = Array.from(mockMedia.values());
    expect(allMedia).toHaveLength(6);
    expect(allMedia.every(m => m.sync_status === 'UPLOADED')).toBe(true);
    expect(allMedia.every(m => m.remote_asset_id)).toBe(true);

    // Verify inspection is confirmed SYNCED
    const finalIns = mockInspections.get(inspectionId);
    expect(finalIns.sync_status).toBe('SYNCED');
  });

  // 2. One failed upload while other files succeed (PARTIALLY_SYNCED)
  it('marks inspection PARTIALLY_SYNCED when one file fails, while keeping successful files uploaded', async () => {
    const inspectionId = 'INS-TEST-002';
    mockInspections.set(inspectionId, { id: inspectionId, sync_status: 'QUEUED' });

    vi.spyOn(GoogleDriveService, 'uploadFile').mockImplementation(async (blob, filename) => {
      if (filename.includes('p2') || filename.includes('photo-2')) {
        throw new Error('Socket timeout on photo 2');
      }
      return { id: `drive_${filename}`, webViewLink: `https://drive.google.com/${filename}` };
    });

    const files = [
      { id: 'p1', type: 'photo' },
      { id: 'p2', type: 'photo' }, // will fail
      { id: 'p3', type: 'photo' }
    ];

    for (const f of files) {
      mockMedia.set(f.id, {
        id: f.id,
        inspection_id: inspectionId,
        type: f.type,
        original_blob: new Blob(['content']),
        sync_status: 'PENDING_UPLOAD'
      });
    }

    mockJobs.set('job_2', { id: 'job_2', inspection_id: inspectionId, status: 'QUEUED' });

    await SyncEngine.startSync();

    // p1 and p3 succeeded and stay UPLOADED
    expect(mockMedia.get('p1').sync_status).toBe('UPLOADED');
    expect(mockMedia.get('p3').sync_status).toBe('UPLOADED');

    // p2 failed
    expect(mockMedia.get('p2').sync_status).toBe('FAILED');
    expect(mockMedia.get('p2').last_upload_error).toContain('Socket timeout');

    // Inspection marked PARTIALLY_SYNCED, NEVER SYNCED prematurely
    expect(mockInspections.get(inspectionId).sync_status).toBe('PARTIALLY_SYNCED');
  });

  // 3. Network loss during an upload
  it('handles network loss gracefully and flags retry_wait without deleting local media', async () => {
    const inspectionId = 'INS-TEST-003';
    mockInspections.set(inspectionId, { id: inspectionId, sync_status: 'QUEUED' });

    vi.spyOn(GoogleDriveService, 'uploadFile').mockImplementation(async () => {
      ConnectivityService.online = false;
      const err = new Error('Network connection interrupted');
      err.code = 'NETWORK_OFFLINE';
      throw err;
    });

    const originalBlob = new Blob(['preserved_video_content']);
    mockMedia.set('v1', {
      id: 'v1',
      inspection_id: inspectionId,
      type: 'video',
      original_blob: originalBlob,
      sync_status: 'PENDING_UPLOAD'
    });

    mockJobs.set('job_3', { id: 'job_3', inspection_id: inspectionId, status: 'QUEUED' });

    await SyncEngine.startSync();

    // Local file blob MUST NEVER be deleted
    expect(mockMedia.get('v1').original_blob).toBe(originalBlob);
    expect(mockJobs.get('job_3').last_error).toContain('interrupted');
  });

  // 4. Network restoration and automatic resumption
  it('automatically resumes syncing when connectivity returns to online', async () => {
    const inspectionId = 'INS-TEST-004';
    mockInspections.set(inspectionId, { id: inspectionId, sync_status: 'QUEUED' });

    let uploadCallCount = 0;
    vi.spyOn(GoogleDriveService, 'uploadFile').mockImplementation(async () => {
      uploadCallCount++;
      return { id: 'drive_resumed', webViewLink: 'https://drive.google.com/resumed' };
    });

    mockMedia.set('p1', {
      id: 'p1',
      inspection_id: inspectionId,
      type: 'photo',
      original_blob: new Blob(['data']),
      sync_status: 'PENDING_UPLOAD'
    });
    mockJobs.set('job_4', { id: 'job_4', inspection_id: inspectionId, status: 'QUEUED' });

    // Transition offline -> online
    ConnectivityService.online = false;
    ConnectivityService.setOnline();

    // Allow auto-resumption to fire
    await new Promise(r => setTimeout(r, 50));

    expect(uploadCallCount).toBeGreaterThan(0);
    expect(mockMedia.get('p1').sync_status).toBe('UPLOADED');
  });

  // 5. Authorization failure (NEEDS_DRIVE_AUTH)
  it('transitions inspection to NEEDS_DRIVE_AUTH on authorization expiration', async () => {
    const inspectionId = 'INS-TEST-005';
    mockInspections.set(inspectionId, { id: inspectionId, sync_status: 'QUEUED' });

    vi.spyOn(GoogleDriveService, 'ensureInspectionFolders').mockRejectedValue({
      code: 'NEEDS_DRIVE_AUTH',
      message: 'Drive token expired or revoked'
    });

    mockMedia.set('p1', {
      id: 'p1',
      inspection_id: inspectionId,
      type: 'photo',
      original_blob: new Blob(['data']),
      sync_status: 'PENDING_UPLOAD'
    });
    mockJobs.set('job_5', { id: 'job_5', inspection_id: inspectionId, status: 'QUEUED' });

    await SyncEngine.startSync();

    expect(mockInspections.get(inspectionId).sync_status).toBe('NEEDS_DRIVE_AUTH');
    expect(mockJobs.get('job_5').status).toBe('NEEDS_DRIVE_AUTH');
  });

  // 6. Request that times out
  it('catches request timeouts cleanly without hanging indefinitely', async () => {
    const inspectionId = 'INS-TEST-006';
    mockInspections.set(inspectionId, { id: inspectionId, sync_status: 'QUEUED' });

    vi.spyOn(GoogleDriveService, 'uploadFile').mockImplementation(async () => {
      const timeoutErr = new Error('Request timed out after 25000ms');
      timeoutErr.code = 'TIMEOUT';
      throw timeoutErr;
    });

    mockMedia.set('p1', {
      id: 'p1',
      inspection_id: inspectionId,
      type: 'photo',
      original_blob: new Blob(['data']),
      sync_status: 'PENDING_UPLOAD'
    });
    mockJobs.set('job_6', { id: 'job_6', inspection_id: inspectionId, status: 'QUEUED' });

    await SyncEngine.startSync();

    expect(mockMedia.get('p1').sync_status).toBe('FAILED');
    expect(mockMedia.get('p1').last_upload_error).toContain('timed out');
    expect(SyncEngine.isSyncing).toBe(false); // Cleanly finished, no hanging lock
  });

  // 7. Duplicate upload prevention & Idempotency
  it('prevents re-uploading already confirmed files or files already existing in Drive', async () => {
    const inspectionId = 'INS-TEST-007';
    mockInspections.set(inspectionId, { id: inspectionId, sync_status: 'QUEUED' });

    let uploadUploadFileCalled = false;
    vi.spyOn(GoogleDriveService, 'uploadFile').mockImplementation(async () => {
      uploadUploadFileCalled = true;
      return { id: 'new_drive_id' };
    });

    // File already exists in Google Drive
    vi.spyOn(GoogleDriveService, 'findExistingFile').mockResolvedValue({
      id: 'existing_drive_file_999',
      webViewLink: 'https://drive.google.com/existing'
    });

    mockMedia.set('p1', {
      id: 'p1',
      inspection_id: inspectionId,
      type: 'photo',
      original_blob: new Blob(['data']),
      sync_status: 'PENDING_UPLOAD'
    });
    mockJobs.set('job_7', { id: 'job_7', inspection_id: inspectionId, status: 'QUEUED' });

    await SyncEngine.startSync();

    // Did NOT upload file blob again, reused existing Drive file
    expect(uploadUploadFileCalled).toBe(false);
    expect(mockMedia.get('p1').sync_status).toBe('UPLOADED');
    expect(mockMedia.get('p1').remote_asset_id).toBe('existing_drive_file_999');
  });

  // 8. Repeated retry clicks without duplicate workers (Mutex protection)
  it('prevents multiple simultaneous sync workers from uploading the same media', async () => {
    const inspectionId = 'INS-TEST-008';
    mockInspections.set(inspectionId, { id: inspectionId, sync_status: 'QUEUED' });

    let uploadCount = 0;
    vi.spyOn(GoogleDriveService, 'uploadFile').mockImplementation(async () => {
      uploadCount++;
      await new Promise(r => setTimeout(r, 40));
      return { id: 'drive_1', webViewLink: 'url' };
    });

    mockMedia.set('m1', {
      id: 'm1',
      inspection_id: inspectionId,
      type: 'photo',
      original_blob: new Blob(['data']),
      sync_status: 'PENDING_UPLOAD'
    });
    mockJobs.set('job_8', { id: 'job_8', inspection_id: inspectionId, status: 'QUEUED' });

    // Trigger two syncs in parallel (simulating rapid user double clicks)
    const sync1 = SyncEngine.startSync();
    const sync2 = SyncEngine.startSync();
    await Promise.all([sync1, sync2]);

    // File should only have been uploaded once
    expect(uploadCount).toBe(1);
  });

  // 9. HTTP 429 and 5xx backoff handling in Drive Service
  it('handles HTTP 429 rate limit backoff and 503 transient errors', async () => {
    let callCount = 0;
    GoogleDriveService.setTokenData({ accessToken: 'test_token', expiresInSec: 3600 });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      callCount++;
      if (callCount === 1) {
        // Return 429 with Retry-After header
        return new Response(JSON.stringify({ error: { message: 'Rate limit exceeded' } }), {
          status: 429,
          headers: { 'Retry-After': '0.01' } // 10ms
        });
      }
      if (callCount === 2) {
        // Return 503
        return new Response(JSON.stringify({ error: { message: 'Service Unavailable' } }), {
          status: 503
        });
      }
      return new Response(JSON.stringify({ id: 'file_ok' }), { status: 200 });
    });

    try {
      const res = await GoogleDriveService._fetchWithRetry('https://example.com/test-endpoint', {
        headers: { Authorization: 'Bearer test_token' }
      }, 3);
      expect(res.status).toBe(200);
      expect(callCount).toBe(3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 10. App refresh / cold start with pending files
  it('resumes pending queued jobs from previous session on cold start', async () => {
    const inspectionId = 'INS-COLD-START';
    mockInspections.set(inspectionId, { id: inspectionId, sync_status: 'QUEUED' });
    mockMedia.set('photo_cold', {
      id: 'photo_cold',
      inspection_id: inspectionId,
      type: 'photo',
      original_blob: new Blob(['saved_offline']),
      sync_status: 'PENDING_UPLOAD'
    });
    mockJobs.set('job_cold', {
      id: 'job_cold',
      inspection_id: inspectionId,
      status: 'QUEUED'
    });

    let uploaded = false;
    vi.spyOn(GoogleDriveService, 'uploadFile').mockImplementation(async () => {
      uploaded = true;
      return { id: 'cold_drive_id' };
    });

    // Simulate app boot: startSync() queries getPendingJobs()
    await SyncEngine.startSync();

    expect(uploaded).toBe(true);
    expect(mockMedia.get('photo_cold').sync_status).toBe('UPLOADED');
    expect(mockInspections.get(inspectionId).sync_status).toBe('SYNCED');
  });

  // 11. Large video chunked resumable upload slices without memory spikes
  it('uploads large videos using 5MB resumable chunks without loading entire file to RAM', async () => {
    // 12 MB video
    const totalSize = 12 * 1024 * 1024;
    const fakeChunk = new Uint8Array(1024);
    const videoBlob = new Blob([fakeChunk], { type: 'video/mp4' });
    Object.defineProperty(videoBlob, 'size', { value: totalSize });

    const sliceSpy = vi.spyOn(videoBlob, 'slice');
    vi.spyOn(GoogleDriveService, 'getValidToken').mockResolvedValue('test_token');

    let initCalled = false;
    let chunksUploaded = 0;
    const progressReports = [];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url, opts) => {
      if (url.includes('uploadType=resumable')) {
        initCalled = true;
        return new Response(null, {
          status: 200,
          headers: { Location: 'https://www.googleapis.com/upload/drive/v3/session_123' }
        });
      }
      if (url.includes('session_123')) {
        chunksUploaded++;
        if (chunksUploaded < 3) {
          // Drive returns 308 Resume Incomplete for intermediate chunks
          const bytesUploaded = chunksUploaded * 5 * 1024 * 1024 - 1;
          return new Response(null, {
            status: 308,
            headers: { Range: `bytes=0-${bytesUploaded}` }
          });
        }
        // Final chunk
        return new Response(JSON.stringify({ id: 'video_drive_id', webViewLink: 'url' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    try {
      const result = await GoogleDriveService.uploadFileResumable(
        videoBlob,
        'video_12mb.mp4',
        'video/mp4',
        'folder_id',
        (pct) => progressReports.push(pct)
      );

      expect(initCalled).toBe(true);
      // Sliced into 3 chunks (5MB, 5MB, 2MB)
      expect(chunksUploaded).toBe(3);
      expect(sliceSpy).toHaveBeenCalledTimes(3);
      expect(result.id).toBe('video_drive_id');
      expect(progressReports.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 12. Local evidence is never deleted before or after confirmed success
  it('guarantees local evidence blob is preserved in local repository even after upload', async () => {
    const inspectionId = 'INS-PRESERVE';
    mockInspections.set(inspectionId, { id: inspectionId, sync_status: 'QUEUED' });
    const localBlob = new Blob(['critical_evidence'], { type: 'image/jpeg' });

    mockMedia.set('ev_1', {
      id: 'ev_1',
      inspection_id: inspectionId,
      type: 'photo',
      original_blob: localBlob,
      sync_status: 'PENDING_UPLOAD'
    });
    mockJobs.set('job_ev', { id: 'job_ev', inspection_id: inspectionId, status: 'QUEUED' });

    vi.spyOn(GoogleDriveService, 'uploadFile').mockResolvedValue({ id: 'remote_ev_1' });

    await SyncEngine.startSync();

    const savedRecord = mockMedia.get('ev_1');
    expect(savedRecord.sync_status).toBe('UPLOADED');
    expect(savedRecord.original_blob).toBe(localBlob);
    expect(savedRecord.original_blob.size).toBe(localBlob.size);
  });
});

