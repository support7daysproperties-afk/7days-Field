/**
 * PhotoSphereStorage.js
 *
 * IndexedDB storage for Photo Sphere capture sessions, raw frames, and stitched panoramas.
 * Implements strict offline-first persistence so captured images are never lost even if
 * browser closes, power drops, or stitching fails.
 */

import { openDB } from 'idb';

const DB_NAME = 'PhotoSphereDB';
const DB_VERSION = 1;

class PhotoSphereStorage {
  constructor() {
    this._isMemory = typeof indexedDB === 'undefined';
    if (this._isMemory) {
      this._memSessions = new Map();
      this._memFrames = new Map();
      this._memPanos = new Map();
      this.dbPromise = Promise.resolve(null);
    } else {
      this.dbPromise = this.initDB();
    }
  }

  async initDB() {
    if (this._isMemory) return null;
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
    const session = {
      id: `ps_session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      inspectionId,
      status: 'capturing', // capturing | stitching | completed | failed
      createdAt: Date.now(),
      updatedAt: Date.now(),
      targetCount: 34,
      capturedCount: 0,
      metadata,
    };

    if (this._isMemory) {
      this._memSessions.set(session.id, session);
      return session;
    }

    const db = await this.dbPromise;
    await db.put('sessions', session);
    return session;
  }

  async updateSession(id, updates) {
    if (this._isMemory) {
      const session = this._memSessions.get(id);
      if (!session) return null;
      const updated = { ...session, ...updates, updatedAt: Date.now() };
      this._memSessions.set(id, updated);
      return updated;
    }

    const db = await this.dbPromise;
    const session = await db.get('sessions', id);
    if (!session) return null;
    const updated = { ...session, ...updates, updatedAt: Date.now() };
    await db.put('sessions', updated);
    return updated;
  }

  async getSession(id) {
    if (this._isMemory) {
      return this._memSessions.get(id) || null;
    }
    const db = await this.dbPromise;
    return db.get('sessions', id);
  }

  async getActiveSession(inspectionId) {
    if (this._isMemory) {
      const active = Array.from(this._memSessions.values()).filter(
        (s) => s.inspectionId === inspectionId && s.status === 'capturing'
      );
      if (active.length === 0) return null;
      active.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return active[0];
    }

    const db = await this.dbPromise;
    const all = await db.getAllFromIndex('sessions', 'inspection_id', inspectionId);
    const active = all.filter((s) => s.status === 'capturing');
    if (active.length === 0) return null;
    active.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return active[0];
  }

  async deleteSession(sessionId) {
    if (this._isMemory) {
      this._memSessions.delete(sessionId);
      for (const [k, v] of this._memFrames.entries()) {
        if (v.sessionId === sessionId) this._memFrames.delete(k);
      }
      return true;
    }

    const db = await this.dbPromise;
    const frames = await this.getFramesForSession(sessionId);
    const tx = db.transaction(['sessions', 'frames'], 'readwrite');
    for (const f of frames) {
      await tx.objectStore('frames').delete(f.id);
    }
    await tx.objectStore('sessions').delete(sessionId);
    await tx.done;
    return true;
  }

  async saveFrame(frameRecord) {
    const record = {
      id: frameRecord.id || `ps_frame_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sessionId: frameRecord.sessionId,
      targetId: frameRecord.targetId,
      sequenceIndex: frameRecord.sequenceIndex,
      yaw: frameRecord.yaw,
      pitch: frameRecord.pitch,
      roll: frameRecord.roll || 0,
      cameraRotationMatrix: frameRecord.cameraRotationMatrix || null,
      blob: frameRecord.blob,
      capturedAt: frameRecord.capturedAt || Date.now(),
      width: frameRecord.width,
      height: frameRecord.height,
    };

    if (this._isMemory) {
      this._memFrames.set(record.id, record);
      if (frameRecord.sessionId) {
        const session = this._memSessions.get(frameRecord.sessionId);
        if (session) {
          session.capturedCount = (session.capturedCount || 0) + 1;
          session.updatedAt = Date.now();
        }
      }
      return record;
    }

    const db = await this.dbPromise;
    await db.put('frames', record);

    if (frameRecord.sessionId) {
      const session = await db.get('sessions', frameRecord.sessionId);
      if (session) {
        session.capturedCount = (session.capturedCount || 0) + 1;
        session.updatedAt = Date.now();
        await db.put('sessions', session);
      }
    }
    return record;
  }

  async deleteFrame(id) {
    if (this._isMemory) {
      const frame = this._memFrames.get(id);
      if (!frame) return false;
      this._memFrames.delete(id);
      if (frame.sessionId) {
        const session = this._memSessions.get(frame.sessionId);
        if (session) {
          session.capturedCount = Math.max(0, (session.capturedCount || 1) - 1);
          session.updatedAt = Date.now();
        }
      }
      return true;
    }

    const db = await this.dbPromise;
    const frame = await db.get('frames', id);
    if (!frame) return false;
    await db.delete('frames', id);

    if (frame.sessionId) {
      const session = await db.get('sessions', frame.sessionId);
      if (session) {
        session.capturedCount = Math.max(0, (session.capturedCount || 1) - 1);
        session.updatedAt = Date.now();
        await db.put('sessions', session);
      }
    }
    return true;
  }

  async deleteLastFrame(sessionId) {
    const frames = await this.getFramesForSession(sessionId);
    if (frames.length === 0) return null;
    const last = frames[frames.length - 1];
    await this.deleteFrame(last.id);
    return last;
  }

  async getFramesForSession(sessionId) {
    if (this._isMemory) {
      const frames = Array.from(this._memFrames.values()).filter(
        (f) => f.sessionId === sessionId
      );
      return frames.sort((a, b) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0));
    }

    const db = await this.dbPromise;
    const frames = await db.getAllFromIndex('frames', 'session_id', sessionId);
    return frames.sort((a, b) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0));
  }

  async savePanorama(panoramaRecord) {
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

    if (this._isMemory) {
      this._memPanos.set(record.id, record);
      return record;
    }

    const db = await this.dbPromise;
    await db.put('panoramas', record);
    return record;
  }

  async getPanorama(id) {
    if (this._isMemory) {
      return this._memPanos.get(id) || null;
    }
    const db = await this.dbPromise;
    return db.get('panoramas', id);
  }

  async getPanoramasForInspection(inspectionId) {
    if (this._isMemory) {
      return Array.from(this._memPanos.values()).filter(
        (p) => p.inspectionId === inspectionId
      );
    }
    const db = await this.dbPromise;
    return db.getAllFromIndex('panoramas', 'inspection_id', inspectionId);
  }
}

export const photoSphereStorage = new PhotoSphereStorage();
export { PhotoSphereStorage };

