import DatabaseService from './DatabaseService';

class InspectionRepository {
  async saveInspection(inspection) {
    const db = await DatabaseService.getDB();
    const now = new Date().toISOString();
    
    const record = {
      ...inspection,
      updated_at: now,
      created_at: inspection.created_at || now,
    };

    await db.put('inspections', record);
    return record;
  }

  async getInspection(id) {
    const db = await DatabaseService.getDB();
    return await db.get('inspections', id);
  }

  async getAllInspections() {
    const db = await DatabaseService.getDB();
    return await db.getAll('inspections');
  }

  async getInspectionsBySyncStatus(status) {
    const db = await DatabaseService.getDB();
    return await db.getAllFromIndex('inspections', 'sync_status', status);
  }

  async deleteInspection(id) {
    const db = await DatabaseService.getDB();
    await db.delete('inspections', id);
  }
}

export default new InspectionRepository();
