import { Link } from 'react-router-dom';
import { HiOutlineArrowRight, HiOutlineCheck } from 'react-icons/hi';
import dayjs from 'dayjs';
import { glassCard } from './BentoGrid';

function getDueBadge(endDate) {
  if (!endDate) return null;
  const now = dayjs();
  const due = dayjs(endDate);
  const diff = due.diff(now, 'day');
  if (diff < 0) return { label: `${Math.abs(diff)}d overdue`, cls: 'bg-red-100 text-red-600' };
  if (diff <= 3) return { label: `Due ${due.format('DD MMM')}`, cls: 'bg-amber-100 text-amber-600' };
  return { label: `Due ${due.format('DD MMM')}`, cls: 'bg-green-50 text-green-600' };
}

function getPriorityColor(p) {
  return { P0: 'bg-red-100 text-red-700', P1: 'bg-orange-100 text-orange-700', P2: 'bg-blue-100 text-blue-700', P3: 'bg-gray-100 text-gray-600' }[p] || 'bg-gray-100 text-gray-600';
}

export default function RecentTasks({ tasks, onComplete, loading, error }) {
  if (loading) {
    return (
      <div className={`${glassCard} p-5 animate-pulse`}>
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-4" />
        {[1,2,3].map(i => <div key={i} className="h-14 bg-gray-100 rounded-xl mb-2" />)}
      </div>
    );
  }

  if (error) {
    return <div className={`${glassCard} p-5 text-center text-gray-400 text-sm`}>Gagal memuat tasks.</div>;
  }

  return (
    <div className={`${glassCard} p-5 h-full overflow-hidden flex flex-col`}>
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-900">Recent Tasks</h3>
        <Link to="/tasks" className="text-xs text-indigo-500 hover:text-indigo-600 flex items-center gap-1">
          View all <HiOutlineArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {tasks.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">Belum ada task.</p>
      ) : (
        <div className="space-y-2 overflow-auto flex-1 min-h-0">
          {tasks.map(task => {
            const isCompleted = task.status === 'Completed';
            const dueBadge = !isCompleted ? getDueBadge(task.end_date) : null;
            return (
              <div key={task.id} className={`flex items-center gap-3 p-3 rounded-xl hover:bg-white/50 transition-colors ${isCompleted ? 'opacity-60' : ''}`}>
                <button
                  onClick={() => !isCompleted && onComplete(task.id)}
                  disabled={isCompleted}
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    isCompleted ? 'border-green-400 bg-green-400' : 'border-gray-300 hover:border-indigo-500 hover:bg-indigo-50 group'
                  }`}
                >
                  <HiOutlineCheck className={`w-3 h-3 ${isCompleted ? 'text-white' : 'text-transparent group-hover:text-indigo-500'}`} />
                </button>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium truncate ${isCompleted ? 'line-through text-gray-400' : 'text-gray-800'}`}>{task.task}</p>
                  <p className="text-xs text-gray-400 truncate">{task.prefix} — {task.kegiatan}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${getPriorityColor(task.priority)}`}>{task.priority}</span>
                  {dueBadge && <span className={`text-xs px-1.5 py-0.5 rounded ${dueBadge.cls}`}>{dueBadge.label}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
