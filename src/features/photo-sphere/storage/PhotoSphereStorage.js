/**
 * PhotoSphereStorage.js
 *
 * IndexedDB storage for Photo Sphere capture sessions, raw frames, and stitched panoramas.
 * Implements strict offline-first persistence so captured images are never lost even if
 * browser closes or stitching fails.
 */

import { openDB } from 'idb';

const DB_NAME = 'PhotoSphereDB';
const DB_VERSION = 1;

class PhotoSphereStorage {
  constructor() {
    this.dbPromise = this.initDB();
  }

  async initDB() {
    return openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('sessions')) {
          const sStore = db.createObjectStore('sessions', { keyPath: 'id' });
          sStore.createIndex('inspection_id', 'inspectionId');
        }
        if (!db.objectStoreNames.contains('frames')) {
          const fStore = db.createObjectStore('frames', { keyPath: 'id' });
          fStore.createIndex('session_id', 'sessionId');
        }
        if (!db.objectStoreNames.contains('panoramas')) {
          const pStore = db.createObjectStore('panoramas', { keyPath: 'id' });
          pStore.createIndex('session_id', 'sessionId');
          pStore.createIndex('inspection_id', 'inspectionId');
        }
      },
    });
  }

  async createSession(inspectionId, metadata = {}) {
    const db = await this.dbPromise;
    const session = {
      id: `ps_session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      inspectionId,
      status: 'capturing', // capturing | stitching | completed | failed
      createdAt: Date.now(),
      updatedAt: Date.now(),
      targetCount: 0,
      capturedCount: 0,
      metadata,
    };
    await db.put('sessions', session);
    return session;
  }

  async updateSession(id, updates) {
    const db = await this.dbPromise;
    const session = await db.get('sessions', id);
    if (!session) return null;
    const updated = { ...session, ...updates, updatedAt: Date.now() };
    await db.put('sessions', updated);
    return updated;
  }

  async getSession(id) {
    const db = await this.dbPromise;
    return db.get('sessions', id);
  }

  async saveFrame(frameRecord) {
    const db = await this.dbPromise;
    const record = {
      id: frameRecord.id || `ps_frame_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sessionId: frameRecord.sessionId,
      targetId: frameRecord.targetId,
      sequenceIndex: frameRecord.sequenceIndex,
      yaw: frameRecord.yaw,
      pitch: frameRecord.pitch,
      roll: frameRecord.roll || 0,
      blob: frameRecord.blob, // Blob stored directly in IndexedDB
      capturedAt: frameRecord.capturedAt || Date.now(),
      width: frameRecord.width,
      height: frameRecord.height,
    };
    await db.put('frames', record);
    return record;
  }

  async getFramesForSession(sessionId) {
    const db = await this.dbPromise;
    const frames = await db.getAllFromIndex('frames', 'session_id', sessionId);
    return frames.sort((a, b) => (a.sequenceIndex ?? 0) - (b.sequenceIndex ?? 0));
  }

  async savePanorama(panoramaRecord) {
    const db = await this.dbPromise;
    const record = {
      id: panoramaRecord.id || `ps_pano_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sessionId: panoramaRecord.sessionId,
      inspectionId: panoramaRecord.inspectionId,
      blob: panoramaRecord.blob,
      width: panoramaRecord.width,
      height: panoramaRecord.height,
      isCompleteSphere: panoramaRecord.isCompleteSphere ?? true,
      metadata: panoramaRecord.metadata || {},
      createdAt: Date.now(),
    };
    await db.put('panoramas', record);
    return record;
  }

  async getPanorama(id) {
    const db = await this.dbPromise;
    return db.get('panoramas', id);
  }

  async getPanoramasForInspection(inspectionId) {
    const db = await this.dbPromise;
    return db.getAllFromIndex('panoramas', 'inspection_id', inspectionId);
  }
}

export const photoSphereStorage = new PhotoSphereStorage();
