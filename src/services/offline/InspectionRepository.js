import DatabaseService from './DatabaseService';

class InspectionRepository {
  async saveInspection(inspection) {
    const db = await DatabaseService.getDB();
    const now = new Date().toISOString();
    const currentUserId = DatabaseService.userId || DatabaseService._resolveCurrentUserId();
    
    const record = {
      ...inspection,
      auth_user_id: inspection.auth_user_id || currentUserId || null,
      updated_at: now,
      created_at: inspection.created_at || now,
    };

    await db.put('inspections', record);
    DatabaseService._notify({ type: 'inspection_saved', inspectionId: record.id, status: record.status });
    return record;
  }

  async getInspection(id) {
    const db = await DatabaseService.getDB();
    return await db.get('inspections', id);
  }

  async getAllInspections() {
    const db = await DatabaseService.getDB();
    const all = await db.getAll('inspections');
    const currentUserId = DatabaseService.userId || DatabaseService._resolveCurrentUserId();
    if (!currentUserId) return all;
    // Defense-in-depth: do not leak inspections belonging to a different user
    return all.filter(ins => !ins.auth_user_id || ins.auth_user_id === currentUserId);
  }

  async getInspectionsBySyncStatus(status) {
    const db = await DatabaseService.getDB();
    const items = await db.getAllFromIndex('inspections', 'sync_status', status);
    const currentUserId = DatabaseService.userId || DatabaseService._resolveCurrentUserId();
    if (!currentUserId) return items;
    return items.filter(ins => !ins.auth_user_id || ins.auth_user_id === currentUserId);
  }

  async deleteInspection(id) {
    const db = await DatabaseService.getDB();
    await db.delete('inspections', id);
    DatabaseService._notify({ type: 'inspection_deleted', inspectionId: id });
  }
}

export default new InspectionRepository();
