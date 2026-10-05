import MediaRepository from './offline/MediaRepository';

export const EvidenceService = {
  saveEvidence: async (evidenceData) => {
    // Generate UUID if not provided
    const id = evidenceData.id || crypto.randomUUID();
    
    const record = {
      ...evidenceData,
      id,
      inspection_id: evidenceData.taskId,
      type: evidenceData.mediaType,
      sync_status: 'PENDING_UPLOAD',
      upload_attempts: 0
    };
    
    return await MediaRepository.saveMedia(record);
  },

  getEvidenceForTask: async (taskId) => {
    const list = await MediaRepository.getMediaForInspection(taskId);
    
    // Process Blobs into object URLs for the UI
    return list.map(item => ({
      ...item,
      taskId: item.inspection_id,
      mediaType: item.type,
      originalImage: item.original_blob ? URL.createObjectURL(item.original_blob) : null,
      geotaggedImage: item.geotagged_blob ? URL.createObjectURL(item.geotagged_blob) : null,
    }));
  },

  calculateDistance: (lat1, lon1, lat2, lon2) => {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const d = R * c;
    return d;
  },

  getLocationStatus: (distanceKm) => {
    if (distanceKm === null) return 'GPS_UNAVAILABLE';
    if (distanceKm <= 0.1) return 'VERIFIED';
    if (distanceKm <= 1.0) return 'NEARBY';
    return 'MISMATCH';
  },

  getEvidenceSummary: async (taskId) => {
    const list = await EvidenceService.getEvidenceForTask(taskId);
    const location = list.find(e => e.evidenceType === 'Location Verification');
    const photos = list.filter(e => e.mediaType === 'photo' && e.evidenceType !== 'Location Verification').length;
    const videos = list.filter(e => e.mediaType === 'video').length;
    return { location, photos, videos, total: photos + videos };
  }
};
