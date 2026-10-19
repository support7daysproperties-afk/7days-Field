import { describe, it, expect, beforeEach, vi } from 'vitest';
import ShareService, { SHARE_STATE } from '../src/services/platform/ShareService';
import GoogleDriveService from '../src/services/GoogleDriveService';
import InspectionRepository from '../src/services/offline/InspectionRepository';
import ConnectivityService from '../src/services/offline/ConnectivityService';

describe('ShareService & Google Drive Folder Sharing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    ConnectivityService.online = true;
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
  });

  describe('formatShareMessage', () => {
    it('formats a standardized share message with inspection ID, property name, and Drive URL', () => {
      const msg = ShareService.formatShareMessage({
        inspectionId: 'INS-20261017-870',
        propertyName: 'Green Valley Plot 4B',
        folderUrl: 'https://drive.google.com/drive/folders/1abc987xyz',
      });

      expect(msg).toContain('7Days Field — Completed Inspection');
      expect(msg).toContain('Inspection: INS-20261017-870');
      expect(msg).toContain('Property: Green Valley Plot 4B');
      expect(msg).toContain('Inspection files and evidence:');
      expect(msg).toContain('https://drive.google.com/drive/folders/1abc987xyz');
    });

    it('falls back gracefully when propertyName is missing', () => {
      const msg = ShareService.formatShareMessage({
        inspectionId: 'INS-001',
        propertyName: null,
        folderUrl: 'https://drive.google.com/drive/folders/xyz',
      });

      expect(msg).toContain('Property: Property Inspection');
      expect(msg).toContain('Inspection: INS-001');
    });
  });

  describe('getInspectionShareState (State Machine & Permissions Check)', () => {
    it('returns READY for a fully synced inspection with a Drive folder URL when online', () => {
      ConnectivityService.online = true;
      const inspection = {
        id: 'ins_1',
        title: 'Survey 1',
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        drive_folder_id: 'folder_123',
        drive_folder_url: 'https://drive.google.com/drive/folders/folder_123',
      };

      const result = ShareService.getInspectionShareState(inspection);
      expect(result.canShare).toBe(true);
      expect(result.state).toBe(SHARE_STATE.READY);
      expect(result.folderUrl).toBe('https://drive.google.com/drive/folders/folder_123');
    });

    it('returns PENDING_SYNC and disallows sharing when inspection upload is still pending', () => {
      ConnectivityService.online = true;
      const inspection = {
        id: 'ins_pending',
        title: 'Pending Survey',
        status: 'COMPLETED',
        sync_status: 'LOCAL_ONLY',
        drive_folder_id: null,
        drive_folder_url: null,
      };

      const result = ShareService.getInspectionShareState(inspection);
      expect(result.canShare).toBe(false);
      expect(result.state).toBe(SHARE_STATE.PENDING_SYNC);
      expect(result.message).toContain('Inspection upload is still pending');
    });

    it('returns FAILED_SYNC when inspection sync failed or is incomplete', () => {
      ConnectivityService.online = true;
      const inspection = {
        id: 'ins_failed',
        title: 'Failed Survey',
        status: 'COMPLETED',
        sync_status: 'FAILED',
        drive_folder_id: 'folder_partial',
        drive_folder_url: 'https://drive.google.com/drive/folders/folder_partial',
      };

      const result = ShareService.getInspectionShareState(inspection);
      expect(result.canShare).toBe(false);
      expect(result.state).toBe(SHARE_STATE.FAILED_SYNC);
      expect(result.message).toContain('Retry sync before sharing');
    });

    it('allows OFFLINE_READY sharing when offline if inspection was previously synced with a valid Drive folder URL', () => {
      ConnectivityService.online = false;
      const inspection = {
        id: 'ins_offline_synced',
        title: 'Offline Survey',
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        drive_folder_id: 'folder_stored',
        drive_folder_url: 'https://drive.google.com/drive/folders/folder_stored',
      };

      const result = ShareService.getInspectionShareState(inspection);
      expect(result.canShare).toBe(true);
      expect(result.state).toBe(SHARE_STATE.OFFLINE_READY);
      expect(result.folderUrl).toBe('https://drive.google.com/drive/folders/folder_stored');
      expect(result.message).toContain('stored Drive link');
    });

    it('rejects sharing with OFFLINE_NO_URL when offline and no Drive folder URL has ever been generated', () => {
      ConnectivityService.online = false;
      const inspection = {
        id: 'ins_offline_unsynced',
        title: 'Unsynced Offline Survey',
        status: 'COMPLETED',
        sync_status: 'LOCAL_ONLY',
        drive_folder_id: null,
        drive_folder_url: null,
      };

      const result = ShareService.getInspectionShareState(inspection);
      expect(result.canShare).toBe(false);
      expect(result.state).toBe(SHARE_STATE.OFFLINE_NO_URL);
      expect(result.message).toContain('Connect to the internet and sync');
    });
  });

  describe('GoogleDriveService permissions & folder URL', () => {
    it('constructs canonical Drive folder URL from folderId', () => {
      const url = GoogleDriveService.getFolderWebUrl('abc_123_xyz');
      expect(url).toBe('https://drive.google.com/drive/folders/abc_123_xyz');
      expect(GoogleDriveService.getFolderWebUrl(null)).toBeNull();
    });

    it('ensureFolderShareable detects existing "anyone" permission and avoids redundant write', async () => {
      vi.spyOn(GoogleDriveService, 'getFolderPermissions').mockResolvedValue([
        { id: 'perm_anyone', type: 'anyone', role: 'reader' }
      ]);
      const fetchSpy = vi.spyOn(GoogleDriveService, '_fetchWithRetry');

      const result = await GoogleDriveService.ensureFolderShareable('folder_existing_perm');
      expect(result.success).toBe(true);
      expect(result.alreadyShareable).toBe(true);
      expect(result.folderUrl).toBe('https://drive.google.com/drive/folders/folder_existing_perm');
      // Should NOT have made a POST call to create permission
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('ensureFolderShareable adds viewer reader permission when not yet present', async () => {
      vi.spyOn(GoogleDriveService, 'getFolderPermissions').mockResolvedValue([]);
      vi.spyOn(GoogleDriveService, '_fetchWithRetry').mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'new_perm_id', role: 'reader', type: 'anyone' }),
      });

      const result = await GoogleDriveService.ensureFolderShareable('folder_new_perm', 'reader');
      expect(result.success).toBe(true);
      expect(result.alreadyShareable).toBe(false);
      expect(result.permissionId).toBe('new_perm_id');
      expect(result.role).toBe('reader');
    });
  });

  describe('prepareShareLink & Single-flight concurrency', () => {
    it('prevents repeated taps from triggering conflicting permission calls via single-flight lock', async () => {
      ConnectivityService.online = true;
      const inspection = {
        id: 'ins_concurrent',
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        drive_folder_id: 'folder_concurrent',
        drive_folder_url: 'https://drive.google.com/drive/folders/folder_concurrent',
        drive_folder_permission_status: null,
      };

      vi.spyOn(InspectionRepository, 'saveInspection').mockResolvedValue(inspection);
      const permSpy = vi.spyOn(GoogleDriveService, 'ensureFolderShareable').mockImplementation(async () => {
        await new Promise(r => setTimeout(r, 50));
        return { success: true, folderUrl: 'https://drive.google.com/drive/folders/folder_concurrent' };
      });

      // Fire 3 simultaneous prepareShareLink calls
      const [res1, res2, res3] = await Promise.all([
        ShareService.prepareShareLink(inspection),
        ShareService.prepareShareLink(inspection),
        ShareService.prepareShareLink(inspection),
      ]);

      expect(res1.folderUrl).toBe('https://drive.google.com/drive/folders/folder_concurrent');
      expect(res2.folderUrl).toBe('https://drive.google.com/drive/folders/folder_concurrent');
      expect(res3.folderUrl).toBe('https://drive.google.com/drive/folders/folder_concurrent');
      // Should only call ensureFolderShareable ONCE due to single-flight deduplication
      expect(permSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Clipboard & Web Share Fallbacks', () => {
    it('falls back to clipboard when native and web share are unavailable', async () => {
      const inspection = {
        id: 'ins_copy_test',
        property_name: 'Test Estate',
        status: 'COMPLETED',
        sync_status: 'SYNCED',
        drive_folder_id: 'f_copy',
        drive_folder_url: 'https://drive.google.com/drive/folders/f_copy',
        drive_folder_permission_status: 'VERIFIED',
      };

      let clipboardWritten = '';
      Object.assign(navigator, {
        clipboard: {
          writeText: vi.fn().mockImplementation(async (text) => {
            clipboardWritten = text;
          }),
        },
        share: undefined,
      });

      const res = await ShareService.shareInspection(inspection);
      expect(res.success).toBe(true);
      expect(res.method).toBe('clipboard');
      expect(clipboardWritten).toContain('7Days Field — Completed Inspection');
      expect(clipboardWritten).toContain('https://drive.google.com/drive/folders/f_copy');
    });
  });
});
