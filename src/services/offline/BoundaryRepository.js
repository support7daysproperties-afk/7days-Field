/**
 * BoundaryRepository — Local IndexedDB storage for property boundary records.
 *
 * Each boundary record maps to one inspection and stores:
 *   - GeoJSON Polygon geometry (coordinates)
 *   - Calculated area (sqft, acres, cents, sq_m, hectares)
 *   - Perimeter in metres
 *   - Centre point
 *   - Capture metadata
 *   - sync_status: 'LOCAL_ONLY' | 'QUEUED' | 'SYNCING' | 'SYNCED' | 'FAILED'
 */

import DatabaseService from './DatabaseService';

class BoundaryRepository {
  /**
   * Save or overwrite the boundary for an inspection.
   * @param {object} boundary - Boundary record
   * @returns {object} saved record
   */
  async saveBoundary(boundary) {
    const db = await DatabaseService.getDB();
    const now = new Date().toISOString();
    const record = {
      ...boundary,
      updated_at: now,
      created_at: boundary.created_at || now,
    };
    await db.put('boundaries', record);
    return record;
  }

  /**
   * Get boundary by its own ID.
   */
  async getBoundary(id) {
    const db = await DatabaseService.getDB();
    return await db.get('boundaries', id);
  }

  /**
   * Get the boundary for a given inspection (there should be at most one).
   * Returns null if none exists.
   */
  async getBoundaryForInspection(inspectionId) {
    const db = await DatabaseService.getDB();
    const all = await db.getAllFromIndex('boundaries', 'inspection_id', inspectionId);
    return all.length > 0 ? all[all.length - 1] : null;
  }

  /**
   * Get all boundaries with a given sync_status.
   */
  async getBoundariesBySyncStatus(status) {
    const db = await DatabaseService.getDB();
    return await db.getAllFromIndex('boundaries', 'sync_status', status);
  }

  async deleteBoundary(id) {
    const db = await DatabaseService.getDB();
    await db.delete('boundaries', id);
  }
}

export default new BoundaryRepository();
