import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { X, RefreshCw, Undo2, Check, Download, Globe, Orbit, Image as ImageIcon } from 'lucide-react';
import { photoSphereStorage } from './storage/PhotoSphereStorage';
import {
  PHOTO_SPHERE_TARGETS,
  getStabilizedYawPitch,
  lerpAngleDeg,
  projectWorldToScreen,
  BOX_FOV_X,
  BOX_FOV_Y,
} from './PhotoSphereTargets';

const RETICLE_CIRCUMFERENCE = 138.23;

const CONFIG = {
  ALIGNMENT_THRESHOLD_DEG: 4.8,
  MAX_ANGULAR_VELOCITY: 45.0,
  HOLD_DURATION_MS: 320,
  CAPTURE_FOV_H_DEG: 44,
  CAPTURE_FOV_V_DEG: 54,
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
  const [activeResultTab, setActiveResultTab] = useState('360'); // '360' | 'planet' | 'equirect'
  const [cameraFacingMode, setCameraFacingMode] = useState('environment');
  const [coveragePercent, setCoveragePercent] = useState(0);
  const [needsGyroPermission, setNeedsGyroPermission] = useState(
    () => typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'
  );

  // Internal Engine State Reference
  const engineRef = useRef({
    scene: null,
    camera: null,
    renderer: null,
    sphereMesh: null,
    sphereTexture: null,
    targetGroup: null,
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
      color: isGapDot ? 0x66b2ff : 0xaaaaaa,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
    });
    const mesh = new THREE.Mesh(dotGeo, dotMat);
    mesh.position.copy(pos);
    mesh.visible = visibleInitially;
    eng.targetGroup.add(mesh);

    const yawDeg = targetMeta ? targetMeta.yaw : THREE.MathUtils.radToDeg(yawRad);
    const pitchDeg = targetMeta ? targetMeta.pitch : THREE.MathUtils.radToDeg(pitchRad);

    const target = {
      id,
      targetId: targetMeta ? targetMeta.id : `t_${id}`,
      dotNumber: targetMeta ? targetMeta.dotNumber : id,
      region: targetMeta ? targetMeta.region : (isGapDot ? 'gap' : 'horizon'),
      yaw: yawDeg,
      pitch: pitchDeg,
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

  // Initialize Lattice from PHOTO_SPHERE_TARGETS (All 33 Dots + Anchor Frame)
  function initTargetLattice() {
    const eng = engineRef.current;
    eng.targets = [];
    eng.targetGroup.clear();

    PHOTO_SPHERE_TARGETS.forEach((t) => {
      const yawRad = THREE.MathUtils.degToRad(t.yaw);
      const pitchRad = THREE.MathUtils.degToRad(t.pitch);
      const isCenterStartDot = t.dotNumber === 0;
      spawnTargetDot(t.dotNumber, yawRad, pitchRad, isCenterStartDot, false, t);
    });

    updateFrontierAndGapDots();
  }

  // Update Frontier Unlocking & Auto-Retire Covered Dots
  function updateFrontierAndGapDots() {
    const eng = engineRef.current;
    if (!eng.coverageGrid) return;

    let totalWeight = 0;
    let coveredWeight = 0;

    for (let gy = 0; gy < CONFIG.COVERAGE_LAT_STEPS; gy++) {
      const lat = (0.5 - (gy + 0.5) / CONFIG.COVERAGE_LAT_STEPS) * Math.PI;
      const w = Math.cos(lat);
      for (let gx = 0; gx < CONFIG.COVERAGE_LON_STEPS; gx++) {
        totalWeight += w;
        if (eng.coverageGrid[gy * CONFIG.COVERAGE_LON_STEPS + gx] === 1) {
          coveredWeight += w;
        }
      }
    }
    eng.coveragePercent = Math.min(100, Math.round((coveredWeight / totalWeight) * 100));
    setCoveragePercent(eng.coveragePercent);

    if (eng.historyStack.length === 0) {
      eng.targets.forEach((t, idx) => {
        t.captured = false;
        t.visible = idx === 0;
        t.mesh.visible = idx === 0;
      });
      updateHUD();
      return;
    }

    const capturedTargets = eng.targets.filter((t) => t.captured);

    eng.targets.forEach((t) => {
      if (t.captured) {
        t.mesh.visible = false;
        return;
      }

      const centerCov = getLocalCoverageRatio(t.yawRad, t.pitchRad, 10);
      if (centerCov >= 0.96) {
        t.captured = true;
        t.visible = false;
        t.mesh.visible = false;
        return;
      }

      let isImmediateNeighbor = false;
      for (const cap of capturedTargets) {
        const ang = THREE.MathUtils.radToDeg(
          Math.acos(THREE.MathUtils.clamp(t.direction.dot(cap.direction), -1, 1))
        );
        if (ang <= 52) {
          isImmediateNeighbor = true;
          break;
        }
      }

      t.visible = isImmediateNeighbor || t.isGapDot;
      t.mesh.visible = t.visible;
    });

    const activeVisible = eng.targets.filter((t) => !t.captured && t.visible);
    if (activeVisible.length === 0 && eng.coveragePercent < 99) {
      const gap = findLargestUncapturedGap();
      if (gap) {
        spawnTargetDot(eng.targets.length, gap.yawRad, gap.pitchRad, true, true);
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

    eng.masterPanoCtx.putImageData(dstImageData, 0, 0);
    eng.sphereTexture.needsUpdate = true;

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
    target.captured = true;
    target.visible = false;
    target.mesh.visible = false;

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

    // Save snapped tile in capturedTiles (Fix 3: snap to target.yaw, target.pitch)
    eng.capturedTiles.push({
      targetId: target.id,
      dotNumber: target.dotNumber !== undefined ? target.dotNumber : target.id,
      yaw: target.yaw,
      pitch: target.pitch,
      canvas: tileCanvas,
      width: cropW,
      height: cropH,
    });

    // 2. Paint frame into 3D sphere texture using exact target pose & zero roll
    const targetYawRad = (target.yaw * Math.PI) / 180;
    const targetPitchRad = (target.pitch * Math.PI) / 180;
    projectLiveCameraFrameOntoSphere(tileCanvas, targetYawRad, targetPitchRad);

    // 3. Save uncropped tile frame to IndexedDB
    try {
      tileCanvas.toBlob(async (blob) => {
        if (blob) {
          eng.capturedCount++;
          await photoSphereStorage.saveFrame({
            id: `frame_${target.id}_${Date.now()}`,
            sessionId: eng.sessionId,
            targetId: target.targetId || `t_${target.dotNumber !== undefined ? target.dotNumber : target.id}`,
            sequenceIndex: target.dotNumber !== undefined ? target.dotNumber : target.id,
            yaw: target.yaw,
            pitch: target.pitch,
            roll: 0,
            quaternion: [0, 0, 0, 1],
            blob,
            width: cropW,
            height: cropH,
            capturedAt: Date.now(),
          });
        }
      }, 'image/jpeg', 0.92);
    } catch (err) {
      console.warn('Could not persist frame to IndexedDB:', err);
    }

    updateFrontierAndGapDots();
    resetHoldProgress();

    setTimeout(() => {
      eng.isCapturing = false;
    }, 160);
  }, []);

  // Render Unified Live 2D Stage (Fix 2 & Fix 3)
  function renderLiveStage() {
    const eng = engineRef.current;
    const canvas = webglCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    const W = canvas.width;
    const H = canvas.height;

    // Viewfinder box size: clamp(220, 42vw, 280) with 3:4 aspect ratio
    const boxWidth = Math.min(Math.max(220, W * 0.42), 280);
    const boxHeight = boxWidth * (4 / 3);
    eng.currentBoxWidth = boxWidth;
    eng.currentBoxHeight = boxHeight;

    // 1. Dark 3D stage background
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, W, H);

    const curYaw = eng.camYaw;
    const curPitch = eng.camPitch;

    // 2. Render all captured photo tiles at (screenX, screenY) with width boxWidth, height boxHeight (0° rotation)
    if (eng.capturedTiles && eng.capturedTiles.length > 0) {
      for (const tile of eng.capturedTiles) {
        const proj = projectWorldToScreen(
          tile.yaw,
          tile.pitch,
          curYaw,
          curPitch,
          W,
          H,
          boxWidth,
          boxHeight
        );
        if (!proj) continue;

        const x = Math.round(proj.screenX - boxWidth / 2);
        const y = Math.round(proj.screenY - boxHeight / 2);

        ctx.save();
        ctx.drawImage(tile.canvas, x, y, boxWidth, boxHeight);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, boxWidth, boxHeight);
        ctx.restore();
      }
    }

    // 3. Render all uncaptured visible target dots using the exact same projection!
    for (const target of eng.targets) {
      if (target.captured) continue; // FIX 4: Permanently hide captured dots!
      if (!target.visible) continue;

      const proj = projectWorldToScreen(
        target.yaw,
        target.pitch,
        curYaw,
        curPitch,
        W,
        H,
        boxWidth,
        boxHeight
      );
      if (!proj) continue;

      const r = target.isGapDot ? 16 : 15; // 30px-32px diameter
      ctx.save();
      ctx.beginPath();
      ctx.arc(proj.screenX, proj.screenY, r, 0, 2 * Math.PI);
      ctx.fillStyle = target.isGapDot ? '#66b2ff' : '#aaaaaa';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.stroke();

      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 8;
      ctx.restore();
    }
  }

  // Strict Hold-Steady Lock & Dot Alignment (Fix 4)
  function evaluateDotAlignment(timestamp) {
    const eng = engineRef.current;
    const canvas = webglCanvasRef.current;
    if (!canvas) return;

    const viewportW = canvas.width || window.innerWidth;
    const viewportH = canvas.height || window.innerHeight;
    const centerX = viewportW / 2;
    const centerY = viewportH / 2;
    const boxWidth = eng.currentBoxWidth || 240;
    const boxHeight = eng.currentBoxHeight || 320;

    let closest = null;
    let minScreenDist = Infinity;
    let closestProj = null;

    for (const t of eng.targets) {
      if (t.captured || !t.visible) continue;

      const proj = projectWorldToScreen(
        t.yaw,
        t.pitch,
        eng.camYaw,
        eng.camPitch,
        viewportW,
        viewportH,
        boxWidth,
        boxHeight
      );
      if (!proj) continue;

      const dist = Math.hypot(proj.screenX - centerX, proj.screenY - centerY);
      if (dist < minScreenDist) {
        minScreenDist = dist;
        closest = t;
        closestProj = proj;
      }
    }

    const centerBlueDot = centerBlueDotRef.current;
    const ringProgress = ringProgressRef.current;
    const banner = instructionBannerRef.current;

    // Strict Hold-Steady Lock: dot inside center circle (< 22px) and angularVelocity < 15
    const isInsideReticle = closest && minScreenDist < 22;
    const isMovingTooFast = (eng.angularVelocity || 0) > 15;

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

      const progress = Math.min(1, (timestamp - eng.holdStartTime) / 350);

      // Smoothly pull blue dot toward exact center (centerX, centerY)
      if (centerBlueDot) {
        centerBlueDot.style.opacity = '1';
        const pullFactor = Math.min(1, progress * 1.5);
        const pullX = (closestProj.screenX - centerX) * (1 - pullFactor);
        const pullY = (closestProj.screenY - centerY) * (1 - pullFactor);
        centerBlueDot.style.transform = `translate(calc(-50% + ${pullX.toFixed(1)}px), calc(-50% + ${pullY.toFixed(1)}px)) scale(${0.7 + 0.3 * progress})`;
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
        centerBlueDot.style.transform = 'translate(-50%, -50%) scale(0.4)';
      }
      resetHoldProgress();

      if (banner) {
        if (eng.coveragePercent >= 99) {
          banner.textContent = '360° Complete! Tap the checkmark ✓';
        } else if (eng.capturedTiles && eng.capturedTiles.length === 0) {
          banner.textContent = 'To start, keep center dot inside circle';
        } else {
          banner.textContent = 'Aim camera at the next dot to unlock that surface';
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
  const handleUndo = () => {
    const eng = engineRef.current;
    const last = eng.historyStack.pop();
    if (!last) return;

    eng.masterPanoCtx.putImageData(last.prevPanoImage, 0, 0);
    eng.coverageGrid.set(last.prevCoverage);
    if (last.prevAccumR && eng.panoAccumR) {
      eng.panoAccumR.set(last.prevAccumR);
      eng.panoAccumG.set(last.prevAccumG);
      eng.panoAccumB.set(last.prevAccumB);
      eng.panoAccumW.set(last.prevAccumW);
    }
    eng.sphereTexture.needsUpdate = true;

    eng.targets.forEach((t) => {
      t.captured = getLocalCoverageRatio(t.yawRad, t.pitchRad, 10) >= 0.96;
    });
    updateFrontierAndGapDots();
  };

  // Reset Session
  const handleReset = () => {
    const eng = engineRef.current;
    eng.initialAlphaOffset = null;
    eng.initialBetaOffset = null;
    eng.initialGammaOffset = null;
    eng.lastOrientTime = null;
    eng.angularVelocity = 0;
    eng.yaw = 0;
    eng.pitch = 0;
    updateCameraFromYawPitch();

    eng.coverageGrid = new Uint8Array(CONFIG.COVERAGE_LON_STEPS * CONFIG.COVERAGE_LAT_STEPS);
    eng.coveragePercent = 0;
    eng.historyStack = [];
    eng.masterPanoCtx.fillStyle = '#121212';
    eng.masterPanoCtx.fillRect(0, 0, CONFIG.PANO_WIDTH, CONFIG.PANO_HEIGHT);
    if (eng.panoAccumR) {
      eng.panoAccumR.fill(0);
      eng.panoAccumG.fill(0);
      eng.panoAccumB.fill(0);
      eng.panoAccumW.fill(0);
    }
    if (eng.sphereTexture) eng.sphereTexture.needsUpdate = true;

    initTargetLattice();
  };

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

  // Open Results Screen
  const handleOpenResults = () => {
    const eng = engineRef.current;
    if (equirectPreviewCanvasRef.current && eng.masterPanoCanvas) {
      const eqCtx = equirectPreviewCanvasRef.current.getContext('2d');
      eqCtx.drawImage(eng.masterPanoCanvas, 0, 0);
    }
    generateTinyPlanet();
    setShowResultModal(true);
    setTimeout(() => {
      initInteractive360Viewer();
    }, 50);
  };

  // Save Final Evidence & Close
  const handleSaveEvidence = async () => {
    const eng = engineRef.current;
    if (!eng.masterPanoCanvas) return;

    eng.masterPanoCanvas.toBlob(async (rawBlob) => {
      if (!rawBlob) return;
      const xmpBlob = await injectXmpIntoJpeg(rawBlob, {
        isCompleteSphere: eng.coveragePercent >= 90,
      });

      const panoRecord = await photoSphereStorage.savePanorama({
        sessionId: eng.sessionId,
        inspectionId: taskId,
        blob: xmpBlob,
        width: CONFIG.PANO_WIDTH,
        height: CONFIG.PANO_HEIGHT,
        isCompleteSphere: eng.coveragePercent >= 90,
        metadata: {
          coveragePercent: eng.coveragePercent,
          stitchedAt: Date.now(),
        },
      });

      if (onSaveEvidence) {
        onSaveEvidence({
          mediaType: 'photo_sphere',
          evidenceType: '360 Photo Sphere',
          blob: xmpBlob,
          url: URL.createObjectURL(xmpBlob),
          id: panoRecord.id,
          coveragePercent: eng.coveragePercent,
          framesCount: eng.capturedCount,
          sessionId: eng.sessionId,
        });
      }
      onClose();
    }, 'image/jpeg', 0.95);
  };

  // Main Mount Lifecycle
  useEffect(() => {
    const eng = engineRef.current;

    // Create session in IndexedDB
    photoSphereStorage.createSession(taskId, { totalTargets: 34 }).then((s) => {
      eng.sessionId = s.id;
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

    // Setup 2D Live Stage Canvas
    if (webglCanvasRef.current) {
      webglCanvasRef.current.width = window.innerWidth;
      webglCanvasRef.current.height = window.innerHeight;
    }

    initTargetLattice();

    // Resize Handler
    const handleResize = () => {
      if (webglCanvasRef.current) {
        webglCanvasRef.current.width = window.innerWidth;
        webglCanvasRef.current.height = window.innerHeight;
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

    // Gyroscope DeviceOrientation Binding with Horizon-Locked ZXY Looking Direction (Fix 1)
    const onDeviceOrientation = (e) => {
      if (e.alpha === null || e.beta === null) return;
      eng.useGyro = true;

      // Extract clean, horizon-locked yaw and pitch without wrist roll (gamma)
      const { yaw: rawYaw, pitch: rawPitch } = getStabilizedYawPitch(e.alpha, e.beta, e.gamma);

      // Lock initial reference orientation when opening capture mode
      if (eng.initialYaw === null) {
        eng.initialYaw = rawYaw;
        eng.camYaw = 0;
        eng.camPitch = rawPitch;
      }

      // Compass-free relative yaw anchored to starting frame
      const targetYaw = ((rawYaw - eng.initialYaw + 540) % 360) - 180;
      const targetPitch = THREE.MathUtils.clamp(rawPitch, -89, 89);

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

    if (
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
      if (eng.renderer) {
        eng.renderer.dispose();
      }
      if (eng.viewerRenderer) {
        eng.viewerRenderer.dispose();
      }
    };
  }, [renderLoop, startHardwareCamera, taskId]);

  return (
    <div
      ref={containerRef}
      className="photosphere-stage"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100dvh',
        backgroundColor: '#0d0d0d',
        color: '#ffffff',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
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
      {/* 3D WebGL Canvas */}
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

      {/* Top HUD */}
      <div
        style={{
          position: 'absolute',
          top: 'max(14px, env(safe-area-inset-top, 14px))',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          width: 'calc(100% - 24px)',
          maxWidth: '480px',
          justifyContent: 'space-between',
        }}
      >
        <div
          style={{
            background: 'rgba(16, 16, 16, 0.82)',
            backdropFilter: 'blur(10px)',
            padding: '7px 14px',
            borderRadius: '999px',
            fontSize: '0.8rem',
            display: 'flex',
            gap: '8px',
            alignItems: 'center',
            border: '1px solid rgba(255, 255, 255, 0.18)',
          }}
        >
          <span ref={coverageBadgeRef} style={{ color: '#4285F4', fontWeight: 'bold' }}>
            0% Captured
          </span>
          <span style={{ color: 'rgba(255, 255, 255, 0.3)' }}>•</span>
          <span ref={targetsBadgeRef}>Center Dot Ready</span>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleFlipCamera}
            style={{
              background: 'rgba(28, 28, 28, 0.85)',
              color: '#ffffff',
              border: '1px solid rgba(255, 255, 255, 0.25)',
              padding: '7px 14px',
              borderRadius: '999px',
              fontSize: '0.78rem',
              fontWeight: 500,
              cursor: 'pointer',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              touchAction: 'manipulation',
            }}
            title="Switch Front/Rear Camera"
          >
            <RefreshCw size={14} /> Flip Camera
          </button>

          <button
            onClick={onClose}
            style={{
              background: 'rgba(28, 28, 28, 0.85)',
              color: '#ffffff',
              border: '1px solid rgba(255, 255, 255, 0.25)',
              padding: '7px',
              borderRadius: '50%',
              cursor: 'pointer',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '34px',
              height: '34px',
              touchAction: 'manipulation',
            }}
            title="Exit Photo Sphere"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* iOS Gyroscope Permission Prompt Banner */}
      {needsGyroPermission && (
        <div
          style={{
            position: 'absolute',
            top: 'max(70px, calc(env(safe-area-inset-top, 0px) + 64px))',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 25,
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

      {/* Instruction Banner */}
      <div
        ref={instructionBannerRef}
        style={{
          position: 'absolute',
          top: needsGyroPermission
            ? 'max(136px, calc(env(safe-area-inset-top, 0px) + 128px))'
            : 'max(68px, calc(env(safe-area-inset-top, 0px) + 58px))',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          textAlign: 'center',
          fontSize: '0.98rem',
          fontWeight: 500,
          color: 'rgba(255, 255, 255, 0.95)',
          textShadow: '0 2px 8px rgba(0, 0, 0, 0.9)',
          pointerEvents: 'none',
          width: '88%',
          transition: 'top 0.2s ease',
        }}
      >
        To start, keep center dot inside circle
      </div>

      {/* The centered white-bordered camera viewfinder box (exact distance from video & screenshot) */}
      <div
        className="camera-viewfinder-box"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'clamp(220px, 42vw, 280px)',
          aspectRatio: '3 / 4',
          border: '2px solid rgba(255, 255, 255, 0.85)',
          boxShadow: '0 0 24px rgba(0, 0, 0, 0.6)',
          borderRadius: '4px',
          overflow: 'hidden',
          zIndex: 5,
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
            objectFit: 'contain', // CRITICAL: Shows full uncropped sensor, zero artificial zoom!
            display: 'block',
            pointerEvents: 'none',
          }}
        />

        {/* Fixed center target ring inside the viewfinder box */}
        <div
          className="center-reticle-ring"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: '54px',
            height: '54px',
            transform: 'translate(-50%, -50%)',
            border: '2.5px solid rgba(255, 255, 255, 0.9)',
            borderRadius: '50%',
            pointerEvents: 'none',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxSizing: 'border-box',
          }}
        >
          <svg
            width="54"
            height="54"
            viewBox="0 0 54 54"
            style={{ position: 'absolute', transform: 'rotate(-90deg)', zIndex: 2 }}
          >
            <circle
              ref={ringProgressRef}
              cx="27"
              cy="27"
              r="22"
              fill="none"
              stroke="#4285F4"
              strokeWidth="4"
              strokeDasharray={String(RETICLE_CIRCUMFERENCE)}
              strokeDashoffset={String(RETICLE_CIRCUMFERENCE)}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 0.05s linear' }}
            />
          </svg>
          <div
            ref={centerBlueDotRef}
            id="center-blue-dot"
            style={{
              position: 'absolute',
              width: '30px',
              height: '30px',
              borderRadius: '50%',
              background: '#4285F4',
              opacity: 0,
              transform: 'scale(0.4)',
              transition: 'opacity 0.14s ease, transform 0.14s ease',
              zIndex: 1,
            }}
          />
        </div>
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

      {/* Bottom Controls */}
      <div
        style={{
          position: 'absolute',
          bottom: 'max(30px, calc(env(safe-area-inset-bottom, 0px) + 20px))',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: '32px',
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
            border: '1.8px solid rgba(255, 255, 255, 0.78)',
            background: 'rgba(20, 20, 20, 0.65)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: canUndo ? 'pointer' : 'not-allowed',
            opacity: canUndo ? 1 : 0.32,
            transition: 'all 0.2s ease',
            backdropFilter: 'blur(6px)',
            touchAction: 'manipulation',
          }}
          title="Undo Last Capture"
        >
          <Undo2 size={22} />
        </button>

        {/* Finish & Stitch Button */}
        <button
          onClick={handleOpenResults}
          disabled={!canFinish}
          style={{
            width: '68px',
            height: '68px',
            borderRadius: '50%',
            border: '2.2px solid rgba(255, 255, 255, 0.95)',
            background: canFinish ? '#1a73e8' : 'rgba(255, 255, 255, 0.15)',
            boxShadow: canFinish ? '0 0 22px rgba(26, 115, 232, 0.85)' : 'none',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: canFinish ? 'pointer' : 'not-allowed',
            opacity: canFinish ? 1 : 0.4,
            transition: 'all 0.2s ease',
            backdropFilter: 'blur(6px)',
            touchAction: 'manipulation',
          }}
          title="Finish & Stitch 360° Photo Sphere"
        >
          <Check size={32} strokeWidth={2.8} />
        </button>

        {/* Reset Button */}
        <button
          onClick={handleReset}
          style={{
            width: '52px',
            height: '52px',
            borderRadius: '50%',
            border: '1.8px solid rgba(255, 255, 255, 0.78)',
            background: 'rgba(20, 20, 20, 0.65)',
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            backdropFilter: 'blur(6px)',
            touchAction: 'manipulation',
          }}
          title="Reset All Captures"
        >
          <X size={22} />
        </button>
      </div>

      {/* Result Viewer Modal */}
      {showResultModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(10, 10, 10, 0.94)',
            backdropFilter: 'blur(12px)',
            zIndex: 90,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'max(10px, env(safe-area-inset-top, 10px)) 10px max(14px, env(safe-area-inset-bottom, 14px)) 10px',
          }}
        >
          <div
            style={{
              background: '#181818',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '16px',
              width: '100%',
              maxWidth: '960px',
              height: '100%',
              maxHeight: 'min(92dvh, 850px)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid #2c2c2c',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              <h3 style={{ fontSize: '1.05rem', fontWeight: 600, margin: 0 }}>Stitched 360° Photo Sphere</h3>
              <div
                style={{
                  display: 'flex',
                  gap: '6px',
                  overflowX: 'auto',
                  WebkitOverflowScrolling: 'touch',
                  scrollbarWidth: 'none',
                }}
              >
                <button
                  onClick={() => {
                    setActiveResultTab('360');
                    setTimeout(() => initInteractive360Viewer(), 50);
                  }}
                  style={{
                    background: activeResultTab === '360' ? '#1a73e8' : '#2a2a2a',
                    color: '#fff',
                    border: 'none',
                    padding: '7px 12px',
                    borderRadius: '8px',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    whiteSpace: 'nowrap',
                    touchAction: 'manipulation',
                  }}
                >
                  <Globe size={15} /> 360°
                </button>
                <button
                  onClick={() => setActiveResultTab('planet')}
                  style={{
                    background: activeResultTab === 'planet' ? '#1a73e8' : '#2a2a2a',
                    color: '#fff',
                    border: 'none',
                    padding: '7px 12px',
                    borderRadius: '8px',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    whiteSpace: 'nowrap',
                    touchAction: 'manipulation',
                  }}
                >
                  <Orbit size={15} /> Tiny Planet
                </button>
                <button
                  onClick={() => setActiveResultTab('equirect')}
                  style={{
                    background: activeResultTab === 'equirect' ? '#1a73e8' : '#2a2a2a',
                    color: '#fff',
                    border: 'none',
                    padding: '7px 12px',
                    borderRadius: '8px',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    whiteSpace: 'nowrap',
                    touchAction: 'manipulation',
                  }}
                >
                  <ImageIcon size={15} /> 2:1 Pano
                </button>
              </div>
            </div>

            {/* Viewer Body */}
            <div
              style={{
                flex: 1,
                position: 'relative',
                background: '#0d0d0d',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                minHeight: '260px',
              }}
            >
              <div
                ref={interactiveViewerContainerRef}
                style={{
                  width: '100%',
                  height: '100%',
                  display: activeResultTab === '360' ? 'block' : 'none',
                  touchAction: 'none',
                }}
              />
              <canvas
                ref={planetCanvasRef}
                width={960}
                height={960}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                  display: activeResultTab === 'planet' ? 'block' : 'none',
                }}
              />
              <canvas
                ref={equirectPreviewCanvasRef}
                width={CONFIG.PANO_WIDTH}
                height={CONFIG.PANO_HEIGHT}
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                  display: activeResultTab === 'equirect' ? 'block' : 'none',
                }}
              />
            </div>

            {/* Footer */}
            <div
              style={{
                padding: '12px 16px',
                borderTop: '1px solid #2c2c2c',
                display: 'flex',
                gap: '8px',
                justifyContent: 'flex-end',
                flexWrap: 'wrap',
                maxHeight: '38vh',
                overflowY: 'auto',
              }}
            >
              <button
                onClick={() => {
                  const canvas = planetCanvasRef.current;
                  if (!canvas) return;
                  const link = document.createElement('a');
                  link.download = `TinyPlanet_360_${Date.now()}.jpg`;
                  link.href = canvas.toDataURL('image/jpeg', 0.95);
                  link.click();
                }}
                style={{
                  background: '#2f2f2f',
                  color: '#fff',
                  border: '1px solid rgba(255, 255, 255, 0.14)',
                  padding: '9px 14px',
                  borderRadius: '10px',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  touchAction: 'manipulation',
                  flex: '1 1 auto',
                }}
              >
                <Download size={15} /> Tiny Planet
              </button>

              <button
                onClick={() => {
                  const eng = engineRef.current;
                  if (!eng.masterPanoCanvas) return;
                  const link = document.createElement('a');
                  link.download = `PhotoSphere_360_${Date.now()}.jpg`;
                  link.href = eng.masterPanoCanvas.toDataURL('image/jpeg', 0.95);
                  link.click();
                }}
                style={{
                  background: '#2f2f2f',
                  color: '#fff',
                  border: '1px solid rgba(255, 255, 255, 0.14)',
                  padding: '9px 14px',
                  borderRadius: '10px',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  touchAction: 'manipulation',
                  flex: '1 1 auto',
                }}
              >
                <Download size={15} /> 360° Photo
              </button>

              <button
                onClick={handleSaveEvidence}
                style={{
                  background: '#1a73e8',
                  color: '#fff',
                  border: 'none',
                  padding: '9px 16px',
                  borderRadius: '10px',
                  fontSize: '0.84rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  boxShadow: '0 0 16px rgba(26, 115, 232, 0.5)',
                  touchAction: 'manipulation',
                  flex: '2 1 auto',
                }}
              >
                <Check size={17} /> Save Evidence
              </button>

              <button
                onClick={() => setShowResultModal(false)}
                style={{
                  background: '#242424',
                  color: '#ccc',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  padding: '9px 14px',
                  borderRadius: '10px',
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  touchAction: 'manipulation',
                  flex: '1 1 auto',
                  textAlign: 'center',
                }}
              >
                Keep Capturing
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alignment CSS Animations */}
      <style>{`
        #center-blue-dot.aligned {
          opacity: 0.92 !important;
          transform: scale(1) !important;
        }
      `}</style>
    </div>
  );
}
