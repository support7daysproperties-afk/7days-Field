import { describe, it, expect, beforeEach, vi } from 'vitest';
import DatabaseService from '../src/services/offline/DatabaseService';
import InspectionRepository from '../src/services/offline/InspectionRepository';

// In-memory IndexedDB mock for node environment testing
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

describe('Multi-User Data Isolation & Fresh Workspace Tests', () => {
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

  describe('Database Naming & Scoping', () => {
    it('scopes database name to the authenticated user ID', () => {
      expect(DatabaseService.getDbName('user-abc-123')).toBe('7days_offline_db_user-abc-123');
      expect(DatabaseService.getDbName('usr_999')).toBe('7days_offline_db_usr_999');
      expect(DatabaseService.getDbName(null)).toBe('7days_offline_db_guest');
    });

    it('switches database partitions when active user changes', async () => {
      await DatabaseService.setCurrentUser('user_alice');
      expect(DatabaseService.getDbName()).toBe('7days_offline_db_user_alice');

      await DatabaseService.setCurrentUser('user_bob');
      expect(DatabaseService.getDbName()).toBe('7days_offline_db_user_bob');
    });
  });

  describe('Fresh Workspace for New Users (Zero Overlap)', () => {
    it('ensures User Bob sees zero records when User Alice created inspections', async () => {
      // 1. User Alice logs in and creates an inspection
      await DatabaseService.setCurrentUser('user_alice');
      await InspectionRepository.saveInspection({
        id: 'INS-ALICE-001',
        title: 'Alice Estate Survey',
        auth_user_id: 'user_alice',
        status: 'IN_PROGRESS'
      });

      const aliceInspections = await InspectionRepository.getAllInspections();
      expect(aliceInspections).toHaveLength(1);
      expect(aliceInspections[0].title).toBe('Alice Estate Survey');

      // 2. Alice logs out
      await DatabaseService.setCurrentUser(null);

      // 3. New user Bob logs in
      await DatabaseService.setCurrentUser('user_bob');
      const bobInspections = await InspectionRepository.getAllInspections();

      // Bob MUST start completely fresh with ZERO overlap
      expect(bobInspections).toHaveLength(0);
    });

    it('retains Alice records when Alice logs back in later', async () => {
      // Alice logs in and saves work
      await DatabaseService.setCurrentUser('user_alice');
      await InspectionRepository.saveInspection({
        id: 'INS-ALICE-002',
        title: 'Alice Land Survey',
        auth_user_id: 'user_alice',
        status: 'DRAFT'
      });

      // Switch to Bob
      await DatabaseService.setCurrentUser('user_bob');
      expect(await InspectionRepository.getAllInspections()).toHaveLength(0);

      // Bob creates his own inspection
      await InspectionRepository.saveInspection({
        id: 'INS-BOB-001',
        title: 'Bob Commercial Plot',
        auth_user_id: 'user_bob',
        status: 'COMPLETED'
      });

      expect(await InspectionRepository.getAllInspections()).toHaveLength(1);
      expect((await InspectionRepository.getAllInspections())[0].title).toBe('Bob Commercial Plot');

      // Switch back to Alice
      await DatabaseService.setCurrentUser('user_alice');
      const restoredAlice = await InspectionRepository.getAllInspections();
      expect(restoredAlice).toHaveLength(1);
      expect(restoredAlice[0].title).toBe('Alice Land Survey');
    });
  });

  describe('Defense-in-Depth User ID Filtering', () => {
    it('filters out records belonging to a different user ID', async () => {
      await DatabaseService.setCurrentUser('user_carol');
      const db = await DatabaseService.getDB();

      // Simulate a raw record with a foreign user id
      await db.put('inspections', {
        id: 'FOREIGN-INS-01',
        title: 'Foreign Inspection',
        auth_user_id: 'other_user',
        status: 'DRAFT'
      });

      await db.put('inspections', {
        id: 'CAROL-INS-01',
        title: 'Carol Inspection',
        auth_user_id: 'user_carol',
        status: 'DRAFT'
      });

      const carolRecords = await InspectionRepository.getAllInspections();
      expect(carolRecords).toHaveLength(1);
      expect(carolRecords[0].id).toBe('CAROL-INS-01');
    });
  });
});
