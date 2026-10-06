import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, Loader2 } from 'lucide-react';
import InspectionRepository from '../services/offline/InspectionRepository';
import { locationService } from '../services/platform/LocationService';

export default function CreateInspection() {
  const navigate = useNavigate();
  
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
      setLocation({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        altitude: pos.coords.altitude || null
      });
    } catch (err) {
      console.error(err);
      let errMsg = 'Could not capture location. Please try again or skip.';
      if (err.code === 1) errMsg = 'Location permission denied. Please allow location access in your browser.';
      if (err.code === 2) errMsg = 'Location information is unavailable.';
      if (err.code === 3) errMsg = 'Location request timed out.';
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
      
      const newInspection = {
        id,
        title: formData.title,
        property_name: formData.title,
        location_name: formData.location_name,
        inspection_type: formData.inspection_type,
        property_type: formData.property_type,
        purpose: formData.purpose,
        reference_number: formData.reference_number,
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
    <div className="pb-xl" style={{ backgroundColor: 'var(--bg-color, #0f1115)', color: 'var(--text-color, #ffffff)', minHeight: '100vh', padding: '16px', paddingBottom: '100px' }}>
      <header className="flex items-center gap-md mb-lg">
        <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', padding: 0, color: 'inherit' }}>
          <ArrowLeft size={24} />
        </button>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 'bold', margin: 0 }}>New Field Inspection</h1>
          <p className="text-secondary text-sm m-0">Create an inspection and configure the field work.</p>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-col gap-md">
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>Property / Site Name *</label>
          <input 
            type="text" 
            name="title"
            value={formData.title}
            onChange={handleInputChange}
            placeholder="e.g. Luxury Villa"
            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-color)', color: 'var(--text-primary)', marginBottom: '16px', fontSize: '16px', boxSizing: 'border-box' }}
            required
          />

          <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>Location Name</label>
          <input 
            type="text" 
            name="location_name"
            value={formData.location_name}
            onChange={handleInputChange}
            placeholder="e.g. Ooty"
            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-color)', color: 'var(--text-primary)', marginBottom: '16px', fontSize: '16px', boxSizing: 'border-box' }}
          />

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>GPS Location (Optional)</label>
            {location ? (
              <div style={{ padding: '12px', borderRadius: '8px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <MapPin size={20} style={{ color: 'var(--primary-color)' }} />
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: '500' }}>Location Captured</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      Accuracy: ±{Math.round(location.accuracy)} m
                      <span className="ml-2 font-medium" style={{ color: location.accuracy < 15 ? 'var(--success-color)' : 'var(--warning-color)' }}>
                        {location.accuracy < 15 ? 'Good' : 'Moderate'}
                      </span>
                    </div>
                  </div>
                </div>
                <button type="button" onClick={handleCaptureLocation} style={{ color: 'var(--primary-color)', fontSize: '14px', fontWeight: '500', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                  Retake
                </button>
              </div>
            ) : (
              <button 
                type="button" 
                onClick={handleCaptureLocation}
                disabled={isLocating}
                style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-color)', color: 'var(--primary-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: '500', cursor: 'pointer' }}
              >
                {isLocating ? <Loader2 size={18} className="animate-spin" /> : <MapPin size={18} />}
                {isLocating ? 'Capturing...' : 'Use Current Location'}
              </button>
            )}
            {locationError && <p style={{ color: 'var(--danger-color)', fontSize: '12px', marginTop: '4px' }}>{locationError}</p>}
          </div>

          <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>Inspection Type</label>
          <select 
            name="inspection_type"
            value={formData.inspection_type}
            onChange={handleInputChange}
            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-color)', color: 'var(--text-primary)', marginBottom: '16px', fontSize: '16px', boxSizing: 'border-box' }}
          >
            {inspectionTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>Property Type</label>
          <select 
            name="property_type"
            value={formData.property_type}
            onChange={handleInputChange}
            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-color)', color: 'var(--text-primary)', marginBottom: '16px', fontSize: '16px', boxSizing: 'border-box' }}
          >
            {propertyTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>Notes / Purpose</label>
          <textarea 
            name="purpose"
            value={formData.purpose}
            onChange={handleInputChange}
            placeholder="e.g. Verify site condition and capture land boundary."
            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-color)', color: 'var(--text-primary)', marginBottom: '16px', fontSize: '16px', minHeight: '80px', boxSizing: 'border-box' }}
          />
          
          <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', color: 'var(--text-secondary)', marginBottom: '4px' }}>Reference Number (Optional)</label>
          <input 
            type="text" 
            name="reference_number"
            value={formData.reference_number}
            onChange={handleInputChange}
            placeholder="External ID if any"
            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-color)', color: 'var(--text-primary)', fontSize: '16px', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '16px', paddingBottom: 'calc(16px + 80px)', backgroundColor: 'var(--surface-color)', borderTop: '1px solid var(--border-color)', zIndex: 10 }}>
          <button 
            type="submit"
            disabled={isSubmitting || !formData.title}
            className="btn btn-primary"
            style={{ width: '100%', padding: '16px', fontSize: '16px', fontWeight: 'bold', borderRadius: '8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}
          >
            {isSubmitting ? <Loader2 size={20} className="animate-spin" /> : null}
            Create Inspection
          </button>
        </div>
      </form>
    </div>
  );
}
