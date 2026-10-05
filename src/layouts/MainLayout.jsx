import { Outlet, NavLink } from 'react-router-dom';
import { Home, ClipboardList, RefreshCw, User } from 'lucide-react';

export default function MainLayout() {
  return (
    <>
      <div className="page-content">
        <Outlet />
      </div>
      
      <nav className="bottom-nav">
        <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Home size={24} />
          <span>Home</span>
        </NavLink>
        <NavLink to="/tasks" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <ClipboardList size={24} />
          <span>Tasks</span>
        </NavLink>
        <NavLink to="/sync" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <RefreshCw size={24} />
          <span>Sync</span>
        </NavLink>
        <NavLink to="/profile" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <User size={24} />
          <span>Profile</span>
        </NavLink>
      </nav>
    </>
  );
}
