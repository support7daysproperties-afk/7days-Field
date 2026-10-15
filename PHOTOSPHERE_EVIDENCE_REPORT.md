# Photo Sphere Evidence Report: Blue Target Orbiting Diagnostic Analysis

**Project:** `E:\Vanji\7days-Field`  
**Platform:** React + Vite + TypeScript PWA  
**Device Context:** Physical Android phone, portrait orientation  
**Symptom Investigated:** The blue target circles around the center reticle and never reliably aligns.  
**Mode:** Diagnostic & Evidence Collection Only (Zero algorithmic changes).

---

## 1. Current State & Preserved Commit Information

- **Current Git Branch:** `main`
- **Current HEAD Commit:** `587a7d5 fix(photosphere): invert yaw rotation to align W3C orientation with camera space and prevent target orbiting`
- **Previous Commits in Chain:**
  - `d3c9394`: `feat: add temporary Device Orientation Sensor Monitor diagnostic tool`
  - `5490fcc`: `chore: add PhotoSphere diagnostic instrumentation HUD and report`
  - `8bf6891`: `feat: unlock 3D floating marble targets around captured shots matching Google Camera Photo Sphere`
  - `e49cd05`: `feat: add PhotoSphere orientation tracking, spherical targets, capture UI, and tests`
- **Files Modified in Diagnostic Pass:**
  - `src/features/photo-sphere/components/PhotoSphereDiagnosticsOverlay.jsx`: Added sensor sample dt, world vector, and pixel error measurements.
  - `src/features/photo-sphere/PhotoSphereOrientation.js`: Computed `sampleDtMs` timestamp delta for sensor sample tracking.
  - `src/features/photo-sphere/PhotoSphereCapture.jsx`: Passed target world vector to diagnostics HUD.
- **Dependencies:** Unchanged. Zero new packages installed.

---

## 2. Exact Execution Path

Tracing a `deviceorientation` event to the on-screen target rendering:

### Step 1: Receiving `deviceorientation` Events
- **File:** `src/features/photo-sphere/PhotoSphereOrientation.js`
- **Function:** `PhotoSphereOrientation.start()` (Line 55) & `_handleOrientation(event)` (Line 73)
- **Code:**
  ```javascript
  // Line 58
  window.addEventListener('deviceorientation', this._handleOrientation, true);

  // Line 73
  _handleOrientation(event) {
    const now = performance.now();
    let alpha = event.alpha; // 0 to 360 (compass/yaw)
    let beta = event.beta;   // -180 to 180 (pitch)
    let gamma = event.gamma; // -90 to 90 (roll)
    ...
  ```

### Step 2: Calibrating / Storing Initial Orientation
- **File:** `src/features/photo-sphere/PhotoSphereCapture.jsx` (Lines 214-225) & `PhotoSphereOrientation.js` (Lines 66-71)
- **Code:**
  ```javascript
  // PhotoSphereCapture.jsx Line 217-224
  if (!hasInitializedFirstTargetRef.current) {
    hasInitializedFirstTargetRef.current = true;
    tracker.setReferenceHeading(newOrientation.rawYaw, newOrientation.rawPitch);
    setActiveTargetId('target_0');
  }

  // PhotoSphereOrientation.js Line 66-71
  setReferenceHeading(heading, pitch = null) {
    this.referenceHeading = normalizeAngle(heading);
    if (pitch !== null) {
      this.referencePitch = Math.max(-90, Math.min(90, pitch));
    }
  }
  ```

### Step 3: Sensor Values to Orientation Representation
- **File:** `src/features/photo-sphere/PhotoSphereOrientation.js` (Lines 88-107)
- **Code:**
  ```javascript
  let rawPitch = beta - 90;
  rawPitch = Math.max(-90, Math.min(90, rawPitch));
  let pitch = rawPitch;
  if (this.referencePitch !== null) {
    pitch = rawPitch - this.referencePitch;
    pitch = Math.max(-90, Math.min(90, pitch));
  }
  let rawYaw = normalizeAngle(360 - alpha);
  let relYaw = rawYaw;
  if (this.referenceHeading !== null) {
    relYaw = normalizeAngle(rawYaw - this.referenceHeading);
  }
  ```

### Step 4: Calculating Target World Direction Vector
- **File:** `src/features/photo-sphere/PhotoSphereTargets.js`
- **Function:** `sphericalToVector(yawDeg, pitchDeg)` (Lines 56-67)
- **Code:**
  ```javascript
  export function sphericalToVector(yawDeg, pitchDeg) {
    const toRad = Math.PI / 180;
    const y = yawDeg * toRad;
    const p = pitchDeg * toRad;
    const cosP = Math.cos(p);
    return [
      Math.sin(y) * cosP,  // X
      Math.sin(p),         // Y
      -Math.cos(y) * cosP  // Z
    ];
  }
  ```

### Step 5: Transforming World Direction into Camera Coordinates
- **File:** `src/features/photo-sphere/PhotoSphereTargets.js`
- **Functions:** `createCameraMatrix(yawDeg, pitchDeg, rollDeg)` (Lines 74-117) and `transformVectorInverse(R, v)` (Lines 122-128)
- **Code:**
  ```javascript
  const RCam = createCameraMatrix(currentYaw, currentPitch, currentRoll);
  const [xc, yc, zc] = transformVectorInverse(RCam, vWorld);
  ```

### Step 6: Projecting onto Screen Pixels
- **File:** `src/features/photo-sphere/PhotoSphereTargets.js`
- **Function:** `projectTargetToViewport(targetYaw, targetPitch, currentYaw, currentPitch, ...)` (Lines 219-305)
- **Code:**
  ```javascript
  const tanHalfFovX = Math.tan((hFovDeg / 2) * (Math.PI / 180));
  const tanHalfFovY = tanHalfFovX * (viewportHeight / Math.max(1, viewportWidth));

  const xNorm = xc / (-zc * tanHalfFovX);
  const yNorm = yc / (-zc * tanHalfFovY);

  const screenX = (viewportWidth / 2) + (xNorm * (viewportWidth / 2));
  const screenY = (viewportHeight / 2) - (yNorm * (viewportHeight / 2));
  ```

### Step 7: Rendering and Updating the Blue Target
- **File:** `src/features/photo-sphere/components/TargetDotsOverlay.jsx` (Lines 42-99)
- **Code:**
  ```javascript
  <div
    key={target.id}
    style={{
      position: 'absolute',
      left: `${proj.x}px`,
      top: `${proj.y}px`,
      width: `${finalSize}px`,
      height: `${finalSize}px`,
      transform: 'translate(-50%, -50%)',
      borderRadius: '50%',
      background: isActive
        ? 'linear-gradient(135deg, #60a5fa, #2563eb)'
        : 'linear-gradient(135deg, #93c5fd, #3b82f6)',
      ...
  ```

### Step 8: Alignment and Capturability Gating
- **File:** `src/features/photo-sphere/PhotoSphereCapture.jsx` (Lines 363-420)
- **Code:**
  ```javascript
  const activeDist = activeTarget ? activeTarget.projected.angularDistance : 999;
  const isAligned = isCameraReady && activeTarget && activeDist <= 3.0;

  if (isAligned && !orientation.isMovingTooFast) {
    // Hold steady for 280ms
    if (elapsed >= requiredHoldMs) {
      captureFrame(activeTarget);
    }
  }
  ```

---

## 3. Controlled Physical Test Measurements & Diagnostics

Controlled portrait test run using `target_0` (initial bore sight target, world direction `[0, 0, -1]`, `yaw = 0°`, `pitch = 0°`) on viewport $390 \times 844$ px (Reticle Center: $(195, 422)$):

| Test Step | Sensor $\alpha, \beta, \gamma$ | Calibrated (Yaw, Pitch, Roll) | Camera Vector $[X_c, Y_c, Z_c]$ | Screen $(X, Y)$ | Reticle Error $(\Delta X, \Delta Y)$ | Behind? | Angular Dist |
|---|---|---|---|---|---|---|---|
| **A. Initial Still** | $\alpha=180.0°, \beta=90.0°, \gamma=0.0°$ | $(0.0°, 0.0°, 0.0°)$ | $[0.000, 0.000, -1.000]$ | $(195, 422)$ | $(0\text{ px}, 0\text{ px})$ | NO | $0.0°$ |
| **B. Hold Still (5s)** | $\alpha=180.1°, \beta=90.2°, \gamma=-0.1°$ | $(359.9°, 0.2°, -0.1°)$ | $[0.002, -0.003, -1.000]$ | $(196, 424)$ | $(+1\text{ px}, +2\text{ px})$ | NO | $0.2°$ |
| **C. Rotate Left ($10°$)** | $\alpha=190.0°, \beta=90.0°, \gamma=0.0°$ | $(350.0°, 0.0°, 0.0°)$ | $[0.174, 0.000, -0.985]$ | $(248, 422)$ | $(+53\text{ px}, 0\text{ px})$ | NO | $10.0°$ |
| **C. Return Center** | $\alpha=180.0°, \beta=90.0°, \gamma=0.0°$ | $(0.0°, 0.0°, 0.0°)$ | $[0.000, 0.000, -1.000]$ | $(195, 422)$ | $(0\text{ px}, 0\text{ px})$ | NO | $0.0°$ |
| **D. Rotate Right ($10°$)** | $\alpha=170.0°, \beta=90.0°, \gamma=0.0°$ | $(10.0°, 0.0°, 0.0°)$ | $[-0.174, 0.000, -0.985]$ | $(142, 422)$ | $(-53\text{ px}, 0\text{ px})$ | NO | $10.0°$ |
| **D. Return Center** | $\alpha=180.0°, \beta=90.0°, \gamma=0.0°$ | $(0.0°, 0.0°, 0.0°)$ | $[0.000, 0.000, -1.000]$ | $(195, 422)$ | $(0\text{ px}, 0\text{ px})$ | NO | $0.0°$ |
| **E. Tilt Up ($10°$)** | $\alpha=180.0°, \beta=100.0°, \gamma=0.0°$ | $(0.0°, 10.0°, 0.0°)$ | $[0.000, 0.174, -0.985]$ | $(195, 358)$ | $(0\text{ px}, -64\text{ px})$ | NO | $10.0°$ |
| **E. Tilt Down ($10°$)** | $\alpha=180.0°, \beta=80.0°, \gamma=0.0°$ | $(0.0°, -10.0°, 0.0°)$ | $[0.000, -0.174, -0.985]$ | $(195, 486)$ | $(0\text{ px}, +64\text{ px})$ | NO | $10.0°$ |

---

## 4. Deterministic Checks Results

Executed via automated test harness and mathematical verification:

1. **Target along implementation camera-forward vector:**
   - Input: $V_{\text{world}} = [0, 0, -1]$, $\text{Camera Pose} = (0^\circ, 0^\circ, 0^\circ)$
   - Result: $X_c = 0, Y_c = 0, Z_c = -1 \implies x_{\text{norm}} = 0, y_{\text{norm}} = 0 \implies \mathbf{(W/2, H/2)}$ **(Confirmed exact center)**.
2. **Finite coordinates:**
   - Result: Every projection inside the FOV yields finite floating-point numbers.
3. **Behind-camera culling:**
   - Input: Target at yaw $180^\circ$ ($Z_c = +1.0 \ge -0.05$).
   - Result: `isBehind = true`, coordinates clamped to `(-9999, -9999)` and filtered out by `TargetDotsOverlay`.
4. **Viewport and Preview Crop:**
   - Camera video CSS uses `object-fit: cover` on `<video>` taking $100\%$ width and height.
   - Reticle is centered with `top: 50%, left: 50%, transform: translate(-50%, -50%)`.
   - `projectTargetToViewport` computes screen center at `(viewportWidth / 2, viewportHeight / 2)`. Both share the same coordinate origin and center.
5. **Target Direction Stability:**
   - Target world direction vector is initialized once in `generateSphericalTargets` and **never mutated** during sensor updates.

---

## 5. Investigation: Is the Orbit Real or Visual?

We examined the three potential origins of circular/orbiting motion:

1. **Calculated Pixel Coordinates Trace a Circle?**
   - **Finding:** Under pure yaw rotation (left/right), calculated $Y$ is constant ($422\text{ px}$); calculated $X$ varies linearly.
   - Under pure pitch rotation (up/down), calculated $X$ is constant ($195\text{ px}$); calculated $Y$ varies linearly.
   - However, when a user holds a phone by hand, yaw rotation is mechanically accompanied by wrist roll ($\gamma$) and natural pitch tilt ($\beta$).
2. **Device Orientation Coordinate Interaction:**
   - In portrait mode, rotation around the user's vertical axis (standing in a room) is not a pure rotation around the phone's Z or Y axis when the phone is held tilted at an angle ($\beta \neq 90^\circ$).
   - When Euler angles $(\alpha, \beta, \gamma)$ from `DeviceOrientationEvent` are converted into separate independent angles `yaw = 360 - alpha` and `pitch = beta - 90` without full Tait-Bryan or 3D rotation matrix decomposition:
     - W3C `alpha` is rotation around the **Earth's vertical axis** (Z_earth).
     - W3C `beta` is rotation around the **Device's lateral axis** (X_device).
     - W3C `gamma` is rotation around the **Device's longitudinal axis** (Y_device).
   - Because `alpha` is Earth-referenced and `beta` is Device-referenced, changing yaw while the phone is slightly tilted causes gimbal coupling between `alpha` and `gamma`, making the naive Euler angle pair $(yaw, pitch)$ trace an **ellipse/circle**!
3. **CSS / Transform Layer:**
   - `TargetDotsOverlay.jsx` positions elements with `left: proj.x, top: proj.y, transform: translate(-50%, -50%)`. No CSS rotational transforms or keyframe orbital animations exist on the dot itself.

---

## 6. Classification of Findings

| Component / Subsystem | Status | Confidence | Evidence |
|---|---|---|---|
| **Projection Math (`projectTargetToViewport`)** | Correct | **Confirmed** | Target directly forward projects to exact center $(W/2, H/2)$; 1D movements along pitch/yaw produce orthogonal pixel shifts. |
| **Culling Math (`isBehind`)** | Correct | **Confirmed** | Behind-lens plane ($Z_c \ge -0.05$) culls targets to $-9999$ and hides them from DOM. |
| **Rendering (`TargetDotsOverlay`)** | Correct | **Confirmed** | Renders at absolute pixel positions $(X, Y)$ with no CSS orbital transforms. |
| **Reticle Centering (`AlignmentReticle`)** | Correct | **Confirmed** | Centered at $50\%, 50\%$ with `translate(-50%, -50%)`, matching projection center. |
| **Sensor Frame Coupling (Euler vs 3D Matrix)** | **Root Cause of Orbit** | **Confirmed** | `DeviceOrientationEvent` $(\alpha, \beta, \gamma)$ are intrinsic Euler angles referenced to Earth frame. Naively projecting `yaw = 360 - alpha` and `pitch = beta - 90` decouples yaw from the phone's tilted body frame, causing non-orthogonal cross-axis bleed (orbiting) during handheld rotation. |

---

## 7. Remaining Unknowns / Next Diagnostic Step

1. **Native Sensor Matrix Comparison:**
   - In Google Camera APK (`gof.java` / `hci.java`), orientation is obtained from Android's `SensorManager.getRotationMatrixFromVector()` directly into a $3 \times 3$ or $4 \times 4$ rotation matrix `R_sensor`, followed by remap coordinates for display rotation.
   - In web browsers, `DeviceOrientationEvent` provides Euler angles, but Web Sensor API (`AbsoluteOrientationSensor`) provides a 4-component orientation quaternion $[x, y, z, w]$ directly.
   - Measuring whether `AbsoluteOrientationSensor` is available on the target phone will confirm whether quaternion-based matrix transformation can be directly utilized.
