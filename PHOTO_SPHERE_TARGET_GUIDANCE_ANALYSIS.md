# Photo Sphere Target Guidance Analysis & Reimplementation Specification

**Source:** Google Camera decompilation (`MGC_8.9.097_A11_V25_snap (1).apk`) under `E:\Vanji\APK-Analysis\decompiled`  
**Target Project:** `E:\Vanji\7days-Field`  
**Date:** October 2026

---

## 1. Executive Summary & Overview

In Google Camera's LightCycle Photo Sphere engine, camera orientation and target tracking are handled with rigid 3D spatial geometry rather than 2D screen-space approximations or Euler angle offsets.

A detailed decompilation review of `LightCycleNative.java`, `defpackage.goo` (`TargetManager`), `defpackage.gof` (`GLSurfaceView.Renderer`), `defpackage.goy` (`SensorFusionTracker`), `defpackage.fre` (`DisplayRotationFilter`), and `defpackage.gom` (`ReticleRenderer`) reveals the exact reasons for the behavioral discrepancy between Google Camera and our previous web implementation:

1. **Active Target Cardinality:**
   - **Google Camera:** Operates with a single active candidate guidance dot at any given instant. While the native backend maintains candidate nodes, only the target actively being tracked is rendered onto the viewfinder as a blue dot. Completed targets are rendered onto the spherical stitched preview texture, **never** as green dots floating in the camera preview.
   - **Our Previous Implementation:** Projected all 30 pre-generated spherical targets simultaneously, and when a target was captured, rendered it as a persistent green circle directly next to the reticle.

2. **Coordinate Mathematics:**
   - **Google Camera:** Every target is defined by a 3x3 rotation matrix representing its world-space orientation $\mathbf{R}_{\text{target}}$. The camera's current pose in world space is maintained via 3x3/4x4 rotation matrix $\mathbf{R}_{\text{cam}}$ produced by sensor fusion (gyro integration + accelerometer gravity compensation + display rotation matrix).
   - The target position in camera coordinates is:
     $$\mathbf{P}_{\text{cam}} = \mathbf{R}_{\text{cam}}^T \cdot \mathbf{R}_{\text{target}} \cdot \begin{bmatrix} 0 \\ 0 \\ -1 \end{bmatrix}$$
   - Targets with $P_{\text{cam}, z} \ge 0$ (behind the camera plane) are completely culled.
   - Perspective projection transforms $\mathbf{P}_{\text{cam}}$ to normalized device coordinates (NDC) using the camera lens's true field of view (FOV) and viewport aspect ratio:
     $$x_{\text{ndc}} = \frac{P_{\text{cam}, x}}{-P_{\text{cam}, z} \cdot \tan(\text{HFOV} / 2)}, \quad y_{\text{ndc}} = \frac{P_{\text{cam}, y}}{-P_{\text{cam}, z} \cdot \tan(\text{VFOV} / 2)}$$
   - **Our Previous Implementation:** Used simple subtraction of Euler yaw/pitch angles with $\tan(\Delta\text{yaw})$. Whenever pitch or roll tilted, this 2D simplification broke down, causing the target to drift non-linearly across the screen.

3. **Session Anchoring:**
   - **Google Camera:** The very first target is placed at the user's initial pointing direction $[0, 0, -1]$ at session start (`LightCycleNative.InitTargets(fArr)`). This defines the zero-reference for the spherical capture grid.
   - Subsequent targets step predictably in azimuth (approx. $30^\circ$ increments on the equator) and elevation ($\pm 25^\circ, \pm 50^\circ, \pm 75^\circ$, zenith, and nadir).

4. **Stability & Auto-Capture:**
   - Checked via `LightCycleNative.TargetHit()` and device angular velocity stability check (`MovingTooFast` / device status).
   - When the angle between camera bore sight $[0, 0, -1]$ and the target vector is within tolerance ($\approx 2.5^\circ - 3.5^\circ$) and angular velocity is below the stability threshold, capture fires once. Capture lock prevents duplicate triggers until storage/advance completes.

---

## 2. Evidence from Decompiled Classes

### 2.1 `LightCycleNative.java` & `NewTarget.java`
- `NewTarget` class holds:
  ```java
  public class NewTarget {
      public int key;
      public float[] orientation; // 9-float 3x3 orientation matrix
  }
  ```
- Key JNI Native interfaces:
  - `public static native void InitTargets(float[] initialOrientation);`
  - `public static native NewTarget[] GetTargets();`
  - `public static native boolean TargetHit();`
  - `public static native boolean MovingTooFast();`
  - `public static native void SetTargetHitAngleRadians(float radians);` // sets tolerance (0.048 - 0.06 rad ~ 2.75° - 3.4°)
  - `public static native int TakeNewPhoto();`

### 2.2 `defpackage.goo` (`TargetManager`)
- Implements the target state lifecycle:
  - Initializes with `b(float[] fArr)`: Invokes `LightCycleNative.InitTargets(fArr)`.
  - Maintains `Map<Integer, float[]> d` mapping target keys to their 4x4 coordinate matrices.
  - Constant bore-sight vector: `private final float[] i = {0.0f, 0.0f, -1.0f, 1.0f};`
  - Updates target list via `LightCycleNative.GetTargets()`. When a target is hit, the native engine marks it complete and generates/reveals the adjacent target candidates.

### 2.3 `defpackage.gof` (`Renderer`) and `gom` (Reticle)
- During every OpenGL frame draw:
  - Camera projection matrix is passed to `Matrix.multiplyMM`.
  - Checks `LightCycleNative.TargetHit()` and orientation stability (`gnx.a() == 0`).
  - If target is aligned and steady:
    - Calls trigger `goc.d()` which instructs the Camera2 API to capture a full-resolution JPEG.
    - Locks capture state until `TakeNewPhoto()` successfully registers the frame into native panorama memory.

### 2.4 Sensor Fusion & Coordinate Transformation (`goy`, `fre`)
- `goy` listens to `Sensor.TYPE_GYROSCOPE` and `Sensor.TYPE_ACCELEROMETER` (or `TYPE_ROTATION_VECTOR`).
- Rotations are accumulated using matrix/quaternion kinematics:
  $$\mathbf{R}_{t+\Delta t} = \mathbf{R}_t \cdot \exp([\vec{\omega}\times] \Delta t)$$
- Accelerometer low-pass filter provides tilt correction (pitch & roll gravity vector) to prevent drift.
- `fre` compensates for Android display rotation (`Surface.ROTATION_0`, `ROTATION_90`, `ROTATION_270`) by applying a planar rotation matrix before view projection.

---

## 3. Mathematical Model for Web Reimplementation

To match Google Camera exactly in JavaScript / HTML5:

### 3.1 World-to-Camera Coordinate System
- World coordinate system:
  - $X$: East / Right
  - $Y$: Up (Zenith)
  - $Z$: South / Forward
- Camera coordinate system:
  - $X_c$: Right on device screen
  - $Y_c$: Up on device screen
  - $Z_c$: Out of screen toward user (so camera look vector is $-Z_c = [0, 0, -1]$)

### 3.2 Target Direction Vector in World Space
For a target at spherical coordinates $(\text{yaw } \psi, \text{pitch } \theta)$ relative to the session reference:
$$\mathbf{V}_{\text{world}} = \begin{bmatrix} \cos\theta \sin\psi \\ \sin\theta \\ -\cos\theta \cos\psi \end{bmatrix}$$
where $\|\mathbf{V}_{\text{world}}\| = 1$.

### 3.3 Camera Rotation Matrix
From device orientation (calibrated yaw $\psi_{\text{cam}}$, pitch $\theta_{\text{cam}}$, roll $\phi_{\text{cam}}$):
Construct $\mathbf{R}_{\text{cam}}$ (transformation from camera frame to world frame).  
The target vector in camera frame is:
$$\mathbf{V}_{\text{cam}} = \mathbf{R}_{\text{cam}}^T \cdot \mathbf{V}_{\text{world}}$$
where $\mathbf{R}_{\text{cam}}^T$ is the inverse (transpose of orthogonal rotation matrix).

### 3.4 Camera Space Analysis & Target Culling
Let $\mathbf{V}_{\text{cam}} = [x_c, y_c, z_c]^T$.
1. **Behind-the-camera culling:**
   If $z_c \ge -0.1$ (the target is behind the camera plane), the target is **completely culled**:
   $$\text{visible} = \text{false}$$
   No dot is rendered on screen.
2. **Angular distance to center reticle:**
   $$\theta_{\text{err}} = \arccos(-z_c) \quad (\text{since } \|\mathbf{V}_{\text{cam}}\| = 1 \text{ and reticle vector is } [0, 0, -1])$$
3. **Perspective Projection to Screen Space:**
   Given camera horizontal and vertical field of view ($\text{HFOV} \approx 65^\circ$):
   $$x_{\text{norm}} = \frac{x_c}{-z_c \cdot \tan(\text{HFOV}/2)}$$
   $$y_{\text{norm}} = \frac{y_c}{-z_c \cdot \tan(\text{VFOV}/2)}$$
   
   Screen coordinates on container width $W$ and height $H$:
   $$\text{screenX} = \frac{W}{2} + x_{\text{norm}} \cdot \frac{W}{2}$$
   $$\text{screenY} = \frac{H}{2} - y_{\text{norm}} \cdot \frac{H}{2}$$

4. **View Frustum Visibility:**
   Target is visible on screen if and only if:
   $$z_c < -0.1 \quad \text{and} \quad |x_{\text{norm}}| \le 1.05 \quad \text{and} \quad |y_{\text{norm}}| \le 1.05$$
   (with small margin so the dot smoothly glides into the edge of the viewport).

---

## 5. Summary of Architecture in `7days-Field`

- `src/features/photo-sphere/PhotoSphereTargets.js`:
  Implements 3D rotation matrix projection, true view-frustum culling, and sequential single-target capture plan.
- `src/features/photo-sphere/components/TargetDotsOverlay.jsx`:
  Renders strictly the single active target dot. Suppresses any completed dots on viewfinder.
- `src/features/photo-sphere/PhotoSphereCapture.jsx`:
  Controls the alignment state machine, auto-capture trigger on stability, and progression to the next target.
