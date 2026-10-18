import { openDB } from 'idb';

const BASE_DB_PREFIX = '7days_offline_db';
const DB_VERSION = 4;

class DatabaseService {
  constructor() {
    this.dbPromise = null;
    this.userId = null;
    this.userEmail = null;
    this.supervisorId = null;
    this._initializedDbName = null;
    this._listeners = new Set();
    this._switchLock = Promise.resolve();
  }

  subscribe(callback) {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  _notify(event = {}) {
    this._listeners.forEach(cb => {
      try {
        cb({ userId: this.userId, email: this.userEmail, dbName: this._initializedDbName, ...event });
      } catch (err) {
        console.error('Error in DatabaseService listener:', err);
      }
    });
  }

  getDbName(identifier = (this.userEmail || this.userId)) {
    const id = identifier || this._resolveCurrentUserEmail() || this._resolveCurrentUserId();
    if (id) {
      const safeId = String(id).toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '_');
      return `${BASE_DB_PREFIX}_${safeId}`;
    }
    return `${BASE_DB_PREFIX}_guest`;
  }

  _resolveCurrentUserId() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem('7days_active_user_id') || null;
      }
    } catch (_) {}
    return null;
  }

  _resolveCurrentUserEmail() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem('7days_active_user_email') || null;
      }
    } catch (_) {}
    return null;
  }

  async setCurrentUser(userId, email = null, supervisorId = null) {
    // Chain onto switch lock to prevent race conditions during rapid user transitions
    this._switchLock = this._switchLock.then(async () => {
      const targetUserId = userId || null;
      const targetUserEmail = (email || '').toLowerCase().trim() || null;
      const targetSupervisorId = supervisorId || null;

      this.userId = targetUserId;
      this.userEmail = targetUserEmail;
      this.supervisorId = targetSupervisorId;

      const targetDbName = this.getDbName(targetUserEmail || targetUserId);

      // If already initialized with this exact database, maintain connection
      if (this.dbPromise && this._initializedDbName === targetDbName) {
        this._notify({ type: 'user_retained', userId: targetUserId, email: targetUserEmail });
        return this.dbPromise;
      }

      // Close any previous open connection cleanly
      if (this.dbPromise) {
        try {
          const db = await this.dbPromise;
          db.close();
        } catch (err) {
          console.warn('Error closing database during user switch:', err);
        }
        this.dbPromise = null;
        this._initializedDbName = null;
      }

      if (targetUserId) {
        try {
          window.localStorage?.setItem('7days_active_user_id', targetUserId);
        } catch (_) {}
      } else {
        try {
          window.localStorage?.removeItem('7days_active_user_id');
        } catch (_) {}
      }

      if (targetUserEmail) {
        try {
          window.localStorage?.setItem('7days_active_user_email', targetUserEmail);
        } catch (_) {}
      } else {
        try {
          window.localStorage?.removeItem('7days_active_user_email');
        } catch (_) {}
      }

      // Initialize the scoped database partition
      const db = await this.init();

      // If switching to an authenticated user partition, migrate any pending guest or legacy items
      if (targetUserId || targetUserEmail) {
        await this._migrateLegacyRecords(db, targetUserId, targetUserEmail);
      }

      this._notify({ type: 'user_switched', userId: targetUserId, email: targetUserEmail, dbName: targetDbName });
      return db;
    });

    return await this._switchLock;
  }

  async _migrateLegacyRecords(targetDb, targetUserId, targetUserEmail) {
    try {
      const candidateDbNames = [];
      // 1. Guest DB
      candidateDbNames.push(`${BASE_DB_PREFIX}_guest`);

      // 2. Legacy partition named directly by targetUserId if different from targetDbName
      if (targetUserId) {
        const legacyUserDbName = `${BASE_DB_PREFIX}_${String(targetUserId).toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        if (legacyUserDbName !== this._initializedDbName) {
          candidateDbNames.push(legacyUserDbName);
        }
      }

      for (const legacyName of candidateDbNames) {
        try {
          const legacyDb = await openDB(legacyName, DB_VERSION).catch(() => null);
          if (!legacyDb) continue;

          const hasStore = (d, name) => !d.objectStoreNames || (typeof d.objectStoreNames.contains === 'function' ? d.objectStoreNames.contains(name) : true);

          // Migrate inspections
          if (hasStore(legacyDb, 'inspections')) {
            const legacyInspections = await legacyDb.getAll('inspections').catch(() => []);
            for (const ins of legacyInspections) {
              const existing = await targetDb.get('inspections', ins.id);
              if (!existing) {
                const migrated = {
                  ...ins,
                  auth_user_id: ins.auth_user_id || targetUserId,
                  user_email: ins.user_email || targetUserEmail,
                };
                await targetDb.put('inspections', migrated);
              }
            }
          }

          // Migrate media
          if (hasStore(legacyDb, 'media')) {
            const legacyMedia = await legacyDb.getAll('media').catch(() => []);
            for (const m of legacyMedia) {
              const existingM = await targetDb.get('media', m.id);
              if (!existingM) {
                await targetDb.put('media', m);
              }
            }
          }

          // Migrate boundaries
          if (hasStore(legacyDb, 'boundaries')) {
            const legacyBoundaries = await legacyDb.getAll('boundaries').catch(() => []);
            for (const b of legacyBoundaries) {
              const existingB = await targetDb.get('boundaries', b.id);
              if (!existingB) {
                await targetDb.put('boundaries', b);
              }
            }
          }

          // Clear guest database after successful migration
          if (legacyName === `${BASE_DB_PREFIX}_guest` && hasStore(legacyDb, 'inspections') && typeof legacyDb.transaction === 'function') {
            try {
              const tx = legacyDb.transaction(['inspections', 'media', 'boundaries'], 'readwrite');
              if (tx && tx.objectStore) {
                await Promise.all([
                  tx.objectStore('inspections')?.clear?.().catch(() => {}),
                  tx.objectStore('media')?.clear?.().catch(() => {}),
                  tx.objectStore('boundaries')?.clear?.().catch(() => {})
                ]);
              }
            } catch (_) {}
          }

          legacyDb.close();
        } catch (_) {}
      }
    } catch (err) {
      console.warn('[DatabaseService] Legacy migration note:', err);
    }
  }

  async init() {
    const dbName = this.getDbName();
    if (this.dbPromise && this._initializedDbName === dbName) {
      return this.dbPromise;
    }

    this._initializedDbName = dbName;
    this.dbPromise = openDB(dbName, DB_VERSION, {
      upgrade(db, oldVersion) {
        // Version 1 stores
        if (oldVersion < 1) {
          if (!db.objectStoreNames.contains('inspections')) {
            const inspectionStore = db.createObjectStore('inspections', { keyPath: 'id' });
            inspectionStore.createIndex('property_id', 'property_id');
            inspectionStore.createIndex('sync_status', 'sync_status');
            inspectionStore.createIndex('auth_user_id', 'auth_user_id');
            inspectionStore.createIndex('supervisor_id', 'supervisor_id');
          }
          if (!db.objectStoreNames.contains('media')) {
            const mediaStore = db.createObjectStore('media', { keyPath: 'id' });
            mediaStore.createIndex('inspection_id', 'inspection_id');
            mediaStore.createIndex('sync_status', 'sync_status');
          }
        }

        // Version 2: add sync_jobs store
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains('sync_jobs')) {
            const jobStore = db.createObjectStore('sync_jobs', { keyPath: 'id' });
            jobStore.createIndex('inspection_id', 'inspection_id');
            jobStore.createIndex('status', 'status');
          }
        }

        // Version 3: add boundaries store
        if (oldVersion < 3) {
          if (!db.objectStoreNames.contains('boundaries')) {
            const boundaryStore = db.createObjectStore('boundaries', { keyPath: 'id' });
            boundaryStore.createIndex('inspection_id', 'inspection_id');
            boundaryStore.createIndex('sync_status', 'sync_status');
          }
        }

        // Version 4: add drive_auth store (supervisor-scoped)
        if (oldVersion < 4) {
          if (!db.objectStoreNames.contains('drive_auth')) {
            db.createObjectStore('drive_auth', { keyPath: 'userId' });
          }
        }
      },
      blocked() {
        console.warn(`Database connection to ${dbName} blocked. Please close other tabs.`);
      },
      blocking() {
        if (this.dbPromise) {
          this.dbPromise.then(db => db.close());
          this.dbPromise = null;
          this._initializedDbName = null;
        }
      },
      terminated() {
        console.error(`Database connection to ${dbName} terminated abnormally`);
        this.dbPromise = null;
        this._initializedDbName = null;
      },
    });

    return this.dbPromise;
  }

  async getDB() {
    const currentExpectedName = this.getDbName();
    if (!this.dbPromise || this._initializedDbName !== currentExpectedName) {
      await this.init();
    }
    return this.dbPromise;
  }

  /**
   * Clears the current user's local database partition.
   */
  async clearCurrentDatabase() {
    const dbName = this.getDbName();
    if (this.dbPromise) {
      try {
        const db = await this.dbPromise;
        db.close();
      } catch (_) {}
      this.dbPromise = null;
      this._initializedDbName = null;
    }

    if (typeof indexedDB !== 'undefined' && indexedDB.deleteDatabase) {
      return new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(dbName);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
        req.onblocked = () => resolve(false);
      });
    }
    return true;
  }
}

export default new DatabaseService();
