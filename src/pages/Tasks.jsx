import { useNavigate } from 'react-router-dom';
import { MapPin, Calendar, ArrowRight } from 'lucide-react';

export default function Tasks() {
  const navigate = useNavigate();

  const tasks = [
    {
      id: 1,
      name: 'Luxury Villa',
      location: 'Ooty',
      type: 'Property Verification',
      due: 'Today',
      status: 'In Progress',
      progress: 65
    },
    {
      id: 2,
      name: 'Tea Estate',
      location: 'Coonoor',
      type: 'Land Survey',
      due: 'Tomorrow',
      status: 'Pending',
      progress: 0
    }
  ];

  return (
    <div className="tasks-page">
      <header className="mb-md">
        <h2>My Tasks</h2>
      </header>

      <div className="flex gap-sm mb-md overflow-x-auto" style={{ paddingBottom: '8px' }}>
        <span className="badge badge-primary">All</span>
        <span className="badge" style={{ backgroundColor: 'var(--surface-color)' }}>Today</span>
        <span className="badge" style={{ backgroundColor: 'var(--surface-color)' }}>Upcoming</span>
        <span className="badge" style={{ backgroundColor: 'var(--surface-color)' }}>In Progress</span>
      </div>

      <div className="flex flex-col gap-md">
        {tasks.map(task => (
          <div key={task.id} className="card" style={{ marginBottom: 0 }}>
            <div className="flex justify-between items-start mb-sm">
              <div>
                <h3>{task.name}</h3>
                <div className="flex items-center gap-xs text-secondary text-sm mt-xs">
                  <MapPin size={14} />
                  <span>{task.location}</span>
                </div>
              </div>
              <span className={`badge ${task.progress > 0 ? 'badge-warning' : 'badge-primary'}`}>
                {task.due}
              </span>
            </div>
            
            <div className="flex items-center gap-xs text-sm mb-md">
              <Calendar size={14} className="text-tertiary" />
              <span>{task.type}</span>
            </div>

            {task.progress > 0 && (
              <div className="mb-md">
                <div className="flex justify-between text-xs mb-xs">
                  <span className="text-secondary">Progress</span>
                  <span className="font-medium">{task.progress}%</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${task.progress}%` }}></div>
                </div>
              </div>
            )}
            
            <button 
              className={`btn ${task.progress > 0 ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => navigate(`/tasks/${task.id}`)}
            >
              {task.progress > 0 ? 'Continue' : 'Open Task'} <ArrowRight size={18} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
