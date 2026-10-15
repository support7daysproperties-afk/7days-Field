# Architecture Decision Record: 360° Photo Sphere Capture & Stitching Engine

## 1. Overview & Context
This document specifies the technical architecture for the brand-new, end-to-end 360° Photo Sphere feature in the **7Days Field Supervisor** application, adhering to the technical reference repository [`n30dyn4m1c/360-photo-app`](https://github.com/n30dyn4m1c/360-photo-app).

Per requirements:
- **No legacy code reuse:** None of the previous `src/lib/land360/*` or old capture components are reused, extended, or patched.
- **Dedicated module structure:** All new code resides under `src/features/photo-sphere/`.
- **Platform awareness:** 7Days Field is a responsive web application deployed on Vercel, running on mobile browsers (Chrome / Safari / Edge) as well as within Capacitor containers.

---

## 2. Platform Architecture: Web vs Native Bridge

### Environment Capabilities & Differences
| Capability | Native Reference (`n30dyn4m1c/360-photo-app`) | Web Environment (Vercel / Mobile Browser) | Capacitor Native Bridge (Installed Android/iOS) |
| :--- | :--- | :--- | :--- |
| **Camera Feed** | Android CameraX (`Preview`, `ImageCapture`) | `navigator.mediaDevices.getUserMedia` (`video` element + `OffscreenCanvas` / `Canvas2D`) | Direct WebRTC or CameraX Capacitor Plugin |
| **Field of View (FOV)** | `CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS` | `stream.getVideoTracks()[0].getSettings()` (`aspectRatio`, `width`, `height`); fallback to standard mobile phone lens (~60°–65° HFOV, ~45°–50° VFOV) | Native camera sensor metadata via bridge |
| **Orientation Tracking** | Android `SensorManager.ROTATION_VECTOR` (`getRotationMatrixFromVector`) | DeviceOrientationEvent (`alpha`, `beta`, `gamma` / `deviceorientationabsolute`) with circular smoothing & quaternion/Euler conversion | Native sensor bridge / Capacitor Motion API |
| **Stitching Pipeline** | Native OpenCV C++ / Java bindings | High-performance HTML5 Canvas / WebGL spherical projector & blender with reverse-spherical ray projection; optional OpenCV.js WebAssembly | Native OpenCV module inside native build |
| **GPano Metadata** | JPEG APP1 XMP marker injector (`GPanoXmpInjector`) | Client-side JPEG APP1 XMP binary injector inserting Google Photo Sphere GPano tags losslessy into JPEG blobs | Same binary injector or native file tagger |

### Architecture Decision: Dual-Path Web-First with Native Bridge Readiness
1. **Primary Runtime:** A complete, robust web engine built in modern ES modules with HTML5 Canvas / WebGL, standard `getUserMedia`, `DeviceOrientationEvent` (with fallback compass alignment), and IndexedDB frame/session persistence.
2. **Native Bridge Interface:** A decoupled `CameraAdapter` and `OrientationAdapter` abstraction. When running inside a native Capacitor shell with native camera/sensor plugins installed, the adapter automatically switches to native sensor streams; when running on the web/Vercel, it uses the calibrated browser APIs seamlessly.
3. **No Fake Stubs:** No simulated camera images or dummy orientations. On devices where camera or orientation sensors are denied or unavailable, explicit user guidance and fallback calibration controls are provided.

---

## 3. Core Subsystems & Math Specification

### A. Coordinate System & Sensor Math (`src/features/photo-sphere/orientation/`)
- Coordinate system:
  - **Yaw ($\psi$):** Horizontal rotation / azimuth ($[-180^\circ, +180^\circ]$ or $[0^\circ, 360^\circ]$).
  - **Pitch ($\theta$):** Elevation angle ($[-90^\circ, +90^\circ]$), where $0^\circ$ is the horizontal equator, negative angles point upwards to the zenith (+90°), and positive downward to the nadir (matching the reference app's camera basis conventions).
  - **Roll ($\phi$):** In-plane phone tilt ($[-180^\circ, +180^\circ]$).
- **Target-to-Camera Angular Distance:**
  $$\Delta \theta = \theta_{\text{target}} - \theta_{\text{current}}$$
  $$\Delta \psi = ((\psi_{\text{target}} - \psi_{\text{current}} + 180^\circ) \pmod{360^\circ}) - 180^\circ$$
  $$\text{angular distance } D = \sqrt{\Delta \psi^2 + \Delta \theta^2}$$
- **Alignment Tolerance:** $4.5^\circ$ angular threshold.
- **Stability Dwell Time:** 600ms steady hold before triggering automatic capture.

### B. Full-Sphere Target Planning (`src/features/photo-sphere/targets/`)
To achieve true 360° × 180° spherical coverage with adequate overlap (~30%–35%):
- **Equator Ring ($\theta = 0^\circ$):** 8 to 10 targets spaced at $36^\circ$ to $45^\circ$ increments.
- **Upper Ring ($\theta = +30^\circ$):** 6 to 8 targets spaced at $45^\circ$ to $60^\circ$ increments.
- **Zenith ($\theta = +70^\circ$ to $+90^\circ$):** 1 to 2 pole cap targets.
- **Lower Ring ($\theta = -30^\circ$):** 6 to 8 targets spaced at $45^\circ$ to $60^\circ$ increments.
- **Nadir ($\theta = -70^\circ$ to $-90^\circ$):** 1 to 2 pole cap targets.
- **Total targets:** 22 to 28 planned targets per complete photo sphere, automatically adjusted based on measured or standard FOV.

### C. Moving Target Projection & Centered Reticle (`src/features/photo-sphere/components/`)
- **Center Reticle:** Mathematically centered at $(W / 2, H / 2)$ of the actual live `<video>` element bounding box, regardless of aspect ratio or outer container padding.
- **Screen Projection:**
  $$X = \frac{W}{2} + \left(\frac{\Delta \psi}{\text{HFOV}}\right) \times W$$
  $$Y = \frac{H}{2} + \left(\frac{\Delta \theta}{\text{VFOV}}\right) \times H$$
- **Off-screen Indicator:** When $|X - W/2| > W/2$ or $|Y - H/2| > H/2$, an orbital chevron indicator appears at the viewport perimeter pointing toward the target.

### D. Capture Coordinator & Frame Storage (`src/features/photo-sphere/storage/`)
- Persistent IndexedDB store (`PhotoSphereDB` v1):
  - `sessions`: Session ID, property ID, inspection ID, supervisor ID, start time, target plan, status.
  - `frames`: Frame ID, session ID, target ID, yaw, pitch, roll, timestamp, local image URI / Blob, capture method (`manual` vs `auto`).
  - `panoramas`: Panorama ID, session ID, equirectangular 2:1 JPEG blob, width, height, coverage percentage, GPano metadata injected.
- **Undo & Restart:** Most recent frame can be rolled back; sessions can be paused, resumed, or cleared.

### E. Equirectangular Stitcher & GPano Injector (`src/features/photo-sphere/stitching/`)
- Spherical canvas projection: Maps each perspective camera frame $(u, v)$ onto an equirectangular canvas $(\lambda, \phi)$ using inverse ray projection and feather-blending at overlapping borders.
- Output aspect ratio: 2:1 ($4096 \times 2048$ or $2048 \times 1024$).
- **GPano XMP Injection:** Lossless APP1 marker injection with GPano tags (`UsePanoramaViewer=True`, `ProjectionType=equirectangular`, `FullPanoWidthPixels`, `FullPanoHeightPixels`, etc.) directly into the JPEG binary stream.

### F. Interactive Panorama Viewer (`src/features/photo-sphere/viewer/`)
- Touch and mouse orbit controls with yaw ($0^\circ - 360^\circ$) and pitch ($-90^\circ - +90^\circ$).
- Pinch-to-zoom / wheel zoom.
- Renders the actual generated equirectangular canvas.
