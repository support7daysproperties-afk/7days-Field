import { useEffect, useRef } from 'react';
import { navigationService } from '../services/NavigationService';

/**
 * Hook to register a back action handler with automatic unregistration on unmount
 * @param {string} id Unique identifier for the handler
 * @param {Function} handler Callback executed when back action triggers. Return true to consume, false to pass.
 * @param {number} priority Higher numbers execute first (e.g., 100 for modals, 50 for steps)
 * @param {boolean} enabled Whether the handler is currently active
 */
export function useBackHandler(id, handler, priority = 100, enabled = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;

    const wrappedHandler = () => {
      if (handlerRef.current) {
        return handlerRef.current();
      }
      return false;
    };

    const unregister = navigationService.registerHandler(id, wrappedHandler, priority);
    return () => {
      unregister();
    };
  }, [id, priority, enabled]);
}

export default useBackHandler;
