/**
 * Land360Service.js  (Phase 2 — extended)
 *
 * Extends the Phase 1 IndexedDB service with:
 * • Capture sessions (config snapshot, reference heading, pause/resume)
 * • Spherical target persistence (for recovery after browser refresh)
 * • Extended frame records (quality, retake tracking, session linkage)
 * • Retake management (old frame → replaced, new frame → active)
 * • Session recovery (reload targets & frames, verify frame files)
 *
 * Database version is bumped from 1 → 2 to add new stores and indexes.
 * The existing capture_points, frames, and panoramas stores are preserved.
 */

import { openDB } from 'idb';

const DB_NAME = 'Land360DB';
const DB_VERSION = 5;

class Land360Service {
  constructor() {
    this.dbPromise = this.initDB();
  }

  async initDB() {
    return openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        // ── v1 stores (create if missing — first install) ──────────
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('capture_points')) {
          const cpStore = db.createObjectStore('capture_points', { keyPath: 'id' });
          cpStore.createIndex('inspection_id', 'inspection_id');
        }
        if (!db.objectStoreNames.contains('frames')) {
          const frameStore = db.createObjectStore('frames', { keyPath: 'id' });
          frameStore.createIndex('capture_point_id', 'capture_point_id');
        }
        if (!db.objectStoreNames.contains('panoramas')) {
          const panoStore = db.createObjectStore('panoramas', { keyPath: 'id' });
          panoStore.createIndex('capture_point_id', 'capture_point_id');
        }

        // ── v2 additions ───────────────────────────────────────────
        if (oldVersion < 2) {
          // Capture sessions (spherical capture attempts)
          if (!db.objectStoreNames.contains('capture_sessions')) {
            const csStore = db.createObjectStore('capture_sessions', { keyPath: 'id' });
            csStore.createIndex('capture_point_id', 'capturePointId');
          }

          // Spherical targets
          if (!db.objectStoreNames.contains('targets')) {
            const tStore = db.createObjectStore('targets', { keyPath: 'id' });
            tStore.createIndex('session_id', 'sessionId');
          }

          // Add session_id index to existing frames store
          const framesStore = transaction.objectStore('frames');
          if (!framesStore.indexNames.contains('session_id')) {
            framesStore.createIndex('session_id', 'sessionId');
          }
        }

        // ── v3 additions (Phase 4 — Universal Property 360°) ──────
        if (oldVersion < 3) {
          if (!db.objectStoreNames.contains('property360_sessions')) {
            db.createObjectStore('property360_sessions', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('property360_scenes')) {
            const sceneStore = db.createObjectStore('property360_scenes', { keyPath: 'id' });
            sceneStore.createIndex('session_id', 'sessionId');
          }
          const panoStore2 = transaction.objectStore('panoramas');
          if (!panoStore2.indexNames.contains('scene_id')) {
            panoStore2.createIndex('scene_id', 'sceneId');
          }
        }

        // ── v5 additions (Phase 6 — Offline Sync Queue) ───────────
        if (oldVersion < 5) {
          if (!db.objectStoreNames.contains('property360_sync_queue')) {
            const queueStore = db.createObjectStore('property360_sync_queue', { keyPath: 'id' });
            queueStore.createIndex('session_id', 'sessionId');
            queueStore.createIndex('status', 'status');
            queueStore.createIndex('session_item_type', ['sessionId', 'itemType']);
          }
        }
      },
    });
  }

  _generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Capture Points  (unchanged API from Phase 1)
  // ═══════════════════════════════════════════════════════════════════

  async createCapturePoint(inspectionId, data) {
    const db = await this.dbPromise;
    const cp = {
      id: this._generateId(),
      inspection_id: inspectionId,
      status: 'Not Captured',
      created_at: Date.now(),
      ...data,
    };
    await db.put('capture_points', cp);
    return cp;
  }

  async getCapturePointsForInspection(inspectionId) {
    const db = await this.dbPromise;
    return db.getAllFromIndex('capture_points', 'inspection_id', inspectionId);
  }

  async getCapturePoint(id) {
    const db = await this.dbPromise;
    return db.get('capture_points', id);
  }

  async updateCapturePointStatus(id, status) {
    const db = await this.dbPromise;
    const cp = await db.get('capture_points', id);
    if (cp) {
      cp.status = status;
      await db.put('capture_points', cp);
    }
    return cp;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Capture Sessions
  // ═══════════════════════════════════════════════════════════════════

  async saveSession(session) {
    const db = await this.dbPromise;
    const record = {
      ...session,
      updatedAt: Date.now(),
    };
    await db.put('capture_sessions', record);
    return record;
  }

  async getSession(sessionId) {
    const db = await this.dbPromise;
    return db.get('capture_sessions', sessionId);
  }

  async getSessionsForCapturePoint(capturePointId) {
    const db = await this.dbPromise;
    return db.getAllFromIndex('capture_sessions', 'capture_point_id', capturePointId);
  }

  async getLatestSessionForCapturePoint(capturePointId) {
    const sessions = await this.getSessionsForCapturePoint(capturePointId);
    if (sessions.length === 0) return null;
    sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return sessions[0];
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Targets
  // ═══════════════════════════════════════════════════════════════════

  async saveTargets(sessionId, targets) {
    const db = await this.dbPromise;
    const tx = db.transaction('targets', 'readwrite');
    const store = tx.objectStore('targets');
    for (const t of targets) {
      await store.put({
        ...t,
        sessionId,
        // Ensure a globally unique key: prefix with sessionId
        id: t.id.startsWith('t_') ? `${sessionId}_${t.id}` : t.id,
        originalTargetId: t.id, // keep original for mapping
      });
    }
    await tx.done;
  }

  async getTargetsForSession(sessionId) {
    const db = await this.dbPromise;
    return db.getAllFromIndex('targets', 'session_id', sessionId);
  }

  async updateTarget(target) {
    const db = await this.dbPromise;
    await db.put('targets', { ...target, updatedAt: Date.now() });
  }

  async updateTargetsBatch(targets) {
    const db = await this.dbPromise;
    const tx = db.transaction('targets', 'readwrite');
    const store = tx.objectStore('targets');
    const now = Date.now();
    for (const t of targets) {
      await store.put({ ...t, updatedAt: now });
    }
    await tx.done;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Frames  (extended from Phase 1)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Save a captured frame with full Phase 2 metadata.
   */
  async saveFrame(sessionId, capturePointId, targetId, frameData) {
    const db = await this.dbPromise;
    const frame = {
      id: this._generateId(),
      sessionId,
      capture_point_id: capturePointId,
      targetId,
      sequenceNumber: frameData.sequenceNumber || 0,

      // Orientation
      targetYaw: frameData.targetYaw,
      targetPitch: frameData.targetPitch,
      capturedYaw: frameData.capturedYaw,
      capturedPitch: frameData.capturedPitch,
      capturedRoll: frameData.capturedRoll || 0,

      // Image
      localUri: frameData.localUri,
      imageWidth: frameData.imageWidth || null,
      imageHeight: frameData.imageHeight || null,
      imageFormat: frameData.imageFormat || 'image/jpeg',

      // GPS
      latitude: frameData.latitude || null,
      longitude: frameData.longitude || null,
      gpsAccuracy: frameData.gpsAccuracy || null,

      // Quality
      qualityStatus: frameData.qualityStatus || 'not-evaluated',
      qualityWarnings: frameData.qualityWarnings || [],
      qualityMetrics: frameData.qualityMetrics || null,

      // Retake tracking
      isRetake: frameData.isRetake || false,
      replacesFrameId: frameData.replacesFrameId || null,
      isActive: true,

      // Timestamps
      capturedAt: Date.now(),
      status: 'captured',
    };

    await db.put('frames', frame);
    return frame;
  }

  async getFramesForCapturePoint(capturePointId) {
    const db = await this.dbPromise;
    return db.getAllFromIndex('frames', 'capture_point_id', capturePointId);
  }

  async getFramesForSession(sessionId) {
    const db = await this.dbPromise;
    return db.getAllFromIndex('frames', 'session_id', sessionId);
  }

  async getActiveFramesForSession(sessionId) {
    const frames = await this.getFramesForSession(sessionId);
    return frames.filter((f) => f.isActive !== false && f.status !== 'replaced');
  }

  async getFrame(frameId) {
    const db = await this.dbPromise;
    return db.get('frames', frameId);
  }

  /**
   * Mark an old frame as replaced and save the replacement frame.
   * The old frame is kept for audit but marked inactive.
   */
  async retakeFrame(sessionId, capturePointId, targetId, oldFrameId, newFrameData) {
    const db = await this.dbPromise;

    // Mark old frame as replaced
    if (oldFrameId) {
      const oldFrame = await db.get('frames', oldFrameId);
      if (oldFrame) {
        oldFrame.isActive = false;
        oldFrame.status = 'replaced';
        await db.put('frames', oldFrame);
      }
    }

    // Save replacement
    const newFrame = await this.saveFrame(sessionId, capturePointId, targetId, {
      ...newFrameData,
      isRetake: true,
      replacesFrameId: oldFrameId,
    });

    return newFrame;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Session recovery
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Recover a session from persistence.
   * Verifies that frame image data still exists (base64 URIs are always valid,
   * but blob URLs may have expired).
   */
  async recoverSession(capturePointId) {
    const session = await this.getLatestSessionForCapturePoint(capturePointId);
    if (!session) return null;
    if (session.status === 'completed' || session.status === 'abandoned') return null;

    const targets = await this.getTargetsForSession(session.id);
    const frames = await this.getActiveFramesForSession(session.id);

    // Verify frame data integrity
    const validFrames = [];
    const invalidFrameIds = [];
    for (const frame of frames) {
      if (frame.localUri && frame.localUri.startsWith('data:')) {
        validFrames.push(frame);
      } else if (frame.localUri && frame.localUri.startsWith('blob:')) {
        // Blob URLs may be stale after page reload
        invalidFrameIds.push(frame.id);
      } else if (frame.localUri) {
        validFrames.push(frame); // assume valid
      } else {
        invalidFrameIds.push(frame.id);
      }
    }

    // Rebuild target status from valid frames
    const validFrameTargetIds = new Set(validFrames.map((f) => f.targetId));
    for (const target of targets) {
      if (target.status === 'captured' && !validFrameTargetIds.has(target.originalTargetId || target.id)) {
        // Frame was lost — mark target for retake
        target.status = 'needs-retake';
        target.capturedFrameId = null;
      }
    }

    return {
      session,
      targets,
      frames: validFrames,
      lostFrameCount: invalidFrameIds.length,
    };
  }
}

export const land360Service = new Land360Service();
