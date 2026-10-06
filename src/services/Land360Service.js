import { openDB } from 'idb';

const DB_NAME = 'Land360DB';
const DB_VERSION = 1;

class Land360Service {
  constructor() {
    this.dbPromise = this.initDB();
  }

  async initDB() {
    return openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Create stores if they don't exist
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
          const panoramaStore = db.createObjectStore('panoramas', { keyPath: 'id' });
          panoramaStore.createIndex('capture_point_id', 'capture_point_id');
        }
      },
    });
  }

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // --- Sessions ---
  async getSessions() {
      const db = await this.dbPromise;
      return db.getAll('sessions');
  }

  // --- Capture Points ---
  async createCapturePoint(inspectionId, data) {
    const db = await this.dbPromise;
    const cp = {
      id: this.generateId(),
      inspection_id: inspectionId,
      status: 'Not Captured',
      created_at: Date.now(),
      ...data
    };
    await db.put('capture_points', cp);
    return cp;
  }

  async getCapturePointsForInspection(inspectionId) {
    const db = await this.dbPromise;
    const all = await db.getAllFromIndex('capture_points', 'inspection_id', inspectionId);
    return all;
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

  // --- Frames ---
  async saveFrame(capturePointId, targetHeading, targetPitch, capturedHeading, capturedPitch, capturedRoll, localUri, gpsData) {
    const db = await this.dbPromise;
    const frame = {
      id: this.generateId(),
      capture_point_id: capturePointId,
      target_heading: targetHeading,
      target_pitch: targetPitch,
      captured_heading: capturedHeading,
      captured_pitch: capturedPitch,
      captured_roll: capturedRoll,
      local_uri: localUri, // Base64 or Blob URL
      latitude: gpsData?.latitude,
      longitude: gpsData?.longitude,
      gps_accuracy: gpsData?.accuracy,
      captured_at: Date.now(),
      status: 'captured'
    };
    await db.put('frames', frame);
    return frame;
  }

  async getFramesForCapturePoint(capturePointId) {
    const db = await this.dbPromise;
    return db.getAllFromIndex('frames', 'capture_point_id', capturePointId);
  }
}

export const land360Service = new Land360Service();
