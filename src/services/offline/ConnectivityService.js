class ConnectivityService {
  constructor() {
    this.online = typeof navigator !== 'undefined' ? Boolean(navigator.onLine) : true;
    this.listeners = new Set();
    this._checkingPromise = null;
    
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.setOnline();
        this.checkConnectivity();
      });
      window.addEventListener('offline', () => this.setOffline());
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          if (typeof navigator !== 'undefined' && navigator.onLine) {
            this.setOnline();
          }
          this.checkConnectivity();
        }
      });
      window.addEventListener('focus', () => {
        if (typeof navigator !== 'undefined' && navigator.onLine) {
          this.setOnline();
        }
        this.checkConnectivity();
      });
    }
    
    // Initial connectivity verification
    if (this.online && typeof window !== 'undefined') {
      this.checkConnectivity();
    }
  }
  
  subscribe(callback) {
    this.listeners.add(callback);
    callback(this.online);
    return () => this.listeners.delete(callback);
  }
  
  notify() {
    this.listeners.forEach(cb => {
      try {
        cb(this.online);
      } catch (err) {
        console.error('Error in connectivity listener:', err);
      }
    });
  }
  
  setOffline() {
    if (this.online) {
      this.online = false;
      this.notify();
    }
  }

  setOnline() {
    if (!this.online) {
      this.online = true;
      this.notify();
    }
  }
  
  async checkConnectivity() {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.setOffline();
      return false;
    }

    if (this._checkingPromise) return this._checkingPromise;

    this._checkingPromise = (async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        // Fast zero-CORS probe: google.com/generate_204 with mode: 'no-cors'
        // Never triggers CORS preflight or cross-origin blocks
        await fetch('https://www.google.com/generate_204', {
          method: 'GET',
          mode: 'no-cors',
          cache: 'no-store',
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        this.setOnline();
        return true;
      } catch (e) {
        // If probe timed out or network blocked, check fallback
        if (typeof navigator !== 'undefined' && navigator.onLine) {
          // Keep online state if navigator reports connected
          this.setOnline();
          return true;
        }
        this.setOffline();
        return false;
      } finally {
        this._checkingPromise = null;
      }
    })();

    return this._checkingPromise;
  }
}

export default new ConnectivityService();
