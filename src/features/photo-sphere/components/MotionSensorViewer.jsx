import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { X, Smartphone, RotateCcw } from 'lucide-react';

/**
 * MotionSensorViewer.jsx
 *
 * Immersive, full-screen motion-controlled panorama viewer using Three.js and DeviceOrientation.
 * Requirements:
 * - Display the stitched panorama as an internal navigable sphere.
 * - Request required motion/orientation permission on platforms (e.g. iOS 13+).
 * - Real-time device-orientation sensor mapping:
 *   turning phone right turns view right; turning left turns view left; tilting changes pitch.
 * - Smooth dampening to eliminate jitter without noticeable lag.
 * - Touch fallback for drag-to-look when motion is not supported or permission denied.
 * - Clear disable motion tracking button and exit action.
 */
export default function MotionSensorViewer({ panoramaUrl, onClose }) {
  const containerRef = useRef(null);
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [permissionError, setPermissionError] = useState(null);
  const [sensorStatus, setSensorStatus] = useState('Checking motion sensors...');

  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const sphereRef = useRef(null);
  const animationFrameRef = useRef(null);

  // Orientation state
  const targetEulerRef = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  const currentEulerRef = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  const referenceHeadingRef = useRef(null);

  // Touch drag fallback
  const isDraggingRef = useRef(false);
  const touchStartRef = useRef({ x: 0, y: 0, yaw: 0, pitch: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Initialize Three.js Scene
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.set(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 2. Load equirectangular texture & sphere
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(
      panoramaUrl,
      (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;

        // Invert sphere along X so viewer sits on inside of sphere
        const geometry = new THREE.SphereGeometry(500, 60, 40);
        geometry.scale(-1, 1, 1);

        const material = new THREE.MeshBasicMaterial({ map: texture });
        const sphere = new THREE.Mesh(geometry, material);
        scene.add(sphere);
        sphereRef.current = sphere;
      },
      undefined,
      (err) => {
        console.error('Failed to load panorama texture', err);
        setSensorStatus('Failed to load panorama image.');
      }
    );

    // 3. Render loop with smoothing
    const render = () => {
      animationFrameRef.current = requestAnimationFrame(render);

      // Dampen orientation with slerp-like smoothing (lerp factor 0.15)
      const cur = currentEulerRef.current;
      const tgt = targetEulerRef.current;

      cur.x += (tgt.x - cur.x) * 0.15;
      cur.y += (tgt.y - cur.y) * 0.15;
      cur.z += (tgt.z - cur.z) * 0.15;

      camera.quaternion.setFromEuler(cur);
      renderer.render(scene, camera);
    };
    render();

    // 4. Resize listener
    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
      window.removeEventListener('resize', handleResize);
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [panoramaUrl]);

  // Motion Sensor Handler
  useEffect(() => {
    const handleOrientation = (e) => {
      if (e.alpha === null || e.beta === null) return;

      // Establish reference heading on first sensor event
      if (referenceHeadingRef.current === null) {
        referenceHeadingRef.current = e.alpha;
      }

      // Convert device orientation to Three.js camera rotation
      // alpha: rotation around z-axis (compass heading 0..360)
      // beta: front-to-back tilt (-180..180)
      // gamma: left-to-right tilt (-90..90)
      const alphaRad = THREE.MathUtils.degToRad(e.alpha - referenceHeadingRef.current);
      const betaRad = THREE.MathUtils.degToRad(e.beta - 90); // pitch (vertical is 0)
      const gammaRad = THREE.MathUtils.degToRad(e.gamma);

      // Set target euler angles (YXZ order)
      targetEulerRef.current.set(betaRad, -alphaRad, -gammaRad, 'YXZ');
      setSensorStatus('Motion tracking active');
    };

    if (motionEnabled) {
      window.addEventListener('deviceorientation', handleOrientation, true);
    }

    return () => {
      window.removeEventListener('deviceorientation', handleOrientation, true);
    };
  }, [motionEnabled]);

  // Request Sensor Access
  const enableMotion = async () => {
    setPermissionError(null);
    try {
      if (
        typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function'
      ) {
        const response = await DeviceOrientationEvent.requestPermission();
        if (response === 'granted') {
          setMotionEnabled(true);
        } else {
          setPermissionError('Motion sensor permission was denied. You can touch & drag to look around.');
        }
      } else {
        // Non-iOS or standard browser
        setMotionEnabled(true);
      }
    } catch (err) {
      console.warn('Error activating motion sensor:', err);
      setPermissionError('Could not access motion sensors. Touch-drag fallback enabled.');
      setMotionEnabled(false);
    }
  };

  // Touch Drag to Look (Fallback or Supplementary)
  const handleTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    isDraggingRef.current = true;
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      yaw: targetEulerRef.current.y,
      pitch: targetEulerRef.current.x,
    };
  };

  const handleTouchMove = (e) => {
    if (!isDraggingRef.current || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - touchStartRef.current.x;
    const dy = e.touches[0].clientY - touchStartRef.current.y;

    const rotSpeed = 0.004;
    targetEulerRef.current.y = touchStartRef.current.yaw + dx * rotSpeed;
    targetEulerRef.current.x = Math.max(
      -Math.PI / 2 + 0.1,
      Math.min(Math.PI / 2 - 0.1, touchStartRef.current.pitch + dy * rotSpeed)
    );
  };

  const handleTouchEnd = () => {
    isDraggingRef.current = false;
  };

  // Reset view to center
  const resetHeading = () => {
    referenceHeadingRef.current = null;
    targetEulerRef.current.set(0, 0, 0, 'YXZ');
    currentEulerRef.current.set(0, 0, 0, 'YXZ');
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: '#000',
        zIndex: 100,
        overflow: 'hidden',
        userSelect: 'none',
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseDown={(e) => {
        isDraggingRef.current = true;
        touchStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          yaw: targetEulerRef.current.y,
          pitch: targetEulerRef.current.x,
        };
      }}
      onMouseMove={(e) => {
        if (!isDraggingRef.current) return;
        const dx = e.clientX - touchStartRef.current.x;
        const dy = e.clientY - touchStartRef.current.y;
        const rotSpeed = 0.003;
        targetEulerRef.current.y = touchStartRef.current.yaw + dx * rotSpeed;
        targetEulerRef.current.x = Math.max(
          -Math.PI / 2 + 0.1,
          Math.min(Math.PI / 2 - 0.1, touchStartRef.current.pitch + dy * rotSpeed)
        );
      }}
      onMouseUp={() => {
        isDraggingRef.current = false;
      }}
    >
      {/* 3D WebGL Canvas Container */}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Top Header Bar */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: '16px',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: '#ffffff',
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Smartphone size={20} color="#38bdf8" />
          <span style={{ fontSize: '15px', fontWeight: 'bold' }}>Motion Sensor View</span>
        </div>

        <button
          onClick={onClose}
          style={{
            background: 'rgba(255, 255, 255, 0.2)',
            border: 'none',
            color: '#fff',
            borderRadius: '50%',
            width: '38px',
            height: '38px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <X size={20} />
        </button>
      </div>

      {/* Bottom Floating Control Bar */}
      <div
        style={{
          position: 'absolute',
          bottom: '24px',
          left: '16px',
          right: '16px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          zIndex: 10,
        }}
      >
        {permissionError && (
          <div
            style={{
              background: 'rgba(239, 68, 68, 0.9)',
              color: '#fff',
              padding: '8px 16px',
              borderRadius: '8px',
              fontSize: '13px',
              textAlign: 'center',
            }}
          >
            {permissionError}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px' }}>
          {!motionEnabled ? (
            <button
              onClick={enableMotion}
              style={{
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '24px',
                fontWeight: 'bold',
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 4px 12px rgba(37, 99, 235, 0.4)',
                cursor: 'pointer',
              }}
            >
              <Smartphone size={18} /> Enable Motion Sensors
            </button>
          ) : (
            <button
              onClick={() => setMotionEnabled(false)}
              style={{
                background: 'rgba(255, 255, 255, 0.2)',
                color: '#fff',
                border: '1px solid rgba(255, 255, 255, 0.4)',
                padding: '10px 18px',
                borderRadius: '24px',
                fontWeight: 'bold',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              Disable Motion Sensors
            </button>
          )}

          <button
            onClick={resetHeading}
            style={{
              background: 'rgba(255, 255, 255, 0.2)',
              color: '#fff',
              border: '1px solid rgba(255, 255, 255, 0.4)',
              padding: '10px 16px',
              borderRadius: '24px',
              fontWeight: 'bold',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
            }}
          >
            <RotateCcw size={16} /> Reset Heading
          </button>
        </div>

        <span style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '12px' }}>
          {motionEnabled ? 'Move phone to look in any direction' : 'Drag on screen to look around'}
        </span>
      </div>
    </div>
  );
}
