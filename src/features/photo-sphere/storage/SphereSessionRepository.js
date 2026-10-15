/**
 * SphereSessionRepository.js
 *
 * Dedicated offline storage repository for Photo Sphere sessions, frames, and panoramas.
 * Uses a dedicated IndexedDB database ("PhotoSphereModuleDB", version 1) to remain
 * 100% decoupled from any legacy land360 database schemas.
 */

import { openDB } from 'idb';

const DB_NAME = 'PhotoSphereModuleDB';
const DB_VERSION = 1;

export class SphereSessionRepository {
  constructor() {
    this.dbPromise = this.initDB();
  }

  async initDB() {
    return openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Sessions store
        if (!db.objectStoreNames.contains('sessions')) {
          const sessionStore = db.createObjectStore('sessions', { keyPath: 'id' });
          sessionStore.createIndex('property_id', 'propertyId');
          sessionStore.createIndex('inspection_id', 'inspectionId');
          sessionStore.createIndex('status', 'status');
        }

        // Frames store
        if (!db.objectStoreNames.contains('frames')) {
          const frameStore = db.createObjectStore('frames', { keyPath: 'id' });
          frameStore.createIndex('session_id', 'sessionId');
          frameStore.createIndex('target_id', 'targetId');
          frameStore.createIndex('created_at', 'createdAt');
        }

        // Panoramas store
        if (!db.objectStoreNames.contains('panoramas')) {
          const panoStore = db.createObjectStore('panoramas', { keyPath: 'id' });
          panoStore.createIndex('session_id', 'sessionId');
        }
      },
    });
  }

  _generateId(prefix = 'sph') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
  }

  /**
   * Creates a new Photo Sphere capture session.
   * @param {object} params
   * @param {string} [params.propertyId]
   * @param {string} [params.inspectionId]
   * @param {string} [params.supervisorId]
   * @param {object[]} params.targetPlan
   * @returns {Promise<PhotoSphereSession>}
   */
  async createSession({ propertyId = null, inspectionId = null, supervisorId = null, targetPlan = [] }) {
    const db = await this.dbPromise;
    const session = {
      id: this._generateId('sess'),
      propertyId,
      inspectionId,
      supervisorId,
      status: 'in_progress', // 'in_progress' | 'completed' | 'abandoned'
      createdAt: Date.now(),
      updatedAt: Date.now(),
      targetPlan,
    };
    await db.put('sessions', session);
    return session;
  }

  async getSession(sessionId) {
    const db = await this.dbPromise;
    return db.get('sessions', sessionId);
  }

  async updateSession(session) {
    const db = await this.dbPromise;
    const updated = { ...session, updatedAt: Date.now() };
    await db.put('sessions', updated);
    return updated;
  }

  /**
   * Persists a captured frame and its orientation metadata.
   * @param {object} frameData
   * @returns {Promise<PhotoSphereFrame>}
   */
  async saveFrame(frameData) {
    const db = await this.dbPromise;
    const frame = {
      id: frameData.id || this._generateId('frm'),
      sessionId: frameData.sessionId,
      targetId: frameData.targetId,
      sequenceNumber: frameData.sequenceNumber || 1,
      yaw: frameData.yaw,
      pitch: frameData.pitch,
      roll: frameData.roll || 0,
      imageBlobOrUri: frameData.imageBlobOrUri, // Data URI or Blob
      captureMethod: frameData.captureMethod || 'auto', // 'auto' | 'manual'
      createdAt: Date.now(),
    };
    await db.put('frames', frame);
    return frame;
  }

  /**
   * Retrieves all frames for a session ordered by sequence.
   * @param {string} sessionId
   * @returns {Promise<PhotoSphereFrame[]>}
   */
  async getFramesForSession(sessionId) {
    const db = await this.dbPromise;
    const frames = await db.getAllFromIndex('frames', 'session_id', sessionId);
    return frames.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  }

  /**
   * Deletes a specific frame (used for Undo).
   * @param {string} frameId
   */
  async deleteFrame(frameId) {
    const db = await this.dbPromise;
    await db.delete('frames', frameId);
  }

  /**
   * Clears all frames for a session (used for Restart).
   * @param {string} sessionId
   */
  async clearSessionFrames(sessionId) {
    const db = await this.dbPromise;
    const frames = await this.getFramesForSession(sessionId);
    const tx = db.transaction('frames', 'readwrite');
    for (const f of frames) {
      await tx.store.delete(f.id);
    }
    await tx.done;
  }

  /**
   * Stores final stitched panorama record.
   * @param {object} panoData
   * @returns {Promise<PhotoSpherePanorama>}
   */
  async savePanorama(panoData) {
    const db = await this.dbPromise;
    const pano = {
      id: panoData.id || this._generateId('pano'),
      sessionId: panoData.sessionId,
      propertyId: panoData.propertyId || null,
      inspectionId: panoData.inspectionId || null,
      panoramaBlobOrUri: panoData.panoramaBlobOrUri,
      width: panoData.width,
      height: panoData.height,
      coveragePercent: panoData.coveragePercent,
      hasGPanoMetadata: panoData.hasGPanoMetadata || false,
      createdAt: Date.now(),
    };
    await db.put('panoramas', pano);
    return pano;
  }

  async getPanoramaForSession(sessionId) {
    const db = await this.dbPromise;
    const panos = await db.getAllFromIndex('panoramas', 'session_id', sessionId);
    return panos.length > 0 ? panos[panos.length - 1] : null;
  }
}

export const sphereSessionRepository = new SphereSessionRepository();
