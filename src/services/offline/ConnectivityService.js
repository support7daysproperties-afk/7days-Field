class ConnectivityService {
  constructor() {
    this.online = navigator.onLine;
    this.listeners = new Set();
    
    window.addEventListener('online', () => this.checkConnectivity());
    window.addEventListener('offline', () => this.setOffline());
    
    // Initial check
    if (this.online) {
      this.checkConnectivity();
    }
  }
  
  subscribe(callback) {
    this.listeners.add(callback);
    callback(this.online);
    return () => this.listeners.delete(callback);
  }
  
  notify() {
    this.listeners.forEach(cb => cb(this.online));
  }
  
  setOffline() {
    if (this.online) {
      this.online = false;
      this.notify();
    }
  }
  
  async checkConnectivity() {
    if (!navigator.onLine) {
      this.setOffline();
      return false;
    }
    
    try {
      // In a real app, this would be `fetch('/api/health')`
      // We will do a lightweight fetch to an external reliable domain or our own backend
      const res = await fetch('https://api.cloudinary.com/v1_1/demo/ping', { method: 'HEAD', cache: 'no-store' });
      if (res.ok || res.status === 404 || res.status === 401) {
        // Any HTTP response means the internet is working
        if (!this.online) {
          this.online = true;
          this.notify();
        }
        return true;
      }
    } catch (e) {
      // Fetch failed entirely (e.g. DNS failure, captive portal)
    }
    
    this.setOffline();
    return false;
  }
}

export default new ConnectivityService();
