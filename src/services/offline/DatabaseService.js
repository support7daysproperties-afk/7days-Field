import { openDB } from 'idb';

const DB_NAME = '7days_offline_db';
const DB_VERSION = 2;

class DatabaseService {
  constructor() {
    this.dbPromise = null;
  }

  async init() {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // Version 1 stores
        if (oldVersion < 1) {
          if (!db.objectStoreNames.contains('inspections')) {
            const inspectionStore = db.createObjectStore('inspections', { keyPath: 'id' });
            inspectionStore.createIndex('property_id', 'property_id');
            inspectionStore.createIndex('sync_status', 'sync_status');
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
      },
      blocked() {
        console.warn('Database connection blocked. Please close other tabs.');
      },
      blocking() {
        if (this.dbPromise) {
          this.dbPromise.then(db => db.close());
          this.dbPromise = null;
        }
      },
      terminated() {
        console.error('Database connection terminated abnormally');
        this.dbPromise = null;
      },
    });

    return this.dbPromise;
  }

  async getDB() {
    if (!this.dbPromise) {
      await this.init();
    }
    return this.dbPromise;
  }
}

export default new DatabaseService();
