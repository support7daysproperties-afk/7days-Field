/**
 * CaptureCoordinator.js
 *
 * Coordinates live camera stream, orientation sensor stream, target selection,
 * automatic shutter triggering, and manual shutter triggers.
 *
 * Enforces:
 * - Single-flight capture lock (no race conditions or duplicate captures)
 * - Atomic persistence before advancing target or incrementing progress
 * - Undo and retake operations
 */

import { sphereSessionRepository } from '../storage/SphereSessionRepository';

export class CaptureCoordinator {
  /**
   * @param {object} params
   * @param {CameraAdapter} params.cameraAdapter
   * @param {OrientationAdapter} params.orientationAdapter
   * @param {SphereTargetPlan} params.targetPlan
   * @param {TargetSelection} params.targetSelection
   * @param {string} [params.sessionId]
   * @param {function(state: object): void} [params.onStateChange]
   */
  constructor({
    cameraAdapter,
    orientationAdapter,
    targetPlan,
    targetSelection,
    sessionId,
    onStateChange,
  }) {
    this.camera = cameraAdapter;
    this.orientation = orientationAdapter;
    this.targetPlan = targetPlan;
    this.targetSelection = targetSelection;
    this.sessionId = sessionId;
    this.onStateChange = onStateChange || (() => {});

    this.isCapturing = false;
    this.capturedFrames = [];
    this.lastCapturedFrame = null;
    this.isPaused = false;

    // Set initial active target
    const currentOrientation = this.orientation.getOrientation();
    const initialTarget = this.targetPlan.findNextTarget(
      currentOrientation.yaw,
      currentOrientation.pitch
    );
    this.targetSelection.setActiveTarget(initialTarget);
  }

  /**
   * Evaluates current frame alignment and auto-triggers capture when conditions are met.
   * Called on every orientation update tick.
   *
   * @returns {Promise<PhotoSphereFrame|null>}
   */
  async tick() {
    if (this.isPaused || this.isCapturing) return null;

    const currentOrient = this.orientation.getOrientation();
    const evalResult = this.targetSelection.evaluate(
      currentOrient.yaw,
      currentOrient.pitch,
      currentOrient.isStable
    );

    this.notifyState();

    if (evalResult.shouldTriggerAutoCapture && this.targetSelection.activeTarget) {
      return this.triggerCapture('auto');
    }

    return null;
  }

  /**
   * Triggers a capture either automatically via alignment dwell or manually via shutter button.
   * @param {'auto'|'manual'} method
   * @returns {Promise<PhotoSphereFrame>}
   */
  async triggerCapture(method = 'manual') {
    if (this.isCapturing) {
      console.warn('Capture already in progress, ignoring duplicate trigger');
      return null;
    }

    const target = this.targetSelection.activeTarget;
    if (!target) {
      console.warn('No active target available for capture');
      return null;
    }

    this.isCapturing = true;
    this.notifyState();

    try {
      // 1. Snapshot orientation at exact shutter moment
      const orient = this.orientation.getOrientation();

      // 2. Capture live camera frame
      const dataUri = await this.camera.captureFrame();

      // 3. Atomically persist to storage
      const frameData = {
        sessionId: this.sessionId,
        targetId: target.id,
        sequenceNumber: this.capturedFrames.length + 1,
        yaw: orient.yaw,
        pitch: orient.pitch,
        roll: orient.roll,
        imageBlobOrUri: dataUri,
        captureMethod: method,
      };

      const savedFrame = await sphereSessionRepository.saveFrame(frameData);

      // 4. Update memory state & mark target captured
      this.capturedFrames.push(savedFrame);
      this.lastCapturedFrame = savedFrame;
      this.targetPlan.markCaptured(target.id, savedFrame.id);

      // 5. Select next target
      const nextTarget = this.targetPlan.findNextTarget(orient.yaw, orient.pitch);
      this.targetSelection.setActiveTarget(nextTarget);

      return savedFrame;
    } catch (err) {
      console.error('Capture failed:', err);
      throw err;
    } finally {
      this.isCapturing = false;
      this.targetSelection.resetDwell();
      this.notifyState();
    }
  }

  /**
   * Undoes the last captured frame.
   */
  async undoLastCapture() {
    if (this.capturedFrames.length === 0 || this.isCapturing) return;

    const frameToUndo = this.capturedFrames.pop();
    await sphereSessionRepository.deleteFrame(frameToUndo.id);

    this.targetPlan.resetTarget(frameToUndo.targetId);
    this.lastCapturedFrame =
      this.capturedFrames.length > 0
        ? this.capturedFrames[this.capturedFrames.length - 1]
        : null;

    const orient = this.orientation.getOrientation();
    const nextTarget = this.targetPlan.findNextTarget(orient.yaw, orient.pitch);
    this.targetSelection.setActiveTarget(nextTarget);

    this.notifyState();
  }

  /**
   * Restarts the capture session, clearing all captured frames.
   */
  async restart() {
    this.isCapturing = true;
    try {
      await sphereSessionRepository.clearSessionFrames(this.sessionId);
      for (const t of this.targetPlan.targets) {
        this.targetPlan.resetTarget(t.id);
      }
      this.capturedFrames = [];
      this.lastCapturedFrame = null;

      const orient = this.orientation.getOrientation();
      const initialTarget = this.targetPlan.findNextTarget(orient.yaw, orient.pitch);
      this.targetSelection.setActiveTarget(initialTarget);
    } finally {
      this.isCapturing = false;
      this.notifyState();
    }
  }

  pause() {
    this.isPaused = true;
    this.targetSelection.resetDwell();
    this.notifyState();
  }

  resume() {
    this.isPaused = false;
    this.notifyState();
  }

  notifyState() {
    const progress = this.targetPlan.getProgress();
    this.onStateChange({
      isCapturing: this.isCapturing,
      isPaused: this.isPaused,
      activeTarget: this.targetSelection.activeTarget,
      isAligned: this.targetSelection.isAligned,
      dwellProgress: this.targetSelection.dwellProgress,
      capturedCount: this.capturedFrames.length,
      progress,
    });
  }
}
