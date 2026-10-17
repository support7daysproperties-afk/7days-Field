import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import SyncEngine from '../src/services/offline/SyncEngine';
import MediaRepository from '../src/services/offline/MediaRepository';
import InspectionRepository from '../src/services/offline/InspectionRepository';
import SyncJobRepository from '../src/services/offline/SyncJobRepository';
import BoundaryRepository from '../src/services/offline/BoundaryRepository';
import ConnectivityService from '../src/services/offline/ConnectivityService';
import GoogleDriveService from '../src/services/GoogleDriveService';
import { supabase } from '../src/lib/supabase';
import { FIELD_INSPECTION_COLUMNS, DB_ENUMS } from '../src/lib/database.types';

const mockInspections = new Map();
const mockMedia = new Map();
const mockJobs = new Map();

describe('Supabase field_inspections Schema Mismatch & Identity Sync Tests', () => {
  let capturedUpsertPayloads = [];
  let capturedInsertPayloads = [];

  beforeEach(() => {
    vi.restoreAllMocks();
    mockInspections.clear();
    mockMedia.clear();
    mockJobs.clear();
    capturedUpsertPayloads = [];
    capturedInsertPayloads = [];

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

    // Mock Supabase Auth
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: { user: { id: 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d' } } }
    });

    // Mock Supabase from('field_inspections')
    vi.spyOn(supabase, 'from').mockImplementation((table) => {
      if (table === 'field_inspections') {
        return {
          upsert: vi.fn().mockImplementation((payload) => {
            capturedUpsertPayloads.push(payload);
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: payload.id || 'c8d67a91-4e4b-4b2a-8745-f09b2b512c01' },
                  error: null
                })
              }),
              error: null
            };
          }),
          insert: vi.fn().mockImplementation((payload) => {
            capturedInsertPayloads.push(payload);
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'c8d67a91-4e4b-4b2a-8745-f09b2b512c01' },
                  error: null
                })
              }),
              error: null
            };
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null })
          })
        };
      }
      return {
        upsert: vi.fn().mockReturnValue({ error: null }),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) })
      };
    });

    // Mock GoogleDriveService
    vi.spyOn(GoogleDriveService, 'ensureInspectionFolders').mockResolvedValue({
      photosFolder: 'photos_folder_id',
      videosFolder: 'videos_folder_id',
      signaturesFolder: 'signatures_folder_id',
      inspectionFolder: 'inspection_folder_id',
      boundaryFolder: 'boundary_folder_id',
    });
    vi.spyOn(GoogleDriveService, 'findExistingFile').mockResolvedValue(null);
    vi.spyOn(GoogleDriveService, 'uploadFile').mockResolvedValue({ id: 'drive_file_id', webViewLink: 'https://drive.google.com/test' });
    vi.spyOn(GoogleDriveService, 'uploadJson').mockResolvedValue({ id: 'summary_file_id' });

    ConnectivityService.online = true;
    SyncEngine.concurrency = 3;
    SyncEngine.isSyncing = false;
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  // 1. Verify payload matches exact Supabase schema (NO auth_user_id, NO phantom columns)
  it('sends payload strictly adhering to field_inspections schema without auth_user_id or phantom columns', async () => {
    const inspectionId = 'INS-20261017-291';
    mockInspections.set(inspectionId, {
      id: inspectionId,
      property_id: 'd9e8f7a6-b5c4-4d3e-2f1a-0b9c8d7e6f5a', // UUID
      supervisor_id: 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d', // UUID
      status: 'COMPLETED',
      sync_status: 'QUEUED',
      created_at: new Date().toISOString(),
      metadata: {
        checklist: { 'Road accessible': true, 'Meter checked': true },
        remarks: 'Site clear and verified',
        ownerInfo: { name: 'Ramesh Kumar', phone: '+919876543210' },
        consent: true,
        signature: 'data:image/png;base64,fakeSignatureData'
      }
    });

    mockJobs.set('job_schema_1', {
      id: 'job_schema_1',
      inspection_id: inspectionId,
      status: 'QUEUED'
    });

    await SyncEngine.startSync();

    const allPayloads = [...capturedUpsertPayloads, ...capturedInsertPayloads];
    expect(allPayloads.length).toBeGreaterThan(0);
    const sentRecord = allPayloads[0];

    // CRITICAL: auth_user_id must NEVER be sent to field_inspections (belongs to field_supervisors)
    expect(sentRecord).not.toHaveProperty('auth_user_id');
    expect(sentRecord).not.toHaveProperty('started_at');
    expect(sentRecord).not.toHaveProperty('completed_at');
    expect(sentRecord).not.toHaveProperty('submitted_at');
    expect(sentRecord).not.toHaveProperty('owner_info');
    expect(sentRecord).not.toHaveProperty('owner_consent');
    expect(sentRecord).not.toHaveProperty('signature_data_url');
    expect(sentRecord).not.toHaveProperty('location_verified');
    expect(sentRecord).not.toHaveProperty('latitude');
    expect(sentRecord).not.toHaveProperty('longitude');

    // Confirmed database columns must be mapped properly
    expect(sentRecord.owner_name).toBe('Ramesh Kumar');
    expect(sentRecord.owner_phone).toBe('+919876543210');
    expect(sentRecord.consent_given).toBe(true);
    expect(sentRecord.signature_url).toBe('data:image/png;base64,fakeSignatureData');
    expect(sentRecord.remarks).toBe('Site clear and verified');
    expect(sentRecord.checklist).toEqual({ 'Road accessible': true, 'Meter checked': true });

    // Validate enum constraints
    expect(DB_ENUMS.sync_status).toContain(sentRecord.sync_status);
    expect(DB_ENUMS.inspection_status).toContain(sentRecord.status);

    // Every key in sentRecord must belong to FIELD_INSPECTION_COLUMNS
    for (const key of Object.keys(sentRecord)) {
      expect(FIELD_INSPECTION_COLUMNS).toContain(key);
    }
  });

  // 2. Server identity resolution & persistence: generates / resolves UUID and saves to local inspection record
  it('resolves server UUID identity and persists server_id locally for idempotent retries', async () => {
    const inspectionId = 'INS-20261017-291';
    mockInspections.set(inspectionId, {
      id: inspectionId,
      status: 'COMPLETED',
      sync_status: 'QUEUED',
      metadata: { consent: true }
    });

    mockJobs.set('job_identity', { id: 'job_identity', inspection_id: inspectionId, status: 'QUEUED' });

    await SyncEngine.startSync();

    // Verify local inspection record has confirmed server identity saved
    const updatedInspection = mockInspections.get(inspectionId);
    expect(updatedInspection.server_id).toBe('c8d67a91-4e4b-4b2a-8745-f09b2b512c01');
    expect(updatedInspection.supabase_id).toBe('c8d67a91-4e4b-4b2a-8745-f09b2b512c01');
  });

  // 3. Existing inspection retry without duplicates: uses onConflict: 'id' with server_id
  it('retries existing inspection using onConflict: id with server_id, preventing duplicate database rows', async () => {
    const inspectionId = 'INS-20261017-291';
    const serverUuid = 'c8d67a91-4e4b-4b2a-8745-f09b2b512c01';

    // Inspection already has server_id from previous attempt
    mockInspections.set(inspectionId, {
      id: inspectionId,
      server_id: serverUuid,
      supabase_id: serverUuid,
      status: 'COMPLETED',
      sync_status: 'FAILED',
      metadata: { consent: true }
    });

    mockJobs.set('job_retry', { id: 'job_retry', inspection_id: inspectionId, status: 'FAILED' });

    await SyncEngine.startSync();

    expect(capturedUpsertPayloads.length).toBe(1);
    expect(capturedUpsertPayloads[0].id).toBe(serverUuid);
    expect(capturedInsertPayloads.length).toBe(0); // Never does a blind duplicate insert
  });

  // 4. Media uploads begin only after server inspection identity exists
  it('initiates media uploads only after server-side inspection identity is confirmed', async () => {
    const inspectionId = 'INS-20261017-291';
    let inspectionUpsertCompleted = false;
    let uploadStartedBeforeUpsert = false;

    vi.spyOn(supabase, 'from').mockImplementation((table) => {
      if (table === 'field_inspections') {
        return {
          upsert: vi.fn().mockImplementation((payload) => {
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockImplementation(async () => {
                  await new Promise(r => setTimeout(r, 20));
                  inspectionUpsertCompleted = true;
                  return { data: { id: 'c8d67a91-4e4b-4b2a-8745-f09b2b512c01' }, error: null };
                })
              }),
              error: null
            };
          }),
          insert: vi.fn().mockImplementation((payload) => {
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockImplementation(async () => {
                  await new Promise(r => setTimeout(r, 20));
                  inspectionUpsertCompleted = true;
                  return { data: { id: 'c8d67a91-4e4b-4b2a-8745-f09b2b512c01' }, error: null };
                })
              }),
              error: null
            };
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: null, error: null })
          })
        };
      }
      return {
        upsert: vi.fn().mockReturnValue({ error: null }),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) })
      };
    });

    vi.spyOn(GoogleDriveService, 'uploadFile').mockImplementation(async () => {
      if (!inspectionUpsertCompleted) {
        uploadStartedBeforeUpsert = true;
      }
      return { id: 'drive_ok' };
    });

    mockInspections.set(inspectionId, { id: inspectionId, status: 'COMPLETED', sync_status: 'QUEUED' });
    mockMedia.set('p1', {
      id: 'p1',
      inspection_id: inspectionId,
      type: 'photo',
      original_blob: new Blob(['evidence']),
      sync_status: 'PENDING_UPLOAD'
    });
    mockJobs.set('job_order', { id: 'job_order', inspection_id: inspectionId, status: 'QUEUED' });

    await SyncEngine.startSync();

    expect(uploadStartedBeforeUpsert).toBe(false);
    expect(inspectionUpsertCompleted).toBe(true);
    expect(mockMedia.get('p1').sync_status).toBe('UPLOADED');
  });

  // 5. Preserves all local evidence if Supabase upsert fails
  it('preserves all local evidence intact without loss when Supabase upsert fails', async () => {
    const inspectionId = 'INS-20261017-291';
    const localBlob = new Blob(['critical_photo'], { type: 'image/jpeg' });

    vi.spyOn(supabase, 'from').mockReturnValue({
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Network timeout to Supabase' } })
        }),
        error: { message: 'Network timeout to Supabase' }
      }),
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Network timeout to Supabase' } })
        }),
        error: { message: 'Network timeout to Supabase' }
      })
    });

    mockInspections.set(inspectionId, { id: inspectionId, status: 'COMPLETED', sync_status: 'QUEUED' });
    mockMedia.set('p_crit', {
      id: 'p_crit',
      inspection_id: inspectionId,
      type: 'photo',
      original_blob: localBlob,
      sync_status: 'PENDING_UPLOAD'
    });
    mockJobs.set('job_fail', { id: 'job_fail', inspection_id: inspectionId, status: 'QUEUED' });

    await SyncEngine.startSync();

    // Verification: local blob is 100% preserved
    const savedMedia = mockMedia.get('p_crit');
    expect(savedMedia.original_blob).toBe(localBlob);
    expect(savedMedia.sync_status).toBe('PENDING_UPLOAD'); // Not corrupted
    expect(mockJobs.get('job_fail').status).toBe('FAILED');
    expect(mockJobs.get('job_fail').last_error).toContain('Supabase inspection record upsert failed');
  });
});
