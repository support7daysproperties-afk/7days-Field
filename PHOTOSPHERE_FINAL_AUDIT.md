# Final Photo Sphere Audit & Verification Report

**Project:** `E:\Vanji\7days-Field`  
**Reference Specification & APK Extraction:** `C:\Users\vanji\OneDrive\Documents\APK`  
**Audit Date:** October 2026  
**Auditor:** Antigravity Agentic Pair Programmer  
**Status:** Audit Complete — No New Features Added

---

## 1. Executive Summary & Verification Status Matrix

Each major capability of the Photo Sphere feature inside `E:\Vanji\7days-Field` was audited using explicit criteria: automated tests, source code inspection, and architectural boundary analysis.

| Feature / Capability | Implementation Verification Status | Evidence / Verification Method |
|---|---|---|
| **Rear Camera Viewfinder** | **Verified by source inspection** | HTML5 `getUserMedia` with `{ video: { facingMode: 'environment' } }` and fallback cascade in [`PhotoSphereCapture.jsx`](file:///e:/Vanji/7days-Field/src/features/photo-sphere/PhotoSphereCapture.jsx). |
| **Rigid 3D Target Vector Math** | **Verified by automated test** | Unit tests in [`tests/photosphere.test.js`](file:///e:/Vanji/7days-Field/tests/photosphere.test.js) test world unit vector transform, inverse camera matrix multiplication, and roll invariance. |
| **Single Active Blue Dot Cardinality** | **Verified by automated test & source** | State machine in [`PhotoSphereCapture.jsx`](file:///e:/Vanji/7days-Field/src/features/photo-sphere/PhotoSphereCapture.jsx) isolates `activeTargetId`; [`TargetDotsOverlay.jsx`](file:///e:/Vanji/7days-Field/src/features/photo-sphere/components/TargetDotsOverlay.jsx) renders strictly one blue dot. |
| **Zero Green Floating Dots** | **Verified by source inspection** | Green dot rendering for captured targets was completely removed; captured targets are tracked internally only. |
| **Frustum / Behind-Camera Culling** | **Verified by automated test** | `tests/photosphere.test.js` tests that targets behind the lens plane ($Z_{\text{cam}} \ge -0.05$) return `visible: false` and coordinates `(-9999, -9999)`. |
| **Alignment Tolerance ($\le 3.0^\circ$)** | **Verified by automated test & source** | Threshold constant in [`PhotoSphereCapture.jsx:L341`](file:///e:/Vanji/7days-Field/src/features/photo-sphere/PhotoSphereCapture.jsx#L341) matches GCam's native `SetTargetHitAngleRadians`. |
| **Motion Speed Guard** | **Verified by source inspection** | [`PhotoSphereOrientation.js:L111`](file:///e:/Vanji/7days-Field/src/features/photo-sphere/PhotoSphereOrientation.js#L111) calculates $\Delta\theta/\Delta t$; flags `isMovingTooFast = true` when $> 45^\circ/\text{s}$, blocking auto-capture. |
| **Single-Fire Auto-Capture Lock** | **Verified by source inspection** | `isCapturing` lock state and hold-time interval (280ms) prevent duplicate shutter triggers. |
| **Offline IndexedDB Persistence** | **Verified by source inspection** | [`PhotoSphereStorage.js`](file:///e:/Vanji/7days-Field/src/features/photo-sphere/storage/PhotoSphereStorage.js) persists frame blobs, timestamps, angles, and stitched panoramas in `PhotoSphereDB`. |
| **Equirectangular Image Projection** | **Partially implemented (Approximate)** | Maps frames onto 2:1 canvas using spherical coordinates and cosine feathering. **Does not perform feature-based bundle adjustment.** |
| **Google Photo Sphere XMP Injection** | **Verified by automated test** | [`tests/photosphere_xmp_stitcher.test.js`](file:///e:/Vanji/7days-Field/tests/photosphere_xmp_stitcher.test.js) tests valid APP1 marker, RDF/XML schema, and roundtrip GPano tag parsing. |
| **Three.js Motion-Sensor Viewer** | **Verified by source inspection** | [`MotionSensorViewer.jsx`](file:///e:/Vanji/7days-Field/src/features/photo-sphere/components/MotionSensorViewer.jsx) maps `deviceorientation` to internal inverted sphere with Three.js WebGL disposal. |
| **Stereoscopic Cardboard VR Viewer** | **Verified by source inspection** | [`VRViewer.jsx`](file:///e:/Vanji/7days-Field/src/features/photo-sphere/components/VRViewer.jsx) implements dual-camera split-screen with $64\text{mm}$ IPD offset and WebGL cleanup. |
| **Physical Device Verification** | **Not verified (Pending user device test)** | Automated tests confirm web APIs and math, but camera/IMU hardware performance requires live testing on an Android phone. |

---

## 2. Actual Stitching Algorithm & Identified Limitations

### 2.1 How the Current Stitcher Operates
In [`PhotoSphereStitcher.js`](file:///e:/Vanji/7days-Field/src/features/photo-sphere/PhotoSphereStitcher.js):
1. **Geometric Coordinate Mapping:**
   - Evaluates frame sequence coverage via `evaluateCoverage()`.
   - Projects each photo onto an equirectangular canvas ($2048 \times 1024$ or $4096 \times 2048$, 2:1 ratio) centered at:
     $$\text{centerX} = \frac{\text{yaw}_{\text{norm}}}{360} \cdot W_{\text{pano}}, \quad \text{centerY} = \frac{90 - \text{pitch}}{180} \cdot H_{\text{pano}}$$
2. **Polar Aspect Compensation:**
   - Scales horizontal frame width by $\frac{1}{\cos(\text{pitch})}$ (clamped at $\ge 0.12$) to accommodate equirectangular metric stretching near the poles.
3. **Cosine Alpha-Feathering:**
   - Applies a radial gradient mask (`0.22r` to `0.50r`) via `destination-in` so overlapping frames blend smoothly rather than leaving harsh edges.
4. **Horizontal Seam Wraparound:**
   - Frames straddling the $0^\circ / 360^\circ$ azimuth boundary are drawn at $x \pm W_{\text{pano}}$ to prevent border seams.

### 2.2 What the Stitcher Does NOT Do (Technical Limitations)
- **No Non-Linear Bundle Adjustment:** Unlike Google Camera's native `liblightcycle.so` (which runs Ceres Solver non-linear optimization with `BundleAdjusterGlobalFocalLength` and `PatchPairwiseMatcher`), the web stitcher **does not extract SIFT/ORB features or register pixel correspondences**.
- **Parallax Sensitivity:** If the phone is translated (not purely rotated about the camera's optical center) during capture, parallax misalignment will appear as ghosting or doubled objects in overlapping areas.
- **Exposure Compensation:** The current stitcher relies on the phone's auto-exposure; it does not compute gain/exposure leveling across tiles.

---

## 3. JPEG & GPano XMP Metadata Validation Evidence

In [`PhotoSphereXMP.js`](file:///e:/Vanji/7days-Field/src/features/photo-sphere/PhotoSphereXMP.js):
1. **Valid Binary JPEG Packaging:**
   - Injected into standard JPEG binary structure directly following SOI (`0xFFD8`) and APP0 JFIF without corrupting quantization or image scan markers.
   - Total APP1 segment size is typically ~900–1,100 bytes, well within the JPEG APP1 $65,535$-byte limit.
2. **Conforming XML Schema:**
   - Injected RDF/XML uses standard namespace `xmlns:GPano="http://ns.google.com/photos/1.0/panorama/"`.
   - Full panorama dimensions (`FullPanoWidthPixels`, `FullPanoHeightPixels`) match the actual 2:1 canvas.
   - Crop tags (`CroppedAreaImageWidthPixels`, `CroppedAreaImageHeightPixels`, `CroppedAreaTopPixels`) reflect true vertical span.
   - `IsPhotosphere` is set to `"True"` **only** when all 24+ shots including zenith and nadir are captured; set to `"False"` for partial sweeps.
3. **Automated Verification:**
   - `tests/photosphere_xmp_stitcher.test.js` tests round-trip injection into a valid JPEG binary and extraction via `extractGPanoMetadataFromJpeg()`.

---

## 4. Test Suite & Production Build Results

### 4.1 Vitest Automated Test Run:
```bash
npx vitest run
```
```
 ✓ tests/photosphere.test.js (10 tests) 6ms
 ✓ tests/photosphere_xmp_stitcher.test.js (5 tests) 5ms
 ✓ tests/land360.test.js (69 tests) 19ms

 Test Files  3 passed (3)
      Tests  84 passed (84)
   Duration  250ms
```

### 4.2 Production Build Verification:
```bash
npm run build
```
```
✓ 1989 modules transformed.
dist/index.html                     0.46 kB │ gzip:   0.29 kB
dist/assets/index-WSvp1-Wd.css     21.46 kB │ gzip:   8.13 kB
dist/assets/index-DVOr2eJR.js   1,400.23 kB │ gzip: 375.62 kB
✓ built in 798ms
```

---

## 5. Defects Found and Fixed During the Rebuild

1. **Scattered Multi-Dot Bug:** Replaced global target mapping with single active target state machine.
2. **Competing Green Dot Bug:** Removed on-screen rendering of captured targets.
3. **Erratic Non-Linear Target Sliding:** Replaced Euler angle subtraction with 3D rotation matrix projection.
4. **Behind-Camera Ghost Dots:** Added rigid plane culling ($Z_{\text{cam}} \ge -0.05 \implies \text{culled}$).
5. **Memory Leak in Three.js Viewers:** Added comprehensive WebGL resource cleanup (`geometry.dispose()`, `material.dispose()`, `texture.dispose()`, `renderer.dispose()`) on unmount.

---

## 6. Real-Device Physical Test Checklist (For Field Supervisor Android Devices)

To substantiate final end-to-end device behavior on a physical Android phone:

1. **Connection & SSL:**
   - Open Chrome on Android: `https://<YOUR-IP>:5173`.
   - Verify camera and motion sensor permission dialogs appear and can be accepted.
2. **Initial Target Check:**
   - Ensure exactly ONE blue target dot appears centered with the reticle on launch.
   - Verify no green dot is visible.
3. **Physical Rotation Test:**
   - Turn phone $90^\circ$ right: target moves left across the screen.
   - Turn phone $180^\circ$ away: target disappears completely (does not float in viewport).
   - Turn back: target reappears smoothly at the screen edge.
4. **Auto-Capture & Stability Test:**
   - Align reticle with blue dot. Hold still: green ring fills and shutter captures automatically.
   - Shake phone while aligned: "Hold camera still • Moving too fast" warning appears and capture is blocked.
5. **Persistence & Stitching:**
   - Complete 10–30 shots, tap "Finish".
   - Confirm equirectangular 360° panorama displays in result screen.
   - Tap "Motion View": turn phone in real life to look around the virtual room.
   - Tap "VR View": verify split-screen stereoscopic view for Cardboard.
   - Refresh page: verify session and panorama remain accessible in history.
