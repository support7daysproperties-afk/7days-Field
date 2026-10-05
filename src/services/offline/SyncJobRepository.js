import DatabaseService from './DatabaseService';

// Sync job status values:
// QUEUED → SYNCING → SYNCED
//                  → FAILED
//                  → NEEDS_DRIVE_AUTH
//                  → PARTIALLY_SYNCED

class SyncJobRepository {
  async upsertJob(job) {
    const db = await DatabaseService.getDB();
    const now = new Date().toISOString();
    const record = {
      ...job,
      updated_at: now,
      created_at: job.created_at || now,
    };
    await db.put('sync_jobs', record);
    return record;
  }

  async getJob(id) {
    const db = await DatabaseService.getDB();
    return db.get('sync_jobs', id);
  }

  async getJobForInspection(inspectionId) {
    const db = await DatabaseService.getDB();
    const jobs = await db.getAllFromIndex('sync_jobs', 'inspection_id', inspectionId);
    // Return the most recent job
    return jobs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;
  }

  async getPendingJobs() {
    const db = await DatabaseService.getDB();
    const queued = await db.getAllFromIndex('sync_jobs', 'status', 'QUEUED');
    const failed = await db.getAllFromIndex('sync_jobs', 'status', 'FAILED');
    const partial = await db.getAllFromIndex('sync_jobs', 'status', 'PARTIALLY_SYNCED');
    const needsDrive = await db.getAllFromIndex('sync_jobs', 'status', 'NEEDS_DRIVE_AUTH');
    return [...queued, ...failed, ...partial, ...needsDrive];
  }

  async getAllJobs() {
    const db = await DatabaseService.getDB();
    return db.getAll('sync_jobs');
  }

  async deleteJob(id) {
    const db = await DatabaseService.getDB();
    await db.delete('sync_jobs', id);
  }
}

export default new SyncJobRepository();
