import DatabaseService from './DatabaseService';

class InspectionRepository {
  async saveInspection(inspection) {
    const db = await DatabaseService.getDB();
    const now = new Date().toISOString();
    const currentUserId = DatabaseService.userId || DatabaseService._resolveCurrentUserId();
    const currentEmail = DatabaseService.userEmail || DatabaseService._resolveCurrentUserEmail();
    const currentSupervisorId = DatabaseService.supervisorId;
    
    const record = {
      ...inspection,
      auth_user_id: inspection.auth_user_id || currentUserId || null,
      user_email: (inspection.user_email || currentEmail || '').toLowerCase().trim() || null,
      supervisor_id: inspection.supervisor_id || currentSupervisorId || null,
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
    const currentEmail = (DatabaseService.userEmail || DatabaseService._resolveCurrentUserEmail() || '').toLowerCase().trim();
    const currentSupervisorId = DatabaseService.supervisorId;

    if (!currentUserId && !currentEmail) return all;

    return all.filter(ins => {
      // 1. Untagged records belong to the active partition
      if (!ins.auth_user_id && !ins.user_email) return true;
      // 2. Email match (primary human supervisor identity)
      if (currentEmail && ins.user_email && ins.user_email.toLowerCase() === currentEmail) return true;
      // 3. Auth user ID match
      if (currentUserId && ins.auth_user_id && ins.auth_user_id === currentUserId) return true;
      // 4. Supervisor ID match
      if (currentSupervisorId && ins.supervisor_id && ins.supervisor_id === currentSupervisorId) return true;
      // 5. If it had no auth_user_id, keep it in the active partition
      if (!ins.auth_user_id) return true;

      return false;
    });
  }

  async getInspectionsBySyncStatus(status) {
    const all = await this.getAllInspections();
    return all.filter(ins => ins.sync_status === status);
  }

  async deleteInspection(id) {
    const db = await DatabaseService.getDB();
    await db.delete('inspections', id);
    DatabaseService._notify({ type: 'inspection_deleted', inspectionId: id });
  }
}

export default new InspectionRepository();
