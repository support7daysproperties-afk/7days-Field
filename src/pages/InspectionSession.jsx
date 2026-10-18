import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, Camera, Image as ImageIcon, MapPin, Video, Play, FileText, User, FileSignature, Save, Upload, ArrowLeft, Folder, X, ChevronLeft, ChevronRight, Trash2, Loader2, Landmark, CheckSquare, Square, RotateCcw, Plus, PlusCircle, CheckCircle } from 'lucide-react';
import FieldCamera from '../components/FieldCamera';
import VideoCamera from '../components/VideoCamera';
import PhotoSphereCapture from '../features/photo-sphere/PhotoSphereCapture';
import InteractivePhotoSphereViewer from '../features/photo-sphere/components/InteractivePhotoSphereViewer';
import VRViewer from '../features/photo-sphere/components/VRViewer';
import MotionSensorViewer from '../features/photo-sphere/components/MotionSensorViewer';
import SignaturePad from '../components/SignaturePad';
import OwnerCamera from '../components/OwnerCamera';
import PropertyBoundary from './PropertyBoundary';
import { EvidenceService } from '../services/EvidenceService';
import InspectionRepository from '../services/offline/InspectionRepository';
import BoundaryRepository from '../services/offline/BoundaryRepository';
import MediaRepository from '../services/offline/MediaRepository';
import { useAuth } from '../context/AuthContext';
import { useBackHandler } from '../hooks/useBackHandler';
import { navigationService } from '../services/NavigationService';

export default function InspectionSession() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { user } = useAuth();
  
  const [activeStepId, setActiveStepIdState] = useState(() => {
    try {
      return sessionStorage.getItem(`active_step_${id}`) || 'overview';
    } catch (_) {
      return 'overview';
    }
  });

  const setActiveStepId = (step) => {
    setActiveStepIdState(step);
    try {
      sessionStorage.setItem(`active_step_${id}`, step);
    } catch (_) {}
  };
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [showPhotoCamera, setShowPhotoCamera] = useState(false);
  const [showVideoCamera, setShowVideoCamera] = useState(false);
  const [showPhotoSphere, setShowPhotoSphere] = useState(false);
  const [showBoundaryMap, setShowBoundaryMap] = useState(false);
  const [showAddCustomCategoryModal, setShowAddCustomCategoryModal] = useState(false);
  const [viewerMode, setViewerMode] = useState(null); // { mode: 'vr' | 'motion', url: string }
  const [evidenceSummary, setEvidenceSummary] = useState({ location: null, photos: 0, videos: 0, total: 0 });
  const [evidenceList, setEvidenceList] = useState([]);
  const [expandedFolder, setExpandedFolder] = useState('photos');
  const [selectedPhotoIds, setSelectedPhotoIds] = useState(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [showSelectionDeleteConfirm, setShowSelectionDeleteConfirm] = useState(false);
  const [selectedVideoIds, setSelectedVideoIds] = useState(new Set());
  const [isVideoSelectionMode, setIsVideoSelectionMode] = useState(false);
  const [showVideoSelectionDeleteConfirm, setShowVideoSelectionDeleteConfirm] = useState(false);
  const [undoState, setUndoState] = useState(null); // { items: [...], count: number, mediaType: 'photo' | 'video', timeoutId: ... }
  const [selectedMediaIndex, setSelectedMediaIndex] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);

  const longPressTimerRef = useRef(null);
  const isLongPressTriggeredRef = useRef(false);

  const [isLoading, setIsLoading] = useState(true);

  const [checklist, setChecklist] = useState({
    'Road accessible': false, 'Vehicle access available': false, 'Entrance identified': false,
    'Exterior inspected': false, 'Interior inspected': false, 'Boundary inspected': false,
    'Documents reviewed': false, 'Owner information confirmed': false
  });
  const [customChecklistItems, setCustomChecklistItems] = useState([]); // [{ id, name, category }]
  const [addingCategory, setAddingCategory] = useState(null); // category name currently adding to
  const [categoryItemInput, setCategoryItemInput] = useState('');
  const [categoryItemError, setCategoryItemError] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryItemName, setNewCategoryItemName] = useState('');
  const [customCategoryError, setCustomCategoryError] = useState('');
  const [checklistReviewed, setChecklistReviewed] = useState(false);

  const [remarks, setRemarks] = useState('');
  const [ownerInfo, setOwnerInfo] = useState({ name: '', phone: '', relationship: 'Owner', remarks: '' });
  const [consent, setConsent] = useState(false);
  const [signature, setSignature] = useState(null);
  const [ownerAadhaar, setOwnerAadhaar] = useState('');
  const [ownerPhoto, setOwnerPhoto] = useState(null);
  const [showOwnerCamera, setShowOwnerCamera] = useState(false);
  const [boundary, setBoundary] = useState(null); // saved BoundaryRepository record
  const [inspectionRecord, setInspectionRecord] = useState(null);

  const loadEvidence = async () => {
    try {
      const list = await EvidenceService.getEvidenceForTask(id);
      setEvidenceList(list || []);
      const summary = await EvidenceService.getEvidenceSummary(id);
      setEvidenceSummary(summary || { location: null, photos: 0, videos: 0, total: 0 });
      const existingOwnerPhoto = list?.find(e => e.evidenceType === 'Owner Photo' || e.evidenceType === 'Owner Verification Photo');
      if (existingOwnerPhoto) {
        setOwnerPhoto(existingOwnerPhoto.geotaggedImage || existingOwnerPhoto.originalImage || null);
      }
    } catch (err) {
      console.error("Failed to load evidence for task:", err);
    }
  };

  useEffect(() => { loadEvidence(); }, [id]);

  useEffect(() => {
    const loadState = async () => {
      try {
        const record = await InspectionRepository.getInspection(id);
        if (record) {
          setInspectionRecord(record);
          if (record.metadata) {
            if (record.metadata.checklist) setChecklist(record.metadata.checklist);
            if (record.metadata.checklistReviewed !== undefined) {
              setChecklistReviewed(record.metadata.checklistReviewed);
            } else if (record.metadata.checklist && Object.values(record.metadata.checklist).some(Boolean)) {
              setChecklistReviewed(true);
            }
            if (record.metadata.customChecklistItems) {
              setCustomChecklistItems(record.metadata.customChecklistItems);
            } else if (record.metadata.checklist) {
              const defaultSet = new Set([
                'Road accessible', 'Vehicle access available', 'Entrance identified',
                'Exterior inspected', 'Interior inspected', 'Boundary inspected',
                'Documents reviewed', 'Owner information confirmed'
              ]);
              const extraKeys = Object.keys(record.metadata.checklist).filter(k => !defaultSet.has(k));
              if (extraKeys.length > 0) {
                setCustomChecklistItems(extraKeys.map(k => ({
                  id: `custom_${k}`,
                  name: k,
                  category: 'Additional Checks'
                })));
              }
            }
            if (record.metadata.remarks) setRemarks(record.metadata.remarks);
            if (record.metadata.ownerInfo) setOwnerInfo(record.metadata.ownerInfo);
            if (record.metadata.consent !== undefined) setConsent(record.metadata.consent);
            if (record.metadata.signature) setSignature(record.metadata.signature);
            if (record.metadata.ownerAadhaar) setOwnerAadhaar(record.metadata.ownerAadhaar);
            if (record.metadata.ownerPhoto) setOwnerPhoto(record.metadata.ownerPhoto);
          }
        }
        // Load any existing boundary
        const existingBoundary = await BoundaryRepository.getBoundaryForInspection(id);
        if (existingBoundary) setBoundary(existingBoundary);
      } catch (err) {
        console.error("Failed to load inspection state", err);
      } finally {
        setIsLoading(false);
      }
    };
    loadState();
  }, [id]);

  useEffect(() => {
    if (isLoading) return;
    
    const saveState = async () => {
      try {
        const existing = await InspectionRepository.getInspection(id);
        await InspectionRepository.saveInspection({
          ...existing,
          id,
          property_id: existing?.property_id || id,
          status: existing?.status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS',
          sync_status: existing?.sync_status || 'LOCAL_ONLY',
          created_at: existing?.created_at,
          updated_at: new Date().toISOString(),
          metadata: {
            ...(existing?.metadata || {}),
            checklist,
            customChecklistItems,
            checklistReviewed,
            remarks,
            ownerInfo,
            consent,
            signature,
            ownerAadhaar,
            ownerPhoto,
          }
        });
      } catch (err) {
        console.error("Failed to save inspection state", err);
      }
    };
    
    saveState();
  }, [id, checklist, customChecklistItems, checklistReviewed, remarks, ownerInfo, consent, signature, ownerAadhaar, ownerPhoto, isLoading]);

  const checklistGroups = useMemo(() => {
    const baseGroups = [
      { title: 'Property Access', items: ['Road accessible', 'Vehicle access available', 'Entrance identified'] },
      { title: 'Property Condition', items: ['Exterior inspected', 'Interior inspected', 'Boundary inspected'] },
      { title: 'Documentation', items: ['Documents reviewed', 'Owner information confirmed'] }
    ];

    const customByCategory = {};
    customChecklistItems.forEach(ci => {
      const cat = ci.category || 'Additional Checks';
      if (!customByCategory[cat]) customByCategory[cat] = [];
      customByCategory[cat].push(ci.name);
    });

    const result = baseGroups.map(g => ({
      ...g,
      items: [...g.items, ...(customByCategory[g.title] || [])]
    }));

    Object.keys(customByCategory).forEach(cat => {
      if (!baseGroups.some(g => g.title === cat)) {
        result.push({
          title: cat,
          items: customByCategory[cat]
        });
      }
    });

    return result;
  }, [customChecklistItems]);

  const handleQuickAddCategoryItem = (categoryTitle) => {
    const trimmed = categoryItemInput.trim();
    if (!trimmed) {
      setCategoryItemError('Please enter a check description.');
      return;
    }
    if (checklist[trimmed] !== undefined) {
      setCategoryItemError('A check with this description already exists.');
      return;
    }

    const newItem = {
      id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: trimmed,
      category: categoryTitle
    };

    setCustomChecklistItems(prev => [...prev, newItem]);
    setChecklist(prev => ({
      ...prev,
      [trimmed]: false
    }));
    setCategoryItemInput('');
    setAddingCategory(null);
    setCategoryItemError('');
  };

  const handleCreateCustomCategory = () => {
    const trimmedCat = newCategoryName.trim();
    const trimmedItem = newCategoryItemName.trim();
    if (!trimmedCat) {
      setCustomCategoryError('Please enter a category name.');
      return;
    }
    if (!trimmedItem) {
      setCustomCategoryError('Please enter a check description.');
      return;
    }
    if (checklist[trimmedItem] !== undefined) {
      setCustomCategoryError('A check with this description already exists.');
      return;
    }

    const newItem = {
      id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: trimmedItem,
      category: trimmedCat
    };

    setCustomChecklistItems(prev => [...prev, newItem]);
    setChecklist(prev => ({
      ...prev,
      [trimmedItem]: false
    }));
    setNewCategoryName('');
    setNewCategoryItemName('');
    setShowAddCustomCategoryModal(false);
    setCustomCategoryError('');
  };

  const handleDeleteCategory = (categoryTitle) => {
    const itemsToDelete = customChecklistItems.filter(ci => ci.category === categoryTitle).map(ci => ci.name);
    setCustomChecklistItems(prev => prev.filter(ci => ci.category !== categoryTitle));
    setChecklist(prev => {
      const next = { ...prev };
      itemsToDelete.forEach(name => {
        delete next[name];
      });
      return next;
    });
  };

  const handleDeleteCustomCheckItem = (itemNameToDelete) => {
    setCustomChecklistItems(prev => prev.filter(ci => ci.name !== itemNameToDelete));
    setChecklist(prev => {
      const next = { ...prev };
      delete next[itemNameToDelete];
      return next;
    });
  };

  const checklistCompleted = Object.values(checklist).filter(Boolean).length;
  const checklistTotal = Object.keys(checklist).length;

  const steps = [
    { id: 'location', name: 'Location Verification', completed: !!evidenceSummary.location },
    { id: 'boundary', name: 'Property Boundary', completed: !!boundary },
    { id: 'evidence', name: 'Evidence (Photos/Videos)', completed: evidenceSummary.total > 0 },
    { id: 'checklist', name: 'Field Checklist', completed: checklistReviewed || checklistCompleted > 0 },
    { id: 'remarks', name: 'Field Observations', completed: remarks.length > 0 },
    { id: 'owner', name: 'Owner Information', completed: ownerInfo.name.length > 0 },
    { id: 'consent', name: 'Owner Consent', completed: consent && !!signature }
  ];

  const activeStepIndex = steps.findIndex(s => s.id === activeStepId);
  const currentStep = steps[activeStepIndex];

  const handleMediaSave = async () => {
    setShowPhotoCamera(false);
    setShowVideoCamera(false);
    await loadEvidence();
  };

  const handleAadhaarChange = (e) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 12);
    const parts = [];
    for (let i = 0; i < raw.length; i += 4) {
      parts.push(raw.slice(i, i + 4));
    }
    setOwnerAadhaar(parts.join(' '));
  };

  const handleOwnerPhotoCaptured = async (blob, dataUrl) => {
    setShowOwnerCamera(false);
    setOwnerPhoto(dataUrl);
    try {
      await EvidenceService.saveEvidence({
        taskId: id,
        evidenceType: 'Owner Photo',
        mediaType: 'photo',
        original_blob: blob,
        mime_type: blob.type || 'image/jpeg',
        size: blob.size || 0,
        captured_at: new Date().toISOString()
      });
      await loadEvidence();
    } catch (err) {
      console.error('Failed to save owner photo evidence:', err);
    }
  };

  const handleOwnerPhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    await handleOwnerPhotoCaptured(file, url);
  };

  const togglePhotoSelection = (photoId) => {
    setSelectedPhotoIds(prev => {
      const next = new Set(prev);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }
      return next;
    });
  };

  const handlePhotoTouchStart = (photoId) => {
    isLongPressTriggeredRef.current = false;
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
    longPressTimerRef.current = setTimeout(() => {
      isLongPressTriggeredRef.current = true;
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(50); } catch (e) {}
      }
      setIsSelectionMode(true);
      setSelectedPhotoIds(prev => {
        const next = new Set(prev);
        next.add(photoId);
        return next;
      });
    }, 500);
  };

  const handlePhotoTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handlePhotoClick = (photo) => {
    if (isLongPressTriggeredRef.current) {
      isLongPressTriggeredRef.current = false;
      return;
    }
    if (isSelectionMode) {
      togglePhotoSelection(photo.id);
    } else {
      setSelectedMediaIndex(evidenceList.findIndex(e => e.id === photo.id));
    }
  };

  const handleConfirmDeleteUnselected = async () => {
    const photos = evidenceList.filter(e => e.mediaType === 'photo' && e.evidenceType !== 'Location Verification');
    const toDelete = photos.filter(p => !selectedPhotoIds.has(p.id));
    if (toDelete.length === 0) {
      setShowSelectionDeleteConfirm(false);
      return;
    }

    try {
      // 1. Fetch full raw records from MediaRepository for backup
      const backupRecords = [];
      for (const item of toDelete) {
        const raw = await MediaRepository.getMedia(item.id);
        if (raw) backupRecords.push(raw);
      }

      // 2. Delete unselected photos from MediaRepository
      for (const item of toDelete) {
        await MediaRepository.deleteMedia(item.id);
      }

      // 3. Close confirmation popup, reset selection mode
      setShowSelectionDeleteConfirm(false);
      setIsSelectionMode(false);
      setSelectedPhotoIds(new Set());
      await loadEvidence();

      // 4. Set undo state with 15-second auto-dismiss timer
      if (undoState?.timeoutId) {
        clearTimeout(undoState.timeoutId);
      }
      const timeoutId = setTimeout(() => {
        setUndoState(null);
      }, 15000);

      setUndoState({
        items: backupRecords,
        count: backupRecords.length,
        mediaType: 'photo',
        timeoutId
      });
    } catch (err) {
      console.error("Failed to delete unselected photos:", err);
    }
  };

  const toggleVideoSelection = (videoId) => {
    setSelectedVideoIds(prev => {
      const next = new Set(prev);
      if (next.has(videoId)) {
        next.delete(videoId);
      } else {
        next.add(videoId);
      }
      return next;
    });
  };

  const handleVideoTouchStart = (videoId) => {
    isLongPressTriggeredRef.current = false;
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
    longPressTimerRef.current = setTimeout(() => {
      isLongPressTriggeredRef.current = true;
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(50); } catch (e) {}
      }
      setIsVideoSelectionMode(true);
      setSelectedVideoIds(prev => {
        const next = new Set(prev);
        next.add(videoId);
        return next;
      });
    }, 500);
  };

  const handleVideoTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleVideoClick = (video) => {
    if (isLongPressTriggeredRef.current) {
      isLongPressTriggeredRef.current = false;
      return;
    }
    if (isVideoSelectionMode) {
      toggleVideoSelection(video.id);
    } else {
      setSelectedMediaIndex(evidenceList.findIndex(e => e.id === video.id));
    }
  };

  const handleConfirmDeleteUnselectedVideos = async () => {
    const videos = evidenceList.filter(e => e.mediaType === 'video');
    const toDelete = videos.filter(v => !selectedVideoIds.has(v.id));
    if (toDelete.length === 0) {
      setShowVideoSelectionDeleteConfirm(false);
      setIsVideoSelectionMode(false);
      return;
    }

    try {
      // 1. Fetch full raw records from MediaRepository for backup
      const backupRecords = [];
      for (const item of toDelete) {
        const raw = await MediaRepository.getMedia(item.id);
        if (raw) backupRecords.push(raw);
      }

      // 2. Delete unselected videos from MediaRepository
      for (const item of toDelete) {
        await MediaRepository.deleteMedia(item.id);
      }

      // 3. Close confirmation popup, reset selection mode
      setShowVideoSelectionDeleteConfirm(false);
      setIsVideoSelectionMode(false);
      setSelectedVideoIds(new Set());
      await loadEvidence();

      // 4. Set undo state with 15-second auto-dismiss timer
      if (undoState?.timeoutId) {
        clearTimeout(undoState.timeoutId);
      }
      const timeoutId = setTimeout(() => {
        setUndoState(null);
      }, 15000);

      setUndoState({
        items: backupRecords,
        count: backupRecords.length,
        mediaType: 'video',
        timeoutId
      });
    } catch (err) {
      console.error("Failed to delete unselected videos:", err);
    }
  };

  const handleUndoDelete = async () => {
    if (!undoState || !undoState.items || undoState.items.length === 0) return;
    if (undoState.timeoutId) clearTimeout(undoState.timeoutId);

    try {
      for (const record of undoState.items) {
        await MediaRepository.saveMedia(record);
      }
      setUndoState(null);
      await loadEvidence();
    } catch (err) {
      console.error("Failed to restore photos:", err);
    }
  };

  // Centralized Mobile & Browser Back Action Handlers
  // 1. Delete Confirmations (Priority 110)
  useBackHandler('insp_del_confirm', () => {
    setShowDeleteConfirm(false);
    return true;
  }, 110, showDeleteConfirm);

  useBackHandler('insp_sel_del_confirm', () => {
    setShowSelectionDeleteConfirm(false);
    return true;
  }, 110, showSelectionDeleteConfirm);

  useBackHandler('insp_vid_sel_del_confirm', () => {
    setShowVideoSelectionDeleteConfirm(false);
    return true;
  }, 110, showVideoSelectionDeleteConfirm);

  useBackHandler('insp_custom_cat_modal', () => {
    setShowAddCustomCategoryModal(false);
    return true;
  }, 110, showAddCustomCategoryModal);

  // 2. Full-Screen Viewers (Priority 100)
  useBackHandler('insp_media_viewer', () => {
    setSelectedMediaIndex(null);
    return true;
  }, 100, selectedMediaIndex !== null);

  useBackHandler('insp_viewer_mode', () => {
    setViewerMode(null);
    return true;
  }, 100, viewerMode !== null);

  // 3. Camera Modals & Tools (Priority 90)
  useBackHandler('insp_photo_camera', () => {
    setShowPhotoCamera(false);
    return true;
  }, 90, showPhotoCamera);

  useBackHandler('insp_owner_camera', () => {
    setShowOwnerCamera(false);
    return true;
  }, 90, showOwnerCamera);

  useBackHandler('insp_photo_sphere', () => {
    setShowPhotoSphere(false);
    return true;
  }, 90, showPhotoSphere);

  useBackHandler('insp_video_camera', () => {
    setShowVideoCamera(false);
    return true;
  }, 90, showVideoCamera);

  useBackHandler('insp_boundary_map', () => {
    setShowBoundaryMap(false);
    return true;
  }, 90, showBoundaryMap);

  // 4. Batch Selection Modes (Priority 80)
  useBackHandler('insp_selection_mode', () => {
    setIsSelectionMode(false);
    setIsVideoSelectionMode(false);
    return true;
  }, 80, isSelectionMode || isVideoSelectionMode);

  // 5. Active Inspection Step -> Return to Overview (Priority 50)
  useBackHandler('insp_active_step', () => {
    setActiveStepId('overview');
    return true;
  }, 50, activeStepId !== 'overview' && !showPhotoCamera && !showOwnerCamera && !showPhotoSphere && !showVideoCamera && !showBoundaryMap && selectedMediaIndex === null);

  // 6. Inspection Overview -> Return to Inspections List / Tasks (Priority 20)
  useBackHandler('insp_overview', () => {
    navigate('/tasks');
    return true;
  }, 20, activeStepId === 'overview' && !showPhotoCamera && !showOwnerCamera && !showPhotoSphere && !showVideoCamera && !showBoundaryMap && selectedMediaIndex === null);

  const renderOverviewContent = () => {
    const completedCount = steps.filter(s => s.completed).length;
    
    return (
      <div style={{ minHeight: '100vh', paddingBottom: '100px' }}>
        <header 
          className="flex items-center justify-between p-md border-b border-color relative safe-top-header" 
          style={{ 
            backgroundColor: 'var(--surface-color)', 
            padding: '14px 16px',
            paddingTop: 'calc(var(--safe-area-top, 36px) + 12px)'
          }}
        >
          <div>
            <h2 style={{ fontSize: '18px', margin: 0, fontWeight: 700, color: 'var(--text-primary)' }}>Inspection Dashboard</h2>
            <div className="text-secondary text-xs" style={{ marginTop: '2px' }}>Site Progress & Section Checklist</div>
          </div>
          <span className="text-xs font-mono px-sm py-xs rounded" style={{ backgroundColor: 'var(--surface-light)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
            {inspectionRecord?.id ? inspectionRecord.id.split('-').slice(-2).join('-') : 'ACTIVE'}
          </span>
        </header>

        <div className="p-md mb-md rounded-xl border border-color" style={{ backgroundColor: 'var(--surface-color)', padding: '18px', marginTop: '16px', borderRadius: '12px' }}>
          <div className="text-primary font-mono text-xs mb-xs" style={{ letterSpacing: '0.5px' }}>{inspectionRecord?.id || id}</div>
          <h1 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 12px 0', color: 'var(--text-primary)' }}>{inspectionRecord?.title || 'Field Inspection'}</h1>
          
          <div className="flex justify-between items-center text-xs mb-xs">
            <span style={{ color: 'var(--text-secondary)' }}>Section Completion</span>
            <span style={{ fontWeight: 600, color: completedCount === steps.length ? 'var(--success-color)' : 'var(--primary-color)' }}>
              {completedCount} / {steps.length} sections ({Math.round((completedCount / steps.length) * 100)}%)
            </span>
          </div>
          <div style={{ height: '6px', backgroundColor: 'var(--bg-color)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ width: `${(completedCount / steps.length) * 100}%`, height: '100%', backgroundColor: completedCount === steps.length ? 'var(--success-color)' : 'var(--primary-color)', borderRadius: '3px', transition: 'width 0.3s ease' }}></div>
          </div>
        </div>

        <div className="section-header" style={{ marginBottom: '10px' }}>
          <h3 className="section-title">Inspection Steps</h3>
        </div>
        
        <div className="flex flex-col gap-sm mb-xl">
          {steps.map(step => (
            <div 
              key={step.id} 
              className="card card-interactive"
              style={{ 
                padding: '14px 16px', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between',
                borderRadius: '10px'
              }}
              onClick={() => setActiveStepId(step.id)}
            >
              <div className="flex items-center gap-md">
                <div style={{ 
                  width: '10px', 
                  height: '10px', 
                  borderRadius: '50%', 
                  backgroundColor: step.completed ? 'var(--success-color)' : 'var(--text-secondary)',
                  opacity: step.completed ? 1 : 0.4
                }} />
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{step.name}</span>
              </div>
              <span className={`badge ${step.completed ? 'badge-success' : 'badge-neutral'}`} style={{ fontSize: '11px' }}>
                {step.completed ? 'Completed' : 'Pending'}
              </span>
            </div>
          ))}
        </div>

        {/* Fixed Bottom Button */}
        <div style={{ 
          position: 'fixed', 
          bottom: 0, 
          left: 0, 
          right: 0, 
          maxWidth: '480px', 
          margin: '0 auto', 
          padding: '16px', 
          paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))', 
          backgroundColor: 'rgba(20, 24, 33, 0.95)', 
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderTop: '1px solid var(--border-color)', 
          zIndex: 20 
        }}>
          <button 
            className="btn btn-primary w-full"
            onClick={() => setActiveStepId('review')}
            style={{ minHeight: '48px', fontSize: '15px', fontWeight: 700, borderRadius: '10px' }}
          >
            Review & Finalize Inspection
          </button>
        </div>
      </div>
    );
  };

  const renderLocationContent = () => {
    const locations = evidenceList.filter(e => e.evidenceType === 'Location Verification');
    
    if (locations.length > 0) {
      return (
        <div className="card">
          <h3 className="mb-md text-success flex items-center gap-sm">
            <Check size={20} /> Location Verification
          </h3>
          <p className="text-sm text-secondary mb-md">You can add multiple geotagged photos if necessary.</p>
          
          <div className="flex flex-col gap-md mb-md">
            {locations.map(loc => (
              <div key={loc.id} className="card m-0" style={{ padding: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-color)' }}>
                <img 
                  src={loc.geotaggedImage || loc.originalImage} 
                  alt="Location Evidence" 
                  style={{ width: '100%', borderRadius: '8px', cursor: 'pointer' }} 
                  onClick={() => setSelectedMediaIndex(evidenceList.findIndex(e => e.id === loc.id))}
                />
                <div className="mt-sm px-xs pb-xs text-sm text-secondary">
                  <p>GPS Coordinates: {loc.latitude ? `${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}` : 'Unavailable'}</p>
                </div>
              </div>
            ))}
          </div>

          <button className="btn btn-secondary w-full flex justify-center items-center gap-sm mb-md" onClick={() => setShowPhotoCamera(true)}>
            <Camera size={20} /> Add Another Photo
          </button>

          <button className="btn btn-primary w-full" onClick={() => setActiveStepId('overview')}>Next</button>
        </div>
      );
    }
    return (
      <div className="card text-center p-md">
        <MapPin size={48} className="text-primary mx-auto mb-md" />
        <h3 className="mb-sm">Location Verification</h3>
        <p className="text-secondary text-sm mb-lg">Capture a photo of the property to record where this inspection was performed. Your location will be recorded automatically.</p>
        <button className="btn btn-primary flex justify-center items-center gap-sm" onClick={() => setShowPhotoCamera(true)}>
          <Camera size={20} /> Open Camera
        </button>
      </div>
    );
  };

  const renderBoundaryContent = () => {
    if (boundary) {
      return (
        <div className="flex flex-col gap-md">
          {/* ── Snapshot Image ── */}
          {boundary.snapshot_image && (
            <div style={{
              width: '100%',
              background: '#1a1d24',
              borderRadius: 16,
              overflow: 'hidden',
              border: '1px solid rgba(255,255,255,0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <img 
                src={boundary.snapshot_image} 
                alt="Property Boundary Snapshot" 
                style={{ width: '100%', height: 'auto', objectFit: 'contain', display: 'block' }} 
              />
            </div>
          )}

          {/* Success Banner */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            background: 'rgba(16,185,129,0.1)', padding: '16px', borderRadius: '12px',
            border: '1px solid rgba(16,185,129,0.2)'
          }}>
            <Check size={24} color="#10b981" style={{ flexShrink: 0 }} />
            <div style={{ fontWeight: 700, fontSize: '18px', color: '#10b981' }}>Property Boundary Captured</div>
          </div>

          {/* Stats Card */}
          <div className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="flex justify-between items-center">
              <span className="text-secondary" style={{ fontSize: '14px', fontWeight: 500 }}>Field Area</span>
              <span style={{ fontWeight: 700, fontSize: '15px' }}>
                {boundary.area_acres} ac ({boundary.area_hectares ?? (boundary.area_sq_m ? (boundary.area_sq_m / 10000).toFixed(4) : '—')} ha)
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-secondary" style={{ fontSize: '14px', fontWeight: 500 }}>Area (Sq Metres)</span>
              <span style={{ fontWeight: 700, fontSize: '15px' }}>
                {boundary.area_sq_m ? `${boundary.area_sq_m.toLocaleString()} m²` : '—'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-secondary" style={{ fontSize: '14px', fontWeight: 500 }}>Perimeter</span>
              <span style={{ fontWeight: 700, fontSize: '15px' }}>{boundary.perimeter_m} m</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-secondary" style={{ fontSize: '14px', fontWeight: 500 }}>Method</span>
              <span style={{ fontWeight: 700, fontSize: '15px', textTransform: 'capitalize' }}>{boundary.capture_mode}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-secondary" style={{ fontSize: '14px', fontWeight: 500 }}>Points</span>
              <span style={{ fontWeight: 700, fontSize: '15px' }}>{boundary.coordinates?.length ?? 0}</span>
            </div>

            <div className="flex gap-sm mt-sm">
              <button
                className="btn btn-secondary flex-1 flex justify-center items-center gap-sm"
                onClick={() => setShowBoundaryMap(true)}
                style={{ fontSize: '14px', fontWeight: 600, padding: '12px' }}
              >
                <Landmark size={16} /> Edit Boundary
              </button>
              <button
                className="btn flex-1"
                onClick={() => setActiveStepId('overview')}
                style={{ fontSize: '14px', fontWeight: 600, padding: '12px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '10px' }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="card text-center p-md">
        <Landmark size={48} className="text-primary mx-auto mb-md" />
        <h3 className="mb-sm">Property Boundary</h3>
        <p className="text-secondary text-sm mb-lg">
          Draw the actual boundary of this property on the satellite map. Tap to add vertices and create an accurate polygon.
        </p>
        <button
          className="btn btn-primary flex justify-center items-center gap-sm"
          onClick={() => setShowBoundaryMap(true)}
        >
          <Landmark size={20} /> Open Boundary Map
        </button>
      </div>
    );
  };

  const renderEvidenceContent = () => {
    const photos = evidenceList.filter(e => e.mediaType === 'photo' && e.evidenceType !== 'Location Verification');
    const photoSpheres = evidenceList.filter(e => e.mediaType === 'photo_sphere');
    const videos = evidenceList.filter(e => e.mediaType === 'video');

    return (
      <>
        <div className="flex gap-sm mb-md">
          <button className="btn btn-primary flex-1 flex flex-col gap-xs py-sm" style={{ height: 'auto' }} onClick={() => setShowPhotoCamera(true)}>
            <Camera size={22} />
            <span className="text-sm">Add Photo</span>
          </button>
          <button className="btn btn-primary flex-1 flex flex-col gap-xs py-sm" style={{ height: 'auto', backgroundColor: '#2563eb' }} onClick={() => setShowPhotoSphere(true)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#60a5fa' }} />
              <Camera size={22} />
            </div>
            <span className="text-sm">Photo Sphere</span>
          </button>
          <button className="btn btn-secondary flex-1 flex flex-col gap-xs py-sm border-color" style={{ height: 'auto', border: '1px solid var(--border-color)' }} onClick={() => setShowVideoCamera(true)}>
            <Video size={22} />
            <span className="text-sm">Add Video</span>
          </button>
        </div>

        <div className="card">
          <div className="flex justify-between items-center mb-md">
            <h3>Captured Media</h3>
            <span className="text-sm text-secondary">{photos.length} Photos • {photoSpheres.length} 360° Spheres • {videos.length} Videos</span>
          </div>

          <div className="flex gap-md mb-md">
            <div 
              className="flex-1 flex flex-col items-center justify-center p-md bg-bg-color rounded-lg cursor-pointer transition-all" 
              style={{ border: expandedFolder === 'photos' ? '2px solid var(--primary-color)' : '1px solid var(--border-color)' }}
              onClick={() => setExpandedFolder(expandedFolder === 'photos' ? null : 'photos')}
            >
              <Folder size={32} className={expandedFolder === 'photos' ? "text-primary mb-xs" : "text-secondary mb-xs"} fill="currentColor" fillOpacity={expandedFolder === 'photos' ? 0.3 : 0.1} />
              <span className="font-bold text-sm">Photos</span>
              <span className="text-xs text-secondary">{photos.length} items</span>
            </div>
            <div 
              className="flex-1 flex flex-col items-center justify-center p-md bg-bg-color rounded-lg cursor-pointer transition-all" 
              style={{ border: expandedFolder === 'photospheres' ? '2px solid #2563eb' : '1px solid var(--border-color)' }}
              onClick={() => setExpandedFolder(expandedFolder === 'photospheres' ? null : 'photospheres')}
            >
              <Folder size={32} className={expandedFolder === 'photospheres' ? "text-primary mb-xs" : "text-secondary mb-xs"} fill="#2563eb" fillOpacity={expandedFolder === 'photospheres' ? 0.4 : 0.1} />
              <span className="font-bold text-sm">Photo Spheres</span>
              <span className="text-xs text-secondary">{photoSpheres.length} items</span>
            </div>
            <div 
              className="flex-1 flex flex-col items-center justify-center p-md bg-bg-color rounded-lg cursor-pointer transition-all" 
              style={{ border: expandedFolder === 'videos' ? '2px solid var(--primary-color)' : '1px solid var(--border-color)' }}
              onClick={() => setExpandedFolder(expandedFolder === 'videos' ? null : 'videos')}
            >
              <Folder size={32} className={expandedFolder === 'videos' ? "text-primary mb-xs" : "text-secondary mb-xs"} fill="currentColor" fillOpacity={expandedFolder === 'videos' ? 0.3 : 0.1} />
              <span className="font-bold text-sm">Videos</span>
              <span className="text-xs text-secondary">{videos.length} items</span>
            </div>
          </div>

          {expandedFolder === 'photospheres' && (
            <div className="animate-fade-in mb-sm p-sm bg-bg-color rounded-lg border border-color">
              <h4 className="text-sm mb-sm flex justify-between font-semibold">360° Photo Spheres <span className="text-secondary">{photoSpheres.length}</span></h4>
              {photoSpheres.length === 0 ? <p className="text-center text-xs text-secondary py-sm">No photo spheres captured</p> : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                  {photoSpheres.map((ps) => (
                    <div 
                      key={ps.id} 
                      onClick={() => setSelectedMediaIndex(evidenceList.findIndex(e => e.id === ps.id))} 
                      style={{ aspectRatio: '2/1', backgroundColor: '#000', borderRadius: '8px', overflow: 'hidden', position: 'relative', cursor: 'pointer', border: '1px solid #334155' }}
                    >
                      <img src={ps.originalImage} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="Photo Sphere" />
                      <div style={{ position: 'absolute', bottom: 4, left: 4, backgroundColor: 'rgba(0,0,0,0.6)', padding: '2px 6px', borderRadius: '4px', color: '#60a5fa', fontSize: '10px', fontWeight: 'bold' }}>
                        360°
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {expandedFolder === 'photos' && (
            <div className="animate-fade-in mb-sm p-sm bg-bg-color rounded-lg border border-color">
              <div className="flex justify-between items-center mb-sm">
                <div>
                  <h4 className="text-sm font-semibold m-0">
                    {isSelectionMode ? `${selectedPhotoIds.size} of ${photos.length} Selected` : `Photos (${photos.length})`}
                  </h4>
                  <p className="text-xs text-secondary m-0" style={{ marginTop: '2px' }}>
                    {isSelectionMode ? 'Tap photos to select or deselect.' : 'Tap to view full screen • Long-press to select.'}
                  </p>
                </div>
                {photos.length > 0 && (
                  <div className="flex items-center gap-xs">
                    {isSelectionMode ? (
                      <>
                        <button 
                          type="button"
                          onClick={() => {
                            const photoIds = photos.map(p => p.id);
                            const allSelected = photoIds.every(id => selectedPhotoIds.has(id));
                            setSelectedPhotoIds(prev => {
                              const next = new Set(prev);
                              if (allSelected) {
                                photoIds.forEach(id => next.delete(id));
                              } else {
                                photoIds.forEach(id => next.add(id));
                              }
                              return next;
                            });
                          }}
                          style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '4px 8px', fontSize: '11px', color: 'var(--text-secondary)', cursor: 'pointer' }}
                        >
                          {photos.every(p => selectedPhotoIds.has(p.id)) ? 'Deselect All' : 'Select All'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsSelectionMode(false);
                            setSelectedPhotoIds(new Set());
                          }}
                          style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '4px 8px', fontSize: '11px', color: 'var(--text-secondary)', cursor: 'pointer' }}
                        >
                          Cancel
                        </button>
                        {selectedPhotoIds.size > 0 && (
                          <button
                            type="button"
                            onClick={() => setShowSelectionDeleteConfirm(true)}
                            style={{ 
                              background: 'var(--primary-color)', 
                              border: 'none', 
                              borderRadius: '6px', 
                              padding: '5px 12px', 
                              fontSize: '11px', 
                              color: 'white', 
                              cursor: 'pointer', 
                              fontWeight: 700,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              boxShadow: '0 2px 6px rgba(37, 99, 235, 0.35)'
                            }}
                          >
                            <Check size={13} strokeWidth={3} /> Save & Confirm ({photos.filter(p => selectedPhotoIds.has(p.id)).length})
                          </button>
                        )}
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setIsSelectionMode(true)}
                        style={{ background: 'rgba(37, 99, 235, 0.12)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', color: '#60a5fa', cursor: 'pointer', fontWeight: 600 }}
                      >
                        Select
                      </button>
                    )}
                  </div>
                )}
              </div>

              {photos.length === 0 ? <p className="text-center text-xs text-secondary py-sm">No photos captured</p> : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  {photos.map((p) => {
                    const isSelected = selectedPhotoIds.has(p.id);
                    return (
                      <div 
                        key={p.id} 
                        onTouchStart={() => handlePhotoTouchStart(p.id)}
                        onTouchEnd={handlePhotoTouchEnd}
                        onTouchCancel={handlePhotoTouchEnd}
                        onMouseDown={() => handlePhotoTouchStart(p.id)}
                        onMouseUp={handlePhotoTouchEnd}
                        onMouseLeave={handlePhotoTouchEnd}
                        onClick={() => handlePhotoClick(p)}
                        style={{ 
                          aspectRatio: '1', 
                          backgroundColor: '#000', 
                          borderRadius: '8px', 
                          overflow: 'hidden', 
                          position: 'relative', 
                          cursor: 'pointer',
                          userSelect: 'none',
                          WebkitUserSelect: 'none',
                          border: isSelectionMode && isSelected 
                            ? '2.5px solid var(--primary-color)' 
                            : '1px solid var(--border-color)',
                          boxShadow: isSelectionMode && isSelected 
                            ? '0 0 0 1px var(--primary-color)' 
                            : 'none',
                          transform: isSelectionMode && isSelected ? 'scale(0.97)' : 'scale(1)',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <img 
                          src={p.originalImage} 
                          style={{ 
                            width: '100%', 
                            height: '100%', 
                            objectFit: 'cover',
                            pointerEvents: 'none',
                            opacity: isSelectionMode && !isSelected ? 0.75 : 1
                          }} 
                          alt="evidence" 
                        />
                        
                        {/* Checkbox badge in selection mode */}
                        {isSelectionMode && (
                          <div 
                            style={{ 
                              position: 'absolute', 
                              top: 6, 
                              left: 6, 
                              backgroundColor: isSelected ? 'var(--primary-color)' : 'rgba(0,0,0,0.6)', 
                              border: isSelected ? 'none' : '1.5px solid rgba(255,255,255,0.7)',
                              borderRadius: '4px',
                              width: '20px',
                              height: '20px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
                              pointerEvents: 'none'
                            }}
                          >
                            {isSelected ? (
                              <Check size={14} color="white" strokeWidth={3} />
                            ) : null}
                          </div>
                        )}

                        <div style={{ position: 'absolute', bottom: 4, right: 4, pointerEvents: 'none', opacity: isSelectionMode ? 0.5 : 1 }}>
                          <ImageIcon size={14} color="white" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {expandedFolder === 'videos' && (
            <div className="animate-fade-in mb-sm p-sm bg-bg-color rounded-lg border border-color">
              <div className="flex justify-between items-center mb-sm">
                <div>
                  <h4 className="text-sm font-semibold m-0">
                    {isVideoSelectionMode ? `${selectedVideoIds.size} of ${videos.length} Selected` : `Videos (${videos.length})`}
                  </h4>
                  <p className="text-xs text-secondary m-0" style={{ marginTop: '2px' }}>
                    {isVideoSelectionMode ? 'Tap videos to select or deselect.' : 'Tap to play • Long-press to select.'}
                  </p>
                </div>
                {videos.length > 0 && (
                  <div className="flex items-center gap-xs">
                    {isVideoSelectionMode ? (
                      <>
                        <button 
                          type="button"
                          onClick={() => {
                            const videoIds = videos.map(v => v.id);
                            const allSelected = videoIds.every(id => selectedVideoIds.has(id));
                            setSelectedVideoIds(prev => {
                              const next = new Set(prev);
                              if (allSelected) {
                                videoIds.forEach(id => next.delete(id));
                              } else {
                                videoIds.forEach(id => next.add(id));
                              }
                              return next;
                            });
                          }}
                          style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '4px 8px', fontSize: '11px', color: 'var(--text-secondary)', cursor: 'pointer' }}
                        >
                          {videos.every(v => selectedVideoIds.has(v.id)) ? 'Deselect All' : 'Select All'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsVideoSelectionMode(false);
                            setSelectedVideoIds(new Set());
                          }}
                          style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '4px 8px', fontSize: '11px', color: 'var(--text-secondary)', cursor: 'pointer' }}
                        >
                          Cancel
                        </button>
                        {selectedVideoIds.size > 0 && (
                          <button
                            type="button"
                            onClick={() => setShowVideoSelectionDeleteConfirm(true)}
                            style={{ 
                              background: 'var(--primary-color)', 
                              border: 'none', 
                              borderRadius: '6px', 
                              padding: '5px 12px', 
                              fontSize: '11px', 
                              color: 'white', 
                              cursor: 'pointer', 
                              fontWeight: 700,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              boxShadow: '0 2px 6px rgba(37, 99, 235, 0.35)'
                            }}
                          >
                            <Check size={13} strokeWidth={3} /> Save & Confirm ({videos.filter(v => selectedVideoIds.has(v.id)).length})
                          </button>
                        )}
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setIsVideoSelectionMode(true)}
                        style={{ background: 'rgba(37, 99, 235, 0.12)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', color: '#60a5fa', cursor: 'pointer', fontWeight: 600 }}
                      >
                        Select
                      </button>
                    )}
                  </div>
                )}
              </div>

              {videos.length === 0 ? <p className="text-center text-xs text-secondary py-sm">No videos captured</p> : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  {videos.map((v) => {
                    const isSelected = selectedVideoIds.has(v.id);
                    return (
                      <div 
                        key={v.id} 
                        onTouchStart={() => handleVideoTouchStart(v.id)}
                        onTouchEnd={handleVideoTouchEnd}
                        onTouchCancel={handleVideoTouchEnd}
                        onMouseDown={() => handleVideoTouchStart(v.id)}
                        onMouseUp={handleVideoTouchEnd}
                        onMouseLeave={handleVideoTouchEnd}
                        onClick={() => handleVideoClick(v)}
                        style={{ 
                          aspectRatio: '1', 
                          backgroundColor: '#1e293b', 
                          borderRadius: '8px', 
                          overflow: 'hidden', 
                          position: 'relative', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center', 
                          cursor: 'pointer',
                          userSelect: 'none',
                          WebkitUserSelect: 'none',
                          border: isVideoSelectionMode && isSelected 
                            ? '2.5px solid var(--primary-color)' 
                            : '1px solid var(--border-color)',
                          boxShadow: isVideoSelectionMode && isSelected 
                            ? '0 0 0 1px var(--primary-color)' 
                            : 'none',
                          transform: isVideoSelectionMode && isSelected ? 'scale(0.97)' : 'scale(1)',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        {/* Play Icon */}
                        <div style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: '50%',
                          backgroundColor: 'rgba(0,0,0,0.6)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          opacity: isVideoSelectionMode && !isSelected ? 0.6 : 1
                        }}>
                          <Play size={18} color="white" style={{ marginLeft: '2px' }} />
                        </div>
                        
                        {/* Checkbox badge in selection mode */}
                        {isVideoSelectionMode && (
                          <div 
                            style={{ 
                              position: 'absolute', 
                              top: 6, 
                              left: 6, 
                              backgroundColor: isSelected ? 'var(--primary-color)' : 'rgba(0,0,0,0.6)', 
                              border: isSelected ? 'none' : '1.5px solid rgba(255,255,255,0.7)',
                              borderRadius: '4px',
                              width: '20px',
                              height: '20px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              boxShadow: '0 1px 4px rgba(0,0,0,0.5)',
                              pointerEvents: 'none'
                            }}
                          >
                            {isSelected ? (
                              <Check size={14} color="white" strokeWidth={3} />
                            ) : null}
                          </div>
                        )}

                        <div style={{ position: 'absolute', bottom: 4, right: 6, color: '#f8fafc', fontSize: '10px', fontWeight: 600, backgroundColor: 'rgba(0,0,0,0.6)', padding: '1px 5px', borderRadius: '4px', pointerEvents: 'none' }}>
                          {v.duration ? `${v.duration}s` : 'Video'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {evidenceSummary.total === 0 && <p className="text-center text-secondary py-xs text-sm">No evidence captured yet.</p>}
        </div>

        {isSelectionMode && selectedPhotoIds.size > 0 ? (
          <button 
            className="btn btn-primary mt-md" 
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            onClick={() => {
              const unselected = photos.filter(p => !selectedPhotoIds.has(p.id));
              if (unselected.length > 0) {
                setShowSelectionDeleteConfirm(true);
              } else {
                setIsSelectionMode(false);
                setActiveStepId('overview');
              }
            }}
          >
            <Check size={18} strokeWidth={2.5} /> Save & Confirm ({photos.filter(p => selectedPhotoIds.has(p.id)).length})
          </button>
        ) : isVideoSelectionMode && selectedVideoIds.size > 0 ? (
          <button 
            className="btn btn-primary mt-md" 
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            onClick={() => {
              const unselected = videos.filter(v => !selectedVideoIds.has(v.id));
              if (unselected.length > 0) {
                setShowVideoSelectionDeleteConfirm(true);
              } else {
                setIsVideoSelectionMode(false);
                setActiveStepId('overview');
              }
            }}
          >
            <Check size={18} strokeWidth={2.5} /> Save & Confirm ({videos.filter(v => selectedVideoIds.has(v.id)).length})
          </button>
        ) : (
          <button className="btn btn-primary mt-md" onClick={() => setActiveStepId('overview')}>Next</button>
        )}
      </>
    );
  };

  const renderChecklistContent = () => (
    <div className="card">
      <div className="flex justify-between items-center mb-md">
        <h3 className="m-0">Inspection Checklist</h3>
        <span className="badge badge-primary">{checklistCompleted} / {checklistTotal}</span>
      </div>
      
      <div className="progress-bar mb-md">
        <div className="progress-fill" style={{ width: `${checklistTotal > 0 ? (checklistCompleted/checklistTotal)*100 : 0}%` }}></div>
      </div>

      <div className="flex flex-col gap-md">
        {checklistGroups.map(group => {
          const isCustomGroup = !['Property Access', 'Property Condition', 'Documentation'].includes(group.title);
          const isAddingHere = addingCategory === group.title;

          return (
            <div key={group.title}>
              <div className="flex justify-between items-center mb-sm">
                <h4 className="text-sm text-secondary uppercase font-semibold m-0">{group.title}</h4>
                <div className="flex items-center gap-xs">
                  <button
                    type="button"
                    onClick={() => {
                      if (isAddingHere) {
                        setAddingCategory(null);
                        setCategoryItemInput('');
                        setCategoryItemError('');
                      } else {
                        setAddingCategory(group.title);
                        setCategoryItemInput('');
                        setCategoryItemError('');
                      }
                    }}
                    className="text-xs font-semibold flex items-center gap-xs"
                    style={{
                      background: isAddingHere ? 'var(--primary-color)' : 'rgba(37, 99, 235, 0.12)',
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                      color: isAddingHere ? '#ffffff' : '#60a5fa',
                      cursor: 'pointer',
                      padding: '3px 8px',
                      borderRadius: '6px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <Plus size={12} strokeWidth={2.5} /> Add
                  </button>
                  {isCustomGroup && (
                    <button
                      type="button"
                      onClick={() => handleDeleteCategory(group.title)}
                      title={`Delete category "${group.title}"`}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#ef4444',
                        cursor: 'pointer',
                        padding: '3px 4px',
                        display: 'flex',
                        alignItems: 'center',
                        opacity: 0.8
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                      onMouseLeave={(e) => e.currentTarget.style.opacity = '0.8'}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>

              {/* Inline input for this specific category */}
              {isAddingHere && (
                <div 
                  className="animate-fade-in"
                  style={{
                    backgroundColor: 'var(--surface-light)',
                    border: '1px solid rgba(59, 130, 246, 0.35)',
                    borderRadius: '8px',
                    padding: '8px 10px',
                    marginBottom: '8px'
                  }}
                >
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', width: '100%' }}>
                    <input 
                      type="text" 
                      className="form-input" 
                      placeholder={`Add check to ${group.title}...`}
                      value={categoryItemInput}
                      onChange={(e) => {
                        setCategoryItemInput(e.target.value);
                        if (categoryItemError) setCategoryItemError('');
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleQuickAddCategoryItem(group.title);
                        }
                      }}
                      autoFocus
                      style={{ 
                        flex: 1, 
                        minWidth: 0, 
                        width: '100%', 
                        padding: '8px 12px', 
                        fontSize: '13px', 
                        margin: 0,
                        backgroundColor: 'var(--surface-color, #0f172a)',
                        color: 'var(--text-primary, #ffffff)',
                        border: '1px solid var(--border-color, #334155)',
                        borderRadius: '6px',
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                    />
                    <button 
                      type="button" 
                      className="btn btn-primary"
                      onClick={() => handleQuickAddCategoryItem(group.title)}
                      disabled={!categoryItemInput.trim()}
                      style={{ 
                        width: 'auto',
                        flex: '0 0 auto',
                        padding: '8px 16px', 
                        fontSize: '12px', 
                        fontWeight: 600, 
                        height: 'auto', 
                        minHeight: 'unset', 
                        whiteSpace: 'nowrap',
                        borderRadius: '6px',
                        opacity: !categoryItemInput.trim() ? 0.5 : 1,
                        cursor: !categoryItemInput.trim() ? 'not-allowed' : 'pointer'
                      }}
                    >
                      Add
                    </button>
                    <button 
                      type="button" 
                      onClick={() => {
                        setAddingCategory(null);
                        setCategoryItemInput('');
                        setCategoryItemError('');
                      }}
                      style={{ 
                        background: 'none', 
                        border: 'none', 
                        color: 'var(--text-secondary)', 
                        cursor: 'pointer', 
                        padding: '6px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center',
                        flex: '0 0 auto',
                        borderRadius: '4px'
                      }}
                      aria-label="Cancel"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  {categoryItemError && (
                    <span className="text-danger text-xs" style={{ display: 'block', marginTop: '4px' }}>
                      {categoryItemError}
                    </span>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-xs">
                {group.items.map(item => {
                  const isCustom = customChecklistItems.some(ci => ci.name === item);
                  return (
                    <div 
                      key={item} 
                      className="checkbox-container" 
                      onClick={() => setChecklist(prev => ({...prev, [item]: !prev[item]}))}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '12px' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                        <input type="checkbox" checked={!!checklist[item]} readOnly style={{ pointerEvents: 'none' }} />
                        <span className="text-sm" style={{ wordBreak: 'break-word' }}>{item}</span>
                        {isCustom && (
                          <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', backgroundColor: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', fontWeight: 600, border: '1px solid rgba(59, 130, 246, 0.3)' }}>
                            Custom
                          </span>
                        )}
                      </div>
                      {isCustom && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteCustomCheckItem(item);
                          }}
                          title="Delete custom check"
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#ef4444',
                            cursor: 'pointer',
                            padding: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '4px',
                            opacity: 0.8
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                          onMouseLeave={(e) => e.currentTarget.style.opacity = '0.8'}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom section for creating a new custom category */}
      {showAddCustomCategoryModal && (
        <div 
          className="animate-fade-in"
          style={{
            backgroundColor: 'var(--surface-light)',
            border: '1.5px solid rgba(59, 130, 246, 0.4)',
            borderRadius: '12px',
            padding: '16px',
            marginTop: '16px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
          }}
        >
          <div className="flex justify-between items-center mb-sm">
            <h4 className="text-sm font-bold flex items-center gap-xs" style={{ margin: 0, color: '#60a5fa' }}>
              <PlusCircle size={16} /> Create Custom Category & Check
            </h4>
            <button 
              type="button"
              onClick={() => {
                setShowAddCustomCategoryModal(false);
                setNewCategoryName('');
                setNewCategoryItemName('');
                setCustomCategoryError('');
              }}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px' }}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 500 }}>
              Category Name
            </label>
            <input 
              type="text" 
              className="form-input" 
              placeholder="e.g. Electricity, Water Supply, Security..."
              value={newCategoryName}
              onChange={(e) => {
                setNewCategoryName(e.target.value);
                if (customCategoryError) setCustomCategoryError('');
              }}
              autoFocus
              style={{ fontSize: '13px', width: '100%', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 500 }}>
              Initial Check Item Description
            </label>
            <input 
              type="text" 
              className="form-input" 
              placeholder="e.g. 24/7 Current, Meter reading verified..."
              value={newCategoryItemName}
              onChange={(e) => {
                setNewCategoryItemName(e.target.value);
                if (customCategoryError) setCustomCategoryError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleCreateCustomCategory();
                }
              }}
              style={{ fontSize: '13px', width: '100%', boxSizing: 'border-box' }}
            />
            {customCategoryError && (
              <span className="text-danger text-xs" style={{ display: 'block', marginTop: '4px' }}>
                {customCategoryError}
              </span>
            )}
          </div>

          <div className="flex gap-sm">
            <button 
              type="button"
              className="btn btn-secondary flex-1"
              onClick={() => {
                setShowAddCustomCategoryModal(false);
                setNewCategoryName('');
                setNewCategoryItemName('');
                setCustomCategoryError('');
              }}
              style={{ padding: '8px 12px', fontSize: '13px' }}
            >
              Cancel
            </button>
            <button 
              type="button"
              className="btn btn-primary flex-1"
              onClick={handleCreateCustomCategory}
              disabled={!newCategoryName.trim() || !newCategoryItemName.trim()}
              style={{ padding: '8px 12px', fontSize: '13px', fontWeight: 700 }}
            >
              Create Category
            </button>
          </div>
        </div>
      )}

      {!showAddCustomCategoryModal && (
        <button 
          type="button"
          onClick={() => {
            setShowAddCustomCategoryModal(true);
            setNewCategoryName('');
            setNewCategoryItemName('');
            setCustomCategoryError('');
          }}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '12px',
            marginTop: '16px',
            backgroundColor: 'rgba(37, 99, 235, 0.05)',
            border: '1.5px dashed rgba(59, 130, 246, 0.4)',
            borderRadius: '10px',
            color: '#60a5fa',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          <Plus size={16} strokeWidth={2.5} /> Add Custom Category
        </button>
      )}

      <button 
        className="btn btn-primary mt-lg" 
        onClick={() => {
          setChecklistReviewed(true);
          setActiveStepId('remarks');
        }}
      >
        Continue to Remarks
      </button>
    </div>
  );

  const handleSubmitInspection = async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const now = new Date().toISOString();
      const supervisorId = user?.supervisorProfile?.id || user?.id;

      // Collect location data from the first location evidence item
      const locationEvidence = evidenceList.find(e => e.evidenceType === 'Location Verification');

      // Finalize the inspection record locally
      const existing = await InspectionRepository.getInspection(id);
      await InspectionRepository.saveInspection({
        ...existing,
        id,
        property_id: id,
        property_name: existing?.property_name || null,
        supervisor_id: supervisorId,
        status: 'COMPLETED',
        sync_status: 'QUEUED',
        completed_at: now,
        submitted_at: now,
        latitude: locationEvidence?.latitude || null,
        longitude: locationEvidence?.longitude || null,
        gps_accuracy: locationEvidence?.accuracy || null,
        gps_timestamp: locationEvidence?.location_captured_at || null,
        location_verified: !!locationEvidence,
        metadata: { checklist, customChecklistItems, checklistReviewed, remarks, ownerInfo, consent, signature, ownerAadhaar, ownerPhoto }
      });

      // Enqueue for synchronization (starts automatically if online)
      await SyncEngine.enqueueInspection(id);

      navigate('/sync');
    } catch (err) {
      console.error('Submit failed:', err);
      setSubmitError('Could not save inspection. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderReviewContent = () => (
    <div className="flex flex-col gap-md">
      <div className="card" style={{ marginBottom: 0 }}>
        <h3 className="mb-sm flex items-center gap-sm"><ImageIcon size={18}/> Evidence</h3>
        <div className="flex flex-col gap-xs text-sm">
          <div className="flex justify-between"><span>Location Verification</span> {evidenceSummary.location ? <Check size={16} className="text-success"/> : <span className="text-secondary">Not captured</span>}</div>
          <div className="flex justify-between"><span>Photos Captured</span> <span>{evidenceSummary.photos}</span></div>
          <div className="flex justify-between"><span>Videos Recorded</span> <span>{evidenceSummary.videos}</span></div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <h3 className="mb-sm flex items-center gap-sm"><Landmark size={18}/> Property Boundary</h3>
        <div className="flex flex-col gap-xs text-sm">
          <div className="flex justify-between">
            <span>Boundary</span>
            {boundary ? <Check size={16} className="text-success"/> : <span className="text-secondary">Not captured</span>}
          </div>
          {boundary && (
            <>
              <div className="flex justify-between"><span>Area</span><span>{boundary.area_acres} ac</span></div>
              <div className="flex justify-between"><span>Perimeter</span><span>{boundary.perimeter_m} m</span></div>
              <div className="flex justify-between"><span>Method</span><span style={{ textTransform: 'capitalize' }}>{boundary.capture_mode}</span></div>
            </>
          )}
          {boundary && (
            <button
              className="btn btn-secondary mt-sm"
              style={{ fontSize: 13, padding: '8px 12px', width: 'auto', alignSelf: 'flex-start' }}
              onClick={() => setShowBoundaryMap(true)}
            >
              View Boundary
            </button>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <h3 className="mb-sm flex items-center gap-sm"><Check size={18}/> Checklist</h3>
        <div className="flex justify-between text-sm">
          <span>Completion</span>
          <span className={checklistCompleted === checklistTotal ? 'text-success' : 'text-warning'}>{checklistCompleted} / {checklistTotal} items</span>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <h3 className="mb-sm flex items-center gap-sm"><FileText size={18}/> Details</h3>
        <div className="flex flex-col gap-xs text-sm">
          <div className="flex justify-between"><span>Remarks</span> {remarks ? <Check size={16} className="text-success"/> : <span className="text-secondary">None</span>}</div>
          <div className="flex justify-between"><span>Owner Info</span> {ownerInfo.name ? <Check size={16} className="text-success"/> : <span className="text-secondary">None</span>}</div>
          <div className="flex justify-between"><span>Aadhaar</span> {ownerAadhaar ? <span className="font-mono text-xs">{ownerAadhaar}</span> : <span className="text-secondary">None</span>}</div>
          <div className="flex justify-between"><span>Owner Photo</span> {ownerPhoto ? <Check size={16} className="text-success"/> : <span className="text-secondary">Not captured</span>}</div>
          <div className="flex justify-between"><span>Consent</span> {consent ? <Check size={16} className="text-success"/> : <span className="text-secondary">Pending</span>}</div>
          <div className="flex justify-between"><span>Signature</span> {signature ? <Check size={16} className="text-success"/> : <span className="text-secondary">Pending</span>}</div>
        </div>
      </div>

      {submitError && (
        <div className="text-danger text-sm text-center p-sm rounded" style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
          {submitError}
        </div>
      )}

      <button
        className="btn btn-primary mt-sm py-md text-lg flex items-center justify-center gap-sm"
        onClick={handleSubmitInspection}
        disabled={isSubmitting}
      >
        {isSubmitting ? <><Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> Saving...</> : <><Upload size={20} /> Submit Inspection</>}
      </button>

      <p className="text-center text-xs text-secondary" style={{ marginTop: '-8px' }}>
        Inspection is saved locally first, then synced automatically.
      </p>
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg-color">
        <div className="text-secondary">Loading inspection data...</div>
      </div>
    );
  }

  return (
    <div className="inspection-session bg-bg-color" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {showPhotoCamera && (
        <FieldCamera 
          taskId={id} 
          evidenceType={activeStepId === 'location' ? 'Location Verification' : 'Exterior'} 
          initialThumbnail={
            (() => {
              const photos = evidenceList.filter(e => e.mediaType === 'photo' && e.evidenceType !== 'Location Verification');
              const last = photos[photos.length - 1];
              return last?.originalImage || last?.geotaggedImage || null;
            })()
          }
          initialCount={
            evidenceList.filter(e => e.mediaType === 'photo' && e.evidenceType !== 'Location Verification').length
          }
          onPhotoCaptured={async () => {
            await loadEvidence();
          }}
          onOpenGallery={() => {
            setShowPhotoCamera(false);
            setActiveStepId('evidence');
            setExpandedFolder('photos');
            loadEvidence();
          }}
          onCancel={() => setShowPhotoCamera(false)} 
        />
      )}
      {showOwnerCamera && (
        <OwnerCamera 
          onPhotoCaptured={handleOwnerPhotoCaptured}
          onClose={() => setShowOwnerCamera(false)}
        />
      )}
      {showPhotoSphere && (
        <PhotoSphereCapture
          taskId={id}
          onSaveEvidence={async (data) => {
            await EvidenceService.saveEvidence({
              taskId: id,
              mediaType: 'photo_sphere',
              evidenceType: '360 Photo Sphere',
              original_blob: data.blob,
              geotagged_blob: data.blob,
              metadata: {
                framesCount: data.framesCount,
                sessionId: data.sessionId,
              },
            });
            setShowPhotoSphere(false);
            await loadEvidence();
          }}
          onClose={() => setShowPhotoSphere(false)}
        />
      )}
      {showVideoCamera && (
        <VideoCamera 
          taskId={id} 
          evidenceType="Exterior Video" 
          onSave={async () => {
            setShowVideoCamera(false);
            setActiveStepId('evidence');
            setExpandedFolder('videos');
            await loadEvidence();
          }} 
          onCancel={() => setShowVideoCamera(false)} 
        />
      )}
      {showBoundaryMap && (
        <PropertyBoundary
          inspectionId={id}
          propertyId={id}
          propertyAreaAcres={null}
          onSave={(saved) => {
            setBoundary(saved);
            setShowBoundaryMap(false);
            setActiveStepId('overview');
          }}
          onCancel={() => setShowBoundaryMap(false)}
        />
      )}

      {activeStepId !== 'overview' && (
        <header 
          className="p-md safe-top-header" 
          style={{ 
            padding: '12px 16px 14px 16px', 
            paddingTop: 'calc(var(--safe-area-top, 36px) + 12px)',
            backgroundColor: 'var(--surface-color)', 
            borderBottom: '1px solid var(--border-color)', 
            position: 'sticky', 
            top: 0, 
            zIndex: 10 
          }}
        >
          <div className="flex justify-between items-center mb-sm">
            <div className="flex items-center gap-sm">
              <button onClick={() => setActiveStepId('overview')} className="text-primary flex items-center" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
                <ArrowLeft size={20} />
              </button>
              <h2 style={{ fontSize: '18px', margin: 0 }}>Inspection <span className="text-secondary text-sm ml-xs font-normal">Step {activeStepIndex + 1} of {steps.length}</span></h2>
            </div>
            <button onClick={() => navigate('/tasks')} className="text-primary text-sm font-medium" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>Save & Exit</button>
          </div>
          <div className="flex items-center justify-between">
            <h3 className="text-primary">{currentStep?.name}</h3>
            {currentStep?.label && <span className="text-xs text-secondary bg-surface px-xs py-xs rounded">{currentStep.label}</span>}
          </div>
          <div className="progress-bar mt-sm" style={{ height: '4px' }}>
            <div className="progress-fill" style={{ width: `${((activeStepIndex + 1) / steps.length) * 100}%` }}></div>
          </div>
        </header>
      )}

      <div className="flex-1 overflow-y-auto" style={{ padding: '16px', paddingBottom: '32px' }}>
        {activeStepId === 'overview' && renderOverviewContent()}
        {activeStepId === 'location' && renderLocationContent()}
        {activeStepId === 'boundary' && renderBoundaryContent()}
        {activeStepId === 'evidence' && renderEvidenceContent()}
        {activeStepId === 'checklist' && renderChecklistContent()}
        
        {activeStepId === 'remarks' && (
          <div className="card">
            <h3 className="mb-md">Remarks & Observations</h3>
            <textarea className="form-textarea mb-md" rows={5} placeholder="Add any issues or observations..." value={remarks} onChange={(e) => setRemarks(e.target.value)}></textarea>
            <button className="btn btn-primary" onClick={() => setActiveStepId('overview')}>Next</button>
          </div>
        )}

        {activeStepId === 'owner' && (
          <div className="card">
            <h3 className="mb-md">Owner Information</h3>
            <div className="form-group">
              <label className="form-label">Name</label>
              <input type="text" className="form-input" value={ownerInfo.name} onChange={e => setOwnerInfo({...ownerInfo, name: e.target.value})} placeholder="Ramesh Kumar" />
            </div>
            <div className="form-group">
              <label className="form-label">Phone</label>
              <input type="tel" className="form-input" value={ownerInfo.phone} onChange={e => setOwnerInfo({...ownerInfo, phone: e.target.value})} placeholder="+91" />
            </div>
            <div className="form-group">
              <label className="form-label">Relationship to Property</label>
              <select className="form-input" value={ownerInfo.relationship || 'Owner'} onChange={e => setOwnerInfo({...ownerInfo, relationship: e.target.value})}>
                <option value="Owner">Owner</option>
                <option value="Tenant">Tenant</option>
                <option value="Property Manager">Property Manager</option>
                <option value="Relative">Relative</option>
                <option value="Neighbor">Neighbor</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div className="form-group mb-lg">
              <label className="form-label">Remarks (Optional)</label>
              <textarea className="form-textarea" rows={3} value={ownerInfo.remarks || ''} onChange={e => setOwnerInfo({...ownerInfo, remarks: e.target.value})} placeholder="Any additional notes about the owner/contact..."></textarea>
            </div>
            <button className="btn btn-primary" onClick={() => setActiveStepId('consent')}>Continue to Consent</button>
          </div>
        )}

        {activeStepId === 'consent' && (
          <div className="flex flex-col gap-md">
            <div className="card" style={{ marginBottom: 0 }}>
              <h3 className="mb-md">Owner Consent</h3>
              <p className="text-sm text-secondary mb-md">I confirm that I have provided access/permission for the 7Days Properties field supervisor to conduct this field verification and collect photographs, videos, location information, and relevant field observations for property verification purposes.</p>
              <div className="checkbox-container" onClick={() => setConsent(!consent)}>
                <input type="checkbox" checked={consent} readOnly style={{ pointerEvents: 'none' }} />
                <span className="font-medium text-sm">Consent Confirmed</span>
              </div>
            </div>

            {consent && (
              <div className="card animate-fade-in" style={{ marginBottom: 0 }}>
                {/* 1. Aadhaar Card Number */}
                <div className="form-group mb-md">
                  <label className="form-label flex items-center justify-between">
                    <span className="flex items-center gap-xs font-semibold">
                      <Landmark size={15} className="text-primary" /> Aadhaar Card Number
                    </span>
                    {ownerAadhaar && (
                      <span 
                        className="text-xs" 
                        style={{ 
                          color: ownerAadhaar.replace(/\D/g, '').length === 12 ? 'var(--success-color)' : 'var(--text-secondary)',
                          fontWeight: 600
                        }}
                      >
                        {ownerAadhaar.replace(/\D/g, '').length === 12 ? '✓ 12 Digits Verified' : `${ownerAadhaar.replace(/\D/g, '').length} / 12 digits`}
                      </span>
                    )}
                  </label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    className="form-input"
                    value={ownerAadhaar}
                    onChange={handleAadhaarChange}
                    placeholder="XXXX XXXX XXXX (12-digit Aadhaar)"
                    maxLength={14}
                    style={{
                      letterSpacing: '1.5px',
                      fontWeight: 600,
                      fontSize: '15px'
                    }}
                  />
                  <p className="text-xs text-secondary mt-xs" style={{ margin: '4px 0 0' }}>
                    Enter the property owner or representative's 12-digit Aadhaar number for identity verification.
                  </p>
                </div>

                {/* 2. Owner Photograph (Camera Option) */}
                <div className="form-group mb-lg">
                  <label className="form-label flex items-center justify-between">
                    <span className="flex items-center gap-xs font-semibold">
                      <Camera size={15} className="text-primary" /> Owner Photograph
                    </span>
                    {ownerPhoto && (
                      <span className="text-xs text-success flex items-center gap-xs font-semibold">
                        <Check size={13} /> Photo Captured
                      </span>
                    )}
                  </label>
                  
                  {ownerPhoto ? (
                    <div 
                      style={{
                        backgroundColor: 'var(--surface-color)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '12px',
                        padding: '14px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '14px',
                      }}
                    >
                      <div 
                        style={{ 
                          width: '72px', 
                          height: '72px', 
                          borderRadius: '10px', 
                          overflow: 'hidden', 
                          border: '2px solid var(--success-color)',
                          flexShrink: 0,
                          backgroundColor: '#000'
                        }}
                      >
                        <img src={ownerPhoto} alt="Owner" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="font-semibold text-sm mb-xs text-primary flex items-center gap-xs">
                          <CheckCircle size={14} className="text-success" /> Verified Photo
                        </div>
                        <p className="text-xs text-secondary" style={{ margin: '0 0 8px 0' }}>
                          Owner verification photo captured and saved to evidence.
                        </p>
                        <div className="flex gap-xs">
                          <button
                            type="button"
                            className="btn btn-sm btn-outline flex items-center gap-xs"
                            style={{ padding: '4px 10px', fontSize: '11px' }}
                            onClick={() => setShowOwnerCamera(true)}
                          >
                            <RotateCcw size={12} /> Retake
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline flex items-center gap-xs"
                            style={{ padding: '4px 10px', fontSize: '11px', color: 'var(--danger-color)' }}
                            onClick={() => setOwnerPhoto(null)}
                          >
                            <Trash2 size={12} /> Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div
                      style={{
                        border: '2px dashed var(--border-color)',
                        borderRadius: '12px',
                        padding: '18px 14px',
                        textAlign: 'center',
                        backgroundColor: 'var(--surface-raised, rgba(255,255,255,0.02))',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '10px'
                      }}
                    >
                      <div 
                        style={{ 
                          width: '48px', 
                          height: '48px', 
                          borderRadius: '50%', 
                          backgroundColor: 'var(--primary-transparent, rgba(37,99,235,0.1))',
                          color: 'var(--primary-color)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <Camera size={24} />
                      </div>
                      <div>
                        <div className="font-semibold text-sm mb-xs" style={{ color: 'var(--text-primary)' }}>
                          Capture Owner Photograph
                        </div>
                        <p className="text-xs text-secondary" style={{ margin: 0, maxWidth: '280px' }}>
                          Take a clear photo of the property owner or representative granting consent.
                        </p>
                      </div>
                      <div className="flex flex-col gap-xs w-full" style={{ maxWidth: '260px', marginTop: '4px' }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm flex items-center justify-center gap-xs"
                          style={{ padding: '10px 16px', fontWeight: 600 }}
                          onClick={() => setShowOwnerCamera(true)}
                        >
                          <Camera size={16} /> Take Owner Photo
                        </button>
                        <label
                          className="btn btn-outline btn-sm flex items-center justify-center gap-xs"
                          style={{ padding: '6px 12px', fontSize: '12px', cursor: 'pointer', margin: 0 }}
                        >
                          <Upload size={13} /> Or upload photo
                          <input
                            type="file"
                            accept="image/*"
                            capture="user"
                            style={{ display: 'none' }}
                            onChange={handleOwnerPhotoUpload}
                          />
                        </label>
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '18px 0' }} />

                <h3 className="mb-md">Owner Signature</h3>
                {signature ? (
                  <div className="flex flex-col gap-md">
                    <div 
                      style={{ 
                        backgroundColor: '#ffffff', 
                        borderRadius: '10px', 
                        padding: '16px', 
                        border: '2px solid var(--success-color)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                      }}
                    >
                      <img src={signature} alt="Owner Signature" style={{ width: '100%', maxHeight: '180px', objectFit: 'contain' }} />
                      <div className="text-success text-center text-sm font-semibold mt-sm flex items-center justify-center gap-xs">
                        <Check size={16} strokeWidth={2.5} /> Signature Saved & Verified
                      </div>
                    </div>
                    <div className="flex gap-sm">
                      <button className="btn btn-outline flex-1" onClick={() => setSignature(null)}>Redraw</button>
                      <button className="btn btn-primary flex-1" onClick={() => setActiveStepId('review')}>Continue</button>
                    </div>
                  </div>
                ) : (
                  <SignaturePad 
                    onSave={async (dataUrl, blob) => {
                      const record = await EvidenceService.saveEvidence({
                        taskId: id,
                        evidenceType: 'Owner Signature',
                        mediaType: 'signature',
                        original_blob: blob,
                        mime_type: 'image/png',
                        size: blob.size,
                        captured_at: new Date().toISOString()
                      });
                      setSignature(dataUrl); // For UI display
                      setActiveStepId('review');
                    }} 
                    onClear={() => setSignature(null)} 
                  />
                )}
              </div>
            )}
          </div>
        )}

        {activeStepId === 'review' && renderReviewContent()}
      </div>

      {selectedMediaIndex !== null && evidenceList[selectedMediaIndex] && (
        <div 
          className="fixed inset-0 bg-black z-50 flex flex-col justify-center items-center animate-fade-in" 
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 }}
          onTouchStart={(e) => {
            setTouchEnd(null);
            setTouchStart(e.targetTouches[0].clientX);
          }}
          onTouchMove={(e) => setTouchEnd(e.targetTouches[0].clientX)}
          onTouchEnd={() => {
            if (!touchStart || !touchEnd) return;
            const distance = touchStart - touchEnd;
            const isLeftSwipe = distance > 50;
            const isRightSwipe = distance < -50;
            
            // Find next/prev valid evidence (same group)
            const currentItem = evidenceList[selectedMediaIndex];
            const isSameGroup = (a, b) => {
              if (a.evidenceType === 'Location Verification' && b.evidenceType === 'Location Verification') return true;
              if (a.evidenceType !== 'Location Verification' && b.evidenceType !== 'Location Verification' && a.mediaType === b.mediaType) return true;
              return false;
            };

            if (isLeftSwipe) {
              let nextIdx = selectedMediaIndex + 1;
              while (nextIdx < evidenceList.length && !isSameGroup(currentItem, evidenceList[nextIdx])) nextIdx++;
              if (nextIdx < evidenceList.length) setSelectedMediaIndex(nextIdx);
            }
            if (isRightSwipe) {
              let prevIdx = selectedMediaIndex - 1;
              while (prevIdx >= 0 && !isSameGroup(currentItem, evidenceList[prevIdx])) prevIdx--;
              if (prevIdx >= 0) setSelectedMediaIndex(prevIdx);
            }
          }}
        >
          {/* Close Button */}
          <button 
            onClick={() => setSelectedMediaIndex(null)} 
            style={{ position: 'absolute', top: 'calc(var(--safe-area-top, 36px) + 12px)', right: '16px', backgroundColor: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '50%', padding: '8px', cursor: 'pointer', zIndex: 10000 }}
          >
            <X size={24} color="white" />
          </button>

          {/* Delete Button */}
          <button 
            onClick={() => setShowDeleteConfirm(true)} 
            style={{ position: 'absolute', top: 'calc(var(--safe-area-top, 36px) + 12px)', right: '64px', backgroundColor: 'rgba(255,0,0,0.4)', border: 'none', borderRadius: '50%', padding: '8px', cursor: 'pointer', zIndex: 10000 }}
          >
            <Trash2 size={24} color="white" />
          </button>

          {/* Select / Deselect Button in Full Screen Preview (Photos & Videos) */}
          {((evidenceList[selectedMediaIndex].mediaType === 'photo' && evidenceList[selectedMediaIndex].evidenceType !== 'Location Verification') || evidenceList[selectedMediaIndex].mediaType === 'video') && (() => {
            const isVid = evidenceList[selectedMediaIndex].mediaType === 'video';
            const isSelected = isVid 
              ? selectedVideoIds.has(evidenceList[selectedMediaIndex].id)
              : selectedPhotoIds.has(evidenceList[selectedMediaIndex].id);
            const labelType = isVid ? 'Video' : 'Photo';

            return (
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  if (isVid) {
                    toggleVideoSelection(evidenceList[selectedMediaIndex].id);
                    setIsVideoSelectionMode(true);
                  } else {
                    togglePhotoSelection(evidenceList[selectedMediaIndex].id);
                    setIsSelectionMode(true);
                  }
                }} 
                style={{ 
                  position: 'absolute', 
                  top: '16px', 
                  right: '114px', 
                  backgroundColor: isSelected ? 'var(--primary-color)' : 'rgba(255,255,255,0.2)', 
                  border: isSelected ? '1px solid #60a5fa' : '1px solid rgba(255,255,255,0.3)', 
                  borderRadius: '20px', 
                  padding: '7px 14px', 
                  cursor: 'pointer', 
                  zIndex: 10000,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: 'white',
                  fontSize: '13px',
                  fontWeight: 600,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)'
                }}
                title={isSelected ? `Deselect ${labelType}` : `Select ${labelType}`}
                aria-label={isSelected ? `Deselect ${labelType}` : `Select ${labelType}`}
              >
                {isSelected ? (
                  <>
                    <CheckSquare size={16} color="white" />
                    <span>Selected</span>
                  </>
                ) : (
                  <>
                    <Square size={16} color="white" />
                    <span>Select</span>
                  </>
                )}
              </button>
            );
          })()}

          {showDeleteConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80 p-md animate-fade-in" style={{ zIndex: 10001 }}>
              <div className="bg-surface-color p-lg rounded-xl shadow-lg w-full max-w-sm text-center border border-color" style={{ backgroundColor: 'var(--surface-color)', border: '1px solid var(--border-color)' }}>
                <div className="mx-auto w-16 h-16 bg-red-900 bg-opacity-20 flex items-center justify-center rounded-full mb-md" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}>
                  <Trash2 size={32} style={{ color: '#ef4444' }} />
                </div>
                <h3 className="text-xl font-bold mb-xs" style={{ color: 'var(--text-primary)' }}>Delete Media?</h3>
                <p className="text-sm text-secondary mb-lg">This action cannot be undone. Are you sure you want to permanently remove this file?</p>
                
                <div className="flex gap-md">
                  <button 
                    className="btn btn-secondary flex-1" 
                    onClick={() => setShowDeleteConfirm(false)}
                    style={{ backgroundColor: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                  >
                    Cancel
                  </button>
                  <button 
                    className="btn flex-1 text-white font-bold" 
                    style={{ backgroundColor: '#ef4444', border: 'none' }}
                    onClick={async () => {
                      const item = evidenceList[selectedMediaIndex];
                      await MediaRepository.deleteMedia(item.id);
                      setShowDeleteConfirm(false);
                      setSelectedMediaIndex(null);
                      await loadEvidence();
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Previous Button (Desktop/Click) */}
          <button 
            onClick={() => {
              const currentItem = evidenceList[selectedMediaIndex];
              const isSameGroup = (a, b) => {
                if (a.evidenceType === 'Location Verification' && b.evidenceType === 'Location Verification') return true;
                if (a.evidenceType !== 'Location Verification' && b.evidenceType !== 'Location Verification' && a.mediaType === b.mediaType) return true;
                return false;
              };
              let prevIdx = selectedMediaIndex - 1;
              while (prevIdx >= 0 && !isSameGroup(currentItem, evidenceList[prevIdx])) prevIdx--;
              if (prevIdx >= 0) setSelectedMediaIndex(prevIdx);
            }}
            style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', backgroundColor: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '50%', padding: '8px', cursor: 'pointer', zIndex: 10000, display: (() => {
              const currentItem = evidenceList[selectedMediaIndex];
              const isSameGroup = (a, b) => {
                if (a.evidenceType === 'Location Verification' && b.evidenceType === 'Location Verification') return true;
                if (a.evidenceType !== 'Location Verification' && b.evidenceType !== 'Location Verification' && a.mediaType === b.mediaType) return true;
                return false;
              };
              let hasPrev = false;
              for(let i = selectedMediaIndex - 1; i >= 0; i--) {
                if(isSameGroup(currentItem, evidenceList[i])) { hasPrev = true; break; }
              }
              return hasPrev ? 'block' : 'none';
            })() }}
          >
            <ChevronLeft size={32} color="white" />
          </button>

          {/* Next Button (Desktop/Click) */}
          <button 
            onClick={() => {
              const currentItem = evidenceList[selectedMediaIndex];
              const isSameGroup = (a, b) => {
                if (a.evidenceType === 'Location Verification' && b.evidenceType === 'Location Verification') return true;
                if (a.evidenceType !== 'Location Verification' && b.evidenceType !== 'Location Verification' && a.mediaType === b.mediaType) return true;
                return false;
              };
              let nextIdx = selectedMediaIndex + 1;
              while (nextIdx < evidenceList.length && !isSameGroup(currentItem, evidenceList[nextIdx])) nextIdx++;
              if (nextIdx < evidenceList.length) setSelectedMediaIndex(nextIdx);
            }}
            style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', backgroundColor: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '50%', padding: '8px', cursor: 'pointer', zIndex: 10000, display: (() => {
              const currentItem = evidenceList[selectedMediaIndex];
              const isSameGroup = (a, b) => {
                if (a.evidenceType === 'Location Verification' && b.evidenceType === 'Location Verification') return true;
                if (a.evidenceType !== 'Location Verification' && b.evidenceType !== 'Location Verification' && a.mediaType === b.mediaType) return true;
                return false;
              };
              let hasNext = false;
              for(let i = selectedMediaIndex + 1; i < evidenceList.length; i++) {
                if(isSameGroup(currentItem, evidenceList[i])) { hasNext = true; break; }
              }
              return hasNext ? 'block' : 'none';
            })() }}
          >
            <ChevronRight size={32} color="white" />
          </button>

          {/* Indicator */}
          <div style={{ position: 'absolute', top: '24px', left: '50%', transform: 'translateX(-50%)', color: 'white', backgroundColor: 'rgba(0,0,0,0.5)', padding: '4px 12px', borderRadius: '16px', fontSize: '14px', zIndex: 10000 }}>
            {evidenceList[selectedMediaIndex].evidenceType === 'Location Verification' ? 'Location Photo' : (evidenceList[selectedMediaIndex].mediaType === 'photo_sphere' ? '360° Photo Sphere' : (evidenceList[selectedMediaIndex].mediaType === 'photo' ? 'Photo' : 'Video'))}
          </div>

          {evidenceList[selectedMediaIndex].mediaType === 'video' ? (
            <video 
              key={evidenceList[selectedMediaIndex].id} 
              src={evidenceList[selectedMediaIndex].originalImage} 
              controls 
              autoPlay 
              playsInline 
              preload="auto"
              style={{ width: '100%', height: '100%', objectFit: 'contain' }} 
            />
          ) : evidenceList[selectedMediaIndex].mediaType === 'photo_sphere' ? (
            <InteractivePhotoSphereViewer
              imageUrl={evidenceList[selectedMediaIndex].geotaggedImage || evidenceList[selectedMediaIndex].originalImage}
              title="360° Photo Sphere Evidence"
              subtitle={evidenceList[selectedMediaIndex].title || 'Inspection 360 View'}
              isEvidenceView={true}
              onClose={() => setSelectedMediaIndex(null)}
            />
          ) : (
            <img key={evidenceList[selectedMediaIndex].id} src={evidenceList[selectedMediaIndex].geotaggedImage || evidenceList[selectedMediaIndex].originalImage} alt="Fullscreen Evidence" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          )}
        </div>
      )}

      {/* Fullscreen VR / Motion Viewer modal when opened from gallery */}
      {viewerMode?.mode === 'vr' && (
        <VRViewer panoramaUrl={viewerMode.url} onClose={() => setViewerMode(null)} />
      )}
      {viewerMode?.mode === 'motion' && (
        <MotionSensorViewer panoramaUrl={viewerMode.url} onClose={() => setViewerMode(null)} />
      )}

      {/* Confirmation Popup before Deleting Unselected Photos */}
      {/* Confirmation Popup before Deleting Unselected Photos */}
      {showSelectionDeleteConfirm && (() => {
        const photos = evidenceList.filter(e => e.mediaType === 'photo' && e.evidenceType !== 'Location Verification');
        const selectedPhotos = photos.filter(p => selectedPhotoIds.has(p.id));
        const unselectedPhotos = photos.filter(p => !selectedPhotoIds.has(p.id));

        return (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-md animate-fade-in" 
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
          >
            <div 
              className="card w-full max-w-sm border border-color" 
              style={{ backgroundColor: 'var(--surface-color)', borderRadius: '16px', padding: '22px', maxWidth: '440px', width: '100%', boxShadow: '0 20px 40px rgba(0,0,0,0.7)', border: '1px solid var(--border-color)', boxSizing: 'border-box' }}
            >
              <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                <div style={{ width: '56px', height: '56px', borderRadius: '50%', backgroundColor: 'rgba(37, 99, 235, 0.15)', border: '1px solid rgba(59, 130, 246, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px auto' }}>
                  <CheckSquare size={28} style={{ color: '#3b82f6' }} />
                </div>
                <h3 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 6px 0', color: 'var(--text-primary)' }}>
                  Save & Confirm Selection
                </h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                  Please confirm your photo selection. Your consent is required to erase the unselected photos.
                </p>
              </div>

              {/* Photos to Save */}
              <div style={{ marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Photos to Keep & Save ({selectedPhotos.length}):
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--success-color)', fontWeight: 600 }}>Kept</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', maxHeight: '100px', overflowY: 'auto', padding: '6px', backgroundColor: 'var(--bg-color)', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
                  {selectedPhotos.map(photo => (
                    <div 
                      key={photo.id}
                      style={{ aspectRatio: '1', borderRadius: '6px', overflow: 'hidden', position: 'relative', border: '2px solid #3b82f6' }}
                    >
                      <img src={photo.originalImage} alt="Selected to save" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      <div style={{ position: 'absolute', top: 2, right: 2, backgroundColor: '#2563eb', borderRadius: '50%', width: '15px', height: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Check size={9} color="white" strokeWidth={3} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Photos to Erase */}
              {unselectedPhotos.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Unselected Photos to Erase ({unselectedPhotos.length}):
                    </span>
                    <span style={{ fontSize: '11px', color: '#f87171', fontWeight: 600 }}>Will be erased</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', maxHeight: '100px', overflowY: 'auto', padding: '6px', backgroundColor: 'var(--bg-color)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                    {unselectedPhotos.map(photo => (
                      <div 
                        key={photo.id}
                        style={{ aspectRatio: '1', borderRadius: '6px', overflow: 'hidden', position: 'relative', border: '1px solid rgba(239, 68, 68, 0.5)', opacity: 0.7 }}
                      >
                        <img src={photo.originalImage} alt="Unselected" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        <div style={{ position: 'absolute', top: 2, right: 2, backgroundColor: '#ef4444', borderRadius: '50%', width: '15px', height: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <X size={9} color="white" strokeWidth={3} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* User Consent notice box */}
              <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '8px', padding: '10px 12px', marginBottom: '16px', fontSize: '12px', color: '#fca5a5', lineHeight: 1.4 }}>
                <strong>User Consent:</strong> By clicking below, you consent to erase the <strong>{unselectedPhotos.length} unselected photo(s)</strong>. Only the <strong>{selectedPhotos.length} selected photo(s)</strong> will be saved.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button 
                  type="button"
                  className="btn text-white font-bold"
                  style={{ backgroundColor: '#ef4444', border: 'none', padding: '12px', borderRadius: '10px', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                  onClick={handleConfirmDeleteUnselected}
                >
                  <Trash2 size={16} /> Save & Confirm (Erase {unselectedPhotos.length} Unselected)
                </button>
                <button 
                  type="button"
                  className="btn btn-secondary"
                  style={{ backgroundColor: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '10px', borderRadius: '10px', fontSize: '14px', cursor: 'pointer' }}
                  onClick={() => setShowSelectionDeleteConfirm(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Confirmation Popup before Deleting Unselected Videos */}
      {showVideoSelectionDeleteConfirm && (() => {
        const videos = evidenceList.filter(e => e.mediaType === 'video');
        const selectedVideos = videos.filter(v => selectedVideoIds.has(v.id));
        const unselectedVideos = videos.filter(v => !selectedVideoIds.has(v.id));

        return (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-md animate-fade-in" 
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
          >
            <div 
              className="card w-full max-w-sm border border-color" 
              style={{ backgroundColor: 'var(--surface-color)', borderRadius: '16px', padding: '22px', maxWidth: '440px', width: '100%', boxShadow: '0 20px 40px rgba(0,0,0,0.7)', border: '1px solid var(--border-color)', boxSizing: 'border-box' }}
            >
              <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                <div style={{ width: '56px', height: '56px', borderRadius: '50%', backgroundColor: 'rgba(37, 99, 235, 0.15)', border: '1px solid rgba(59, 130, 246, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px auto' }}>
                  <CheckSquare size={28} style={{ color: '#3b82f6' }} />
                </div>
                <h3 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 6px 0', color: 'var(--text-primary)' }}>
                  Save & Confirm Selection
                </h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                  Please confirm your video selection. Your consent is required to erase the unselected videos.
                </p>
              </div>

              {/* Videos to Save */}
              <div style={{ marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Videos to Keep & Save ({selectedVideos.length}):
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--success-color)', fontWeight: 600 }}>Kept</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', maxHeight: '100px', overflowY: 'auto', padding: '6px', backgroundColor: 'var(--bg-color)', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
                  {selectedVideos.map(video => (
                    <div 
                      key={video.id}
                      style={{ aspectRatio: '1', borderRadius: '6px', overflow: 'hidden', position: 'relative', border: '2px solid #3b82f6', backgroundColor: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Play size={16} color="white" />
                      <div style={{ position: 'absolute', top: 2, right: 2, backgroundColor: '#2563eb', borderRadius: '50%', width: '15px', height: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Check size={9} color="white" strokeWidth={3} />
                      </div>
                      <div style={{ position: 'absolute', bottom: 2, left: 2, right: 2, textAlign: 'center', fontSize: '9px', color: '#94a3b8', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: '2px' }}>
                        {video.duration ? `${video.duration}s` : 'Video'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Videos to Erase */}
              {unselectedVideos.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Unselected Videos to Erase ({unselectedVideos.length}):
                    </span>
                    <span style={{ fontSize: '11px', color: '#f87171', fontWeight: 600 }}>Will be erased</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', maxHeight: '100px', overflowY: 'auto', padding: '6px', backgroundColor: 'var(--bg-color)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                    {unselectedVideos.map(video => (
                      <div 
                        key={video.id}
                        style={{ aspectRatio: '1', borderRadius: '6px', overflow: 'hidden', position: 'relative', border: '1px solid rgba(239, 68, 68, 0.5)', backgroundColor: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.7 }}
                      >
                        <Play size={16} color="white" />
                        <div style={{ position: 'absolute', top: 2, right: 2, backgroundColor: '#ef4444', borderRadius: '50%', width: '15px', height: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <X size={9} color="white" strokeWidth={3} />
                        </div>
                        <div style={{ position: 'absolute', bottom: 2, left: 2, right: 2, textAlign: 'center', fontSize: '9px', color: '#94a3b8', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: '2px' }}>
                          {video.duration ? `${video.duration}s` : 'Video'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* User Consent notice box */}
              <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '8px', padding: '10px 12px', marginBottom: '16px', fontSize: '12px', color: '#fca5a5', lineHeight: 1.4 }}>
                <strong>User Consent:</strong> By clicking below, you consent to erase the <strong>{unselectedVideos.length} unselected video(s)</strong>. Only the <strong>{selectedVideos.length} selected video(s)</strong> will be saved.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button 
                  type="button"
                  className="btn text-white font-bold"
                  style={{ backgroundColor: '#ef4444', border: 'none', padding: '12px', borderRadius: '10px', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                  onClick={handleConfirmDeleteUnselectedVideos}
                >
                  <Trash2 size={16} /> Save & Confirm (Erase {unselectedVideos.length} Unselected)
                </button>
                <button 
                  type="button"
                  className="btn btn-secondary"
                  style={{ backgroundColor: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '10px', borderRadius: '10px', fontSize: '14px', cursor: 'pointer' }}
                  onClick={() => setShowVideoSelectionDeleteConfirm(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Undo Floating Notification */}
      {undoState && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          left: '16px',
          right: '16px',
          maxWidth: '448px',
          margin: '0 auto',
          backgroundColor: 'rgba(20, 24, 33, 0.96)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(59, 130, 246, 0.4)',
          borderRadius: '12px',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 10000,
          boxShadow: '0 8px 30px rgba(0,0,0,0.7)',
          animation: 'fade-in 0.2s ease-out'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#60a5fa' }} />
            <span style={{ fontSize: '13px', color: '#f8fafc', fontWeight: 500 }}>
              Deleted {undoState.count} unselected {undoState.mediaType === 'video' ? 'video' : 'photo'}{undoState.count > 1 ? 's' : ''}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={handleUndoDelete}
              style={{
                backgroundColor: 'rgba(59, 130, 246, 0.18)',
                border: '1px solid #3b82f6',
                borderRadius: '8px',
                color: '#60a5fa',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}
            >
              <RotateCcw size={14} /> Undo
            </button>
            <button
              onClick={() => {
                if (undoState?.timeoutId) clearTimeout(undoState.timeoutId);
                setUndoState(null);
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                padding: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center'
              }}
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
