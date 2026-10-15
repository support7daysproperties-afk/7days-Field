import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { X, Glasses, RotateCcw } from 'lucide-react';

/**
 * VRViewer.jsx
 *
 * Immersive stereoscopic VR / Cardboard-style split-screen panorama viewer using Three.js.
 * Requirements:
 * - Display generated panorama as an immersive spherical environment.
 * - Provide stereoscopic, split-screen viewing layout (left eye / right eye) for VR headset/cardboard.
 * - Allow the user to view surroundings by moving head/device (DeviceOrientation tracking).
 * - Keep viewing direction and panorama projection consistent between eyes with appropriate inter-pupillary offset.
 * - Provide clear exit button to return to the panorama result screen.
 */
export default function VRViewer({ panoramaUrl, onClose }) {
  const containerRef = useRef(null);
  const leftEyeRef = useRef(null);
  const rightEyeRef = useRef(null);

  const [motionActive, setMotionActive] = useState(false);
  const [permissionMsg, setPermissionMsg] = useState(null);

  // Three.js instances
  const sceneRef = useRef(null);
  const rendererLeftRef = useRef(null);
  const rendererRightRef = useRef(null);
  const cameraLeftRef = useRef(null);
  const cameraRightRef = useRef(null);
  const animationFrameRef = useRef(null);

  const targetEulerRef = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  const currentEulerRef = useRef(new THREE.Euler(0, 0, 0, 'YXZ'));
  const referenceHeadingRef = useRef(null);

  useEffect(() => {
    if (!leftEyeRef.current || !rightEyeRef.current) return;

    const leftContainer = leftEyeRef.current;
    const rightContainer = rightEyeRef.current;

    const width = leftContainer.clientWidth;
    const height = leftContainer.clientHeight;

    // 1. Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // 2. Stereoscopic Cameras (with slight IPD offset)
    const ipd = 0.064; // ~64mm standard interpupillary distance
    const cameraLeft = new THREE.PerspectiveCamera(80, width / height, 0.1, 1000);
    cameraLeft.position.set(-ipd / 2, 0, 0);
    cameraLeftRef.current = cameraLeft;

    const cameraRight = new THREE.PerspectiveCamera(80, width / height, 0.1, 1000);
    cameraRight.position.set(ipd / 2, 0, 0);
    cameraRightRef.current = cameraRight;

    // 3. Renderers
    const rendererLeft = new THREE.WebGLRenderer({ antialias: true });
    rendererLeft.setSize(width, height);
    rendererLeft.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    leftContainer.appendChild(rendererLeft.domElement);
    rendererLeftRef.current = rendererLeft;

    const rendererRight = new THREE.WebGLRenderer({ antialias: true });
    rendererRight.setSize(width, height);
    rendererRight.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rightContainer.appendChild(rendererRight.domElement);
    rendererRightRef.current = rendererRight;

    let loadedTexture = null;
    let sphereMesh = null;

    // 4. Inverted Equirectangular Sphere Mesh
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(panoramaUrl, (texture) => {
      loadedTexture = texture;
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.colorSpace = THREE.SRGBColorSpace;

      const geometry = new THREE.SphereGeometry(500, 60, 40);
      geometry.scale(-1, 1, 1);
      const material = new THREE.MeshBasicMaterial({ map: texture });
      sphereMesh = new THREE.Mesh(geometry, material);
      scene.add(sphereMesh);
    });

    // 5. Render Loop
    const render = () => {
      animationFrameRef.current = requestAnimationFrame(render);

      const cur = currentEulerRef.current;
      const tgt = targetEulerRef.current;

      cur.x += (tgt.x - cur.x) * 0.15;
      cur.y += (tgt.y - cur.y) * 0.15;
      cur.z += (tgt.z - cur.z) * 0.15;

      const quat = new THREE.Quaternion().setFromEuler(cur);
      cameraLeft.quaternion.copy(quat);
      cameraRight.quaternion.copy(quat);

      rendererLeft.render(scene, cameraLeft);
      rendererRight.render(scene, cameraRight);
    };
    render();

    // 6. Resize listener
    const handleResize = () => {
      if (!leftContainer || !rightContainer) return;
      const w = leftContainer.clientWidth;
      const h = leftContainer.clientHeight;
      cameraLeft.aspect = w / h;
      cameraLeft.updateProjectionMatrix();
      cameraRight.aspect = w / h;
      cameraRight.updateProjectionMatrix();
      rendererLeft.setSize(w, h);
      rendererRight.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
      window.removeEventListener('resize', handleResize);
      if (rendererLeft.domElement && leftContainer.contains(rendererLeft.domElement)) {
        leftContainer.removeChild(rendererLeft.domElement);
      }
      if (rendererRight.domElement && rightContainer.contains(rendererRight.domElement)) {
        rightContainer.removeChild(rendererRight.domElement);
      }
      if (sphereMesh) {
        if (sphereMesh.geometry) sphereMesh.geometry.dispose();
        if (sphereMesh.material) sphereMesh.material.dispose();
      }
      if (loadedTexture) {
        loadedTexture.dispose();
      }
      rendererLeft.dispose();
      rendererRight.dispose();
    };
  }, [panoramaUrl]);

  // Orientation Sensor Listener
  useEffect(() => {
    const handleOrientation = (e) => {
      if (e.alpha === null || e.beta === null) return;

      if (referenceHeadingRef.current === null) {
        referenceHeadingRef.current = e.alpha;
      }

      const alphaRad = THREE.MathUtils.degToRad(e.alpha - referenceHeadingRef.current);
      const betaRad = THREE.MathUtils.degToRad(e.beta - 90);
      const gammaRad = THREE.MathUtils.degToRad(e.gamma);

      targetEulerRef.current.set(betaRad, -alphaRad, -gammaRad, 'YXZ');
      setMotionActive(true);
    };

    const startSensors = async () => {
      try {
        if (
          typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function'
        ) {
          const res = await DeviceOrientationEvent.requestPermission();
          if (res === 'granted') {
            window.addEventListener('deviceorientation', handleOrientation, true);
          } else {
            setPermissionMsg('Motion sensor permission denied for VR mode.');
          }
        } else {
          window.addEventListener('deviceorientation', handleOrientation, true);
        }
      } catch (err) {
        console.warn('VR sensor request error', err);
      }
    };

    startSensors();

    return () => {
      window.removeEventListener('deviceorientation', handleOrientation, true);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: '#000000',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'row',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Left Eye View */}
      <div
        ref={leftEyeRef}
        style={{
          width: '50%',
          height: '100%',
          position: 'relative',
          borderRight: '2px solid #222',
        }}
      >
        {/* Alignment Reticle crosshair dot for VR focus */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: 'rgba(255, 255, 255, 0.4)',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Right Eye View */}
      <div
        ref={rightEyeRef}
        style={{
          width: '50%',
          height: '100%',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: 'rgba(255, 255, 255, 0.4)',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Top Floating Exit Button */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          right: '16px',
          display: 'flex',
          gap: '12px',
          zIndex: 20,
        }}
      >
        <button
          onClick={onClose}
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            color: '#ffffff',
            borderRadius: '50%',
            width: '44px',
            height: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <X size={22} />
        </button>
      </div>

      {/* Center VR Divider Line & Badge */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          padding: '6px 14px',
          borderRadius: '20px',
          color: '#ffffff',
          fontSize: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          zIndex: 20,
        }}
      >
        <Glasses size={16} color="#a855f7" />
        <span>Cardboard / Headset Mode</span>
      </div>

      {/* Bottom helper tip */}
      <div
        style={{
          position: 'absolute',
          bottom: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'rgba(0,0,0,0.6)',
          padding: '6px 16px',
          borderRadius: '16px',
          color: '#aaa',
          fontSize: '12px',
          textAlign: 'center',
          zIndex: 20,
          whiteSpace: 'nowrap',
        }}
      >
        {permissionMsg || (motionActive ? 'Move head/phone to explore surroundings' : 'Insert phone into VR headset')}
      </div>
    </div>
  );
}
