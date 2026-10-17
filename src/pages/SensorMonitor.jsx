import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Compass, Play, Square, ShieldAlert, ArrowLeft, RefreshCw, Activity, Smartphone } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import useBackHandler from '../hooks/useBackHandler';

/**
 * SensorMonitor.jsx
 *
 * Temporary Development-Only Device Orientation Sensor Monitor.
 * Live reads window.DeviceOrientationEvent (alpha, beta, gamma)
 * and screen.orientation.angle in large, readable text.
 */
export default function SensorMonitor() {
  const navigate = useNavigate();

  // Back returns to dashboard
  useBackHandler(
    'sensor_monitor_back',
    () => {
      navigate('/', { replace: false });
      return true;
    },
    10,
    true
  );

  const [isMonitoring, setIsMonitoring] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState('unknown'); // 'unknown' | 'granted' | 'denied' | 'prompt'
  const [sensorValues, setSensorValues] = useState({
    alpha: null,
    beta: null,
    gamma: null,
    absolute: false,
    timestamp: null,
  });
  const [screenAngle, setScreenAngle] = useState(0);
  const [eventCount, setEventCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');

  const countRef = useRef(0);
  const isMonitoringRef = useRef(false);

  // Update screen orientation angle
  const updateScreenAngle = useCallback(() => {
    if (typeof window !== 'undefined') {
      const angle = window.screen?.orientation?.angle ?? window.orientation ?? 0;
      setScreenAngle(angle);
    }
  }, []);

  useEffect(() => {
    updateScreenAngle();
    window.addEventListener('orientationchange', updateScreenAngle);
    if (window.screen?.orientation) {
      window.screen.orientation.addEventListener('change', updateScreenAngle);
    }
    return () => {
      window.removeEventListener('orientationchange', updateScreenAngle);
      if (window.screen?.orientation) {
        window.screen.orientation.removeEventListener('change', updateScreenAngle);
      }
    };
  }, [updateScreenAngle]);

  const handleOrientation = useCallback((event) => {
    if (!isMonitoringRef.current) return;

    countRef.current += 1;
    setEventCount(countRef.current);

    setSensorValues({
      alpha: event.alpha !== null ? Number(event.alpha.toFixed(1)) : null,
      beta: event.beta !== null ? Number(event.beta.toFixed(1)) : null,
      gamma: event.gamma !== null ? Number(event.gamma.toFixed(1)) : null,
      absolute: Boolean(event.absolute),
      timestamp: Date.now(),
    });
  }, []);

  const requestPermissionAndStart = async () => {
    setErrorMessage('');

    // Check if DeviceOrientationEvent exists in the browser
    if (typeof window === 'undefined' || !window.DeviceOrientationEvent) {
      setPermissionStatus('denied');
      setErrorMessage('DeviceOrientationEvent is not supported by this browser.');
      return;
    }

    // iOS 13+ permission request
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const response = await DeviceOrientationEvent.requestPermission();
        setPermissionStatus(response);
        if (response === 'granted') {
          startListening();
        } else {
          setErrorMessage('Sensor permission was denied on iOS.');
        }
      } catch (err) {
        setPermissionStatus('denied');
        setErrorMessage(err.message || 'Error requesting sensor permission.');
      }
    } else {
      // Android / non-iOS browsers
      setPermissionStatus('granted');
      startListening();
    }
  };

  const startListening = () => {
    if (isMonitoringRef.current) return;
    isMonitoringRef.current = true;
    setIsMonitoring(true);
    window.addEventListener('deviceorientation', handleOrientation, true);
  };

  const stopListening = () => {
    isMonitoringRef.current = false;
    setIsMonitoring(false);
    window.removeEventListener('deviceorientation', handleOrientation, true);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening();
    };
  }, []);

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#0a0f1d',
        color: '#f8fafc',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      {/* Top Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '20px',
        }}
      >
        <button
          onClick={() => navigate(-1)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            border: 'none',
            color: '#94a3b8',
            padding: '8px 14px',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          <ArrowLeft size={16} /> Back
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Activity size={18} color="#3b82f6" />
          <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#60a5fa', letterSpacing: '0.05em' }}>
            DIAGNOSTIC SENSOR MONITOR
          </span>
        </div>
      </div>

      {/* Status & Screen Orientation Info Bar */}
      <div
        style={{
          backgroundColor: '#1e293b',
          borderRadius: '12px',
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '20px',
          border: '1px solid #334155',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              backgroundColor: isMonitoring ? '#10b981' : '#64748b',
              boxShadow: isMonitoring ? '0 0 10px #10b981' : 'none',
            }}
          />
          <div>
            <div style={{ fontSize: '14px', fontWeight: 'bold' }}>
              {isMonitoring ? 'Monitoring Active' : 'Monitoring Stopped'}
            </div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>
              Permission: {permissionStatus} • Events: {eventCount}
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#cbd5e1', fontSize: '13px' }}>
            <Smartphone size={14} /> Screen Angle
          </div>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#38bdf8' }}>
            {screenAngle}°
          </div>
        </div>
      </div>

      {/* Error / Warning Alert if denied */}
      {errorMessage && (
        <div
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '10px',
            padding: '12px 16px',
            color: '#fca5a5',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '20px',
          }}
        >
          <ShieldAlert size={18} />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Big Readable Sensor Value Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '16px',
          marginBottom: '24px',
        }}
      >
        {/* Alpha (Compass / Yaw) */}
        <div
          style={{
            backgroundColor: '#111827',
            borderRadius: '16px',
            padding: '24px',
            border: '2px solid #2563eb',
            boxShadow: '0 8px 24px rgba(37, 99, 235, 0.15)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '14px', color: '#93c5fd', fontWeight: '600', textTransform: 'uppercase' }}>
              Alpha (Yaw / Compass)
            </span>
            <Compass size={20} color="#60a5fa" />
          </div>
          <div style={{ fontSize: '56px', fontWeight: '800', color: '#ffffff', letterSpacing: '-0.02em' }}>
            {sensorValues.alpha !== null ? `${sensorValues.alpha}°` : '--'}
          </div>
          <div style={{ fontSize: '13px', color: '#64748b', marginTop: '6px' }}>
            Range: 0° to 360° (Heading rotation around Z-axis)
          </div>
        </div>

        {/* Beta (Pitch) */}
        <div
          style={{
            backgroundColor: '#111827',
            borderRadius: '16px',
            padding: '24px',
            border: '2px solid #10b981',
            boxShadow: '0 8px 24px rgba(16, 185, 129, 0.15)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '14px', color: '#6ee7b7', fontWeight: '600', textTransform: 'uppercase' }}>
              Beta (Pitch / Tilt)
            </span>
            <span style={{ fontSize: '12px', padding: '2px 8px', borderRadius: '12px', backgroundColor: 'rgba(16,185,129,0.2)', color: '#34d399' }}>
              X-Axis
            </span>
          </div>
          <div style={{ fontSize: '56px', fontWeight: '800', color: '#ffffff', letterSpacing: '-0.02em' }}>
            {sensorValues.beta !== null ? `${sensorValues.beta}°` : '--'}
          </div>
          <div style={{ fontSize: '13px', color: '#64748b', marginTop: '6px' }}>
            Range: -180° to 180° (Upright portrait is ~90°)
          </div>
        </div>

        {/* Gamma (Roll) */}
        <div
          style={{
            backgroundColor: '#111827',
            borderRadius: '16px',
            padding: '24px',
            border: '2px solid #f59e0b',
            boxShadow: '0 8px 24px rgba(245, 158, 11, 0.15)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '14px', color: '#fcd34d', fontWeight: '600', textTransform: 'uppercase' }}>
              Gamma (Roll / Lean)
            </span>
            <span style={{ fontSize: '12px', padding: '2px 8px', borderRadius: '12px', backgroundColor: 'rgba(245,158,11,0.2)', color: '#fbbf24' }}>
              Y-Axis
            </span>
          </div>
          <div style={{ fontSize: '56px', fontWeight: '800', color: '#ffffff', letterSpacing: '-0.02em' }}>
            {sensorValues.gamma !== null ? `${sensorValues.gamma}°` : '--'}
          </div>
          <div style={{ fontSize: '13px', color: '#64748b', marginTop: '6px' }}>
            Range: -90° to 90° (Left / Right tilt)
          </div>
        </div>
      </div>

      {/* Start / Stop Action Buttons */}
      <div style={{ display: 'flex', gap: '14px', marginTop: 'auto' }}>
        {!isMonitoring ? (
          <button
            onClick={requestPermissionAndStart}
            style={{
              flex: 1,
              padding: '16px',
              borderRadius: '12px',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              border: 'none',
              fontSize: '16px',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(37, 99, 235, 0.4)',
            }}
          >
            <Play size={20} /> Start Monitoring
          </button>
        ) : (
          <button
            onClick={stopListening}
            style={{
              flex: 1,
              padding: '16px',
              borderRadius: '12px',
              backgroundColor: '#ef4444',
              color: '#ffffff',
              border: 'none',
              fontSize: '16px',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(239, 68, 68, 0.4)',
            }}
          >
            <Square size={20} /> Stop Monitoring
          </button>
        )}
      </div>
    </div>
  );
}
