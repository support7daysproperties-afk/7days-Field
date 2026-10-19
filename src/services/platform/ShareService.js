import { Capacitor, registerPlugin } from '@capacitor/core';
import GoogleDriveService from '../GoogleDriveService';
import InspectionRepository from '../offline/InspectionRepository';
import ConnectivityService from '../offline/ConnectivityService';

const NativeShare = registerPlugin('NativeShare');

export const SHARE_STATE = {
  READY: 'READY',
  PENDING_SYNC: 'PENDING_SYNC',
  FAILED_SYNC: 'FAILED_SYNC',
  NO_FOLDER_URL: 'NO_FOLDER_URL',
  OFFLINE_READY: 'OFFLINE_READY',
  OFFLINE_NO_URL: 'OFFLINE_NO_URL',
};

class ShareService {
  constructor() {
    this._inFlightRequests = new Map();
  }

  /**
   * Format standard share message according to 7Days Field specification.
   */
  formatShareMessage({ inspectionId, propertyName, folderUrl }) {
    const propDisplay = propertyName?.trim() || 'Property Inspection';
    const insDisplay = inspectionId?.trim() || 'N/A';
    const urlDisplay = folderUrl?.trim() || '';

    return [
      '7Days Field — Completed Inspection',
      '',
      `Inspection: ${insDisplay}`,
      `Property: ${propDisplay}`,
      '',
      'Inspection files and evidence:',
      urlDisplay,
    ].join('\n');
  }

  /**
   * Evaluate the inspection's current sharing eligibility.
   */
  getInspectionShareState(inspection) {
    if (!inspection) {
      return {
        canShare: false,
        state: SHARE_STATE.PENDING_SYNC,
        message: 'No inspection record provided.',
        folderUrl: null,
      };
    }

    const isFullySynced = inspection.sync_status === 'SYNCED';
    const isOnline = ConnectivityService.online && (typeof navigator === 'undefined' || navigator.onLine);
    const folderId = inspection.drive_folder_id || null;
    const folderUrl = inspection.drive_folder_url || (folderId ? GoogleDriveService.getFolderWebUrl(folderId) : null);

    // Case 1: Fully Synced with folder URL
    if (isFullySynced && folderUrl) {
      return {
        canShare: true,
        state: isOnline ? SHARE_STATE.READY : SHARE_STATE.OFFLINE_READY,
        message: isOnline ? 'Ready to share' : 'Ready to share offline (using stored Drive link)',
        folderUrl,
        folderId,
      };
    }

    // Case 2: Offline with existing valid URL
    if (!isOnline && folderUrl) {
      return {
        canShare: true,
        state: SHARE_STATE.OFFLINE_READY,
        message: 'Device is offline. Sharing previously verified Drive folder link.',
        folderUrl,
        folderId,
      };
    }

    // Case 3: Offline without URL
    if (!isOnline) {
      return {
        canShare: false,
        state: SHARE_STATE.OFFLINE_NO_URL,
        message: 'Inspection upload requires internet connectivity. Connect to the internet and sync before sharing.',
        folderUrl: null,
        folderId: null,
      };
    }

    // Case 4: Sync failed or partially synced
    if (inspection.sync_status === 'FAILED' || inspection.sync_status === 'PARTIALLY_SYNCED') {
      return {
        canShare: false,
        state: SHARE_STATE.FAILED_SYNC,
        message: 'Inspection upload is incomplete or encountered errors. Retry sync before sharing.',
        folderUrl: null,
        folderId,
      };
    }

    // Case 5: Pending synchronization
    return {
      canShare: false,
      state: SHARE_STATE.PENDING_SYNC,
      message: 'Inspection upload is still pending. Sync the inspection before sharing.',
      folderUrl: null,
      folderId,
    };
  }

  /**
   * Prepares and verifies Google Drive sharing permissions.
   * Single-flight per inspection ID to prevent conflicting concurrent requests.
   */
  async prepareShareLink(inspection, { verifyPermission = true } = {}) {
    if (!inspection) throw new Error('Inspection record required');

    const shareCheck = this.getInspectionShareState(inspection);
    if (!shareCheck.canShare) {
      const err = new Error(shareCheck.message);
      err.shareState = shareCheck.state;
      throw err;
    }

    const folderId = shareCheck.folderId || inspection.drive_folder_id;
    let folderUrl = shareCheck.folderUrl || inspection.drive_folder_url;

    if (!folderId && !folderUrl) {
      throw new Error('Google Drive folder information not found for this inspection.');
    }

    // Check single-flight lock
    if (this._inFlightRequests.has(inspection.id)) {
      return this._inFlightRequests.get(inspection.id);
    }

    const promise = (async () => {
      const isOnline = ConnectivityService.online && (typeof navigator === 'undefined' || navigator.onLine);

      // Verify and set read permissions if online and not previously verified
      if (isOnline && verifyPermission && folderId && inspection.drive_folder_permission_status !== 'VERIFIED') {
        try {
          const permResult = await GoogleDriveService.ensureFolderShareable(folderId, 'reader');
          if (permResult?.folderUrl) {
            folderUrl = permResult.folderUrl;
          }

          // Persist verified permission status locally so future shares don't re-query
          await InspectionRepository.saveInspection({
            ...inspection,
            drive_folder_id: folderId,
            drive_folder_url: folderUrl,
            drive_folder_permission_status: 'VERIFIED',
          });
        } catch (permErr) {
          console.warn('[ShareService] Notice verifying Drive folder permissions:', permErr.message);
          // If already has URL, we can still proceed with stored URL if permission check failed non-fatally
          if (!folderUrl) {
            throw permErr;
          }
        }
      }

      return {
        folderId,
        folderUrl: folderUrl || GoogleDriveService.getFolderWebUrl(folderId),
      };
    })().finally(() => {
      this._inFlightRequests.delete(inspection.id);
    });

    this._inFlightRequests.set(inspection.id, promise);
    return promise;
  }

  /**
   * Share the inspection via Native Android share sheet, Web Share API, or Clipboard fallback.
   */
  async shareInspection(inspection, options = {}) {
    const { folderUrl } = await this.prepareShareLink(inspection, options);

    const title = '7Days Field — Completed Inspection';
    const text = this.formatShareMessage({
      inspectionId: inspection.id,
      propertyName: inspection.property_name || inspection.title,
      folderUrl,
    });

    // 1. Android / iOS Native share via Capacitor plugin
    if (Capacitor.isNativePlatform()) {
      try {
        await NativeShare.share({
          title,
          text,
          url: folderUrl,
          dialogTitle: 'Share Inspection via',
        });
        return { success: true, method: 'native', url: folderUrl };
      } catch (err) {
        console.warn('[ShareService] Native share failed or was dismissed:', err);
        // Fallback to clipboard if available
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(text);
          return { success: true, method: 'clipboard_fallback', url: folderUrl };
        }
        throw err;
      }
    }

    // 2. Web browser: Use Web Share API if supported
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title,
          text,
          url: folderUrl,
        });
        return { success: true, method: 'web_share', url: folderUrl };
      } catch (err) {
        // AbortError indicates user dismissed share sheet; treat as clean exit without error
        if (err.name === 'AbortError') {
          return { success: false, dismissed: true, url: folderUrl };
        }
        console.warn('[ShareService] Web share failed, falling back to clipboard:', err);
      }
    }

    // 3. Fallback: Copy to clipboard
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return { success: true, method: 'clipboard', url: folderUrl };
    }

    return { success: false, url: folderUrl, message: 'Sharing not supported on this platform' };
  }

  /**
   * Copy the formatted share text or direct folder URL to clipboard.
   */
  async copyInspectionLink(inspection, { copyFullMessage = false } = {}) {
    const { folderUrl } = await this.prepareShareLink(inspection, { verifyPermission: false });
    const contentToCopy = copyFullMessage
      ? this.formatShareMessage({
          inspectionId: inspection.id,
          propertyName: inspection.property_name || inspection.title,
          folderUrl,
        })
      : folderUrl;

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(contentToCopy);
      return { success: true, url: folderUrl };
    }

    throw new Error('Clipboard is unavailable on this device');
  }
}

export default new ShareService();
