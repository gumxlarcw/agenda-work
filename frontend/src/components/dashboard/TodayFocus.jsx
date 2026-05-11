import { HiOutlineCheckCircle, HiOutlineBell, HiOutlineCheck } from 'react-icons/hi';
import dayjs from 'dayjs';
import { glassCard } from './BentoGrid';

function FocusItem({ item, type, onComplete }) {
  const isOverdue = type === 'overdue';
  return (
    <div className={`flex items-center gap-3 py-2.5 px-3 rounded-xl transition-colors hover:bg-white/50 ${isOverdue ? 'border-l-[3px] border-red-400' : ''}`}>
      {type !== 'reminder' ? (
        <button
          onClick={() => onComplete(item.id)}
          className="w-5 h-5 rounded-full border-2 border-gray-300 hover:border-indigo-500 hover:bg-indigo-50 flex items-center justify-center flex-shrink-0 transition-colors group"
        >
          <HiOutlineCheck className="w-3 h-3 text-transparent group-hover:text-indigo-500" />
        </button>
      ) : (
        <HiOutlineBell className="w-5 h-5 text-orange-400 flex-shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-800 truncate">{item.task || item.title}</p>
        {type === 'reminder' && (
          <p className="text-xs text-orange-500">{dayjs(item.reminder_datetime).format('HH:mm')}</p>
        )}
      </div>
      {item.priority && (
        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
          item.priority === 'P0' ? 'bg-red-100 text-red-700' :
          item.priority === 'P1' ? 'bg-orange-100 text-orange-700' :
          'bg-gray-100 text-gray-600'
        }`}>{item.priority}</span>
      )}
      {isOverdue && (
        <span className="text-xs font-medium text-red-500">{item.days_overdue}d</span>
      )}
    </div>
  );
}

export default function TodayFocus({ data, onComplete, loading, error, onRetry }) {
  if (loading) {
    return (
      <div className={`${glassCard} p-5 animate-pulse h-full overflow-hidden`}>
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-4" />
        {[1,2,3].map(i => <div key={i} className="h-10 bg-gray-100 rounded-xl mb-2" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${glassCard} p-5 text-center text-gray-400 text-sm h-full overflow-hidden`}>
        Gagal memuat focus. <button onClick={onRetry} className="text-indigo-500 underline">Retry</button>
      </div>
    );
  }

  const overdue = data?.overdue || [];
  const dueToday = data?.due_today || [];
  const reminders = data?.today_reminders || [];
  const isEmpty = overdue.length === 0 && dueToday.length === 0 && reminders.length === 0;

  const remaining = dueToday.length + overdue.length;
  const motivation = isEmpty ? 'All clear for today! 🎉' : remaining <= 1 ? 'Satu lagi! Kamu bisa! 💪' : `${remaining} tasks to go. Semangat!`;

  return (
    <div className={`${glassCard} p-5 flex flex-col h-full overflow-hidden`}>
      <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-indigo-500" />
        Today's Focus
      </h3>

      <div className="flex-1 space-y-1 overflow-auto">
        {overdue.length > 0 && (
          <>
            <p className="text-xs font-semibold text-red-500 uppercase tracking-wider px-3 pt-1">Overdue</p>
            {overdue.map(item => <FocusItem key={item.id} item={item} type="overdue" onComplete={onComplete} />)}
          </>
        )}
        {dueToday.length > 0 && (
          <>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 pt-2">Due Today</p>
            {dueToday.map(item => <FocusItem key={item.id} item={item} type="today" onComplete={onComplete} />)}
          </>
        )}
        {reminders.length > 0 && (
          <>
            <p className="text-xs font-semibold text-orange-400 uppercase tracking-wider px-3 pt-2">Reminders</p>
            {reminders.map(item => <FocusItem key={item.id} item={item} type="reminder" onComplete={onComplete} />)}
          </>
        )}
        {isEmpty && (
          <div className="flex flex-col items-center justify-center py-6 text-gray-400">
            <HiOutlineCheckCircle className="w-10 h-10 mb-2 text-green-400" />
            <p className="text-sm">All clear for today!</p>
          </div>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-gray-100 text-center">
        <p className="text-xs text-gray-500">{motivation}</p>
      </div>
    </div>
  );
}
