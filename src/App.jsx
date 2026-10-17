import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import Home from './pages/Home';
import Tasks from './pages/Tasks';
import TaskDetails from './pages/TaskDetails';
import CreateInspection from './pages/CreateInspection';
import InspectionSession from './pages/InspectionSession';
import Sync from './pages/Sync';
import Profile from './pages/Profile';
import GoogleDriveAccess from './pages/GoogleDriveAccess';
import Login from './pages/Login';
import SensorMonitor from './pages/SensorMonitor';
import { useAuth } from './context/AuthContext';
import GlobalBackController from './components/GlobalBackController';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

// A simple protected route wrapper
function ProtectedRoute() {
  const { authenticated, loading, driveAuthorized } = useAuth();
  const location = useLocation();
  
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-color)', color: 'var(--text-primary)', flexDirection: 'column', gap: '12px' }}>
        <div style={{ width: '32px', height: '32px', border: '3px solid rgba(59, 130, 246, 0.3)', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Loading 7Days Field...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }
  
  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }
  
  return <Outlet />;
}

function App() {
  return (
    <Router>
      <GlobalBackController />
      <div className="app-container">
        <Routes>
          {/* Public Diagnostic Route */}
          <Route path="/login" element={<Login />} />
          <Route path="/sensor-monitor" element={<SensorMonitor />} />
          
          {/* Protected Routes */}
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<MainLayout />}>
              <Route index element={<Home />} />
              <Route path="tasks" element={<Tasks />} />
              <Route path="sync" element={<Sync />} />
              <Route path="profile" element={<Profile />} />
            </Route>
            
            <Route path="/create-inspection" element={<CreateInspection />} />
            <Route path="/tasks/:id" element={<TaskDetails />} />
            <Route path="/google-drive-access" element={<GoogleDriveAccess />} />
            <Route path="/inspection/:id/*" element={<InspectionSession />} />
          </Route>
          
          {/* Catch-all fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
