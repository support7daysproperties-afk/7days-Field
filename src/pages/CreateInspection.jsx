import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import InspectionRepository from '../services/offline/InspectionRepository';
import { locationService } from '../services/platform/LocationService';

export default function CreateInspection() {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [formData, setFormData] = useState({
    title: '',
    location_name: '',
    inspection_type: 'Property Verification',
    property_type: 'Residential Plot',
    purpose: '',
    reference_number: ''
  });
  
  const [location, setLocation] = useState(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const inspectionTypes = [
    'Property Verification',
    'Land Survey',
    'Site Inspection',
    'Property Condition',
    'Land Boundary',
    'Agricultural Land',
    'Commercial Property',
    'General Inspection',
    'Custom'
  ];
  
  const propertyTypes = [
    'Residential Plot',
    'Apartment',
    'Villa',
    'Commercial Land',
    'Agricultural Land',
    'Tea Estate',
    'Resort',
    'Industrial Land',
    'Other'
  ];

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleCaptureLocation = async () => {
    setIsLocating(true);
    setLocationError('');
    try {
      const pos = await locationService.getCurrentPosition();
      const lat = pos?.coords?.latitude ?? pos?.latitude;
      const lng = pos?.coords?.longitude ?? pos?.longitude;
      const acc = pos?.coords?.accuracy ?? pos?.accuracy;
      const alt = pos?.coords?.altitude ?? pos?.altitude ?? null;

      if (lat != null && lng != null) {
        setLocation({
          latitude: lat,
          longitude: lng,
          accuracy: acc,
          altitude: alt
        });
      } else {
        throw new Error('Location coordinates were empty');
      }
    } catch (err) {
      console.error('Location capture error:', err);
      let errMsg = 'Could not capture location. Please try again or skip.';
      if (err.code === 1) errMsg = 'Location permission denied. Please allow location access in your browser.';
      if (err.code === 2) errMsg = 'Location information is unavailable. Please check your device GPS.';
      if (err.code === 3) errMsg = 'Location request timed out. Please try again.';
      if (!navigator.geolocation) errMsg = 'Geolocation is not supported by your browser (or requires HTTPS).';
      setLocationError(errMsg);
    } finally {
      setIsLocating(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.title) return;
    
    setIsSubmitting(true);
    try {
      // Generate unique ID
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const randomPart = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      const id = `INS-${dateStr}-${randomPart}`;
      
      const generateUUID = () => {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
          return crypto.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      };

      const taskId = generateUUID();
      const propertyId = generateUUID();

      const newInspection = {
        id,
        task_id: taskId,
        property_id: propertyId,
        title: formData.title,
        property_name: formData.title,
        location_name: formData.location_name,
        inspection_type: formData.inspection_type,
        property_type: formData.property_type,
        purpose: formData.purpose,
        reference_number: formData.reference_number,
        supervisor_id: user?.supervisorProfile?.id || user?.id || null,
        auth_user_id: user?.id || null,
        supervisor_name: user?.supervisorProfile?.name || 'Field Supervisor',
        latitude: location?.latitude || null,
        longitude: location?.longitude || null,
        altitude: location?.altitude || null,
        gps_accuracy: location?.accuracy || null,
        status: 'DRAFT',
        sync_status: 'LOCAL_ONLY',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {
          checklist: {
            'Road accessible': false, 'Vehicle access available': false, 'Entrance identified': false,
            'Exterior inspected': false, 'Interior inspected': false, 'Boundary inspected': false,
            'Documents reviewed': false, 'Owner information confirmed': false
          },
          remarks: '',
          ownerInfo: { name: '', phone: '', relationship: 'Owner', remarks: '' },
          consent: false,
          signature: null
        }
      };
      
      await InspectionRepository.saveInspection(newInspection);
      navigate(`/inspection/${id}`);
    } catch (err) {
      console.error("Failed to create inspection:", err);
      alert("Error creating inspection");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="pb-xl" style={{ backgroundColor: 'var(--bg-color)', color: 'var(--text-primary)', minHeight: '100vh', padding: '16px', paddingBottom: '110px' }}>
      <header className="flex items-center gap-md mb-lg">
        <button 
          onClick={() => navigate(-1)} 
          style={{ 
            background: 'var(--surface-color)', 
            border: '1px solid var(--border-color)', 
            borderRadius: '10px',
            width: '40px',
            height: '40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-primary)',
            cursor: 'pointer'
          }}
          aria-label="Back"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0, letterSpacing: '-0.2px' }}>New Field Inspection</h1>
          <p className="text-secondary text-xs m-0" style={{ marginTop: '2px' }}>Configure site details and start recording evidence</p>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-md">
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '18px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
              Property / Site Name *
            </label>
            <input 
              type="text" 
              name="title"
              value={formData.title}
              onChange={handleInputChange}
              placeholder="e.g. Green Valley Tea Estate"
              style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-color)', color: 'var(--text-primary)', fontSize: '15px', boxSizing: 'border-box', outline: 'none' }}
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
              Location / Region
            </label>
            <input 
              type="text" 
              name="location_name"
              value={formData.location_name}
              onChange={handleInputChange}
              placeholder="e.g. Ooty, Nilgiris District"
              style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-color)', color: 'var(--text-primary)', fontSize: '15px', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
              GPS Location (Optional)
            </label>
            {location ? (
              <div style={{ padding: '12px 14px', borderRadius: '10px', backgroundColor: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <MapPin size={20} style={{ color: 'var(--success-color)' }} />
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>Coordinates Captured</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      Accuracy: ±{Math.round(location.accuracy)} m
                      <span style={{ marginLeft: '8px', fontWeight: 600, color: location.accuracy < 15 ? 'var(--success-color)' : 'var(--warning-color)' }}>
                        ({location.accuracy < 15 ? 'High Accuracy' : 'Moderate Accuracy'})
                      </span>
                    </div>
                  </div>
                </div>
                <button 
                  type="button" 
                  onClick={handleCaptureLocation} 
                  style={{ color: 'var(--primary-color)', fontSize: '13px', fontWeight: 600, background: 'rgba(37, 99, 235, 0.12)', border: 'none', borderRadius: '6px', padding: '6px 10px', cursor: 'pointer' }}
                >
                  Retake
                </button>
              </div>
            ) : (
              <button 
                type="button" 
                onClick={handleCaptureLocation}
                disabled={isLocating}
                style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1px dashed var(--border-color)', backgroundColor: 'var(--surface-light)', color: 'var(--primary-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', minHeight: '44px' }}
              >
                {isLocating ? <Loader2 size={18} className="animate-spin" /> : <MapPin size={18} />}
                {isLocating ? 'Acquiring GPS Signal...' : 'Capture Current Location'}
              </button>
            )}
            {locationError && <p style={{ color: 'var(--danger-color)', fontSize: '12px', marginTop: '6px' }}>{locationError}</p>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                Inspection Type
              </label>
              <select 
                name="inspection_type"
                value={formData.inspection_type}
                onChange={handleInputChange}
                style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-color)', color: 'var(--text-primary)', fontSize: '14px', boxSizing: 'border-box' }}
              >
                {inspectionTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                Property Type
              </label>
              <select 
                name="property_type"
                value={formData.property_type}
                onChange={handleInputChange}
                style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-color)', color: 'var(--text-primary)', fontSize: '14px', boxSizing: 'border-box' }}
              >
                {propertyTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
              Notes / Purpose
            </label>
            <textarea 
              name="purpose"
              value={formData.purpose}
              onChange={handleInputChange}
              placeholder="e.g. Verify boundary survey, check boundary markers, and record road access."
              style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-color)', color: 'var(--text-primary)', fontSize: '14px', minHeight: '80px', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>
          
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
              Reference Number (Optional)
            </label>
            <input 
              type="text" 
              name="reference_number"
              value={formData.reference_number}
              onChange={handleInputChange}
              placeholder="e.g. REF-2026-081"
              style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-color)', color: 'var(--text-primary)', fontSize: '14px', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>
        </div>

        <div style={{ 
          position: 'fixed', 
          bottom: 0, 
          left: 0, 
          right: 0, 
          width: '100%',
          maxWidth: '480px',
          margin: '0 auto',
          padding: '16px', 
          paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))', 
          backgroundColor: 'rgba(20, 24, 33, 0.96)', 
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderTop: '1px solid var(--border-color)', 
          zIndex: 100,
          boxSizing: 'border-box'
        }}>
          <button 
            type="submit"
            disabled={isSubmitting || !formData.title}
            className="btn btn-primary"
            style={{ 
              width: '100%', 
              padding: '14px', 
              fontSize: '15px', 
              fontWeight: 700, 
              borderRadius: '10px', 
              display: 'flex', 
              justifyContent: 'center', 
              alignItems: 'center', 
              gap: '8px',
              minHeight: '50px',
              cursor: isSubmitting || !formData.title ? 'not-allowed' : 'pointer',
              opacity: isSubmitting || !formData.title ? 0.6 : 1
            }}
          >
            {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : null}
            Create Inspection
          </button>
        </div>
      </form>
    </div>
  );
}
