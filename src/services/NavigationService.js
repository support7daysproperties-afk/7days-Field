import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';

class NavigationService {
  constructor() {
    this.handlers = []; // Sorted by priority desc: [{ id, handler, priority }]
    this.historyStack = []; // In-app visited pathnames
    this.lastBackPressTime = 0;
    this.toastCallback = null;
    this.confirmCallback = null;
    this.navigateFn = null;
    this.initialized = false;
    this.lastDispatchedBackTime = 0;
  }

  init(navigate) {
    this.navigateFn = navigate;
    if (this.initialized) return;
    this.initialized = true;

    // 1. Android Capacitor Hardware Back Button & System Back Gesture
    if (Capacitor.isNativePlatform()) {
      try {
        CapApp.addListener('backButton', () => {
          this.handleBack();
        });
      } catch (err) {
        console.warn('CapApp.addListener backButton error:', err);
      }
    }

    // 2. Custom hardwareBackButton event dispatched from native Android MainActivity
    if (typeof window !== 'undefined') {
      window.addEventListener('hardwareBackButton', () => {
        this.handleBack();
      });

      // 3. Browser Back / popstate support
      window.addEventListener('popstate', () => {
        if (this.hasActiveModalOrOverlay()) {
          const handled = this.handleTopmostOverlay();
          if (handled) {
            // Push state back so browser URL stays on current page while dismissing modal
            window.history.pushState(null, '', window.location.href);
          }
        }
      });
    }
  }

  // Record route navigation for in-app history tracking
  recordNavigation(pathname) {
    if (!pathname) return;
    const len = this.historyStack.length;
    if (len === 0 || this.historyStack[len - 1] !== pathname) {
      this.historyStack.push(pathname);
      if (this.historyStack.length > 50) {
        this.historyStack.shift();
      }
    }
  }

  // Register a back action handler
  // Priorities:
  // 110: Nested dialogs / Delete confirmation modals
  // 100: Topmost modals (Full-screen media preview, signature full-screen)
  //  90: Camera modals (FieldCamera, VideoCamera, PhotoSphere, PropertyBoundary)
  //  80: In-page modes (Selection mode, filter sheets)
  //  50: Workflow steps (activeStepId !== 'overview')
  //  10: Custom route handlers
  registerHandler(id, handler, priority = 100) {
    this.unregisterHandler(id);
    this.handlers.push({ id, handler, priority });
    this.handlers.sort((a, b) => b.priority - a.priority);

    return () => this.unregisterHandler(id);
  }

  unregisterHandler(id) {
    this.handlers = this.handlers.filter(h => h.id !== id);
  }

  hasActiveModalOrOverlay() {
    return this.handlers.some(h => h.priority >= 50);
  }

  handleTopmostOverlay() {
    for (const item of this.handlers) {
      if (item.priority >= 50) {
        try {
          const res = item.handler();
          if (res !== false) {
            return true;
          }
        } catch (e) {
          console.error(`Error in back handler ${item.id}:`, e);
        }
      }
    }
    return false;
  }

  handleBack() {
    // Debounce rapid back presses (within 150ms)
    const now = Date.now();
    if (now - this.lastDispatchedBackTime < 150) {
      return true;
    }
    this.lastDispatchedBackTime = now;

    // Priority 0: If keyboard is focused, dismiss it before closing screens
    if (
      typeof document !== 'undefined' &&
      document.activeElement &&
      (document.activeElement.tagName === 'INPUT' ||
       document.activeElement.tagName === 'TEXTAREA' ||
       document.activeElement.isContentEditable)
    ) {
      document.activeElement.blur();
      return true;
    }

    // Priority 1 & 2: Registered handlers (Modals, Confirmations, Workflow Steps)
    for (const item of this.handlers) {
      try {
        const handled = item.handler();
        if (handled !== false) {
          return true;
        }
      } catch (err) {
        console.error(`Error in back handler ${item.id}:`, err);
      }
    }

    // Priority 3 & 4: Route navigation
    const currentPath = typeof window !== 'undefined' && window.location ? window.location.pathname : '/';

    // If already on Root Home page or Login page: trigger root exit policy
    if (currentPath === '/' || currentPath === '' || currentPath === '/login') {
      return this.handleRootExit();
    }

    // If on a secondary main tab (tasks, sync, profile): return to Home tab
    if (currentPath === '/tasks' || currentPath === '/sync' || currentPath === '/profile') {
      if (this.navigateFn) {
        this.navigateFn('/');
        return true;
      }
    }

    // If in inspection creation or details: return to tasks
    if (currentPath.startsWith('/create-inspection') || currentPath.startsWith('/tasks/')) {
      if (this.navigateFn) {
        this.navigateFn('/tasks');
        return true;
      }
    }

    // Standard in-app history back navigation
    if (typeof window !== 'undefined' && window.history && window.history.length > 1) {
      if (this.navigateFn) {
        this.navigateFn(-1);
        return true;
      } else {
        window.history.back();
        return true;
      }
    }

    // Fallback when no history exists: go to home
    if (this.navigateFn) {
      this.navigateFn('/', { replace: true });
      return true;
    }

    return false;
  }

  handleRootExit() {
    const now = Date.now();
    if (now - this.lastBackPressTime < 2000) {
      if (Capacitor.isNativePlatform()) {
        try {
          CapApp.exitApp();
        } catch (_) {}
      }
      return true;
    } else {
      this.lastBackPressTime = now;
      if (this.toastCallback) {
        this.toastCallback('Press back again to exit');
      }
      return true;
    }
  }

  setToastCallback(cb) {
    this.toastCallback = cb;
  }

  // Explicit back navigation helper for in-app UI buttons (e.g. arrow left)
  goBack(fallback = '/') {
    // If any active overlay or step handler exists, let it handle the back action
    for (const item of this.handlers) {
      try {
        const handled = item.handler();
        if (handled !== false) {
          return;
        }
      } catch (e) {}
    }

    // Navigate to previous route if history exists, otherwise use fallback
    if (typeof window !== 'undefined' && window.history && window.history.length > 1) {
      if (this.navigateFn) this.navigateFn(-1);
      else window.history.back();
    } else {
      if (this.navigateFn) this.navigateFn(fallback);
      else if (typeof window !== 'undefined') window.location.href = fallback;
    }
  }
}

export const navigationService = new NavigationService();
