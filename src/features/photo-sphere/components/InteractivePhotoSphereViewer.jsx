import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { ArrowLeft, Compass, Glasses, Download, Check, Orbit, RefreshCw } from 'lucide-react';
import useBackHandler from '../../../hooks/useBackHandler';

const PhotoSphereSensor = registerPlugin('PhotoSphereSensor');

/**
 * InteractivePhotoSphereViewer.jsx
 *
 * Real work 360 viewer matching Google Camera / Google Street View output:
 * - Full-screen edge-to-edge spherical equirectangular projection
 * - Silky smooth touch-drag navigation (yaw + pitch) with momentum damping
 * - Pinch-to-zoom (FOV 35° to 90°)
 * - Bottom-left: Compass / Gyroscope Motion Tracking toggle (physical device orientation)
 * - Bottom-right: Google Cardboard VR stereoscopic split-screen mode with center divider
 * - Android Back button / Back gesture integration
 * - Export options: Save Evidence, Download 360 JPEG, Tiny Planet
 */
export default function InteractivePhotoSphereViewer({
  sourceCanvas,
  imageUrl,
  title = '360° Photo Sphere',
  subtitle,
  onSaveEvidence,
  onClose,
  isEvidenceView = false,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  // UI state
  const [motionActive, setMotionActive] = useState(false);
  const [vrMode, setVrMode] = useState(false);
  const [fov, setFov] = useState(70);
  const [showTinyPlanet, setShowTinyPlanet] = useState(false);
  const [planetDataUrl, setPlanetDataUrl] = useState(null);

  // Back handler: priority 100 for VR mode exit, priority 95 for viewer close
  useBackHandler('interactive_360_vr', () => {
    if (vrMode) {
      setVrMode(false);
      return true;
    }
    if (showTinyPlanet) {
      setShowTinyPlanet(false);
      return true;
    }
    if (onClose) {
      onClose();
      return true;
    }
    return false;
  }, 95);

  // Internal Three.js refs
  const stateRef = useRef({
    scene: null,
    camera: null,
    cameraLeft: null,
    cameraRight: null,
    renderer: null,
    sphereMesh: null,
    texture: null,
    animId: null,

    // Angles in degrees
    yaw: 0,
    pitch: 0,
    targetYaw: 0,
    targetPitch: 0,

    // Inertia & momentum
    isDragging: false,
    lastPointerX: 0,
    lastPointerY: 0,
    velocityX: 0,
    velocityY: 0,

    // Pinch zoom
    initialPinchDist: 0,
    initialFov: 70,

    // Sensor tracking
    isNative: Capacitor.isNativePlatform(),
    nativeSensorHandle: null,
    sensorInitialYaw: null,
    lastSensorYaw: 0,
    lastSensorPitch: 0,
  });

  // Toggle Motion Sensor
  const toggleMotion = useCallback(() => {
    setMotionActive((prev) => {
      const next = !prev;
      const s = stateRef.current;
      if (next) {
        // Reset reference so view starts from current heading
        s.sensorInitialYaw = null;
      }
      return next;
    });
  }, []);

  // Toggle Cardboard VR Mode
  const toggleVrMode = useCallback(() => {
    setVrMode((prev) => {
      const next = !prev;
      if (next) {
        // VR mode automatically enables motion tracking
        setMotionActive(true);
        stateRef.current.sensorInitialYaw = null;
      }
      return next;
    });
  }, []);

  // Generate Tiny Planet Projection from current panorama
  const generateTinyPlanet = useCallback(() => {
    const s = stateRef.current;
    let canvas = sourceCanvas;
    if (!canvas && s.texture && s.texture.image) {
      canvas = s.texture.image;
    }
    if (!canvas) return;

    try {
      const size = 800;
      const planetCanvas = document.createElement('canvas');
      planetCanvas.width = size;
      planetCanvas.height = size;
      const pCtx = planetCanvas.getContext('2d');

      const srcW = canvas.width || 2048;
      const srcH = canvas.height || 1024;
      const tempC = document.createElement('canvas');
      tempC.width = srcW;
      tempC.height = srcH;
      const tCtx = tempC.getContext('2d');
      tCtx.drawImage(canvas, 0, 0);
      const srcData = tCtx.getImageData(0, 0, srcW, srcH).data;

      const outImg = pCtx.createImageData(size, size);
      const outData = outImg.data;
      const cx = size / 2;
      const cy = size / 2;
      const maxR = size / 2;

      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = x - cx;
          const dy = y - cy;
          const r = Math.hypot(dx, dy);

          const outIdx = (y * size + x) * 4;
          if (r > maxR) {
            outData[outIdx + 3] = 0;
            continue;
          }

          const phi = Math.atan2(dy, dx);
          let u = (phi + Math.PI) / (2 * Math.PI);
          let v = r / maxR;

          const sx = Math.min(srcW - 1, Math.max(0, Math.floor(u * srcW)));
          const sy = Math.min(srcH - 1, Math.max(0, Math.floor(v * srcH)));
          const srcIdx = (sy * srcW + sx) * 4;

          outData[outIdx] = srcData[srcIdx];
          outData[outIdx + 1] = srcData[srcIdx + 1];
          outData[outIdx + 2] = srcData[srcIdx + 2];
          outData[outIdx + 3] = 255;
        }
      }

      pCtx.putImageData(outImg, 0, 0);
      setPlanetDataUrl(planetCanvas.toDataURL('image/jpeg', 0.92));
      setShowTinyPlanet(true);
    } catch (err) {
      console.warn('Could not generate tiny planet:', err);
    }
  }, [sourceCanvas]);

  // Main Three.js Lifecycle
  useEffect(() => {
    const s = stateRef.current;
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // 1. Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050505);
    s.scene = scene;

    // 2. Camera (Mono + Stereo L/R for Cardboard VR)
    const camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 1000);
    camera.position.set(0, 0, 0);
    s.camera = camera;

    const ipd = 0.064; // Interpupillary distance in meters
    const cameraLeft = new THREE.PerspectiveCamera(70, (width / 2) / height, 0.1, 1000);
    cameraLeft.position.set(-ipd / 2, 0, 0);
    s.cameraLeft = cameraLeft;

    const cameraRight = new THREE.PerspectiveCamera(70, (width / 2) / height, 0.1, 1000);
    cameraRight.position.set(ipd / 2, 0, 0);
    s.cameraRight = cameraRight;

    // 3. WebGL Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    s.renderer = renderer;

    // 4. Inverted Equirectangular Sphere (Radius = 500)
    const geometry = new THREE.SphereGeometry(500, 72, 48);
    geometry.scale(-1, 1, 1); // View from inside

    let texture;
    if (sourceCanvas) {
      texture = new THREE.CanvasTexture(sourceCanvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.colorSpace = THREE.SRGBColorSpace;
      s.texture = texture;

      const material = new THREE.MeshBasicMaterial({ map: texture });
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
      s.sphereMesh = mesh;
    } else if (imageUrl) {
      const loader = new THREE.TextureLoader();
      loader.load(imageUrl, (tex) => {
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.colorSpace = THREE.SRGBColorSpace;
        s.texture = tex;

        const material = new THREE.MeshBasicMaterial({ map: tex });
        const mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);
        s.sphereMesh = mesh;
      });
    }

    // 5. Render Loop with smooth momentum & quaternion orientation
    const render = () => {
      s.animId = requestAnimationFrame(render);

      const W = container.clientWidth || window.innerWidth;
      const H = container.clientHeight || window.innerHeight;

      // Inertia decay when not dragging and not using motion
      if (!s.isDragging && !motionActive) {
        s.targetYaw += s.velocityX;
        s.targetPitch += s.velocityY;
        s.velocityX *= 0.92;
        s.velocityY *= 0.92;
      }

      s.targetPitch = Math.max(-88, Math.min(88, s.targetPitch));

      // Smooth lerp to target yaw & pitch
      s.yaw += (s.targetYaw - s.yaw) * 0.18;
      s.pitch += (s.targetPitch - s.pitch) * 0.18;

      // Construct camera orientation via quaternions to avoid gimbal lock
      const qYaw = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        -THREE.MathUtils.degToRad(s.yaw)
      );
      const qPitch = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        THREE.MathUtils.degToRad(s.pitch)
      );
      const targetQuat = new THREE.Quaternion().copy(qYaw).multiply(qPitch);

      if (vrMode) {
        // VR Cardboard Stereo Mode
        const halfW = Math.floor(W / 2);

        renderer.setSize(W, H, false);
        renderer.setScissorTest(true);

        // Left Eye
        cameraLeft.aspect = halfW / H;
        cameraLeft.fov = fov;
        cameraLeft.updateProjectionMatrix();
        cameraLeft.quaternion.copy(targetQuat);

        renderer.setViewport(0, 0, halfW, H);
        renderer.setScissor(0, 0, halfW, H);
        renderer.render(scene, cameraLeft);

        // Right Eye
        cameraRight.aspect = halfW / H;
        cameraRight.fov = fov;
        cameraRight.updateProjectionMatrix();
        cameraRight.quaternion.copy(targetQuat);

        renderer.setViewport(halfW, 0, halfW, H);
        renderer.setScissor(halfW, 0, halfW, H);
        renderer.render(scene, cameraRight);

        renderer.setScissorTest(false);
      } else {
        // Normal Fullscreen Mono Mode
        camera.aspect = W / H;
        camera.fov = fov;
        camera.updateProjectionMatrix();
        camera.quaternion.copy(targetQuat);

        renderer.setSize(W, H, false);
        renderer.setViewport(0, 0, W, H);
        renderer.render(scene, camera);
      }
    };
    render();

    // 6. Window Resize Handler
    const handleResize = () => {
      const nw = container.clientWidth || window.innerWidth;
      const nh = container.clientHeight || window.innerHeight;
      renderer.setSize(nw, nh, false);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (s.animId) cancelAnimationFrame(s.animId);
      if (s.texture) s.texture.dispose();
      if (renderer) renderer.dispose();
    };
  }, [sourceCanvas, imageUrl, vrMode, fov, motionActive]);

  // Sensor Listener Effect
  useEffect(() => {
    const s = stateRef.current;
    if (!motionActive) {
      if (s.nativeSensorHandle && typeof s.nativeSensorHandle.remove === 'function') {
        s.nativeSensorHandle.remove();
        s.nativeSensorHandle = null;
      }
      return;
    }

    if (s.isNative) {
      try {
        PhotoSphereSensor.start().catch(() => {});
        PhotoSphereSensor.addListener('sensorOrientation', (data) => {
          if (!data) return;
          const rawYaw = ((data.yaw % 360) + 360) % 360;
          const rawPitch = Math.max(-88, Math.min(88, data.pitch));

          if (s.sensorInitialYaw === null) {
            s.sensorInitialYaw = rawYaw - s.targetYaw;
          }

          const relYaw = rawYaw - s.sensorInitialYaw;
          s.targetYaw = relYaw;
          s.targetPitch = rawPitch;
        }).then((handle) => {
          s.nativeSensorHandle = handle;
        }).catch(() => {});
      } catch (err) {
        console.warn('Native sensor plugin error in viewer:', err);
      }
    } else {
      const handleWebOrientation = (e) => {
        if (e.alpha === null || e.beta === null) return;
        const rawYaw = (360 - e.alpha) % 360;
        const rawPitch = Math.max(-88, Math.min(88, e.beta - 90));

        if (s.sensorInitialYaw === null) {
          s.sensorInitialYaw = rawYaw - s.targetYaw;
        }

        s.targetYaw = rawYaw - s.sensorInitialYaw;
        s.targetPitch = rawPitch;
      };

      window.addEventListener('deviceorientation', handleWebOrientation, true);
      return () => {
        window.removeEventListener('deviceorientation', handleWebOrientation, true);
      };
    }

    return () => {
      if (s.nativeSensorHandle && typeof s.nativeSensorHandle.remove === 'function') {
        s.nativeSensorHandle.remove();
        s.nativeSensorHandle = null;
      }
    };
  }, [motionActive]);

  // Touch and Mouse Drag / Pinch Handlers
  const handlePointerDown = (e) => {
    const s = stateRef.current;
    s.isDragging = true;
    s.lastPointerX = e.clientX;
    s.lastPointerY = e.clientY;
    s.velocityX = 0;
    s.velocityY = 0;
  };

  const handlePointerMove = (e) => {
    const s = stateRef.current;
    if (!s.isDragging) return;

    const dx = e.clientX - s.lastPointerX;
    const dy = e.clientY - s.lastPointerY;

    // If motion is active and user starts dragging, disable motion so user has full touch control
    if (motionActive) {
      setMotionActive(false);
    }

    const sens = 0.22;
    s.targetYaw += dx * sens;
    s.targetPitch += dy * sens;

    s.velocityX = dx * sens * 0.45;
    s.velocityY = dy * sens * 0.45;

    s.lastPointerX = e.clientX;
    s.lastPointerY = e.clientY;
  };

  const handlePointerUp = () => {
    stateRef.current.isDragging = false;
  };

  // Touch Pinch Zoom Handler
  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      stateRef.current.initialPinchDist = Math.hypot(dx, dy);
      stateRef.current.initialFov = fov;
    }
  };

  const handleTouchMove = (e) => {
    if (e.touches.length === 2 && stateRef.current.initialPinchDist > 0) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const currentDist = Math.hypot(dx, dy);
      const factor = stateRef.current.initialPinchDist / currentDist;
      const newFov = Math.max(35, Math.min(90, stateRef.current.initialFov * factor));
      setFov(newFov);
    }
  };

  // Download Equirectangular Image
  const handleDownload = () => {
    const s = stateRef.current;
    let canvas = sourceCanvas;
    if (!canvas && s.texture && s.texture.image) {
      canvas = s.texture.image;
    }
    if (!canvas) return;

    const link = document.createElement('a');
    link.download = `PhotoSphere_360_${Date.now()}.jpg`;
    if (canvas.toDataURL) {
      link.href = canvas.toDataURL('image/jpeg', 0.95);
    } else if (imageUrl) {
      link.href = imageUrl;
    }
    link.click();
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: '#000000',
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
    >
      {/* Three.js Canvas */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
          touchAction: 'none',
        }}
      />

      {/* VR Mode Divider Line */}
      {vrMode && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: '50%',
            width: '2px',
            background: 'rgba(255, 255, 255, 0.4)',
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        />
      )}

      {/* Top Floating Header */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: 'max(14px, env(safe-area-inset-top, 14px)) 16px 14px 16px',
          background: 'linear-gradient(180deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0) 100%)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 20,
          pointerEvents: 'none',
        }}
      >
        {/* Left: Back / Close button */}
        <button
          onClick={onClose}
          style={{
            pointerEvents: 'auto',
            width: '42px',
            height: '42px',
            borderRadius: '50%',
            background: 'rgba(25, 25, 25, 0.75)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.25)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            touchAction: 'manipulation',
          }}
          title="Back"
        >
          <ArrowLeft size={22} />
        </button>

        {/* Center: Title & Subtitle */}
        <div style={{ textAlign: 'center', pointerEvents: 'none' }}>
          <div style={{ color: '#ffffff', fontSize: '15px', fontWeight: 600, letterSpacing: '0.3px', textShadow: '0 2px 6px rgba(0,0,0,0.8)' }}>
            {title}
          </div>
          {subtitle && (
            <div style={{ color: 'rgba(255, 255, 255, 0.75)', fontSize: '11px', marginTop: '2px', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
              {subtitle}
            </div>
          )}
        </div>

        {/* Right Actions: Tiny Planet, Download, and Save Evidence */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', pointerEvents: 'auto' }}>
          <button
            onClick={generateTinyPlanet}
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '50%',
              background: 'rgba(25, 25, 25, 0.75)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255, 255, 255, 0.25)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              touchAction: 'manipulation',
            }}
            title="Tiny Planet View"
          >
            <Orbit size={18} />
          </button>

          <button
            onClick={handleDownload}
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '50%',
              background: 'rgba(25, 25, 25, 0.75)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255, 255, 255, 0.25)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              touchAction: 'manipulation',
            }}
            title="Download 360 JPEG"
          >
            <Download size={18} />
          </button>

          {!isEvidenceView && onSaveEvidence && (
            <button
              onClick={onSaveEvidence}
              style={{
                height: '38px',
                padding: '0 16px',
                borderRadius: '20px',
                background: '#1a73e8',
                border: 'none',
                color: '#ffffff',
                fontSize: '13px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 2px 10px rgba(26, 115, 232, 0.5)',
                cursor: 'pointer',
                touchAction: 'manipulation',
              }}
              title="Save Evidence"
            >
              <Check size={18} /> Save
            </button>
          )}
        </div>
      </div>

      {/* Floating Bottom Left Button: Compass / Gyro Motion Toggle (Matching Real Work Video) */}
      <button
        onClick={toggleMotion}
        style={{
          position: 'absolute',
          bottom: 'max(24px, env(safe-area-inset-bottom, 24px))',
          left: '20px',
          width: '54px',
          height: '54px',
          borderRadius: '50%',
          background: motionActive ? '#1a73e8' : 'rgba(25, 25, 25, 0.82)',
          backdropFilter: 'blur(12px)',
          border: motionActive ? '2px solid #ffffff' : '1.5px solid rgba(255, 255, 255, 0.35)',
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: motionActive
            ? '0 0 20px rgba(26, 115, 232, 0.8), 0 4px 12px rgba(0,0,0,0.5)'
            : '0 4px 12px rgba(0,0,0,0.5)',
          transition: 'all 0.2s ease',
          zIndex: 20,
          touchAction: 'manipulation',
        }}
        title={motionActive ? 'Motion Tracking ON (Tap to use Touch Drag)' : 'Motion Tracking OFF (Tap to steer with Device)'}
      >
        <Compass
          size={26}
          style={{
            transform: motionActive ? 'rotate(45deg)' : 'none',
            transition: 'transform 0.3s ease',
          }}
        />
      </button>

      {/* Floating Bottom Right Button: VR Headset / Cardboard Toggle (Matching Real Work Video) */}
      <button
        onClick={toggleVrMode}
        style={{
          position: 'absolute',
          bottom: 'max(24px, env(safe-area-inset-bottom, 24px))',
          right: '20px',
          width: '54px',
          height: '54px',
          borderRadius: '50%',
          background: vrMode ? '#ea4335' : 'rgba(25, 25, 25, 0.82)',
          backdropFilter: 'blur(12px)',
          border: vrMode ? '2px solid #ffffff' : '1.5px solid rgba(255, 255, 255, 0.35)',
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: vrMode
            ? '0 0 20px rgba(234, 67, 53, 0.8), 0 4px 12px rgba(0,0,0,0.5)'
            : '0 4px 12px rgba(0,0,0,0.5)',
          transition: 'all 0.2s ease',
          zIndex: 20,
          touchAction: 'manipulation',
        }}
        title={vrMode ? 'Exit Cardboard VR Mode' : 'Enter Cardboard VR Stereo Mode'}
      >
        <Glasses size={26} />
      </button>

      {/* Tiny Planet Modal Overlay */}
      {showTinyPlanet && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(5, 5, 5, 0.95)',
            backdropFilter: 'blur(16px)',
            zIndex: 40,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', maxWidth: '520px', marginBottom: '14px', alignItems: 'center' }}>
            <h3 style={{ color: '#fff', fontSize: '17px', margin: 0, fontWeight: 600 }}>Tiny Planet Projection</h3>
            <button
              onClick={() => setShowTinyPlanet(false)}
              style={{
                background: 'rgba(40, 40, 40, 0.8)',
                border: 'none',
                color: '#fff',
                padding: '6px 14px',
                borderRadius: '16px',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              Close
            </button>
          </div>

          {planetDataUrl && (
            <img
              src={planetDataUrl}
              alt="Tiny Planet"
              style={{
                width: '100%',
                maxWidth: '480px',
                aspectRatio: '1/1',
                borderRadius: '50%',
                boxShadow: '0 0 35px rgba(0,0,0,0.9), 0 0 10px rgba(255,255,255,0.1)',
                objectFit: 'cover',
              }}
            />
          )}

          <div style={{ marginTop: '20px', display: 'flex', gap: '12px' }}>
            <a
              href={planetDataUrl}
              download={`TinyPlanet_${Date.now()}.jpg`}
              style={{
                background: '#1a73e8',
                color: '#fff',
                padding: '10px 20px',
                borderRadius: '24px',
                fontSize: '13px',
                fontWeight: 600,
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 2px 10px rgba(26, 115, 232, 0.5)',
              }}
            >
              <Download size={16} /> Download Tiny Planet
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
