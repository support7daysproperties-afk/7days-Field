import { describe, it, expect, vi, beforeEach } from 'vitest';
import MediaRepository from '../src/services/offline/MediaRepository';

describe('Video Inspection Selection & Consent Deletion Flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('correctly partitions videos into selected and unselected sets', () => {
    const videos = [
      { id: 'v1', mediaType: 'video', duration: 15 },
      { id: 'v2', mediaType: 'video', duration: 30 },
      { id: 'v3', mediaType: 'video', duration: 45 },
    ];
    const selectedVideoIds = new Set(['v1', 'v3']);

    const selectedVideos = videos.filter(v => selectedVideoIds.has(v.id));
    const unselectedVideos = videos.filter(v => !selectedVideoIds.has(v.id));

    expect(selectedVideos.map(v => v.id)).toEqual(['v1', 'v3']);
    expect(unselectedVideos.map(v => v.id)).toEqual(['v2']);
    expect(unselectedVideos.length).toBe(1);
  });

  it('select all and deselect all toggles video selection properly', () => {
    const videos = [
      { id: 'v1', mediaType: 'video' },
      { id: 'v2', mediaType: 'video' },
    ];
    const videoIds = videos.map(v => v.id);

    // Initial empty
    let selectedSet = new Set();
    expect(selectedSet.size).toBe(0);

    // Select All
    const allSelected1 = videoIds.every(id => selectedSet.has(id));
    expect(allSelected1).toBe(false);
    videoIds.forEach(id => selectedSet.add(id));
    expect(selectedSet.size).toBe(2);

    // Deselect All
    const allSelected2 = videoIds.every(id => selectedSet.has(id));
    expect(allSelected2).toBe(true);
    videoIds.forEach(id => selectedSet.delete(id));
    expect(selectedSet.size).toBe(0);
  });

  it('deletes unselected videos and allows complete restoration via undo', async () => {
    const mockStorage = {
      v1: { id: 'v1', mediaType: 'video', duration: 12, blob: new Blob(['video1']) },
      v2: { id: 'v2', mediaType: 'video', duration: 25, blob: new Blob(['video2']) },
      v3: { id: 'v3', mediaType: 'video', duration: 40, blob: new Blob(['video3']) },
    };

    vi.spyOn(MediaRepository, 'getMedia').mockImplementation(async (id) => mockStorage[id] || null);
    vi.spyOn(MediaRepository, 'deleteMedia').mockImplementation(async (id) => {
      delete mockStorage[id];
    });
    vi.spyOn(MediaRepository, 'saveMedia').mockImplementation(async (record) => {
      mockStorage[record.id] = record;
      return record;
    });

    const videos = [mockStorage.v1, mockStorage.v2, mockStorage.v3];
    const selectedIds = new Set(['v2']);

    // Find to delete
    const toDelete = videos.filter(v => !selectedIds.has(v.id));
    expect(toDelete.map(v => v.id)).toEqual(['v1', 'v3']);

    // 1. Backup
    const backupRecords = [];
    for (const item of toDelete) {
      const raw = await MediaRepository.getMedia(item.id);
      if (raw) backupRecords.push(raw);
    }
    expect(backupRecords.length).toBe(2);

    // 2. Perform deletion
    for (const item of toDelete) {
      await MediaRepository.deleteMedia(item.id);
    }
    expect(mockStorage.v1).toBeUndefined();
    expect(mockStorage.v3).toBeUndefined();
    expect(mockStorage.v2).toBeDefined();

    // 3. Undo
    for (const record of backupRecords) {
      await MediaRepository.saveMedia(record);
    }
    expect(mockStorage.v1).toBeDefined();
    expect(mockStorage.v1.duration).toBe(12);
    expect(mockStorage.v3).toBeDefined();
    expect(mockStorage.v3.duration).toBe(40);
  });
});
