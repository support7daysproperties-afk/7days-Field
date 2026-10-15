import DatabaseService from './DatabaseService';

class DriveAuthRepository {
  async getAuth(userId) {
    if (!userId) return null;
    const db = await DatabaseService.getDB();
    return await db.get('drive_auth', userId);
  }

  async saveAuth(authRecord) {
    if (!authRecord?.userId) return null;
    const db = await DatabaseService.getDB();
    const now = new Date().toISOString();
    const record = {
      ...authRecord,
      updated_at: now,
      created_at: authRecord.created_at || now,
    };
    await db.put('drive_auth', record);
    return record;
  }

  async deleteAuth(userId) {
    if (!userId) return;
    const db = await DatabaseService.getDB();
    await db.delete('drive_auth', userId);
  }
}

export default new DriveAuthRepository();
