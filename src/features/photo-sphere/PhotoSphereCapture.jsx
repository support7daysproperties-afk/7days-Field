import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { X, RefreshCw, Undo2, Check, Download, Globe, Orbit, Image as ImageIcon, ArrowLeft, Compass, Eye, Glasses, Layers } from 'lucide-react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { photoSphereStorage } from './storage/PhotoSphereStorage';
import useBackHandler from '../../hooks/useBackHandler';
import InteractivePhotoSphereViewer from './components/InteractivePhotoSphereViewer';
import { PhotoSphereStitcher } from './PhotoSphereStitcher';

const PhotoSphereSensor = registerPlugin('PhotoSphereSensor');

import { injectXmpIntoJpeg } from './PhotoSphereXMP';
import {
  PHOTO_SPHERE_TARGETS,
  COVERAGE_CONFIG,
  getStabilizedYawPitch,
  getCameraBasisFromDeviceOrientation,
  projectTargetDot3D,
  lerpAngleDeg,
  angularDistance,
  projectWorldToScreen,
  BOX_FOV_X,
  BOX_FOV_Y,
} from './PhotoSphereTargets';

const RETICLE_CIRCUMFERENCE = 150.8;

const CONFIG = {
  ALIGNMENT_THRESHOLD_DEG: COVERAGE_CONFIG.ALIGNMENT_THRESHOLD_DEG,
  MAX_ANGULAR_VELOCITY: 45.0,
  HOLD_DURATION_MS: COVERAGE_CONFIG.HOLD_DURATION_MS,
  CAPTURE_FOV_H_DEG: COVERAGE_CONFIG.CAPTURE_FOV_H_DEG,
  CAPTURE_FOV_V_DEG: COVERAGE_CONFIG.CAPTURE_FOV_V_DEG,
  SPHERE_RADIUS: 500, // Exact 3D sphere radius R = 500 units
  PANO_WIDTH: 2048,
  PANO_HEIGHT: 1024,
  COVERAGE_LON_STEPS: 72,
  COVERAGE_LAT_STEPS: 36,
};

export default function PhotoSphereCapture({
  taskId,
  onSaveEvidence,
  onClose,
}) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const webglCanvasRef = useRef(null);
  const dotsCanvasRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const ringProgressRef = useRef(null);
  const centerBlueDotRef = useRef(null);
  const instructionBannerRef = useRef(null);
  const coverageBadgeRef = useRef(null);
  const targetsBadgeRef = useRef(null);
  const shutterFlashRef = useRef(null);

  // Result Modal Canvas Refs
  const interactiveViewerContainerRef = useRef(null);
  const planetCanvasRef = useRef(null);
  const equirectPreviewCanvasRef = useRef(null);

  // React State for Controls & Modal
  const [canUndo, setCanUndo] = useState(false);
  const [canFinish, setCanFinish] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [isStitching, setIsStitching] = useState(false);
  const [stitchingProgress, setStitchingProgress] = useState({ percent: 0, statusText: '' });
  const [stitchedPanoData, setStitchedPanoData] = useState(null);
  const [stitchError, setStitchError] = useState(null);
  const [activeResultTab, setActiveResultTab] = useState('360'); // '360' | 'planet' | 'equirect'
  const [cameraFacingMode, setCameraFacingMode] = useState('environment');
  const [coveragePercent, setCoveragePercent] = useState(0);
  const [needsGyroPermission, setNeedsGyroPermission] = useState(
    () => typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'
  );

  // Global back handler for Photo Sphere capture (priority 90)
  useBackHandler('photo_sphere_capture', () => {
    if (stitchError) {
      setStitchError(null);
      return true;
    }
    if (isStitching) {
      // Prevent exit while stitching is processing
      return true;
    }
    if (showResultModal) {
      setShowResultModal(false);
      return true;
    }
    if (engineRef.current?.capturedCount > 0) {
      if (window.confirm('Exit Photo Sphere capture? Unsaved progress will be discarded.')) {
        onClose();
      }
      return true;
    }
    onClose();
    return true;
  }, 90);

  // Internal Engine State Reference
  const engineRef = useRef({
    scene: null,
    camera: null,
    renderer: null,
    sphereMesh: null,
    sphereTexture: null,
    targetGroup: new THREE.Group(),
    masterPanoCanvas: null,
    masterPanoCtx: null,
    panoAccumR: null,
    panoAccumG: null,
    panoAccumB: null,
    panoAccumW: null,
    animationFrameId: null,
    currentStream: null,
    activeTarget: null,
    holdStartTime: 0,
    isCapturing: false,
    useGyro: false,
    initialYaw: null,
    camYaw: 0,
    camPitch: 0,
    currentBoxWidth: 240,
    currentBoxHeight: 320,
    angularVelocity: 0,
    lastOrientTime: null,
    targets: [],
    capturedTiles: [],
    historyStack: [],
    coverageGrid: null,
    coveragePercent: 0,
    capturedCount: 0,
    sessionId: null,
    viewerScene: null,
    viewerCamera: null,
    viewerRenderer: null,
    viewerYaw: 0,
    viewerPitch: 0,
    viewerAnimId: null,
  });

  // Spherical Coordinates to 3D Unit Vector
  function sphericalToCartesian(yaw, pitch) {
    return new THREE.Vector3(
      Math.cos(pitch) * Math.sin(yaw),
      Math.sin(pitch),
      -Math.cos(pitch) * Math.cos(yaw)
    );
  }

  // True Aligned Inward Spherical Geometry
  function createTrueAlignedSphereGeometry(radius, widthSegments = 72, heightSegments = 48) {
    const geo = new THREE.BufferGeometry();
    const positions = [];
    const uvs = [];
    const indices = [];

    for (let iy = 0; iy <= heightSegments; iy++) {
      const v = iy / heightSegments;
      const pitch = (v - 0.5) * Math.PI;

      for (let ix = 0; ix <= widthSegments; ix++) {
        const u = ix / widthSegments;
        const yaw = (u - 0.5) * 2 * Math.PI;

        const dir = sphericalToCartesian(yaw, pitch);
        positions.push(dir.x * radius, dir.y * radius, dir.z * radius);
        uvs.push(u, v);
      }
    }

    for (let iy = 0; iy < heightSegments; iy++) {
      for (let ix = 0; ix < widthSegments; ix++) {
        const a = iy * (widthSegments + 1) + ix;
        const b = a + 1;
        const c = (iy + 1) * (widthSegments + 1) + ix;
        const d = c + 1;

        indices.push(a, b, d);
        indices.push(a, d, c);
      }
    }

    geo.setIndex(indices);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    return geo;
  }

  // Local Coverage Ratio in Radius
  function getLocalCoverageRatio(yawRad, pitchRad, radiusDeg) {
    const eng = engineRef.current;
    if (!eng.coverageGrid) return 1;

    const centerVec = sphericalToCartesian(yawRad, pitchRad).normalize();
    const cosThresh = Math.cos(THREE.MathUtils.degToRad(radiusDeg));
    let total = 0, covered = 0;

    for (let gy = 0; gy < CONFIG.COVERAGE_LAT_STEPS; gy++) {
      const lat = (0.5 - (gy + 0.5) / CONFIG.COVERAGE_LAT_STEPS) * Math.PI;
      for (let gx = 0; gx < CONFIG.COVERAGE_LON_STEPS; gx++) {
        const lon = ((gx + 0.5) / CONFIG.COVERAGE_LON_STEPS - 0.5) * 2 * Math.PI;
        const vec = sphericalToCartesian(lon, lat);
        if (centerVec.dot(vec) >= cosThresh) {
          total++;
          if (eng.coverageGrid[gy * CONFIG.COVERAGE_LON_STEPS + gx] === 1) covered++;
        }
      }
    }
    return total === 0 ? 1 : covered / total;
  }

  // Find Largest Uncaptured Gap Centroid
  function findLargestUncapturedGap() {
    const eng = engineRef.current;
    if (!eng.coverageGrid) return null;

    let bestScore = -1;
    let bestLon = 0;
    let bestLat = 0;

    for (let gy = 1; gy < CONFIG.COVERAGE_LAT_STEPS - 1; gy++) {
      const lat = (0.5 - (gy + 0.5) / CONFIG.COVERAGE_LAT_STEPS) * Math.PI;
      const weight = Math.cos(lat);
      for (let gx = 0; gx < CONFIG.COVERAGE_LON_STEPS; gx++) {
        if (eng.coverageGrid[gy * CONFIG.COVERAGE_LON_STEPS + gx] === 0) {
          const lon = ((gx + 0.5) / CONFIG.COVERAGE_LON_STEPS - 0.5) * 2 * Math.PI;
          const uncoveredRatio = 1 - getLocalCoverageRatio(lon, lat, 16);
          const score = uncoveredRatio * (0.35 + 0.65 * weight);
          if (score > bestScore) {
            bestScore = score;
            bestLon = lon;
            bestLat = lat;
          }
        }
      }
    }
    return bestScore > 0.05 ? { yawRad: bestLon, pitchRad: bestLat } : null;
  }

  // Spawn Target 3D Mesh Dot
  function spawnTargetDot(id, yawRad, pitchRad, visibleInitially, isGapDot, targetMeta = null) {
    const eng = engineRef.current;
    const dir = sphericalToCartesian(yawRad, pitchRad).normalize();
    const pos = dir.clone().multiplyScalar(CONFIG.SPHERE_RADIUS * 0.92);

    // Exact 28px-32px diameter (30px diameter uncaptured target dots, radius 15 units)
    const dotGeo = new THREE.SphereGeometry(isGapDot ? 17 : 15, 24, 24);
    const dotMat = new THREE.MeshBasicMaterial({
      color: isGapDot ? 0x66b2ff : 0x4285F4,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
    });
    const mesh = new THREE.Mesh(dotGeo, dotMat);
    mesh.position.copy(pos);
    mesh.visible = visibleInitially;
    if (eng.targetGroup) eng.targetGroup.add(mesh);

    const yawDeg = targetMeta ? targetMeta.yaw : THREE.MathUtils.radToDeg(yawRad);
    const pitchDeg = targetMeta ? targetMeta.pitch : THREE.MathUtils.radToDeg(pitchRad);

    const target = {
      id,
      targetId: targetMeta ? targetMeta.id : `t_${id}`,
      dotNumber: targetMeta ? targetMeta.dotNumber : id,
      region: targetMeta ? targetMeta.region : (isGapDot ? 'gap' : 'horizon'),
      yaw: yawDeg,
      pitch: pitchDeg,
      baseYaw: yawDeg,
      basePitch: pitchDeg,
      yawRad,
      pitchRad,
      direction: dir,
      mesh,
      captured: false,
      visible: visibleInitially,
      isGapDot,
    };
    eng.targets.push(target);
    return target;
  }

  // 3D Spatial Grid with subtle Google Camera "+" cross markers on floor & ceiling
  function createSpatialCrossGrid() {
    const group = new THREE.Group();
    const material = new THREE.LineBasicMaterial({
      color: 0xaaaaaa,
      transparent: true,
      opacity: 0.32,
    });

    const positions = [];
    const crossSize = 0.16;
    const spacing = 1.6;
    const count = 10;

    // Floor cross grid at Y = -4.5
    const floorY = -4.5;
    for (let ix = -count; ix <= count; ix++) {
      for (let iz = -count; iz <= count; iz++) {
        const cx = ix * spacing;
        const cz = iz * spacing;
        positions.push(cx - crossSize, floorY, cz, cx + crossSize, floorY, cz);
        positions.push(cx, floorY, cz - crossSize, cx, floorY, cz + crossSize);
      }
    }

    // Ceiling cross grid at Y = +4.5
    const ceilY = 4.5;
    for (let ix = -count; ix <= count; ix++) {
      for (let iz = -count; iz <= count; iz++) {
        const cx = ix * spacing;
        const cz = iz * spacing;
        positions.push(cx - crossSize, ceilY, cz, cx + crossSize, ceilY, cz);
        positions.push(cx, ceilY, cz - crossSize, cx, ceilY, cz + crossSize);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const lines = new THREE.LineSegments(geometry, material);
    group.add(lines);
    return group;
  }

  // Add captured photo frame as a true 3D textured mesh on the sphere in Three.js
  function addCapturedTileTo3DScene(tileCanvas, targetYaw, targetPitch) {
    const eng = engineRef.current;
    if (!eng.tilesGroup) return null;

    const dist = 10;
    const yawRad = THREE.MathUtils.degToRad(targetYaw);
    const pitchRad = THREE.MathUtils.degToRad(targetPitch);

    const x = dist * Math.cos(pitchRad) * Math.sin(yawRad);
    const y = dist * Math.sin(pitchRad);
    const z = -dist * Math.cos(pitchRad) * Math.cos(yawRad);

    // Patch size matching 42° horizontal FOV and 3:4 aspect ratio
    const patchW = 2 * dist * Math.tan(THREE.MathUtils.degToRad(21));
    const patchH = patchW * (4 / 3);

    const geometry = new THREE.PlaneGeometry(patchW, patchH);
    const texture = new THREE.CanvasTexture(tileCanvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      depthTest: true,
      transparent: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);

    eng.tilesGroup.add(mesh);
    return { mesh, texture, geometry };
  }

  // Initialize Lattice from PHOTO_SPHERE_TARGETS (All 33 Dots + Anchor Frame)
  function initTargetLattice() {
    const eng = engineRef.current;
    eng.targets = [];
    eng.capturedTiles = [];
    eng.anchorYaw = null;
    eng.capturedCount = 0;
    if (eng.targetGroup) eng.targetGroup.clear();
    if (eng.tilesGroup) eng.tilesGroup.clear();

    PHOTO_SPHERE_TARGETS.forEach((t) => {
      const yawRad = THREE.MathUtils.degToRad(t.yaw);
      const pitchRad = THREE.MathUtils.degToRad(t.pitch);
      const isCenterStartDot = t.dotNumber === 0;
      // All 360 targets are visible across the sphere so the user never gets lost
      spawnTargetDot(t.dotNumber, yawRad, pitchRad, true, false, t);
    });

    updateFrontierAndGapDots();
  }

  // Update All 360 Dots Visibility and Dynamic Gap Sealing
  function updateFrontierAndGapDots() {
    const eng = engineRef.current;
    if (!eng.targets || eng.targets.length === 0) return;

    // All uncaptured dots remain visible across the 360 space; captured dots are retired
    eng.targets.forEach((t) => {
      if (t.captured) {
        t.visible = false;
        if (t.mesh) t.mesh.visible = false;
      } else {
        t.visible = true;
        if (t.mesh) t.mesh.visible = true;
      }
    });

    // Dynamic gap-filling: if uncaptured dots are depleted but coverage is incomplete, spawn gap dot
    const remainingUncaptured = eng.targets.filter((t) => !t.captured);
    if (remainingUncaptured.length === 0 && eng.coveragePercent < 98 && eng.coverageGrid) {
      const gap = findLargestUncapturedGap(eng.coverageGrid);
      if (gap) {
        const gapTarget = spawnTargetDot(
          eng.targets.length,
          gap.yawRad,
          gap.pitchRad,
          true,
          true,
          { id: `gap_${eng.targets.length}`, dotNumber: eng.targets.length, yaw: gap.yawDeg, pitch: gap.pitchDeg, region: 'gap' }
        );
        gapTarget.isGapDot = true;
      }
    }

    updateHUD();
  }

  // Update Camera Matrix from Current Yaw & Pitch
  function updateCameraFromYawPitch() {
    const eng = engineRef.current;
    if (!eng.camera) return;
    const dir = sphericalToCartesian(eng.yaw, eng.pitch);
    const upVec = new THREE.Vector3(0, 1, 0);
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), dir, upVec);
    eng.camera.quaternion.setFromRotationMatrix(m);
  }

  // Update Top HUD Badges & Action Buttons
  function updateHUD() {
    const eng = engineRef.current;
    if (coverageBadgeRef.current) {
      coverageBadgeRef.current.textContent = `${eng.coveragePercent}% Captured`;
    }
    const remaining = eng.targets.filter((t) => !t.captured).length;
    if (targetsBadgeRef.current) {
      targetsBadgeRef.current.textContent =
        remaining === 0 ? 'Sphere Sealed!' : `${remaining} Dots Left`;
    }

    setCanUndo(eng.historyStack.length > 0);
    setCanFinish(eng.historyStack.length > 0);
  }

  // Reset Hold Ring Progress
  function resetHoldProgress() {
    const eng = engineRef.current;
    eng.activeTarget = null;
    eng.holdStartTime = 0;
    if (ringProgressRef.current) {
      ringProgressRef.current.style.strokeDashoffset = String(RETICLE_CIRCUMFERENCE);
    }
  }

  // Project Captured Camera Frame Onto Sphere Texture with Exact Pose & Cosine Blending
  function projectLiveCameraFrameOntoSphere(frameCanvas, captureQuatOrYaw, optPitch) {
    const eng = engineRef.current;
    if (!eng.masterPanoCtx) return;

    const prevPanoImage = eng.masterPanoCtx.getImageData(0, 0, CONFIG.PANO_WIDTH, CONFIG.PANO_HEIGHT);
    const prevCoverage = new Uint8Array(eng.coverageGrid);
    const prevAccumR = eng.panoAccumR ? new Float32Array(eng.panoAccumR) : null;
    const prevAccumG = eng.panoAccumG ? new Float32Array(eng.panoAccumG) : null;
    const prevAccumB = eng.panoAccumB ? new Float32Array(eng.panoAccumB) : null;
    const prevAccumW = eng.panoAccumW ? new Float32Array(eng.panoAccumW) : null;
    eng.historyStack.push({ prevPanoImage, prevCoverage, prevAccumR, prevAccumG, prevAccumB, prevAccumW });
    if (eng.historyStack.length > 16) eng.historyStack.shift();

    const srcW = frameCanvas.width;
    const srcH = frameCanvas.height;
    const srcCtx = frameCanvas.getContext('2d');
    const srcData = srcCtx.getImageData(0, 0, srcW, srcH).data;

    const dstImageData = eng.masterPanoCtx.getImageData(0, 0, CONFIG.PANO_WIDTH, CONFIG.PANO_HEIGHT);
    const dstData = dstImageData.data;

    let forward, up, right;
    if (captureQuatOrYaw instanceof THREE.Quaternion) {
      forward = new THREE.Vector3(0, 0, -1).applyQuaternion(captureQuatOrYaw).normalize();
      up = new THREE.Vector3(0, 1, 0).applyQuaternion(captureQuatOrYaw).normalize();
      right = new THREE.Vector3(1, 0, 0).applyQuaternion(captureQuatOrYaw).normalize();
    } else {
      const yaw = captureQuatOrYaw;
      const pitch = optPitch || 0;
      forward = sphericalToCartesian(yaw, pitch).normalize();
      let worldUp = new THREE.Vector3(0, 1, 0);
      if (Math.abs(forward.y) > 0.98) {
        worldUp.set(Math.sin(yaw), 0, -Math.cos(yaw));
      }
      right = new THREE.Vector3().crossVectors(forward, worldUp).normalize();
      up = new THREE.Vector3().crossVectors(right, forward).normalize();
    }

    const tanHalfH = Math.tan(THREE.MathUtils.degToRad(BOX_FOV_X / 2));
    const tanHalfV = Math.tan(THREE.MathUtils.degToRad(BOX_FOV_Y / 2));
    const tanHalfD = Math.hypot(tanHalfH, tanHalfV);

    const angularRadius = Math.atan(tanHalfD);
    const maxCosRadius = Math.cos(angularRadius * 1.08);

    const W = CONFIG.PANO_WIDTH;
    const H = CONFIG.PANO_HEIGHT;

    // Latitudinal bounding box for speed and efficiency
    const centerLat = Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1));
    const minLat = Math.max(-Math.PI / 2, centerLat - angularRadius * 1.15);
    const maxLat = Math.min(Math.PI / 2, centerLat + angularRadius * 1.15);

    const pyMin = Math.max(0, Math.floor((0.5 - maxLat / Math.PI) * H));
    const pyMax = Math.min(H - 1, Math.ceil((0.5 - minLat / Math.PI) * H));

    for (let py = pyMin; py <= pyMax; py++) {
      const vTex = 1.0 - (py + 0.5) / H;
      const lat = (vTex - 0.5) * Math.PI;
      const cosLat = Math.cos(lat);
      const sinLat = Math.sin(lat);

      for (let px = 0; px < W; px++) {
        const uTex = (px + 0.5) / W;
        const lon = (uTex - 0.5) * 2 * Math.PI;

        const vx = cosLat * Math.sin(lon);
        const vy = sinLat;
        const vz = -cosLat * Math.cos(lon);

        const dotZ = vx * forward.x + vy * forward.y + vz * forward.z;
        if (dotZ <= maxCosRadius) continue;

        const projX = (vx * right.x + vy * right.y + vz * right.z) / dotZ;
        const projY = (vx * up.x + vy * up.y + vz * up.z) / dotZ;

        const normX = projX / tanHalfH;
        const normY = projY / tanHalfV;

        if (Math.abs(normX) <= 1.0 && Math.abs(normY) <= 1.0) {
          const srcX = Math.min(srcW - 1, Math.max(0, Math.floor((normX * 0.5 + 0.5) * srcW)));
          const srcY = Math.min(srcH - 1, Math.max(0, Math.floor((0.5 - normY * 0.5) * srcH)));

          const srcIdx = (srcY * srcW + srcX) * 4;
          const dstIdx = (py * W + px) * 4;
          const pIdx = py * W + px;

          // Continuous 2D cosine weight: 1.0 at optical center, exactly 0.0 at borders
          const wx = Math.cos((normX * Math.PI) / 2);
          const wy = Math.cos((normY * Math.PI) / 2);
          const weight = Math.pow(Math.max(0, wx * wy), 1.4);

          if (weight > 0.001) {
            eng.panoAccumR[pIdx] += srcData[srcIdx] * weight;
            eng.panoAccumG[pIdx] += srcData[srcIdx + 1] * weight;
            eng.panoAccumB[pIdx] += srcData[srcIdx + 2] * weight;
            eng.panoAccumW[pIdx] += weight;

            const totalW = eng.panoAccumW[pIdx];
            dstData[dstIdx] = Math.min(255, Math.round(eng.panoAccumR[pIdx] / totalW));
            dstData[dstIdx + 1] = Math.min(255, Math.round(eng.panoAccumG[pIdx] / totalW));
            dstData[dstIdx + 2] = Math.min(255, Math.round(eng.panoAccumB[pIdx] / totalW));
            dstData[dstIdx + 3] = 255;
          }
        }
      }
    }

    // Seal zenith and nadir poles so the live 3D preview sphere has zero black holes
    PhotoSphereStitcher.sealPolarGaps(dstData, eng.panoAccumW, W, H);

    eng.masterPanoCtx.putImageData(dstImageData, 0, 0);
    if (eng.sphereTexture) eng.sphereTexture.needsUpdate = true;

    // Update Coverage Grid
    for (let gy = 0; gy < CONFIG.COVERAGE_LAT_STEPS; gy++) {
      const lat = (0.5 - (gy + 0.5) / CONFIG.COVERAGE_LAT_STEPS) * Math.PI;
      for (let gx = 0; gx < CONFIG.COVERAGE_LON_STEPS; gx++) {
        const lon = ((gx + 0.5) / CONFIG.COVERAGE_LON_STEPS - 0.5) * 2 * Math.PI;
        const cellVec = sphericalToCartesian(lon, lat);
        const dotZ = cellVec.dot(forward);
        if (dotZ > 0) {
          const nx = cellVec.dot(right) / dotZ / tanHalfH;
          const ny = cellVec.dot(up) / dotZ / tanHalfV;
          if (Math.abs(nx) <= 0.94 && Math.abs(ny) <= 0.94) {
            eng.coverageGrid[gy * CONFIG.COVERAGE_LON_STEPS + gx] = 1;
          }
        }
      }
    }
  }

  // Trigger Capture for Selected Dot
  const triggerSingleDotCapture = useCallback(async (target) => {
    const eng = engineRef.current;
    if (eng.isCapturing) return;

    const videoEl = videoRef.current;
    if (!videoEl || videoEl.readyState < 2 || !videoEl.videoWidth) return;

    eng.isCapturing = true;

    if (navigator.vibrate) {
      try {
        navigator.vibrate(35);
      } catch (_) {}
    }
    if (shutterFlashRef.current) {
      shutterFlashRef.current.style.opacity = '0.65';
      setTimeout(() => {
        if (shutterFlashRef.current) shutterFlashRef.current.style.opacity = '0';
      }, 140);
    }

    // 1. Crop exact center 3:4 region matching the viewfinder box
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    const targetAspect = 3 / 4;
    const videoAspect = vw / vh;
    let cropW, cropH, cropX, cropY;

    if (videoAspect > targetAspect) {
      cropH = vh;
      cropW = Math.round(vh * targetAspect);
      cropX = Math.round((vw - cropW) / 2);
      cropY = 0;
    } else {
      cropW = vw;
      cropH = Math.round(vw / targetAspect);
      cropX = 0;
      cropY = Math.round((vh - cropH) / 2);
    }

    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = cropW;
    tileCanvas.height = cropH;
    const tileCtx = tileCanvas.getContext('2d');
    tileCtx.drawImage(videoEl, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    // 2. Durable Persistence Rule: Save full-res JPEG bytes & pose to storage FIRST
    try {
      const blob = await new Promise((resolve) => tileCanvas.toBlob(resolve, 'image/jpeg', 0.95));
      if (blob) {
        await photoSphereStorage.saveFrame({
          id: `frame_${target.id}_${Date.now()}`,
          sessionId: eng.sessionId,
          targetId: target.targetId || `t_${target.dotNumber !== undefined ? target.dotNumber : target.id}`,
          sequenceIndex: target.dotNumber !== undefined ? target.dotNumber : target.id,
          yaw: target.yaw,
          pitch: target.pitch,
          roll: 0,
          blob,
          width: cropW,
          height: cropH,
          capturedAt: Date.now(),
        });
      }
    } catch (err) {
      console.warn('Could not persist frame to IndexedDB:', err);
    }

    // 3. Only after durable storage write succeeds, advance capture count & mark captured
    if (eng.capturedCount === 0 || target.dotNumber === 0) {
      eng.anchorYaw = eng.camYaw;
      eng.anchorPitch = 0;
    }
    eng.capturedCount++;

    target.captured = true;
    target.visible = false;
    if (target.mesh) target.mesh.visible = false;

    // 4. Add as a true 3D textured mesh on the sphere in Three.js
    const tile3DEntry = addCapturedTileTo3DScene(tileCanvas, target.yaw, target.pitch);

    // Save snapped tile in capturedTiles
    eng.capturedTiles.push({
      targetId: target.id,
      dotNumber: target.dotNumber !== undefined ? target.dotNumber : target.id,
      yaw: target.yaw,
      pitch: target.pitch,
      canvas: tileCanvas,
      tileEntry: tile3DEntry,
      width: cropW,
      height: cropH,
    });

    // 5. Paint frame into 3D sphere texture using exact target pose & zero roll
    const targetYawRad = (target.yaw * Math.PI) / 180;
    const targetPitchRad = (target.pitch * Math.PI) / 180;
    projectLiveCameraFrameOntoSphere(tileCanvas, targetYawRad, targetPitchRad);

    updateFrontierAndGapDots();
    resetHoldProgress();
    setCanUndo(true);
    setCanFinish(true);

    const isComplete = eng.capturedCount >= 34 || (eng.targets && eng.targets.length > 0 && eng.targets.every((t) => t.captured));
    if (isComplete) {
      if (instructionBannerRef.current) {
        instructionBannerRef.current.textContent = 'Sphere Sealed! Generating 360 View...';
      }
      setTimeout(() => {
        handleOpenResults();
      }, 450);
    }

    setTimeout(() => {
      eng.isCapturing = false;
    }, 180);
  }, []);

  // Render 3D WebGL Perspective Stage and Target Dots Overlay
  function renderLiveStage() {
    const eng = engineRef.current;
    const dotsCanvas = dotsCanvasRef.current;

    const W = window.innerWidth;
    const H = window.innerHeight;
    const centerX = W / 2;
    const centerY = H / 2;

    // Viewfinder box size: clamp(220, 42vw, 280) with 3:4 aspect ratio
    const boxWidth = Math.min(Math.max(220, W * 0.42), 280);
    const boxHeight = boxWidth * (4 / 3);
    eng.currentBoxWidth = boxWidth;
    eng.currentBoxHeight = boxHeight;

    // Set Three.js camera FOV so boxHeight exactly matches 56° vertical FOV
    const focalPx = (boxWidth / 2) / Math.tan((21 * Math.PI) / 180);
    const screenVFOV = 2 * Math.atan((H / 2) / focalPx) * (180 / Math.PI);

    // Two-Phase Capture Start: anchorYaw tracks camYaw during shot 0
    if (eng.capturedCount === 0 || eng.anchorYaw === null) {
      eng.anchorYaw = eng.camYaw;
    }

    const anchorYaw = eng.anchorYaw !== null ? eng.anchorYaw : eng.camYaw;
    const relYaw = eng.camYaw - anchorYaw;

    // ── LAYER 1: 3D WebGL Perspective Scene (Three.js) ──
    if (eng.camera && eng.renderer && eng.scene) {
      eng.camera.fov = screenVFOV;
      eng.camera.aspect = W / H;
      eng.camera.updateProjectionMatrix();

      // Horizon-locked 3D Camera Rotation via Quaternions (Gimbal-lock Free at Poles!)
      const qYaw = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        -THREE.MathUtils.degToRad(relYaw)
      );
      const qPitch = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        THREE.MathUtils.degToRad(eng.camPitch)
      );
      eng.camera.quaternion.copy(qYaw).multiply(qPitch);

      eng.renderer.setSize(W, H, false);
      eng.renderer.render(eng.scene, eng.camera);
    }

    // ── LAYER 3: Target Dots Overlay Canvas (z-index: 30) ──
    if (dotsCanvas) {
      if (dotsCanvas.width !== W || dotsCanvas.height !== H) {
        dotsCanvas.width = W;
        dotsCanvas.height = H;
      }
      const dotsCtx = dotsCanvas.getContext('2d');
      if (dotsCtx && eng.camera) {
        dotsCtx.clearRect(0, 0, W, H);

        // Project all uncaptured targets and identify the Active Target
        let activeTarget = null;
        let minCenterDist = Infinity;
        const projectedDots = [];

        for (const target of eng.targets) {
          if (target.captured || !target.visible) continue;

          const tYaw = target.baseYaw !== undefined ? target.baseYaw : target.yaw;
          const tPitch = target.basePitch !== undefined ? target.basePitch : target.pitch;

          const dist = 10;
          const yawRad = THREE.MathUtils.degToRad(tYaw);
          const pitchRad = THREE.MathUtils.degToRad(tPitch);
          const dotPos = new THREE.Vector3(
            dist * Math.cos(pitchRad) * Math.sin(yawRad),
            dist * Math.sin(pitchRad),
            -dist * Math.cos(pitchRad) * Math.cos(yawRad)
          );

          const proj = dotPos.clone().project(eng.camera);
          const isBehind = proj.z > 1.0;

          const screenX = (proj.x * 0.5 + 0.5) * W;
          const screenY = (-(proj.y * 0.5) + 0.5) * H;
          const distPx = Math.hypot(screenX - centerX, screenY - centerY);

          if (!isBehind) {
            projectedDots.push({ target, screenX, screenY, distPx });
            if (distPx < minCenterDist) {
              minCenterDist = distPx;
              activeTarget = target;
            }
          }
        }

        // Draw candidate dots first, then active target on top
        for (const { target, screenX, screenY, distPx } of projectedDots) {
          const isActive = target === activeTarget;
          const isAligned = isActive && distPx <= 26;

          dotsCtx.save();
          dotsCtx.beginPath();
          const drawX = isAligned ? centerX : screenX;
          const drawY = isAligned ? centerY : screenY;

          if (isActive) {
            // Prominent Glowing Active Google Blue Target
            const r = isAligned ? 17 : 15;
            dotsCtx.arc(drawX, drawY, r, 0, 2 * Math.PI);
            dotsCtx.fillStyle = '#4285F4';
            dotsCtx.shadowColor = 'rgba(66, 133, 244, 0.95)';
            dotsCtx.shadowBlur = isAligned ? 18 : 12;
            dotsCtx.fill();

            // Crisp white outer ring
            dotsCtx.lineWidth = 3.0;
            dotsCtx.strokeStyle = '#FFFFFF';
            dotsCtx.stroke();

            // Inner white dot
            dotsCtx.beginPath();
            dotsCtx.arc(drawX, drawY, 4, 0, 2 * Math.PI);
            dotsCtx.fillStyle = '#FFFFFF';
            dotsCtx.fill();
          } else {
            // Visible Google Blue 360 constellation dot
            const r = 12;
            dotsCtx.arc(drawX, drawY, r, 0, 2 * Math.PI);
            dotsCtx.fillStyle = 'rgba(66, 133, 244, 0.65)';
            dotsCtx.shadowColor = 'rgba(0, 0, 0, 0.75)';
            dotsCtx.shadowBlur = 6;
            dotsCtx.fill();

            // Crisp white outline
            dotsCtx.lineWidth = 2.0;
            dotsCtx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
            dotsCtx.stroke();

            // Center highlight
            dotsCtx.beginPath();
            dotsCtx.arc(drawX, drawY, 2.5, 0, 2 * Math.PI);
            dotsCtx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            dotsCtx.fill();
          }
          dotsCtx.restore();
        }

        // Off-screen directional guidance: if no uncaptured targets inside screen, guide user toward closest target
        if (projectedDots.length === 0 || minCenterDist > Math.max(W, H) * 0.45) {
          let nearestAnywhere = null;
          let minAng = Infinity;
          for (const target of eng.targets) {
            if (target.captured) continue;
            const tYaw = target.baseYaw !== undefined ? target.baseYaw : target.yaw;
            const tPitch = target.basePitch !== undefined ? target.basePitch : target.pitch;
            const ang = angularDistance(relYaw, eng.camPitch, tYaw, tPitch);
            if (ang < minAng) {
              minAng = ang;
              nearestAnywhere = target;
            }
          }

          if (nearestAnywhere) {
            const tYaw = nearestAnywhere.baseYaw !== undefined ? nearestAnywhere.baseYaw : nearestAnywhere.yaw;
            const tPitch = nearestAnywhere.basePitch !== undefined ? nearestAnywhere.basePitch : nearestAnywhere.pitch;
            const dYaw = ((tYaw - relYaw + 540) % 360) - 180;
            const dPitch = tPitch - eng.camPitch;
            const dirAngle = Math.atan2(-dPitch, dYaw);

            const guideRadius = 56;
            const gx = centerX + guideRadius * Math.cos(dirAngle);
            const gy = centerY + guideRadius * Math.sin(dirAngle);

            dotsCtx.save();
            dotsCtx.beginPath();
            dotsCtx.arc(gx, gy, 7, 0, 2 * Math.PI);
            dotsCtx.fillStyle = '#4285F4';
            dotsCtx.shadowColor = 'rgba(66, 133, 244, 0.95)';
            dotsCtx.shadowBlur = 10;
            dotsCtx.fill();
            dotsCtx.lineWidth = 2;
            dotsCtx.strokeStyle = '#FFFFFF';
            dotsCtx.stroke();
            dotsCtx.restore();
          }
        }
      }
    }
  }

  // Strict Hold-Steady Lock & Dot Alignment
  function evaluateDotAlignment(timestamp) {
    const eng = engineRef.current;
    if (!eng.camera) return;

    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const centerX = viewportW / 2;
    const centerY = viewportH / 2;

    let closest = null;
    let minScreenDist = Infinity;

    for (const t of eng.targets) {
      if (t.captured || !t.visible) continue;

      let tYaw = t.baseYaw !== undefined ? t.baseYaw : t.yaw;
      let tPitch = t.basePitch !== undefined ? t.basePitch : t.pitch;

      const dist = 10;
      const yawRad = THREE.MathUtils.degToRad(tYaw);
      const pitchRad = THREE.MathUtils.degToRad(tPitch);
      const dotPos = new THREE.Vector3(
        dist * Math.cos(pitchRad) * Math.sin(yawRad),
        dist * Math.sin(pitchRad),
        -dist * Math.cos(pitchRad) * Math.cos(yawRad)
      );

      const proj = dotPos.clone().project(eng.camera);
      if (proj.z > 1.0) continue;

      const screenX = (proj.x * 0.5 + 0.5) * viewportW;
      const screenY = (-(proj.y * 0.5) + 0.5) * viewportH;

      const distPx = Math.hypot(screenX - centerX, screenY - centerY);
      if (distPx < minScreenDist) {
        minScreenDist = distPx;
        closest = t;
      }
    }

    const centerBlueDot = centerBlueDotRef.current;
    const ringProgress = ringProgressRef.current;
    const banner = instructionBannerRef.current;

    // Polar Dot Snapping: overhead (zenith +90°) and ground (nadir -90°) dots have slightly wider
    // catchment radius and velocity tolerance matching Google Camera LightCycle native decompiled app
    const isPolarDot = closest && Math.abs(closest.pitch) >= 70;
    const reticleRadiusPx = isPolarDot ? 38 : 28;
    const maxVelocity = isPolarDot ? 40 : 28;

    const isInsideReticle = closest && minScreenDist <= reticleRadiusPx;
    const isMovingTooFast = (eng.angularVelocity || 0) > maxVelocity;

    if (isInsideReticle) {
      if (isMovingTooFast) {
        if (banner) banner.textContent = 'Slow down — hold steady';
        resetHoldProgress();
        return;
      }

      if (eng.activeTarget !== closest) {
        eng.activeTarget = closest;
        eng.holdStartTime = timestamp;
      }

      const elapsed = timestamp - eng.holdStartTime;
      const progress = Math.min(1, elapsed / (CONFIG.HOLD_DURATION_MS || 600));

      // Snap blue dot to center
      if (centerBlueDot) {
        centerBlueDot.style.opacity = '1';
        centerBlueDot.style.transform = 'translate(-50%, -50%) scale(1)';
      }

      if (ringProgress) {
        ringProgress.style.strokeDashoffset = (RETICLE_CIRCUMFERENCE * (1 - progress)).toFixed(1);
      }
      if (banner) banner.textContent = 'Hold steady...';

      if (progress >= 1.0 && !eng.isCapturing) {
        triggerSingleDotCapture(closest);
      }
    } else {
      if (centerBlueDot) {
        centerBlueDot.style.opacity = '0';
        centerBlueDot.style.transform = 'translate(-50%, -50%) scale(0.35)';
      }
      resetHoldProgress();

      if (banner) {
        if (eng.capturedCount >= 34) {
          banner.textContent = 'Photo Sphere complete!\nTap the checkmark ✓';
        } else if (eng.capturedCount === 0) {
          banner.textContent = 'To start, keep\ndot inside circle';
        } else {
          banner.textContent = 'Aim camera at the\nnext dot to capture';
        }
      }
    }
  }

  // Master Render Loop
  const renderLoop = useCallback((timestamp) => {
    const eng = engineRef.current;
    eng.animationFrameId = requestAnimationFrame(renderLoop);

    if (!eng.useGyro) {
      eng.angularVelocity *= 0.85;
    }

    renderLiveStage();
    evaluateDotAlignment(timestamp);
  }, [triggerSingleDotCapture]);

  // Start Hardware Camera Stream
  const startHardwareCamera = useCallback(async (facingMode = 'environment') => {
    const eng = engineRef.current;
    if (eng.currentStream) {
      eng.currentStream.getTracks().forEach((t) => t.stop());
    }

    const attempts = [
      {
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 960 }, // Native 4:3 sensor aspect ratio (prevents browser zoom crop)
          aspectRatio: { ideal: 1.333333 },
        },
        audio: false,
      },
      {
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      },
      { video: { facingMode }, audio: false },
      { video: true, audio: false },
    ];

    let stream = null;
    for (const c of attempts) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(c);
        break;
      } catch (_) {}
    }

    if (!stream) {
      console.warn('Camera access unavailable or blocked');
      return false;
    }

    // Explicitly lock zoom to 1.0x if the mobile browser supports hardware zoom
    const [track] = stream.getVideoTracks();
    const capabilities = track?.getCapabilities?.() || {};
    if ('zoom' in capabilities) {
      try {
        await track.applyConstraints({
          advanced: [{ zoom: capabilities.zoom?.min || 1.0 }],
        });
      } catch (err) {
        console.warn('Could not lock hardware zoom to 1.0x:', err);
      }
    }

    eng.currentStream = stream;
    setCameraFacingMode(facingMode);
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }
    return true;
  }, []);

  // Flip Camera Front / Back
  const handleFlipCamera = async () => {
    const nextMode = cameraFacingMode === 'environment' ? 'user' : 'environment';
    await startHardwareCamera(nextMode);
  };

  // Request iOS Gyroscope Permission on User Tap
  const handleRequestGyroPermission = async () => {
    try {
      if (
        typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function'
      ) {
        const perm = await DeviceOrientationEvent.requestPermission();
        if (perm === 'granted') {
          setNeedsGyroPermission(false);
          const eng = engineRef.current;
          if (eng.onDeviceOrientation) {
            window.addEventListener('deviceorientation', eng.onDeviceOrientation, true);
          }
        }
      }
    } catch (err) {
      console.warn('Gyro permission request rejected:', err);
    }
  };

  // Keep Mobile Screen Awake During Capture Session
  useEffect(() => {
    let wakeLock = null;
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then((lock) => {
        wakeLock = lock;
      }).catch(() => {});
    }
    if (typeof window !== 'undefined' && window.screen?.orientation?.lock) {
      window.screen.orientation.lock('portrait').catch(() => {});
    }
    return () => {
      if (wakeLock) {
        wakeLock.release().catch(() => {});
      }
    };
  }, []);


  // Undo Last Capture
  const handleUndo = useCallback(async () => {
    const eng = engineRef.current;
    if (eng.capturedTiles.length === 0) return;

    // Pop the last captured tile
    const lastTile = eng.capturedTiles.pop();
    if (lastTile && lastTile.tileEntry) {
      if (eng.tilesGroup && lastTile.tileEntry.mesh) {
        eng.tilesGroup.remove(lastTile.tileEntry.mesh);
      }
      if (lastTile.tileEntry.texture) lastTile.tileEntry.texture.dispose();
      if (lastTile.tileEntry.geometry) lastTile.tileEntry.geometry.dispose();
    }

    // Delete last frame from durable storage
    if (eng.sessionId) {
      try {
        await photoSphereStorage.deleteLastFrame(eng.sessionId);
      } catch (err) {
        console.warn('Could not remove last frame from storage:', err);
      }
    }

    // Re-enable target
    const target = eng.targets.find(
      (t) => t.id === lastTile.targetId || t.dotNumber === lastTile.dotNumber
    );
    if (target) {
      target.captured = false;
      target.visible = true;
      if (target.mesh) target.mesh.visible = true;
    }

    eng.capturedCount = Math.max(0, eng.capturedCount - 1);
    if (eng.capturedCount === 0) {
      eng.anchorYaw = null;
    }

    const last = eng.historyStack.pop();
    if (last) {
      if (eng.masterPanoCtx && last.prevPanoImage) {
        eng.masterPanoCtx.putImageData(last.prevPanoImage, 0, 0);
      }
      if (eng.coverageGrid && last.prevCoverage) {
        eng.coverageGrid.set(last.prevCoverage);
      }
      if (last.prevAccumR && eng.panoAccumR) {
        eng.panoAccumR.set(last.prevAccumR);
        eng.panoAccumG.set(last.prevAccumG);
        eng.panoAccumB.set(last.prevAccumB);
        eng.panoAccumW.set(last.prevAccumW);
      }
    }

    updateFrontierAndGapDots();
    resetHoldProgress();
    setCanUndo(eng.capturedTiles.length > 0);
    setCanFinish(eng.capturedTiles.length > 0);
  }, []);

  // Reset Session
  const handleReset = useCallback(() => {
    const eng = engineRef.current;
    if (eng.tilesGroup) eng.tilesGroup.clear();
    eng.capturedTiles = [];
    eng.capturedCount = 0;
    eng.anchorYaw = null;
    eng.historyStack = [];
    if (eng.masterPanoCtx) {
      eng.masterPanoCtx.fillStyle = '#121212';
      eng.masterPanoCtx.fillRect(0, 0, CONFIG.PANO_WIDTH, CONFIG.PANO_HEIGHT);
    }
    initTargetLattice();
    resetHoldProgress();
    setCanUndo(false);
    setCanFinish(false);
  }, []);

  // Generate Tiny Planet Projection
  const generateTinyPlanet = () => {
    const eng = engineRef.current;
    const canvas = planetCanvasRef.current;
    if (!canvas || !eng.masterPanoCtx) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    const srcData = eng.masterPanoCtx.getImageData(0, 0, CONFIG.PANO_WIDTH, CONFIG.PANO_HEIGHT).data;
    const dstImg = ctx.createImageData(W, H);
    const dst = dstImg.data;

    const cx = W / 2;
    const cy = H / 2;
    const scale = W * 0.36;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = (x - cx) / scale;
        const dy = (y - cy) / scale;
        const r = Math.hypot(dx, dy);

        const c = 2 * Math.atan(r);
        const lat = Math.cos(c) * (-Math.PI / 2) + (1 - Math.cos(c)) * (Math.PI / 2);
        const lon = Math.atan2(dx, -dy);

        const uTex = lon / (2 * Math.PI) + 0.5;
        const vTex = 0.5 - lat / Math.PI;

        const u = Math.min(CONFIG.PANO_WIDTH - 1, Math.max(0, Math.floor(uTex * CONFIG.PANO_WIDTH)));
        const v = Math.min(CONFIG.PANO_HEIGHT - 1, Math.max(0, Math.floor(vTex * CONFIG.PANO_HEIGHT)));

        const sIdx = (v * CONFIG.PANO_WIDTH + u) * 4;
        const dIdx = (y * W + x) * 4;

        dst[dIdx] = srcData[sIdx];
        dst[dIdx + 1] = srcData[sIdx + 1];
        dst[dIdx + 2] = srcData[sIdx + 2];
        dst[dIdx + 3] = 255;
      }
    }
    ctx.putImageData(dstImg, 0, 0);
  };

  // Initialize Interactive 360 Viewer inside Result Modal
  const initInteractive360Viewer = () => {
    const eng = engineRef.current;
    const container = interactiveViewerContainerRef.current;
    if (!container || !eng.masterPanoCanvas) return;
    container.innerHTML = '';

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 500;

    const vScene = new THREE.Scene();
    const vCamera = new THREE.PerspectiveCamera(70, width / height, 0.1, 500);
    vCamera.position.set(0, 0, 0);

    const vRenderer = new THREE.WebGLRenderer({ antialias: true });
    vRenderer.setSize(width, height);
    container.appendChild(vRenderer.domElement);

    const geo = createTrueAlignedSphereGeometry(50, 72, 48);
    const tex = new THREE.CanvasTexture(eng.masterPanoCanvas);
    vScene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })));

    eng.viewerScene = vScene;
    eng.viewerCamera = vCamera;
    eng.viewerRenderer = vRenderer;

    let drag = false, lx = 0, ly = 0;
    vRenderer.domElement.addEventListener('pointerdown', (e) => {
      drag = true;
      lx = e.clientX;
      ly = e.clientY;
    });
    window.addEventListener('pointermove', (e) => {
      if (!drag) return;
      eng.viewerYaw += (e.clientX - lx) * 0.004;
      eng.viewerPitch = THREE.MathUtils.clamp(
        eng.viewerPitch - (e.clientY - ly) * 0.004,
        -Math.PI / 2 + 0.08,
        Math.PI / 2 - 0.08
      );
      lx = e.clientX;
      ly = e.clientY;
    });
    window.addEventListener('pointerup', () => (drag = false));

    function vLoop() {
      if (!showResultModal) return;
      eng.viewerAnimId = requestAnimationFrame(vLoop);
      vCamera.lookAt(sphericalToCartesian(eng.viewerYaw, eng.viewerPitch));
      vRenderer.render(vScene, vCamera);
    }
    vLoop();
  };

  // Open Results Screen & Run Genuine Spherical Stitching
  const handleOpenResults = async () => {
    const eng = engineRef.current;
    if (isStitching) return;

    setIsStitching(true);
    setStitchError(null);
    setStitchingProgress({ percent: 5, statusText: 'Retrieving captured spherical frames...' });

    try {
      // 1. Gather all frames for the session from IndexedDB
      let frames = [];
      if (eng.sessionId) {
        frames = await photoSphereStorage.getFramesForSession(eng.sessionId);
      }

      // If storage had no frames (e.g. headless tests or in-memory fallback), gather from capturedTiles
      if ((!frames || frames.length === 0) && eng.capturedTiles && eng.capturedTiles.length > 0) {
        frames = await Promise.all(
          eng.capturedTiles.map(async (tile, idx) => {
            let blob = null;
            if (tile.canvas && tile.canvas.toBlob) {
              blob = await new Promise((resolve) => tile.canvas.toBlob(resolve, 'image/jpeg', 0.95));
            }
            return {
              id: `mem_frame_${idx}`,
              yaw: tile.yaw,
              pitch: tile.pitch,
              roll: 0,
              blob,
              bitmap: tile.canvas,
            };
          })
        );
      }

      if (!frames || frames.length === 0) {
        throw new Error('No captured frames available for stitching');
      }

      // 2. Execute PhotoSphereStitcher with dual native/web inverse-spherical pipeline
      const stitchResult = await PhotoSphereStitcher.stitch(
        frames,
        {
          width: CONFIG.PANO_WIDTH,
          strictCoverage: false, // Allows partial panorama generation with honest warning
        },
        (progress, statusText) => {
          setStitchingProgress({
            percent: Math.min(100, Math.max(0, Math.round(progress * 100))),
            statusText,
          });
        }
      );

      // Clean up previous blob URL if any
      if (stitchedPanoData?.url) {
        try {
          URL.revokeObjectURL(stitchedPanoData.url);
        } catch (_) {}
      }

      setStitchedPanoData(stitchResult);
      setIsStitching(false);
      setShowResultModal(true);
    } catch (err) {
      console.error('Photo Sphere stitching failed:', err);
      setStitchError(err.message || 'Stitching failed. Please try again.');
      setIsStitching(false);
    }
  };

  // Save Final Evidence & Close
  const handleSaveEvidence = async () => {
    const eng = engineRef.current;
    
    // Prioritize high-quality stitched blob with GPano XMP from PhotoSphereStitcher
    let finalBlob = stitchedPanoData?.blob;
    let panoWidth = stitchedPanoData?.width || CONFIG.PANO_WIDTH;
    let panoHeight = stitchedPanoData?.height || CONFIG.PANO_HEIGHT;
    let isComplete = stitchedPanoData?.isCompleteSphere ?? (eng.coveragePercent >= 80);
    let coverage = stitchedPanoData?.coveragePercent ?? eng.coveragePercent;

    if (!finalBlob && eng.masterPanoCanvas) {
      // Fallback to master canvas if stitchedPanoData wasn't available
      const rawBlob = await new Promise((resolve) => eng.masterPanoCanvas.toBlob(resolve, 'image/jpeg', 0.95));
      if (rawBlob) {
        finalBlob = await injectXmpIntoJpeg(rawBlob, {
          isCompleteSphere: isComplete,
        });
      }
    }

    if (!finalBlob) {
      alert('No panorama image available to save');
      return;
    }

    try {
      const panoRecord = await photoSphereStorage.savePanorama({
        sessionId: eng.sessionId,
        inspectionId: taskId,
        blob: finalBlob,
        width: panoWidth,
        height: panoHeight,
        isCompleteSphere: isComplete,
        metadata: {
          coveragePercent: coverage,
          framesCount: eng.capturedCount,
          stitchedAt: Date.now(),
        },
      });

      if (onSaveEvidence) {
        onSaveEvidence({
          mediaType: 'photo_sphere',
          evidenceType: '360 Photo Sphere',
          blob: finalBlob,
          url: stitchedPanoData?.url || URL.createObjectURL(finalBlob),
          id: panoRecord.id,
          coveragePercent: coverage,
          framesCount: eng.capturedCount,
          sessionId: eng.sessionId,
        });
      }
      onClose();
    } catch (err) {
      console.error('Failed to save panorama evidence:', err);
      alert('Failed to save Photo Sphere evidence: ' + err.message);
    }
  };

  // Main Mount Lifecycle
  useEffect(() => {
    const eng = engineRef.current;

    // Resume existing active session or create a new one in IndexedDB
    photoSphereStorage.getActiveSession(taskId).then(async (activeSession) => {
      let session = activeSession;
      if (!session) {
        session = await photoSphereStorage.createSession(taskId, { totalTargets: 34 });
      }
      eng.sessionId = session.id;

      // Interruption recovery: restore already-captured frames from storage
      const savedFrames = await photoSphereStorage.getFramesForSession(session.id);
      if (savedFrames && savedFrames.length > 0) {
        savedFrames.forEach((frame) => {
          const t = eng.targets.find(
            (tgt) => tgt.id === frame.targetId || tgt.targetId === frame.targetId || tgt.dotNumber === frame.sequenceIndex
          );
          if (t) {
            t.captured = true;
            t.visible = false;
            if (t.mesh) t.mesh.visible = false;
          }
        });
        eng.capturedCount = savedFrames.length;
        if (savedFrames.length > 0) {
          eng.anchorYaw = savedFrames[0].yaw;
          eng.anchorPitch = 0;
        }
        updateFrontierAndGapDots();
        setCanUndo(true);
        setCanFinish(true);
      }
    });

    // Master Equirectangular Texture Canvas
    const masterCanvas = document.createElement('canvas');
    masterCanvas.width = CONFIG.PANO_WIDTH;
    masterCanvas.height = CONFIG.PANO_HEIGHT;
    eng.masterPanoCanvas = masterCanvas;
    eng.masterPanoCtx = masterCanvas.getContext('2d', { willReadFrequently: true });
    eng.coverageGrid = new Uint8Array(CONFIG.COVERAGE_LON_STEPS * CONFIG.COVERAGE_LAT_STEPS);
    eng.panoAccumR = new Float32Array(CONFIG.PANO_WIDTH * CONFIG.PANO_HEIGHT);
    eng.panoAccumG = new Float32Array(CONFIG.PANO_WIDTH * CONFIG.PANO_HEIGHT);
    eng.panoAccumB = new Float32Array(CONFIG.PANO_WIDTH * CONFIG.PANO_HEIGHT);
    eng.panoAccumW = new Float32Array(CONFIG.PANO_WIDTH * CONFIG.PANO_HEIGHT);
    eng.masterPanoCtx.fillStyle = '#121212';
    eng.masterPanoCtx.fillRect(0, 0, CONFIG.PANO_WIDTH, CONFIG.PANO_HEIGHT);

    // Initialize Three.js WebGL Scene on webglCanvasRef
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0d0d);
    eng.scene = scene;

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 0, 0);
    eng.camera = camera;

    let renderer = null;
    if (webglCanvasRef.current) {
      renderer = new THREE.WebGLRenderer({
        canvas: webglCanvasRef.current,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      eng.renderer = renderer;
    }

    // Tiles group for captured 3D meshes
    const tilesGroup = new THREE.Group();
    scene.add(tilesGroup);
    eng.tilesGroup = tilesGroup;

    // 3D Spatial cross grid on floor & ceiling
    const spatialGrid = createSpatialCrossGrid();
    scene.add(spatialGrid);
    eng.spatialGrid = spatialGrid;

    // Setup Target Dots Overlay Canvas
    if (dotsCanvasRef.current) {
      dotsCanvasRef.current.width = window.innerWidth;
      dotsCanvasRef.current.height = window.innerHeight;
    }

    initTargetLattice();

    // Resize Handler for WebGL renderer and dots overlay
    const handleResize = () => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      if (eng.renderer) {
        eng.renderer.setSize(W, H, false);
      }
      if (dotsCanvasRef.current) {
        dotsCanvasRef.current.width = W;
        dotsCanvasRef.current.height = H;
      }
    };
    window.addEventListener('resize', handleResize);

    // Pointer Drag Controls (Fallback / Desktop)
    let dragging = false, px = 0, py = 0;
    const canvasEl = webglCanvasRef.current;
    const onPointerDown = (e) => {
      dragging = true;
      px = e.clientX;
      py = e.clientY;
    };
    const onPointerMove = (e) => {
      if (!dragging || eng.useGyro) return;
      const dx = e.clientX - px;
      const dy = e.clientY - py;
      px = e.clientX;
      py = e.clientY;

      eng.camYaw = ((eng.camYaw + dx * 0.18 + 540) % 360) - 180;
      eng.camPitch = THREE.MathUtils.clamp(eng.camPitch - dy * 0.18, -89, 89);
      eng.angularVelocity = Math.hypot(dx, dy) * 1.5;
    };
    const onPointerUp = () => {
      dragging = false;
      eng.angularVelocity = 0;
    };

    if (canvasEl) {
      canvasEl.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    }

    // Gyroscope DeviceOrientation Binding with 3D Rotation Matrix Projection (Fix 3)
    const onDeviceOrientation = (e) => {
      if (e.alpha === null || e.beta === null) return;
      eng.useGyro = true;

      // Extract clean 3D camera orientation basis without wrist roll
      const { yawDeg, pitchDeg } = getCameraBasisFromDeviceOrientation(e.alpha, e.beta, e.gamma);

      // Lock initial reference orientation when opening capture mode
      if (eng.initialYaw === null) {
        eng.initialYaw = yawDeg;
        eng.camYaw = yawDeg;
        eng.camPitch = pitchDeg;
      }

      const targetYaw = yawDeg;
      const targetPitch = THREE.MathUtils.clamp(pitchDeg, -90, 90);

      // Track movement speed (deg/sec) with dt measurement to protect against jerky motion
      const now = performance.now();
      if (eng.lastOrientTime) {
        const dt = Math.max(0.005, (now - eng.lastOrientTime) / 1000);
        const dYaw = ((targetYaw - eng.camYaw + 540) % 360) - 180;
        const dPitch = targetPitch - eng.camPitch;
        const instSpeed = Math.hypot(dYaw, dPitch) / dt;
        eng.angularVelocity = 0.8 * (eng.angularVelocity || 0) + 0.2 * instSpeed;
      }
      eng.lastOrientTime = now;

      // Smooth with circular EMA (shortest wrapping path)
      eng.camYaw = lerpAngleDeg(eng.camYaw, targetYaw, 0.22);
      eng.camPitch = eng.camPitch + (targetPitch - eng.camPitch) * 0.22;
    };

    eng.onDeviceOrientation = onDeviceOrientation;

    let nativeSensorHandle = null;
    const isNative = Capacitor.isNativePlatform();

    if (isNative) {
      setNeedsGyroPermission(false);
      try {
        PhotoSphereSensor.start().catch((err) => {
          console.warn('Native rotation sensor start note:', err);
        });
        PhotoSphereSensor.addListener('sensorOrientation', (data) => {
          if (!eng.camera || !data) return;
          const targetYaw = ((data.yaw % 360) + 360) % 360;
          const targetPitch = Math.max(-90, Math.min(90, data.pitch));

          const now = performance.now();
          if (eng.lastOrientTime) {
            const dt = Math.max(0.005, (now - eng.lastOrientTime) / 1000);
            const dYaw = ((targetYaw - eng.camYaw + 540) % 360) - 180;
            const dPitch = targetPitch - eng.camPitch;
            const instSpeed = Math.hypot(dYaw, dPitch) / dt;
            eng.angularVelocity = 0.8 * (eng.angularVelocity || 0) + 0.2 * instSpeed;
          }
          eng.lastOrientTime = now;

          // 200Hz direct sensor fusion from Snapdragon/MediaTek DSP
          eng.camYaw = lerpAngleDeg(eng.camYaw, targetYaw, 0.4);
          eng.camPitch = eng.camPitch + (targetPitch - eng.camPitch) * 0.4;
        }).then((handle) => {
          nativeSensorHandle = handle;
        }).catch(() => {});
      } catch (err) {
        console.warn('Could not initialize native sensor plugin:', err);
      }
    } else if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      DeviceOrientationEvent.requestPermission()
        .then((perm) => {
          if (perm === 'granted') {
            setNeedsGyroPermission(false);
            window.addEventListener('deviceorientation', onDeviceOrientation, true);
          }
        })
        .catch(() => {
          setNeedsGyroPermission(true);
        });
    } else if ('DeviceOrientationEvent' in window) {
      setNeedsGyroPermission(false);
      window.addEventListener('deviceorientation', onDeviceOrientation, true);
    }

    // Start Camera & Render Loop
    startHardwareCamera('environment');
    eng.animationFrameId = requestAnimationFrame(renderLoop);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('deviceorientation', onDeviceOrientation, true);
      if (nativeSensorHandle && typeof nativeSensorHandle.remove === 'function') {
        nativeSensorHandle.remove();
      }
      if (isNative) {
        try {
          PhotoSphereSensor.stop().catch(() => {});
        } catch (_) {}
      }
      if (canvasEl) {
        canvasEl.removeEventListener('pointerdown', onPointerDown);
      }
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);

      if (eng.animationFrameId) cancelAnimationFrame(eng.animationFrameId);
      if (eng.viewerAnimId) cancelAnimationFrame(eng.viewerAnimId);
      if (eng.currentStream) {
        eng.currentStream.getTracks().forEach((t) => t.stop());
      }
      if (eng.tilesGroup) {
        eng.tilesGroup.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (obj.material.map) obj.material.map.dispose();
            obj.material.dispose();
          }
        });
      }
      if (eng.crossGrid) {
        eng.crossGrid.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) obj.material.dispose();
        });
      }
      if (eng.renderer) {
        eng.renderer.dispose();
      }
      if (eng.viewerRenderer) {
        eng.viewerRenderer.dispose();
      }
    };
  }, [renderLoop, startHardwareCamera, taskId]);

  // Clean up stitched panorama object URL when component unmounts or new stitch runs
  useEffect(() => {
    return () => {
      if (stitchedPanoData?.url) {
        try {
          URL.revokeObjectURL(stitchedPanoData.url);
        } catch (_) {}
      }
    };
  }, [stitchedPanoData]);

  return (
    <div
      ref={containerRef}
      className="photosphere-stage"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100dvh',
        backgroundColor: '#000000',
        color: '#ffffff',
        fontFamily: '"Google Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        overflow: 'hidden',
        touchAction: 'none',
        zIndex: 85,
        userSelect: 'none',
        WebkitUserSelect: 'none',
        overscrollBehavior: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Layer 1: 3D WebGL Canvas (Hardware Three.js Scene: 3D Cross Grid & Captured Photo Meshes) */}
      <canvas
        ref={webglCanvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          zIndex: 1,
          touchAction: 'none',
        }}
      />

      {/* iOS Gyroscope Permission Prompt Banner */}
      {needsGyroPermission && (
        <div
          style={{
            position: 'absolute',
            top: 'max(20px, calc(env(safe-area-inset-top, 0px) + 16px))',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 35,
            width: 'calc(100% - 32px)',
            maxWidth: '380px',
            background: 'rgba(26, 115, 232, 0.95)',
            backdropFilter: 'blur(12px)',
            borderRadius: '14px',
            padding: '10px 14px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
          }}
        >
          <div style={{ fontSize: '0.82rem', color: '#fff', lineHeight: 1.25 }}>
            <strong>Enable Motion Sensors</strong>
            <div style={{ opacity: 0.9, fontSize: '0.74rem' }}>Tap to allow 360° gyroscope camera tracking</div>
          </div>
          <button
            onClick={handleRequestGyroPermission}
            style={{
              background: '#ffffff',
              color: '#1a73e8',
              border: 'none',
              fontWeight: 700,
              fontSize: '0.8rem',
              padding: '8px 14px',
              borderRadius: '8px',
              cursor: 'pointer',
              flexShrink: 0,
              touchAction: 'manipulation',
            }}
          >
            Enable
          </button>
        </div>
      )}

      {/* Center Instruction Text directly above viewfinder box */}
      <div
        ref={instructionBannerRef}
        style={{
          position: 'absolute',
          top: 'calc(50% - ' + ((engineRef.current.currentBoxHeight || 320) / 2 + 56) + 'px)',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 25,
          textAlign: 'center',
          fontSize: '1.05rem',
          fontWeight: 400,
          color: 'rgba(255, 255, 255, 0.95)',
          textShadow: '0 2px 10px rgba(0, 0, 0, 0.95)',
          pointerEvents: 'none',
          width: '90%',
          maxWidth: '360px',
          whiteSpace: 'pre-line',
          lineHeight: 1.35,
        }}
      >
        To start, keep{'\n'}dot inside circle
      </div>

      {/* Layer 2: Center White-Bordered Camera Viewfinder Box (z-index: 10) */}
      <div
        className="camera-viewfinder-box"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'clamp(220px, 42vw, 280px)',
          aspectRatio: '3 / 4',
          border: '2px solid rgba(255, 255, 255, 0.95)',
          boxShadow: '0 0 24px rgba(0, 0, 0, 0.75)',
          borderRadius: '2px',
          overflow: 'hidden',
          zIndex: 10,
          pointerEvents: 'none',
          backgroundColor: '#0d0d0d',
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: 'block',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Layer 3: Target Dots Overlay Canvas (z-index: 30) - ALWAYS ON TOP OF VIDEO */}
      <canvas
        ref={dotsCanvasRef}
        className="target-dots-overlay"
        style={{
          position: 'fixed',
          inset: 0,
          width: '100vw',
          height: '100vh',
          pointerEvents: 'none',
          zIndex: 30,
        }}
      />

      {/* Layer 4: Center Reticle 4-Quadrant Ring (gom.java) & Snap Indicator (z-index: 35) */}
      <div
        className="center-reticle-ring"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: '58px',
          height: '58px',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
          zIndex: 35,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxSizing: 'border-box',
        }}
      >
        <svg
          width="58"
          height="58"
          viewBox="0 0 58 58"
          style={{ position: 'absolute', zIndex: 2 }}
        >
          {/* Base 4 Quadrant Brackets with Cardinal Gaps (gom.java) */}
          <path d="M 32 5 A 24 24 0 0 1 53 26" fill="none" stroke="rgba(255, 255, 255, 0.85)" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M 53 32 A 24 24 0 0 1 32 53" fill="none" stroke="rgba(255, 255, 255, 0.85)" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M 26 53 A 24 24 0 0 1 5 32" fill="none" stroke="rgba(255, 255, 255, 0.85)" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M 5 26 A 24 24 0 0 1 26 5" fill="none" stroke="rgba(255, 255, 255, 0.85)" strokeWidth="2.5" strokeLinecap="round" />

          {/* Dwell Progress Fill Ring across 4 Quadrants (600ms dwell) */}
          <circle
            ref={ringProgressRef}
            cx="29"
            cy="29"
            r="24"
            fill="none"
            stroke="#4285F4"
            strokeWidth="3.5"
            strokeDasharray={String(RETICLE_CIRCUMFERENCE)}
            strokeDashoffset={String(RETICLE_CIRCUMFERENCE)}
            strokeLinecap="round"
            transform="rotate(-90 29 29)"
            style={{ transition: 'stroke-dashoffset 0.05s linear' }}
          />
        </svg>
        <div
          ref={centerBlueDotRef}
          id="center-blue-dot"
          style={{
            position: 'absolute',
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            background: '#4285F4',
            opacity: 0,
            transform: 'scale(0.35)',
            transition: 'opacity 0.12s ease, transform 0.12s ease',
            zIndex: 1,
            boxShadow: '0 0 10px rgba(66, 133, 244, 0.85)',
          }}
        />
      </div>

      {/* Shutter Flash Animation */}
      <div
        ref={shutterFlashRef}
        style={{
          position: 'fixed',
          inset: 0,
          background: '#ffffff',
          opacity: 0,
          pointerEvents: 'none',
          zIndex: 20,
          transition: 'opacity 0.16s ease-out',
        }}
      />

      {/* Floating Bottom Bar: Undo (Left), Checkmark Finish (Center), Cancel (Right) */}
      <div
        className="photosphere-bottom-bar"
        style={{
          position: 'absolute',
          bottom: 'max(24px, env(safe-area-inset-bottom, 24px))',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '36px',
          width: '100%',
          maxWidth: '380px',
        }}
      >
        {/* Undo Button */}
        <button
          onClick={handleUndo}
          disabled={!canUndo}
          style={{
            width: '52px',
            height: '52px',
            borderRadius: '50%',
            border: '1.5px solid rgba(255, 255, 255, 0.45)',
            background: 'rgba(25, 25, 25, 0.8)',
            backdropFilter: 'blur(10px)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: canUndo ? 'pointer' : 'default',
            opacity: canUndo ? 1 : 0.35,
            transition: 'opacity 0.2s ease, transform 0.1s ease',
            touchAction: 'manipulation',
          }}
          title="Undo Last Photo"
        >
          <Undo2 size={22} />
        </button>

        {/* Finish & Stitch Button (Checkmark) */}
        <button
          onClick={handleOpenResults}
          disabled={!canFinish}
          style={{
            width: '68px',
            height: '68px',
            borderRadius: '50%',
            border: '3px solid #ffffff',
            background: canFinish ? '#4285F4' : 'rgba(38, 38, 38, 0.85)',
            boxShadow: canFinish ? '0 0 24px rgba(66, 133, 244, 0.75)' : 'none',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: canFinish ? 'pointer' : 'default',
            opacity: canFinish ? 1 : 0.45,
            transition: 'background-color 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease',
            touchAction: 'manipulation',
          }}
          title="Finish & Stitch 360° Photo Sphere"
        >
          <Check size={32} strokeWidth={3} />
        </button>

        {/* Cancel / Exit Button */}
        <button
          onClick={onClose}
          style={{
            width: '52px',
            height: '52px',
            borderRadius: '50%',
            border: '1.5px solid rgba(255, 255, 255, 0.45)',
            background: 'rgba(25, 25, 25, 0.8)',
            backdropFilter: 'blur(10px)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'transform 0.1s ease',
            touchAction: 'manipulation',
          }}
          title="Exit Photo Sphere"
        >
          <X size={22} />
        </button>
      </div>

      {/* Stitching Progress Modal Overlay */}
      {isStitching && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            backgroundColor: 'rgba(5, 8, 16, 0.92)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            color: '#f8fafc',
            fontFamily: '"Google Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '380px',
              backgroundColor: '#111827',
              borderRadius: '20px',
              border: '1px solid #374151',
              padding: '28px 24px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.75)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              gap: '16px',
            }}
          >
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, rgba(66, 133, 244, 0.2), rgba(52, 168, 83, 0.2))',
                border: '2px solid #4285F4',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <RefreshCw
                size={30}
                color="#4285F4"
                style={{ animation: 'spin 1.8s linear infinite' }}
              />
            </div>

            <div>
              <h3 style={{ margin: '0 0 6px 0', fontSize: '1.25rem', fontWeight: 600, color: '#f8fafc' }}>
                Stitching 360° Photo Sphere
              </h3>
              <p style={{ margin: 0, fontSize: '0.86rem', color: '#9ca3af', lineHeight: 1.4 }}>
                {stitchingProgress.statusText || 'Processing spherical alignment...'}
              </p>
            </div>

            {/* Progress Bar Container */}
            <div
              style={{
                width: '100%',
                height: '8px',
                backgroundColor: '#1f2937',
                borderRadius: '999px',
                overflow: 'hidden',
                margin: '8px 0 4px 0',
              }}
            >
              <div
                style={{
                  width: `${stitchingProgress.percent}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #4285F4 0%, #34A853 100%)',
                  borderRadius: '999px',
                  transition: 'width 0.2s ease-out',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '0.8rem', color: '#6b7280' }}>
              <span>Spherical Blending</span>
              <span style={{ color: '#4285F4', fontWeight: 600 }}>{stitchingProgress.percent}%</span>
            </div>
          </div>
        </div>
      )}

      {/* Stitching Error Alert Dialog */}
      {stitchError && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 101,
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '360px',
              backgroundColor: '#1f2937',
              borderRadius: '16px',
              border: '1px solid #ef4444',
              padding: '24px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
          >
            <h4 style={{ margin: 0, color: '#ef4444', fontSize: '1.1rem' }}>Stitching Error</h4>
            <p style={{ margin: 0, color: '#d1d5db', fontSize: '0.88rem' }}>{stitchError}</p>
            <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
              <button
                onClick={() => setStitchError(null)}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid #4b5563',
                  background: 'transparent',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                Dismiss
              </button>
              <button
                onClick={handleOpenResults}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#4285F4',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interactive 360 Output Viewer Matching Real Work Output */}
      {showResultModal && (
        <InteractivePhotoSphereViewer
          imageUrl={stitchedPanoData?.url}
          sourceCanvas={stitchedPanoData?.url ? undefined : engineRef.current?.masterPanoCanvas}
          title="360° Photo Sphere"
          subtitle={`${stitchedPanoData?.coveragePercent || coveragePercent}% Coverage • ${engineRef.current?.capturedCount || 34} Photos${
            stitchedPanoData?.warning ? ` • ${stitchedPanoData.warning}` : ''
          }`}
          onSaveEvidence={handleSaveEvidence}
          onClose={() => setShowResultModal(false)}
        />
      )}

      {/* Alignment CSS Animations */}
      <style>{`
        #center-blue-dot.aligned {
          opacity: 0.92 !important;
          transform: scale(1) !important;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
