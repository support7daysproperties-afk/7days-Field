import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

import { AuthProvider } from './context/AuthContext'
import DatabaseService from './services/offline/DatabaseService.js'
import SyncEngine from './services/offline/SyncEngine.js'

// Initialise the local database as early as possible
DatabaseService.init().then(() => {
  // Attempt to resume any pending sync jobs (if online and Drive token was restored from session)
  SyncEngine.startSync().catch(() => {/* will retry when online */});
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
)
