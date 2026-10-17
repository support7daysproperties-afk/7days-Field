import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { navigationService } from '../src/services/NavigationService';

describe('Global Mobile Back Navigation & Priority System', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    navigationService.handlers = [];
    navigationService.historyStack = [];
    navigationService.lastBackPressTime = 0;
    navigationService.lastDispatchedBackTime = 0;
    navigationService.toastCallback = null;
    navigationService.navigateFn = null;
    navigationService.initialized = false;

    globalThis.window = {
      location: { pathname: '/' },
      history: { length: 2, back: vi.fn(), pushState: vi.fn() },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    globalThis.document = {
      activeElement: null,
      createElement: (tag) => ({
        tagName: tag.toUpperCase(),
        blur: vi.fn(),
        focus: vi.fn(),
      }),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
    };
  });

  afterEach(() => {
    navigationService.handlers = [];
  });

  it('correctly registers and sorts handlers by descending priority', () => {
    const log = [];
    navigationService.registerHandler('route_handler', () => { log.push('route'); return true; }, 10);
    navigationService.registerHandler('dialog_modal', () => { log.push('dialog'); return true; }, 110);
    navigationService.registerHandler('media_preview', () => { log.push('media'); return true; }, 100);
    navigationService.registerHandler('workflow_step', () => { log.push('step'); return true; }, 50);

    expect(navigationService.handlers.map(h => h.id)).toEqual([
      'dialog_modal',
      'media_preview',
      'workflow_step',
      'route_handler',
    ]);
  });

  it('executes topmost modal first without triggering underlying route navigation', () => {
    const modalClosed = vi.fn(() => true);
    const routeNavigated = vi.fn(() => true);

    navigationService.registerHandler('route_handler', routeNavigated, 10);
    navigationService.registerHandler('confirm_modal', modalClosed, 110);

    const handled = navigationService.handleBack();

    expect(handled).toBe(true);
    expect(modalClosed).toHaveBeenCalledTimes(1);
    expect(routeNavigated).not.toHaveBeenCalled();
  });

  it('cascades down the priority stack when a handler returns false or unregisters', () => {
    const modalClosed = vi.fn(() => true);
    const cameraDismissed = vi.fn(() => true);

    const unregModal = navigationService.registerHandler('modal', modalClosed, 100);
    navigationService.registerHandler('camera', cameraDismissed, 90);

    // First back press closes modal
    navigationService.handleBack();
    expect(modalClosed).toHaveBeenCalledTimes(1);
    expect(cameraDismissed).not.toHaveBeenCalled();

    // Modal unmounts/unregisters after closing
    unregModal();
    navigationService.lastDispatchedBackTime = 0; // reset debounce

    // Second back press dismisses camera
    navigationService.handleBack();
    expect(cameraDismissed).toHaveBeenCalledTimes(1);
  });

  it('blurs active text input or textarea before dismissing overlays', () => {
    const input = {
      tagName: 'INPUT',
      blur: vi.fn(() => {
        document.activeElement = null;
      }),
    };
    document.activeElement = input;

    const modalHandler = vi.fn(() => true);
    navigationService.registerHandler('modal', modalHandler, 100);

    const handled = navigationService.handleBack();

    expect(handled).toBe(true);
    expect(input.blur).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(null);
    expect(modalHandler).not.toHaveBeenCalled();
  });

  it('tracks in-app history and avoids duplicate consecutive entries', () => {
    navigationService.recordNavigation('/tasks');
    navigationService.recordNavigation('/tasks'); // duplicate
    navigationService.recordNavigation('/tasks/123');
    navigationService.recordNavigation('/inspection/123');

    expect(navigationService.historyStack).toEqual([
      '/tasks',
      '/tasks/123',
      '/inspection/123',
    ]);
  });

  it('triggers "Press back again to exit" toast on first press at root screen', () => {
    const toastFn = vi.fn();
    navigationService.setToastCallback(toastFn);
    window.location.pathname = '/';

    const handled = navigationService.handleBack();
    expect(handled).toBe(true);
    expect(toastFn).toHaveBeenCalledWith('Press back again to exit');
  });

  it('exits or allows double-back exit when pressed again within 2 seconds', () => {
    const toastFn = vi.fn();
    navigationService.setToastCallback(toastFn);
    window.location.pathname = '/';

    // First press
    navigationService.handleBack();
    expect(toastFn).toHaveBeenCalledTimes(1);

    // Second press 500ms later
    navigationService.lastDispatchedBackTime = 0; // reset 150ms debounce
    navigationService.lastBackPressTime = Date.now() - 500;

    const handled = navigationService.handleBack();
    expect(handled).toBe(true);
  });

  it('debounces rapid back button spam within 150ms', () => {
    const handler = vi.fn(() => true);
    navigationService.registerHandler('test', handler, 100);

    navigationService.handleBack();
    expect(handler).toHaveBeenCalledTimes(1);

    // Immediate second call (<150ms)
    navigationService.handleBack();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('navigates to fallback route when history is empty in goBack()', () => {
    const mockNavigate = vi.fn();
    navigationService.navigateFn = mockNavigate;
    window.history.length = 1;

    navigationService.goBack('/tasks');
    expect(mockNavigate).toHaveBeenCalledWith('/tasks');
  });
});
