import DatabaseService from './DatabaseService';

class MediaRepository {
  async saveMedia(media) {
    const db = await DatabaseService.getDB();
    const now = new Date().toISOString();
    
    const record = {
      ...media,
      updated_at: now,
      created_at: media.created_at || now,
    };

    await db.put('media', record);
    return record;
  }

  async getMedia(id) {
    const db = await DatabaseService.getDB();
    return await db.get('media', id);
  }

  async getMediaForInspection(inspectionId) {
    const db = await DatabaseService.getDB();
    return await db.getAllFromIndex('media', 'inspection_id', inspectionId);
  }

  async getMediaByStatus(status) {
    const db = await DatabaseService.getDB();
    return await db.getAllFromIndex('media', 'sync_status', status);
  }

  async getPendingMedia() {
    return await this.getMediaByStatus('PENDING_UPLOAD');
  }

  async getUploadingMedia() {
    return await this.getMediaByStatus('UPLOADING');
  }

  async deleteMedia(id) {
    const db = await DatabaseService.getDB();
    await db.delete('media', id);
  }
}

export default new MediaRepository();
