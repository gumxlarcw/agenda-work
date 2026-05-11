import { useState, useEffect, useCallback } from 'react';
import { remindersAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import ReminderForm from '../components/shared/ReminderForm';
import ConfirmDialog from '../components/notes/ConfirmDialog';
import {
  HiOutlinePlus,
  HiOutlinePencil,
  HiOutlineTrash,
  HiOutlineCheck,
  HiOutlineBell,
  HiOutlineClipboardList,
  HiOutlineCalendar,
  HiOutlineClock,
  HiOutlineExclamation,
  HiOutlineLightningBolt,
  HiOutlineRefresh,
} from 'react-icons/hi';

const SOURCE_CONFIG = {
  custom: { label: 'Custom', color: 'bg-violet-100 text-violet-700', icon: HiOutlineBell },
  task: { label: 'Task', color: 'bg-blue-100 text-blue-700', icon: HiOutlineClipboardList },
  event: { label: 'Event', color: 'bg-emerald-100 text-emerald-700', icon: HiOutlineCalendar },
};

const STAT_CONFIG = [
  { key: 'active', label: 'Aktif', icon: HiOutlineBell, color: 'from-primary-500 to-primary-700' },
  { key: 'custom', label: 'Custom', icon: HiOutlineLightningBolt, color: 'from-violet-500 to-violet-700' },
  { key: 'system', label: 'System', icon: HiOutlineClock, color: 'from-blue-500 to-blue-600' },
  { key: 'overdue', label: 'Overdue', icon: HiOutlineExclamation, color: 'from-red-500 to-red-600', pulse: true },
];

const SECTION_CONFIG = {
  overdue: { label: 'Overdue', icon: HiOutlineExclamation, color: 'text-red-600 bg-red-50' },
  today: { label: 'Hari Ini', icon: HiOutlineClock, color: 'text-amber-600 bg-amber-50' },
  upcoming: { label: 'Mendatang', icon: HiOutlineCalendar, color: 'text-primary-600 bg-primary-50' },
  completed: { label: 'Selesai', icon: HiOutlineCheck, color: 'text-gray-500 bg-gray-100' },
};

export default function Reminders() {
  const { isAdmin } = useAuth();
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingReminder, setEditingReminder] = useState(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('active');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [scope, setScope] = useState('all');
  const [confirmDialog, setConfirmDialog] = useState(null);

  const fetchReminders = useCallback(async (showSpinner = false) => {
    try {
      if (showSpinner) setLoading(true);
      const response = await remindersAPI.getAll();
      setReminders(response.data.data);
    } catch (error) {
      toast.error('Gagal memuat reminders');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReminders(true);
    const handleFocus = () => fetchReminders();
    window.addEventListener('focus', handleFocus);
    let bc;
    try {
      bc = new BroadcastChannel('task-updates');
      bc.onmessage = () => fetchReminders();
    } catch {}
    return () => {
      window.removeEventListener('focus', handleFocus);
      try { bc?.close(); } catch {}
    };
  }, [fetchReminders]);

  const openCreateModal = () => {
    setEditingReminder(null);
    setShowModal(true);
  };

  const openEditModal = (reminder) => {
    setEditingReminder(reminder);
    setShowModal(true);
  };

  const handleComplete = async (id) => {
    try {
      await remindersAPI.complete(id);
      toast.success('Reminder selesai');
      fetchReminders();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Gagal menyelesaikan reminder');
    }
  };

  const handleDelete = (id) => {
    setConfirmDialog({
      message: 'Hapus reminder ini?',
      confirmLabel: 'Hapus',
      confirmColor: 'red',
      onConfirm: async () => {
        try {
          await remindersAPI.delete(id);
          toast.success('Reminder dihapus');
          fetchReminders();
        } catch (error) {
          toast.error('Gagal menghapus reminder');
        }
      },
    });
  };

  const isOverdue = (datetime) => dayjs(datetime).isBefore(dayjs().startOf('day'));
  const isToday = (datetime) => dayjs(datetime).isSame(dayjs(), 'day');
  const isSystem = (r) => r.source_type && r.source_type !== 'custom';

  const cleanTitle = (r) => {
    if (!isSystem(r)) return r.title;
    return r.title.replace(/^\[(?:Task|Kegiatan|Event) #\d+\]\s*/, '');
  };

  const sourceRef = (r) => {
    if (!isSystem(r)) return null;
    const match = r.title.match(/^\[(Task|Kegiatan|Event) #(\d+)\]/);
    return match ? `${match[1]} #${match[2]}` : null;
  };

  const filteredReminders = reminders.filter(r => {
    if (filter === 'active' && (r.is_completed || !r.is_active)) return false;
    if (filter === 'completed' && !r.is_completed) return false;
    if (sourceFilter === 'custom' && isSystem(r)) return false;
    if (sourceFilter === 'system' && !isSystem(r)) return false;
    if (scope === 'personal' && r.source_type === 'event') return false;
    return true;
  });

  const overdueReminders = filteredReminders.filter(r => !r.is_completed && isOverdue(r.reminder_datetime));
  const todayReminders = filteredReminders.filter(r => !r.is_completed && isToday(r.reminder_datetime));
  const upcomingReminders = filteredReminders.filter(r => !r.is_completed && !isOverdue(r.reminder_datetime) && !isToday(r.reminder_datetime));
  const completedReminders = filteredReminders.filter(r => r.is_completed);

  // Stats
  const stats = {
    active: reminders.filter(r => !r.is_completed && r.is_active).length,
    system: reminders.filter(r => isSystem(r) && !r.is_completed).length,
    custom: reminders.filter(r => !isSystem(r) && !r.is_completed).length,
    overdue: reminders.filter(r => !r.is_completed && isOverdue(r.reminder_datetime)).length,
  };

  // Click stat card to toggle source filter
  const handleStatClick = (key) => {
    if (key === 'active') { setSourceFilter('all'); setFilter('active'); }
    else if (key === 'custom') { setSourceFilter(sourceFilter === 'custom' ? 'all' : 'custom'); setFilter('active'); }
    else if (key === 'system') { setSourceFilter(sourceFilter === 'system' ? 'all' : 'system'); setFilter('active'); }
    else if (key === 'overdue') { setFilter('active'); setSourceFilter('all'); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  const renderReminder = (reminder) => {
    const source = SOURCE_CONFIG[reminder.source_type || 'custom'];
    const SourceIcon = source.icon;
    const isDone = reminder.is_completed;
    const overdue = !isDone && isOverdue(reminder.reminder_datetime);
    const today = !isDone && isToday(reminder.reminder_datetime);
    const system = isSystem(reminder);

    const borderColor = isDone
      ? 'border-l-gray-300'
      : overdue ? 'border-l-red-500'
      : today ? 'border-l-amber-400'
      : system ? 'border-l-blue-400'
      : 'border-l-violet-400';

    return (
      <div
        key={reminder.id}
        className={`bg-white rounded-xl p-4 shadow-sm border border-gray-100 border-l-4 transition-all hover:shadow-md group ${borderColor} ${isDone ? 'opacity-60' : ''}`}
      >
        <div className="flex items-start gap-3">
          {/* Done button */}
          <div className="mt-0.5 flex-shrink-0">
            {!system ? (
              <button
                onClick={() => !isDone && handleComplete(reminder.id)}
                disabled={isDone}
                className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                  isDone
                    ? 'bg-green-500 border-green-500'
                    : 'border-gray-300 hover:border-green-500 hover:bg-green-50 hover:scale-110'
                }`}
              >
                {isDone && <HiOutlineCheck className="w-4 h-4 text-white" />}
              </button>
            ) : (
              <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                isDone ? 'bg-gray-300' : overdue ? 'bg-red-100' : today ? 'bg-amber-100' : 'bg-blue-100'
              }`}>
                {isDone ? (
                  <HiOutlineCheck className="w-3.5 h-3.5 text-white" />
                ) : (
                  <SourceIcon className={`w-3.5 h-3.5 ${overdue ? 'text-red-600' : today ? 'text-amber-600' : 'text-blue-600'}`} />
                )}
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <h3 className={`font-semibold text-sm ${isDone ? 'line-through text-gray-400' : 'text-gray-900'}`}>
              {cleanTitle(reminder)}
            </h3>

            {/* Badges row */}
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${source.color}`}>
                <SourceIcon className="w-3 h-3" />
                {source.label}
              </span>
              {sourceRef(reminder) && (
                <span className="text-[10px] text-gray-400">{sourceRef(reminder)}</span>
              )}
              {reminder.repeat_type !== 'None' && (
                <span className="inline-flex items-center gap-0.5 text-[10px] bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full font-medium">
                  <HiOutlineRefresh className="w-3 h-3" />
                  {reminder.repeat_type}
                </span>
              )}
              {overdue && (
                <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">Overdue</span>
              )}
              {isAdmin && reminder.username && (
                <span className="text-[10px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full">{reminder.username}</span>
              )}
            </div>

            {/* Description */}
            {reminder.description && (
              <p className="text-xs text-gray-500 mt-1.5 line-clamp-2">{reminder.description}</p>
            )}

            {/* Date */}
            <p className={`text-[11px] mt-2 flex items-center gap-1 ${
              overdue ? 'text-red-500 font-medium' : today ? 'text-amber-600' : 'text-gray-400'
            }`}>
              <HiOutlineBell className="w-3.5 h-3.5" />
              {dayjs(reminder.reminder_datetime).format('DD MMM YYYY, HH:mm')}
              {today && <span className="ml-1 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">Hari ini</span>}
            </p>
          </div>

          {/* Actions — visible on hover */}
          <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {!system && (
              <button
                onClick={() => openEditModal(reminder)}
                className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                title="Edit"
              >
                <HiOutlinePencil className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => handleDelete(reminder.id)}
              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="Hapus"
            >
              <HiOutlineTrash className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderSection = (sectionKey, items) => {
    if (items.length === 0) return null;
    const config = SECTION_CONFIG[sectionKey];
    const Icon = config.icon;
    return (
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${config.color}`}>
            <Icon className="w-3.5 h-3.5" />
          </div>
          <h3 className="text-sm font-semibold text-gray-700">{config.label}</h3>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{items.length}</span>
        </div>
        <div className="space-y-2">
          {items.map(renderReminder)}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5 animate-fadeIn">

      {/* ══════ Header ══════ */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-200">
            <HiOutlineBell className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Reminders</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              {stats.active} aktif · {filteredReminders.length} ditampilkan
            </p>
          </div>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl shadow-sm shadow-primary-200 transition-all hover:shadow-md"
        >
          <HiOutlinePlus className="w-4 h-4" />
          <span className="hidden sm:inline">Custom Reminder</span>
          <span className="sm:hidden">Baru</span>
        </button>
      </div>

      {/* ══════ Stats Strip ══════ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {STAT_CONFIG.map(({ key, label, icon: Icon, color, pulse }) => {
          const value = stats[key] || 0;
          const isActive = (key === 'custom' && sourceFilter === 'custom') ||
                           (key === 'system' && sourceFilter === 'system') ||
                           (key === 'active' && sourceFilter === 'all' && filter === 'active');
          const showPulse = pulse && value > 0;
          return (
            <button
              key={key}
              onClick={() => handleStatClick(key)}
              className={`relative overflow-hidden rounded-xl p-4 text-left transition-all duration-200 group
                ${isActive
                  ? 'ring-2 ring-primary-400 shadow-md scale-[1.02]'
                  : 'hover:shadow-md hover:scale-[1.01]'}
                bg-white border border-gray-100`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
                </div>
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center shadow-sm`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
              </div>
              {showPulse && (
                <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              )}
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary-400 to-primary-600" />
              )}
            </button>
          );
        })}
      </div>

      {/* ══════ Filters (pill-based) ══════ */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Status pills */}
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-400 mr-1">Status:</span>
          {[
            { key: 'active', label: 'Aktif' },
            { key: 'completed', label: 'Selesai' },
            { key: 'all', label: 'Semua' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                filter === tab.key
                  ? 'bg-primary-100 text-primary-700 ring-1 ring-primary-200 shadow-sm'
                  : 'bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Scope pills */}
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-400 mr-1">Scope:</span>
          {[
            { key: 'all', label: 'Semua' },
            { key: 'personal', label: 'Personal' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setScope(tab.key)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                scope === tab.key
                  ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-200 shadow-sm'
                  : 'bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Source pills */}
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-400 mr-1">Source:</span>
          {[
            { key: 'all', label: 'Semua' },
            { key: 'system', label: 'System' },
            { key: 'custom', label: 'Custom' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setSourceFilter(tab.key)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                sourceFilter === tab.key
                  ? 'bg-gray-800 text-white shadow-sm'
                  : 'bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ══════ Reminders List ══════ */}
      {filteredReminders.length === 0 ? (
        <div className="bg-white rounded-xl p-12 text-center border border-gray-100">
          <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <HiOutlineBell className="w-8 h-8 text-amber-300" />
          </div>
          <p className="text-gray-600 font-medium">Tidak ada reminder</p>
          <p className="text-gray-400 text-sm mt-1">Reminder otomatis muncul saat ada task atau event baru</p>
        </div>
      ) : (
        <div className="space-y-6">
          {renderSection('overdue', overdueReminders)}
          {renderSection('today', todayReminders)}
          {renderSection('upcoming', upcomingReminders)}
          {renderSection('completed', completedReminders)}
        </div>
      )}

      {/* ══════ Create/Edit Modal ══════ */}
      {showModal && (
        <ReminderForm
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); fetchReminders(); }}
          editingReminder={editingReminder}
        />
      )}

      {/* ══════ Confirm Dialog ══════ */}
      <ConfirmDialog dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />
    </div>
  );
}
