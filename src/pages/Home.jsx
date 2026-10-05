import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Home() {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const name = user?.supervisorProfile?.name || 'Field Supervisor';
  // Supabase Google Auth puts the picture in user_metadata.avatar_url or user_metadata.picture
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;

  return (
    <div className="home-page">
      <header className="mb-lg flex justify-between items-start">
        <div>
          <h1 className="text-secondary" style={{ fontSize: '16px', fontWeight: '500' }}>Good morning,</h1>
          <h2 style={{ fontSize: '28px' }}>{name}</h2>
        </div>
        
        <div 
          className="bg-primary flex items-center justify-center overflow-hidden cursor-pointer" 
          style={{ width: '48px', height: '48px', borderRadius: '50%', border: '2px solid var(--surface-color)' }}
          onClick={() => navigate('/profile')}
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <User size={24} className="text-white" />
          )}
        </div>
      </header>

      <section className="mb-lg">
        <h3 className="mb-sm">Today's Work</h3>
        <div className="card flex flex-col gap-sm">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-sm">
              <span className="badge badge-primary">12</span>
              <span>Today's Tasks</span>
            </div>
          </div>
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-sm">
              <span className="badge badge-warning">3</span>
              <span>In Progress</span>
            </div>
          </div>
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-sm">
              <span className="badge badge-success">7</span>
              <span>Completed</span>
            </div>
          </div>
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-sm">
              <span className="badge badge-primary">2</span>
              <span>Pending Sync</span>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="flex justify-between items-center mb-sm">
          <h3>Priority Task</h3>
          <span className="text-primary text-sm font-medium" onClick={() => navigate('/tasks')} style={{ cursor: 'pointer' }}>See all</span>
        </div>
        
        <div className="card">
          <div className="flex justify-between mb-sm">
            <div>
              <h3 className="mb-xs">Luxury Villa</h3>
              <p className="text-secondary text-sm">Ooty</p>
            </div>
            <span className="badge badge-warning">Due Today • 10:30 AM</span>
          </div>
          
          <div className="flex items-center gap-sm mb-md text-sm">
            <CheckCircle size={16} className="text-primary" />
            <span>Property Verification</span>
          </div>
          
          <button 
            className="btn btn-primary"
            onClick={() => navigate('/tasks/1')}
          >
            Open Task <ArrowRight size={18} />
          </button>
        </div>
      </section>
    </div>
  );
}
