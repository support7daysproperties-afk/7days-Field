import { openDB } from 'idb';

const BASE_DB_PREFIX = '7days_offline_db';
const DB_VERSION = 4;

class DatabaseService {
  constructor() {
    this.dbPromise = null;
    this.userId = null;
    this._initializedDbName = null;
  }

  getDbName(userId = this.userId) {
    const id = userId || this._resolveCurrentUserId();
    if (id) {
      const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
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

  async setCurrentUser(userId) {
    const targetUserId = userId || null;
    const targetDbName = this.getDbName(targetUserId);

    // If already initialized with this exact database, maintain connection
    if (this.dbPromise && this._initializedDbName === targetDbName) {
      this.userId = targetUserId;
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

    this.userId = targetUserId;
    if (targetUserId) {
      try {
        window.localStorage?.setItem('7days_active_user_id', targetUserId);
      } catch (_) {}
    } else {
      try {
        window.localStorage?.removeItem('7days_active_user_id');
      } catch (_) {}
    }

    // Initialize the scoped database partition
    return await this.init();
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
