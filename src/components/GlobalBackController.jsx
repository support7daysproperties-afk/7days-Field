import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { navigationService } from '../services/NavigationService';

export default function GlobalBackController() {
  const navigate = useNavigate();
  const location = useLocation();
  const [toastMessage, setToastMessage] = useState(null);

  useEffect(() => {
    navigationService.init(navigate);
    navigationService.setToastCallback((msg) => {
      setToastMessage(msg);
      setTimeout(() => {
        setToastMessage((prev) => (prev === msg ? null : prev));
      }, 2000);
    });
  }, [navigate]);

  useEffect(() => {
    navigationService.recordNavigation(location.pathname);
  }, [location.pathname]);

  if (!toastMessage) return null;

  return (
    <div
      className="nav-exit-toast animate-fade-in"
      style={{
        position: 'fixed',
        bottom: '84px',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: 'rgba(20, 24, 33, 0.95)',
        color: '#f8fafc',
        padding: '10px 20px',
        borderRadius: '24px',
        fontSize: '13px',
        fontWeight: 500,
        border: '1px solid rgba(255, 255, 255, 0.15)',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.6)',
        zIndex: 99999,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {toastMessage}
    </div>
  );
}
