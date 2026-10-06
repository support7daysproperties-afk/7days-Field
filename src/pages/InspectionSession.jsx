import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, Camera, Image as ImageIcon, MapPin, Video, Play, FileText, User, FileSignature, Save, Upload, ArrowLeft, Folder, X, ChevronLeft, ChevronRight, Trash2, Loader2, Landmark } from 'lucide-react';
import FieldCamera from '../components/FieldCamera';
import VideoCamera from '../components/VideoCamera';
import SignaturePad from '../components/SignaturePad';
import PropertyBoundary from './PropertyBoundary';
import { EvidenceService } from '../services/EvidenceService';
import InspectionRepository from '../services/offline/InspectionRepository';
import BoundaryRepository from '../services/offline/BoundaryRepository';
import MediaRepository from '../services/offline/MediaRepository';
import SyncEngine from '../services/offline/SyncEngine';
import { useAuth } from '../context/AuthContext';
import { land360Service } from '../services/Land360Service';
import Land360Overview from './land360/Land360Overview';

export default function InspectionSession() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { user } = useAuth();
  
  const [activeStepId, setActiveStepId] = useState('overview');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [showPhotoCamera, setShowPhotoCamera] = useState(false);
  const [showVideoCamera, setShowVideoCamera] = useState(false);
  const [evidenceSummary, setEvidenceSummary] = useState({ location: null, photos: 0, videos: 0, total: 0 });
  const [evidenceList, setEvidenceList] = useState([]);
  const [expandedFolder, setExpandedFolder] = useState('photos');
  const [selectedMediaIndex, setSelectedMediaIndex] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);

  const [isLoading, setIsLoading] = useState(true);

  const [checklist, setChecklist] = useState({
    'Road accessible': false, 'Vehicle access available': false, 'Entrance identified': false,
    'Exterior inspected': false, 'Interior inspected': false, 'Boundary inspected': false,
    'Documents reviewed': false, 'Owner information confirmed': false
  });
  const [remarks, setRemarks] = useState('');
  const [ownerInfo, setOwnerInfo] = useState({ name: '', phone: '', relationship: 'Owner', remarks: '' });
  const [consent, setConsent] = useState(false);
  const [signature, setSignature] = useState(null);
  const [boundary, setBoundary] = useState(null); // saved BoundaryRepository record
  const [showBoundaryMap, setShowBoundaryMap] = useState(false);
  const [land360Points, setLand360Points] = useState([]);
  const [inspectionRecord, setInspectionRecord] = useState(null);

  useEffect(() => {
    const loadState = async () => {
      try {
        const record = await InspectionRepository.getInspection(id);
        if (record) {
          setInspectionRecord(record);
          if (record.metadata) {
            if (record.metadata.checklist) setChecklist(record.metadata.checklist);
            if (record.metadata.remarks) setRemarks(record.metadata.remarks);
            if (record.metadata.ownerInfo) setOwnerInfo(record.metadata.ownerInfo);
            if (record.metadata.consent !== undefined) setConsent(record.metadata.consent);
            if (record.metadata.signature) setSignature(record.metadata.signature);
          }
        }
        // Load any existing boundary
        const existingBoundary = await BoundaryRepository.getBoundaryForInspection(id);
        if (existingBoundary) setBoundary(existingBoundary);
        
        const cp = await land360Service.getCapturePointsForInspection(id);
        setLand360Points(cp || []);
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
          id,
          property_id: id,
          status: 'IN_PROGRESS',
          sync_status: existing?.sync_status || 'LOCAL_ONLY',
          created_at: existing?.created_at,
          metadata: { checklist, remarks, ownerInfo, consent, signature }
        });
      } catch (err) {
        console.error("Failed to save inspection state", err);
      }
    };
    
    saveState();
  }, [id, checklist, remarks, ownerInfo, consent, signature, isLoading]);

  const checklistGroups = [
    { title: 'Property Access', items: ['Road accessible', 'Vehicle access available', 'Entrance identified'] },
    { title: 'Property Condition', items: ['Exterior inspected', 'Interior inspected', 'Boundary inspected'] },
    { title: 'Documentation', items: ['Documents reviewed', 'Owner information confirmed'] }
  ];

  const checklistCompleted = Object.values(checklist).filter(Boolean).length;
  const checklistTotal = Object.keys(checklist).length;

  const steps = [
    { id: 'location', name: 'Location Verification', completed: !!evidenceSummary.location },
    { id: 'boundary', name: 'Property Boundary', completed: !!boundary },
    { id: 'land360', name: 'Land 360° Capture', completed: land360Points.length > 0 },
    { id: 'evidence', name: 'Evidence (Photos/Videos)', completed: evidenceSummary.total > 0 },
    { id: 'checklist', name: 'Field Checklist', completed: checklistCompleted === checklistTotal },
    { id: 'remarks', name: 'Field Observations', completed: remarks.length > 0 },
    { id: 'owner', name: 'Owner Information', completed: ownerInfo.name.length > 0 },
    { id: 'consent', name: 'Owner Consent', completed: consent && !!signature }
  ];

  const activeStepIndex = steps.findIndex(s => s.id === activeStepId);
  const currentStep = steps[activeStepIndex];

  const loadEvidence = async () => {
    const list = await EvidenceService.getEvidenceForTask(id);
    setEvidenceList(list);
    const summary = await EvidenceService.getEvidenceSummary(id);
    setEvidenceSummary(summary);
  };

  useEffect(() => { loadEvidence(); }, [id]);

  const handleMediaSave = async () => {
    setShowPhotoCamera(false);
    setShowVideoCamera(false);
    await loadEvidence();
  };

  const renderOverviewContent = () => {
    const completedCount = steps.filter(s => s.completed).length;
    
    return (
      <div style={{ minHeight: '100vh', paddingBottom: '100px' }}>
        <header className="flex items-center justify-center p-md bg-surface-color border-b border-color relative">
          <h2 style={{ fontSize: '18px', margin: 0, fontWeight: 'bold' }}>Inspection Dashboard</h2>
          <span className="absolute right-4 text-xs text-secondary font-medium" style={{ right: '16px' }}>45</span>
        </header>

        <div className="bg-surface-color p-md mb-lg shadow-sm rounded-b-lg border-b border-color">
          <div className="text-primary font-bold text-sm mb-xs">{inspectionRecord?.id || id}</div>
          <h1 style={{ fontSize: '20px', fontWeight: 'bold', margin: '0 0 16px 0' }}>{inspectionRecord?.title || 'Inspection'}</h1>
          
          <div className="text-secondary text-sm mb-xs">
            Progress: {completedCount} / {steps.length} sections completed
          </div>
          <div style={{ height: '8px', backgroundColor: 'var(--bg-color)', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ width: `${(completedCount / steps.length) * 100}%`, height: '100%', backgroundColor: 'var(--primary-color)', borderRadius: '4px' }}></div>
          </div>
        </div>

        <h3 className="px-md mb-md font-bold" style={{ fontSize: '16px' }}>Inspection Steps</h3>
        
        <div className="px-md flex flex-col gap-sm mb-xl">
          {steps.map(step => (
            <div 
              key={step.id} 
              className="bg-surface-color rounded-lg p-md flex items-center justify-between shadow-sm"
              style={{ cursor: 'pointer', border: '1px solid var(--border-color)' }}
              onClick={() => setActiveStepId(step.id)}
            >
              <div className="flex items-center gap-md">
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: step.completed ? 'var(--success-color)' : 'var(--border-color)' }}></div>
                <span className="font-medium" style={{ fontSize: '15px', color: 'var(--text-primary)' }}>{step.name}</span>
              </div>
              <span className="text-sm" style={{ color: step.completed ? 'var(--success-color)' : 'var(--text-secondary)' }}>
                {step.completed ? 'Completed' : 'Not Started'}
              </span>
            </div>
          ))}
        </div>

        {/* Fixed Bottom Button */}
        <div className="fixed bottom-0 left-0 right-0 p-md bg-surface-color border-t border-color" style={{ maxWidth: '480px', margin: '0 auto', paddingBottom: 'calc(16px + env(safe-area-inset-bottom))', zIndex: 20 }}>
          <button 
            className="btn btn-primary w-full py-md text-md font-bold"
            onClick={() => setActiveStepId('review')}
            style={{ borderRadius: '8px' }}
          >
            Review & Submit
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
              <span className="text-secondary" style={{ fontSize: '14px', fontWeight: 500 }}>Area</span>
              <span style={{ fontWeight: 700, fontSize: '15px' }}>
                {boundary.area_acres} acres
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
    const videos = evidenceList.filter(e => e.mediaType === 'video');

    return (
      <>
        <div className="flex gap-sm mb-md">
          <button className="btn btn-primary flex-1 flex flex-col gap-xs py-sm" style={{ height: 'auto' }} onClick={() => setShowPhotoCamera(true)}>
            <Camera size={24} />
            <span className="text-sm">Add Photo</span>
          </button>
          <button className="btn btn-secondary flex-1 flex flex-col gap-xs py-sm border-color" style={{ height: 'auto', border: '1px solid var(--border-color)' }} onClick={() => setShowVideoCamera(true)}>
            <Video size={24} />
            <span className="text-sm">Add Video</span>
          </button>
        </div>

        <div className="card">
          <div className="flex justify-between items-center mb-md">
            <h3>Captured Media</h3>
            <span className="text-sm text-secondary">{photos.length} Photos • {videos.length} Videos</span>
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
              style={{ border: expandedFolder === 'videos' ? '2px solid var(--primary-color)' : '1px solid var(--border-color)' }}
              onClick={() => setExpandedFolder(expandedFolder === 'videos' ? null : 'videos')}
            >
              <Folder size={32} className={expandedFolder === 'videos' ? "text-primary mb-xs" : "text-secondary mb-xs"} fill="currentColor" fillOpacity={expandedFolder === 'videos' ? 0.3 : 0.1} />
              <span className="font-bold text-sm">Videos</span>
              <span className="text-xs text-secondary">{videos.length} items</span>
            </div>
          </div>

          {expandedFolder === 'photos' && (
            <div className="animate-fade-in mb-sm p-sm bg-bg-color rounded-lg border border-color">
              <h4 className="text-sm mb-sm flex justify-between font-semibold">Photos <span className="text-secondary">{photos.length}</span></h4>
              {photos.length === 0 ? <p className="text-center text-xs text-secondary py-sm">No photos captured</p> : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  {photos.map((p, idx) => (
                    <div key={p.id} onClick={() => setSelectedMediaIndex(evidenceList.findIndex(e => e.id === p.id))} style={{ aspectRatio: '1', backgroundColor: '#000', borderRadius: '8px', overflow: 'hidden', position: 'relative', cursor: 'pointer' }}>
                      <img src={p.originalImage} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="evidence" />
                      <div style={{ position: 'absolute', bottom: 4, right: 4 }}><ImageIcon size={14} color="white" /></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {expandedFolder === 'videos' && (
            <div className="animate-fade-in mb-sm p-sm bg-bg-color rounded-lg border border-color">
              <h4 className="text-sm mb-sm flex justify-between font-semibold">Videos <span className="text-secondary">{videos.length}</span></h4>
              {videos.length === 0 ? <p className="text-center text-xs text-secondary py-sm">No videos captured</p> : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  {videos.map((v, idx) => (
                    <div key={v.id} onClick={() => setSelectedMediaIndex(evidenceList.findIndex(e => e.id === v.id))} style={{ aspectRatio: '1', backgroundColor: '#333', borderRadius: '8px', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                      <Play size={24} color="white" />
                      <div style={{ position: 'absolute', bottom: 4, right: 4, color: 'white', fontSize: '10px' }}>{v.duration}s</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {evidenceSummary.total === 0 && <p className="text-center text-secondary py-xs text-sm">No evidence captured yet.</p>}
        </div>

        <button className="btn btn-primary mt-md" onClick={() => setActiveStepId('overview')}>Next</button>
      </>
    );
  };

  const renderChecklistContent = () => (
    <div className="card">
      <div className="flex justify-between items-center mb-md">
        <h3>Inspection Checklist</h3>
        <span className="badge badge-primary">{checklistCompleted} / {checklistTotal}</span>
      </div>
      
      <div className="progress-bar mb-md">
        <div className="progress-fill" style={{ width: `${(checklistCompleted/checklistTotal)*100}%` }}></div>
      </div>

      <div className="flex flex-col gap-md">
        {checklistGroups.map(group => (
          <div key={group.title}>
            <h4 className="text-sm text-secondary mb-sm uppercase font-semibold">{group.title}</h4>
            <div className="flex flex-col gap-xs">
              {group.items.map(item => (
                <div key={item} className="checkbox-container" onClick={() => setChecklist(prev => ({...prev, [item]: !prev[item]}))}>
                  <input type="checkbox" checked={checklist[item]} readOnly style={{ pointerEvents: 'none' }} />
                  <span className="text-sm">{item}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button className="btn btn-primary mt-lg" onClick={() => setActiveStepId('remarks')}>Continue to Remarks</button>
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
        metadata: { checklist, remarks, ownerInfo, consent, signature }
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
      {showPhotoCamera && <FieldCamera taskId={id} evidenceType={activeStepId === 'location' ? 'Location Verification' : 'Exterior'} onSave={handleMediaSave} onCancel={() => setShowPhotoCamera(false)} />}
      {showVideoCamera && <VideoCamera taskId={id} evidenceType="Exterior Video" onSave={handleMediaSave} onCancel={() => setShowVideoCamera(false)} />}
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
        <header className="p-md" style={{ padding: '16px', backgroundColor: 'var(--surface-color)', borderBottom: '1px solid var(--border-color)', position: 'sticky', top: 0, zIndex: 10 }}>
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
        {activeStepId === 'land360' && <Land360Overview inspectionId={id} points={land360Points} onPointsUpdated={setLand360Points} onNext={() => setActiveStepId('evidence')} />}
        {activeStepId === 'evidence' && renderEvidenceContent()}
        {activeStepId === 'checklist' && renderChecklistContent()}
        
        {activeStepId === 'remarks' && (
          <div className="card">
            <h3 className="mb-md">Remarks & Observations</h3>
            <textarea className="form-textarea mb-md" rows={5} placeholder="Add any issues or observations..." value={remarks} onChange={(e) => setRemarks(e.target.value)}></textarea>
            <button className="btn btn-primary" onClick={() => setActiveStepId('owner')}>Continue to Owner Info</button>
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
                <h3 className="mb-md">Owner Signature</h3>
                {signature ? (
                  <div className="flex flex-col gap-md">
                    <div className="bg-bg-color rounded p-sm" style={{ border: '1px solid var(--success-color)' }}>
                      <img src={signature} alt="Owner Signature" style={{ width: '100%', maxHeight: '200px', objectFit: 'contain' }} />
                      <div className="text-success text-center text-sm font-medium mt-sm flex items-center justify-center gap-xs">
                        <Check size={16} /> Signature Saved
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
            style={{ position: 'absolute', top: '16px', right: '16px', backgroundColor: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '50%', padding: '8px', cursor: 'pointer', zIndex: 10000 }}
          >
            <X size={24} color="white" />
          </button>

          {/* Delete Button */}
          <button 
            onClick={() => setShowDeleteConfirm(true)} 
            style={{ position: 'absolute', top: '16px', right: '64px', backgroundColor: 'rgba(255,0,0,0.4)', border: 'none', borderRadius: '50%', padding: '8px', cursor: 'pointer', zIndex: 10000 }}
          >
            <Trash2 size={24} color="white" />
          </button>

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
            {evidenceList[selectedMediaIndex].evidenceType === 'Location Verification' ? 'Location Photo' : (evidenceList[selectedMediaIndex].mediaType === 'photo' ? 'Photo' : 'Video')}
          </div>

          {evidenceList[selectedMediaIndex].mediaType === 'video' ? (
            <video key={evidenceList[selectedMediaIndex].id} src={evidenceList[selectedMediaIndex].originalImage} controls autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <img key={evidenceList[selectedMediaIndex].id} src={evidenceList[selectedMediaIndex].geotaggedImage || evidenceList[selectedMediaIndex].originalImage} alt="Fullscreen Evidence" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          )}
        </div>
      )}
    </div>
  );
}
