import { describe, it, expect, beforeEach, vi } from 'vitest';
import DatabaseService from '../src/services/offline/DatabaseService';
import InspectionRepository from '../src/services/offline/InspectionRepository';
import SyncJobRepository from '../src/services/offline/SyncJobRepository';
import SyncEngine from '../src/services/offline/SyncEngine';
import ConnectivityService from '../src/services/offline/ConnectivityService';

// In-memory mock IDB
class MockObjectStore {
  constructor() {
    this.data = new Map();
  }
  async put(item) {
    this.data.set(item.id, JSON.parse(JSON.stringify(item)));
    return item.id;
  }
  async get(id) {
    const item = this.data.get(id);
    return item ? JSON.parse(JSON.stringify(item)) : undefined;
  }
  async getAll() {
    return Array.from(this.data.values()).map(v => JSON.parse(JSON.stringify(v)));
  }
  async delete(id) {
    this.data.delete(id);
  }
}

class MockIDBDatabase {
  constructor(name) {
    this.name = name;
    this.stores = {
      inspections: new MockObjectStore(),
      media: new MockObjectStore(),
      sync_jobs: new MockObjectStore(),
      boundaries: new MockObjectStore(),
      drive_auth: new MockObjectStore()
    };
  }
  async put(storeName, item) {
    return this.stores[storeName].put(item);
  }
  async get(storeName, key) {
    return this.stores[storeName].get(key);
  }
  async getAll(storeName) {
    return this.stores[storeName].getAll();
  }
  async getAllFromIndex(storeName, indexName, query) {
    const all = await this.stores[storeName].getAll();
    return all.filter(item => item[indexName] === query);
  }
  async delete(storeName, key) {
    return this.stores[storeName].delete(key);
  }
  close() {}
}

const mockDatabases = new Map();

vi.mock('idb', () => ({
  openDB: vi.fn(async (name) => {
    if (!mockDatabases.has(name)) {
      mockDatabases.set(name, new MockIDBDatabase(name));
    }
    return mockDatabases.get(name);
  })
}));

describe('Reactive Database & Sync Error Recovery Tests', () => {
  beforeEach(async () => {
    mockDatabases.clear();
    globalThis.localStorage = {
      _store: {},
      getItem(k) { return this._store[k] || null; },
      setItem(k, v) { this._store[k] = String(v); },
      removeItem(k) { delete this._store[k]; },
      clear() { this._store = {}; }
    };
    await DatabaseService.setCurrentUser(null);
  });

  it('notifies subscribers immediately when database partition switches', async () => {
    const events = [];
    const unsub = DatabaseService.subscribe(evt => events.push(evt));

    await DatabaseService.setCurrentUser('user_dev_1');
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1].userId).toBe('user_dev_1');
    expect(events[events.length - 1].type).toBe('user_switched');

    unsub();
  });

  it('notifies subscribers when an inspection is saved or updated', async () => {
    await DatabaseService.setCurrentUser('user_supervisor');
    const events = [];
    const unsub = DatabaseService.subscribe(evt => events.push(evt));

    await InspectionRepository.saveInspection({
      id: 'INS-TEST-1',
      title: 'Property Alpha',
      status: 'IN_PROGRESS'
    });

    expect(events.some(e => e.type === 'inspection_saved' && e.inspectionId === 'INS-TEST-1')).toBe(true);

    // Update to COMPLETED
    await InspectionRepository.saveInspection({
      id: 'INS-TEST-1',
      title: 'Property Alpha',
      status: 'COMPLETED'
    });

    expect(events.filter(e => e.type === 'inspection_saved').length).toBe(2);
    unsub();
  });

  it('resets and clears last_error when a sync job is retried or re-enqueued', async () => {
    await DatabaseService.setCurrentUser('user_sync_test');

    // Simulate an inspection that had a previous schema failure
    await InspectionRepository.saveInspection({
      id: 'INS-STALE-ERR',
      title: 'Property 1',
      status: 'COMPLETED',
      sync_status: 'FAILED'
    });

    await SyncJobRepository.upsertJob({
      id: 'job_err_1',
      inspection_id: 'INS-STALE-ERR',
      status: 'FAILED',
      last_error: "Supabase inspection upsert failed: Could not find the 'auth_user_id' column of 'field_inspections' in the schema cache"
    });

    // Check that job currently has the error
    let job = await SyncJobRepository.getJobForInspection('INS-STALE-ERR');
    expect(job.last_error).toContain('schema cache');

    // Re-enqueue inspection for sync
    await SyncEngine.enqueueInspection('INS-STALE-ERR');

    job = await SyncJobRepository.getJobForInspection('INS-STALE-ERR');
    expect(job.status).toBe('QUEUED');
    expect(job.last_error).toBeNull();
  });

  it('ConnectivityService keeps online state when navigator.onLine is true even if ping throws', async () => {
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
      writable: true,
    });
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network probe timeout'));

    const isConnected = await ConnectivityService.checkConnectivity();
    expect(isConnected).toBe(true);
    expect(ConnectivityService.online).toBe(true);
  });
});
