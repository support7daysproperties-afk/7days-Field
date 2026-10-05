import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import Home from './pages/Home';
import Tasks from './pages/Tasks';
import TaskDetails from './pages/TaskDetails';
import InspectionSession from './pages/InspectionSession';
import Sync from './pages/Sync';
import Profile from './pages/Profile';
import GoogleDriveAccess from './pages/GoogleDriveAccess';
import Login from './pages/Login';
import { useAuth } from './context/AuthContext';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

// A simple protected route wrapper
function ProtectedRoute() {
  const { authenticated, loading, driveAuthorized } = useAuth();
  const location = useLocation();
  
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-bg text-text">Loading...</div>;
  }
  
  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }
  
  return <Outlet />;
}

function App() {
  return (
    <Router>
      <div className="app-container">
        <Routes>
          {/* Public Route */}
          <Route path="/login" element={<Login />} />
          
          {/* Protected Routes */}
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<MainLayout />}>
              <Route index element={<Home />} />
              <Route path="tasks" element={<Tasks />} />
              <Route path="tasks/:id" element={<TaskDetails />} />
              <Route path="sync" element={<Sync />} />
              <Route path="profile" element={<Profile />} />
            </Route>
            
            <Route path="/google-drive-access" element={<GoogleDriveAccess />} />
            <Route path="/inspection/:id/*" element={<InspectionSession />} />
          </Route>
        </Routes>
      </div>
    </Router>
  );
}

export default App;
