import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { HiOutlineCheck, HiOutlinePlus, HiOutlinePencil, HiOutlineBell } from 'react-icons/hi';
import { glassCard } from './BentoGrid';

dayjs.extend(relativeTime);

const ICONS = {
  task_completed: { icon: HiOutlineCheck, color: 'bg-green-100 text-green-600' },
  task_created: { icon: HiOutlinePlus, color: 'bg-blue-100 text-blue-600' },
  note_updated: { icon: HiOutlinePencil, color: 'bg-purple-100 text-purple-600' },
  reminder_due: { icon: HiOutlineBell, color: 'bg-orange-100 text-orange-600' },
};

const LABELS = {
  task_completed: 'Completed task',
  task_created: 'Created task',
  note_updated: 'Updated note',
  reminder_due: 'Reminder',
};

export default function ActivityFeed({ items, loading, error }) {
  if (loading) {
    return (
      <div className={`${glassCard} p-5 animate-pulse`}>
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-4" />
        {[1,2,3,4].map(i => <div key={i} className="flex gap-3 mb-3"><div className="w-8 h-8 bg-gray-100 rounded-full" /><div className="flex-1 h-8 bg-gray-100 rounded" /></div>)}
      </div>
    );
  }

  if (error) {
    return <div className={`${glassCard} p-5 text-center text-gray-400 text-sm`}>Gagal memuat activity.</div>;
  }

  return (
    <div className={`${glassCard} p-5 h-full overflow-hidden flex flex-col`}>
      <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-3 flex-shrink-0">
        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        Activity
      </h3>

      {items.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">Belum ada aktivitas.</p>
      ) : (
        <div className="space-y-1 overflow-auto flex-1 min-h-0">
          {items.map((item, idx) => {
            const config = ICONS[item.type] || ICONS.task_created;
            const IconComp = config.icon;
            return (
              <div key={`${item.type}-${item.ref_id}-${idx}`} className="flex items-start gap-3 py-2 px-2 rounded-lg hover:bg-white/50 transition-colors">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${config.color}`}>
                  <IconComp className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-500">{LABELS[item.type] || item.type}</p>
                  <p className="text-sm text-gray-800 truncate">{item.title}</p>
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">{dayjs(item.timestamp).fromNow()}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
