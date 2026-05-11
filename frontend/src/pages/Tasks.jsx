import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { tasksAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import { sanitizeUrl } from '../utils/sanitizeUrl';
import TaskForm from '../components/shared/TaskForm';
import CalendarHeatmap from '../components/CalendarHeatmap';
import {
  HiOutlinePlus,
  HiOutlinePencil,
  HiOutlineTrash,
  HiOutlineX,
  HiOutlineExternalLink,
  HiOutlineCheck,
  HiOutlineCheckCircle,
  HiOutlineChevronLeft,
  HiOutlineChevronRight,
  HiOutlineClipboardList,
  HiOutlineClock,
  HiOutlineExclamation,
  HiOutlineBan,
  HiOutlineCalendar,
  HiOutlineDotsCircleHorizontal,
} from 'react-icons/hi';

const ITEMS_PER_PAGE = 10;
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const STATUSES = ['Pending', 'In Progress', 'Completed', 'On Hold', 'Cancelled'];

const PRIORITY_ROW = {
  P0: 'border-l-red-500 bg-red-50/40',
  P1: 'border-l-orange-400 bg-orange-50/30',
  P2: 'border-l-blue-400 bg-blue-50/20',
  P3: 'border-l-gray-300 bg-transparent',
};

const PRIORITY_BADGE = {
  P0: 'bg-red-100 text-red-700 border-red-200',
  P1: 'bg-orange-100 text-orange-700 border-orange-200',
  P2: 'bg-blue-100 text-blue-700 border-blue-200',
  P3: 'bg-gray-100 text-gray-600 border-gray-200',
};

const STATUS_BADGE = {
  'Pending': 'bg-yellow-100 text-yellow-800',
  'In Progress': 'bg-blue-100 text-blue-800',
  'Completed': 'bg-green-100 text-green-800',
  'On Hold': 'bg-gray-100 text-gray-800',
  'Cancelled': 'bg-red-100 text-red-800',
};

/* ─── Stat pill config ─────────────────────── */
const STAT_CONFIG = [
  { key: 'total', label: 'Total', icon: HiOutlineClipboardList, color: 'from-blue-500 to-blue-600', bg: 'bg-blue-50' },
  { key: 'pending', label: 'Pending', icon: HiOutlineDotsCircleHorizontal, color: 'from-yellow-500 to-yellow-600', bg: 'bg-yellow-50', filterStatus: 'Pending' },
  { key: 'in_progress', label: 'Progress', icon: HiOutlineClock, color: 'from-amber-500 to-amber-600', bg: 'bg-amber-50', filterStatus: 'In Progress' },
  { key: 'completed', label: 'Selesai', icon: HiOutlineCheckCircle, color: 'from-green-500 to-green-600', bg: 'bg-green-50', filterStatus: 'Completed' },
  { key: 'on_hold', label: 'On Hold', icon: HiOutlineBan, color: 'from-gray-500 to-gray-600', bg: 'bg-gray-50', filterStatus: 'On Hold' },
  { key: 'overdue', label: 'Overdue', icon: HiOutlineExclamation, color: 'from-red-500 to-red-600', bg: 'bg-red-50', pulse: true },
];

/* ─── Date filter presets & dropdown ──────── */
const DATE_PRESETS = [
  { label: 'Hari ini', getRange: () => { const d = dayjs().format('YYYY-MM-DD'); return [d, d]; } },
  { label: 'Minggu ini', getRange: () => [dayjs().startOf('week').format('YYYY-MM-DD'), dayjs().endOf('week').format('YYYY-MM-DD')] },
  { label: 'Bulan ini', getRange: () => [dayjs().startOf('month').format('YYYY-MM-DD'), dayjs().endOf('month').format('YYYY-MM-DD')] },
  { label: 'Bulan lalu', getRange: () => [dayjs().subtract(1, 'month').startOf('month').format('YYYY-MM-DD'), dayjs().subtract(1, 'month').endOf('month').format('YYYY-MM-DD')] },
  { label: '3 bulan terakhir', getRange: () => [dayjs().subtract(3, 'month').format('YYYY-MM-DD'), dayjs().format('YYYY-MM-DD')] },
];

function DateFilterDropdown({ dateFrom, dateTo, onChange }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('preset'); // 'preset' | 'single' | 'range'
  const [tempFrom, setTempFrom] = useState(dateFrom);
  const [tempTo, setTempTo] = useState(dateTo);
  const dropdownRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Sync temp with prop changes
  useEffect(() => { setTempFrom(dateFrom); setTempTo(dateTo); }, [dateFrom, dateTo]);

  const isActive = dateFrom || dateTo;
  const displayLabel = isActive
    ? dateFrom === dateTo
      ? dayjs(dateFrom).format('DD MMM YY')
      : `${dayjs(dateFrom).format('DD MMM')} → ${dayjs(dateTo).format('DD MMM YY')}`
    : 'Tanggal';

  const applyPreset = (preset) => {
    const [from, to] = preset.getRange();
    onChange(from, to);
    setOpen(false);
  };

  const applyCustom = () => {
    if (mode === 'single' && tempFrom) {
      onChange(tempFrom, tempFrom);
    } else if (mode === 'range' && tempFrom && tempTo) {
      // ensure from <= to
      const f = tempFrom <= tempTo ? tempFrom : tempTo;
      const t = tempFrom <= tempTo ? tempTo : tempFrom;
      onChange(f, t);
    }
    setOpen(false);
  };

  const clearDate = (e) => {
    e.stopPropagation();
    onChange('', '');
    setOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
          isActive
            ? 'bg-primary-50 text-primary-700 ring-1 ring-primary-200 shadow-sm'
            : 'bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600'
        }`}
      >
        <HiOutlineCalendar className="w-3.5 h-3.5" />
        <span>{displayLabel}</span>
        {isActive && (
          <span onClick={clearDate} className="ml-0.5 hover:text-red-500 transition-colors">
            <HiOutlineX className="w-3 h-3" />
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 bg-white rounded-xl shadow-xl border border-gray-200 z-40 w-72 overflow-hidden animate-fadeIn">
          {/* Presets */}
          <div className="p-2 space-y-0.5">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-2 pb-1">Preset</p>
            {DATE_PRESETS.map(p => (
              <button
                key={p.label}
                onClick={() => applyPreset(p)}
                className="w-full text-left px-3 py-1.5 text-sm text-gray-600 hover:bg-primary-50 hover:text-primary-700 rounded-lg transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="h-px bg-gray-100" />

          {/* Custom mode tabs */}
          <div className="p-2">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-2 pb-1.5">Custom</p>
            <div className="flex gap-1 mb-2">
              <button
                onClick={() => setMode('single')}
                className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-all ${
                  mode === 'single' ? 'bg-primary-100 text-primary-700' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
                }`}
              >
                Tanggal
              </button>
              <button
                onClick={() => setMode('range')}
                className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-all ${
                  mode === 'range' ? 'bg-primary-100 text-primary-700' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
                }`}
              >
                Rentang
              </button>
            </div>

            {mode === 'single' && (
              <div className="space-y-2">
                <input
                  type="date"
                  value={tempFrom}
                  onChange={(e) => setTempFrom(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-300 focus:border-transparent outline-none"
                />
              </div>
            )}

            {mode === 'range' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={tempFrom}
                    onChange={(e) => setTempFrom(e.target.value)}
                    className="flex-1 px-2.5 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-300 focus:border-transparent outline-none"
                  />
                  <span className="text-gray-300 text-xs">→</span>
                  <input
                    type="date"
                    value={tempTo}
                    onChange={(e) => setTempTo(e.target.value)}
                    className="flex-1 px-2.5 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-300 focus:border-transparent outline-none"
                  />
                </div>
              </div>
            )}

            {(mode === 'single' || mode === 'range') && (
              <button
                onClick={applyCustom}
                disabled={mode === 'single' ? !tempFrom : !(tempFrom && tempTo)}
                className="w-full mt-2 py-2 text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Terapkan
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Tasks() {
  const { isAdmin } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState({ status: '', priority: '', dateFrom: '', dateTo: '' });
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ key: 'start_date', dir: 'desc' });
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completingTask, setCompletingTask] = useState(null);
  const [completeFormData, setCompleteFormData] = useState({ capaian: '', bukti_dukung: '', notes: '' });
  const [heatmapData, setHeatmapData] = useState([]);

  const fetchTasks = useCallback(async () => {
    try {
      const response = await tasksAPI.getAll({ limit: 100 });
      setTasks(response.data.data);
    } catch (error) {
      toast.error('Failed to fetch tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHeatmap = useCallback(async () => {
    try {
      const res = await tasksAPI.getHeatmapData(12);
      setHeatmapData(res.data.data);
    } catch (_) {}
  }, []);

  useEffect(() => {
    fetchTasks();
    fetchHeatmap();
  }, [fetchTasks, fetchHeatmap]);

  const taskSuggestions = useMemo(() => {
    const names = [...new Set(tasks.map(t => t.task).filter(Boolean))];
    names.sort((a, b) => a.localeCompare(b));
    return names;
  }, [tasks]);

  /* ─── Stats computed ─────────────────────── */
  const stats = useMemo(() => {
    const today = dayjs().format('YYYY-MM-DD');
    const active = tasks.filter(t => t.status !== 'Cancelled');
    return {
      total: active.length,
      completed: active.filter(t => t.status === 'Completed').length,
      in_progress: active.filter(t => t.status === 'In Progress').length,
      overdue: active.filter(t =>
        t.status !== 'Completed' && t.end_date && dayjs(t.end_date).format('YYYY-MM-DD') < today
      ).length,
    };
  }, [tasks]);

  /* ─── Handlers ───────────────────────────── */
  const openCreateModal = () => { setEditingTask(null); setShowModal(true); };
  const openEditModal = (task) => { setEditingTask(task); setShowModal(true); };

  const handleDelete = async (id) => {
    if (!confirm('Hapus task ini?')) return;
    try {
      await tasksAPI.delete(id);
      toast.success('Task deleted');
      await Promise.all([fetchTasks(), fetchHeatmap()]);
    } catch (error) {
      toast.error('Failed to delete task');
    }
  };

  const openCompleteModal = (task) => {
    setCompletingTask(task);
    setCompleteFormData({
      capaian: task.capaian || '',
      bukti_dukung: task.bukti_dukung || '',
      notes: task.notes || ''
    });
    setShowCompleteModal(true);
  };

  const handleCompleteSubmit = async (e) => {
    e.preventDefault();
    if (!completeFormData.capaian) { toast.error('Capaian wajib diisi'); return; }
    if (!completeFormData.bukti_dukung) { toast.error('Bukti Dukung (URL) wajib diisi'); return; }
    if (!isValidUrl(completeFormData.bukti_dukung)) { toast.error('Format URL tidak valid'); return; }
    setSaving(true);
    try {
      await tasksAPI.update(completingTask.id, {
        status: 'Completed',
        capaian: completeFormData.capaian,
        bukti_dukung: completeFormData.bukti_dukung,
        notes: completeFormData.notes
      });
      toast.success('Task completed!');
      setShowCompleteModal(false);
      setCompletingTask(null);
      try { new BroadcastChannel('task-updates').postMessage({ type: 'task-completed' }); } catch {}
      await Promise.all([fetchTasks(), fetchHeatmap()]);
    } catch (error) {
      toast.error('Failed to complete task');
    } finally {
      setSaving(false);
    }
  };

  const isValidUrl = (string) => {
    try { new URL(string); return true; } catch (_) {
      return /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/.test(string);
    }
  };

  /* ─── Filter & Sort ──────────────────────── */
  const filteredTasks = tasks.filter(task => {
    if (filter.status && task.status !== filter.status) return false;
    if (filter.priority && task.priority !== filter.priority) return false;
    // Date filter: task range overlaps filter range
    if (filter.dateFrom || filter.dateTo) {
      const tStart = task.start_date ? dayjs(task.start_date).format('YYYY-MM-DD') : null;
      const tEnd = task.end_date ? dayjs(task.end_date).format('YYYY-MM-DD') : tStart;
      if (!tStart) return false; // no date → skip
      const fFrom = filter.dateFrom || '0000-01-01';
      const fTo = filter.dateTo || '9999-12-31';
      // overlap check: task starts before filter ends AND task ends after filter starts
      if (tEnd < fFrom || tStart > fTo) return false;
    }
    return true;
  });

  const sortedTasks = [...filteredTasks].sort((a, b) => {
    if (!sort.key) return 0;
    let va = a[sort.key], vb = b[sort.key];
    if (sort.key === 'start_date' || sort.key === 'end_date') {
      va = va ? new Date(va).getTime() : 0;
      vb = vb ? new Date(vb).getTime() : 0;
    } else if (sort.key === 'jumlah_hari') {
      va = Number(va) || 0; vb = Number(vb) || 0;
    } else {
      va = (va || '').toString().toLowerCase();
      vb = (vb || '').toString().toLowerCase();
    }
    if (va < vb) return sort.dir === 'asc' ? -1 : 1;
    if (va > vb) return sort.dir === 'asc' ? 1 : -1;
    return 0;
  });

  const totalPages = Math.ceil(sortedTasks.length / ITEMS_PER_PAGE);
  const paginatedTasks = sortedTasks.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  const toggleSort = (key) => {
    setSort(prev => prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
    setPage(1);
  };

  const SortIcon = ({ col }) => {
    if (sort.key !== col) return <span className="text-gray-300 ml-1">↕</span>;
    return <span className="ml-1 text-primary-500">{sort.dir === 'asc' ? '↑' : '↓'}</span>;
  };

  const isOverdue = (task) => {
    if (task.status === 'Completed' || task.status === 'Cancelled') return false;
    if (!task.end_date) return false;
    return dayjs(task.end_date).format('YYYY-MM-DD') < dayjs().format('YYYY-MM-DD');
  };

  useEffect(() => { setPage(1); }, [filter.status, filter.priority, filter.dateFrom, filter.dateTo]);

  const handleStatClick = (filterStatus) => {
    if (!filterStatus) {
      setFilter({ status: '', priority: '', dateFrom: '', dateTo: '' });
    } else {
      setFilter(prev => ({ ...prev, status: prev.status === filterStatus ? '' : filterStatus }));
    }
  };

  const hasActiveFilter = filter.status || filter.priority || filter.dateFrom || filter.dateTo;

  if (loading) {
    return (
      <div className="space-y-4 animate-fadeIn">
        <div className="h-20 bg-white rounded-2xl animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="h-20 bg-white rounded-xl animate-pulse" />)}
        </div>
        <div className="h-48 bg-white rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fadeIn">

      {/* ══════ Header ══════ */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-lg shadow-primary-200">
            <HiOutlineClipboardList className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Tasks</h1>
            <p className="text-xs text-gray-400 mt-0.5">{filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''} ditampilkan</p>
          </div>
        </div>
        <button onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold rounded-xl shadow-sm shadow-primary-200 transition-all hover:shadow-md">
          <HiOutlinePlus className="w-4 h-4" />
          <span className="hidden sm:inline">Tambah Task</span>
          <span className="sm:hidden">Baru</span>
        </button>
      </div>

      {/* ══════ Stats Strip (dashboard-style) ══════ */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
        {STAT_CONFIG.map(({ key, label, icon: Icon, color, bg, filterStatus, pulse }) => {
          const value = stats[key] || 0;
          const isActive = filterStatus && filter.status === filterStatus;
          const showPulse = pulse && value > 0;
          return (
            <button
              key={key}
              onClick={() => handleStatClick(filterStatus)}
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

      {/* ══════ Heatmap ══════ */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <CalendarHeatmap data={heatmapData} />
      </div>

      {/* ══════ Filters (pill-based) ══════ */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Status pills */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-xs font-medium text-gray-400 mr-1">Status:</span>
          {STATUSES.map(s => (
            <button
              key={s}
              onClick={() => setFilter(prev => ({ ...prev, status: prev.status === s ? '' : s }))}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                filter.status === s
                  ? `${STATUS_BADGE[s]} ring-1 ring-current/20 shadow-sm`
                  : 'bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-gray-200 mx-1 hidden sm:block" />

        {/* Priority pills */}
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-gray-400 mr-1">Priority:</span>
          {PRIORITIES.map(p => (
            <button
              key={p}
              onClick={() => setFilter(prev => ({ ...prev, priority: prev.priority === p ? '' : p }))}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                filter.priority === p
                  ? `${PRIORITY_BADGE[p]} border ring-1 ring-current/20 shadow-sm`
                  : 'bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-gray-200 mx-1 hidden sm:block" />

        {/* Date filter */}
        <DateFilterDropdown
          dateFrom={filter.dateFrom}
          dateTo={filter.dateTo}
          onChange={(from, to) => setFilter(prev => ({ ...prev, dateFrom: from, dateTo: to }))}
        />

        {hasActiveFilter && (
          <button
            onClick={() => setFilter({ status: '', priority: '', dateFrom: '', dateTo: '' })}
            className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            <HiOutlineX className="w-3 h-3" />
            Reset
          </button>
        )}
      </div>

      {/* ══════ Table — Desktop ══════ */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden hidden md:block border border-gray-100">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50/80">
                {isAdmin && <th onClick={() => toggleSort('username')} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 select-none">User<SortIcon col="username" /></th>}
                <th onClick={() => toggleSort('task')} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 select-none">Task<SortIcon col="task" /></th>
                <th onClick={() => toggleSort('priority')} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 select-none">Priority<SortIcon col="priority" /></th>
                <th onClick={() => toggleSort('status')} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 select-none">Status<SortIcon col="status" /></th>
                <th onClick={() => toggleSort('start_date')} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 select-none">Tanggal<SortIcon col="start_date" /></th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {paginatedTasks.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 6 : 5} className="px-4 py-16 text-center">
                    <HiOutlineClipboardList className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                    <p className="text-gray-400 font-medium">Tidak ada task ditemukan</p>
                    <p className="text-gray-300 text-sm mt-1">Coba ubah filter atau buat task baru</p>
                  </td>
                </tr>
              ) : (
                paginatedTasks.map((task) => {
                  const overdue = isOverdue(task);
                  const completed = task.status === 'Completed';
                  const rowTint = overdue
                    ? 'border-l-4 border-l-red-400 bg-red-50/50'
                    : completed
                      ? 'border-l-4 border-l-green-400 bg-green-50/30'
                      : `border-l-4 ${PRIORITY_ROW[task.priority] || PRIORITY_ROW.P3}`;

                  return (
                    <tr key={task.id} className={`${rowTint} transition-colors hover:bg-gray-50/60 ${completed ? 'opacity-60' : ''}`}>
                      {isAdmin && (
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-purple-50 text-purple-700">
                            {task.username || '?'}
                          </span>
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <div className="min-w-0">
                          <p className={`text-sm font-medium text-gray-900 ${completed ? 'line-through' : ''}`}>{task.task}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{task.prefix} — {task.kegiatan}</p>
                          {overdue && (
                            <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold text-red-600 bg-red-100 px-1.5 py-0.5 rounded">
                              <HiOutlineExclamation className="w-3 h-3" />
                              Overdue
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 text-[11px] font-bold rounded border ${PRIORITY_BADGE[task.priority] || PRIORITY_BADGE.P2}`}>
                          {task.priority}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 text-[11px] font-semibold rounded ${STATUS_BADGE[task.status] || ''}`}>
                          {task.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs text-gray-500">
                          {task.start_date && (
                            <>
                              <span>{dayjs(task.start_date).format('DD MMM')}</span>
                              {task.end_date && <span className="text-gray-300"> → </span>}
                              {task.end_date && <span>{dayjs(task.end_date).format('DD MMM YY')}</span>}
                            </>
                          )}
                          {task.jumlah_hari && (
                            <span className="ml-1.5 text-gray-300">({task.jumlah_hari}d)</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {task.status !== 'Completed' && task.status !== 'Cancelled' && (
                            <button onClick={() => openCompleteModal(task)}
                              className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors" title="Selesaikan">
                              <HiOutlineCheckCircle className="w-4 h-4" />
                            </button>
                          )}
                          {task.bukti_dukung && (
                            <a href={sanitizeUrl(task.bukti_dukung)} target="_blank" rel="noopener noreferrer"
                              className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors" title="Bukti Dukung">
                              <HiOutlineExternalLink className="w-4 h-4" />
                            </a>
                          )}
                          <button onClick={() => openEditModal(task)}
                            className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors" title="Edit">
                            <HiOutlinePencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDelete(task.id)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Hapus">
                            <HiOutlineTrash className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ══════ Cards — Mobile ══════ */}
      <div className="block md:hidden space-y-3">
        {paginatedTasks.length === 0 ? (
          <div className="bg-white rounded-2xl p-10 text-center border border-gray-100">
            <HiOutlineClipboardList className="w-10 h-10 text-gray-200 mx-auto mb-2" />
            <p className="text-gray-400 text-sm">Tidak ada task ditemukan</p>
          </div>
        ) : (
          paginatedTasks.map((task) => {
            const overdue = isOverdue(task);
            const completed = task.status === 'Completed';
            const borderColor = overdue ? 'border-l-red-400' : completed ? 'border-l-green-400'
              : task.priority === 'P0' ? 'border-l-red-500' : task.priority === 'P1' ? 'border-l-orange-400'
              : task.priority === 'P2' ? 'border-l-blue-400' : 'border-l-gray-300';

            return (
              <div key={task.id} className={`bg-white rounded-xl border border-gray-100 border-l-4 ${borderColor} p-4 space-y-2.5 ${completed ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {isAdmin && task.username && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-purple-50 text-purple-700 mb-1">
                        {task.username}
                      </span>
                    )}
                    <p className={`text-sm font-semibold text-gray-900 ${completed ? 'line-through' : ''}`}>{task.task}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{task.kegiatan}</p>
                  </div>
                  <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded border flex-shrink-0 ${PRIORITY_BADGE[task.priority]}`}>
                    {task.priority}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`px-2 py-0.5 text-[11px] font-semibold rounded ${STATUS_BADGE[task.status]}`}>
                    {task.status}
                  </span>
                  {task.start_date && (
                    <span className="text-[11px] text-gray-400">
                      {dayjs(task.start_date).format('DD/MM')}
                      {task.end_date && ` → ${dayjs(task.end_date).format('DD/MM/YY')}`}
                    </span>
                  )}
                  {task.jumlah_hari && <span className="text-[11px] text-gray-300">{task.jumlah_hari}d</span>}
                  {overdue && (
                    <span className="text-[10px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded">Overdue</span>
                  )}
                </div>

                <div className="flex items-center gap-1 pt-2 border-t border-gray-50">
                  {task.status !== 'Completed' && task.status !== 'Cancelled' && (
                    <button onClick={() => openCompleteModal(task)}
                      className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg" title="Selesaikan">
                      <HiOutlineCheckCircle className="w-5 h-5" />
                    </button>
                  )}
                  {task.bukti_dukung && (
                    <a href={sanitizeUrl(task.bukti_dukung)} target="_blank" rel="noopener noreferrer"
                      className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg">
                      <HiOutlineExternalLink className="w-5 h-5" />
                    </a>
                  )}
                  <button onClick={() => openEditModal(task)}
                    className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg">
                    <HiOutlinePencil className="w-5 h-5" />
                  </button>
                  <div className="flex-1" />
                  <button onClick={() => handleDelete(task.id)}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg">
                    <HiOutlineTrash className="w-5 h-5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ══════ Pagination ══════ */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-white rounded-xl p-3 border border-gray-100">
          <p className="text-xs text-gray-400">
            {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, filteredTasks.length)} dari {filteredTasks.length}
          </p>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              <HiOutlineChevronLeft className="w-4 h-4" />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
              .reduce((acc, p, idx, arr) => {
                if (idx > 0 && p - arr[idx - 1] > 1) acc.push('...');
                acc.push(p);
                return acc;
              }, [])
              .map((p, idx) =>
                p === '...' ? (
                  <span key={`gap-${idx}`} className="px-1.5 text-gray-300 text-xs">...</span>
                ) : (
                  <button key={p} onClick={() => setPage(p)}
                    className={`w-8 h-8 rounded-lg text-xs font-medium transition-all ${
                      page === p ? 'bg-primary-600 text-white shadow-sm' : 'hover:bg-gray-100 text-gray-500'
                    }`}>
                    {p}
                  </button>
                )
              )}
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              <HiOutlineChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ══════ TaskForm Modal ══════ */}
      {showModal && (
        <TaskForm
          onClose={() => setShowModal(false)}
          onSaved={async () => { setShowModal(false); await Promise.all([fetchTasks(), fetchHeatmap()]); }}
          editingTask={editingTask}
          taskSuggestions={taskSuggestions}
        />
      )}

      {/* ══════ Complete Task Modal ══════ */}
      {showCompleteModal && completingTask && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-50 p-4" onClick={() => setShowCompleteModal(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[95vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white rounded-t-2xl z-10">
              <div>
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <HiOutlineCheckCircle className="w-5 h-5 text-green-500" />
                  Selesaikan Task
                </h2>
                <p className="text-sm text-gray-400 mt-0.5">{completingTask.task}</p>
              </div>
              <button onClick={() => setShowCompleteModal(false)} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
                <HiOutlineX className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <form onSubmit={handleCompleteSubmit} className="p-6 space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                <p className="text-sm text-green-700">Lengkapi informasi berikut untuk menyelesaikan task ini</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Capaian <span className="text-red-500">*</span></label>
                <textarea value={completeFormData.capaian}
                  onChange={(e) => setCompleteFormData(prev => ({ ...prev, capaian: e.target.value }))}
                  className="form-input text-sm" rows={3} placeholder="Contoh: Laporan selesai 100% dan tepat waktu" required />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Bukti Dukung (URL) <span className="text-red-500">*</span></label>
                <input type="text" value={completeFormData.bukti_dukung}
                  onChange={(e) => setCompleteFormData(prev => ({ ...prev, bukti_dukung: e.target.value }))}
                  className="form-input text-sm" placeholder="https://docs.google.com/..." required />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Catatan <span className="text-gray-300 normal-case font-normal">(opsional)</span></label>
                <textarea value={completeFormData.notes}
                  onChange={(e) => setCompleteFormData(prev => ({ ...prev, notes: e.target.value }))}
                  className="form-input text-sm" rows={2} placeholder="Catatan tambahan..." />
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button type="button" onClick={() => setShowCompleteModal(false)}
                  className="px-5 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors">
                  Batal
                </button>
                <button type="submit" disabled={saving}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-green-600 hover:bg-green-700 shadow-sm disabled:opacity-50 transition-all flex items-center gap-2">
                  <HiOutlineCheck className="w-4 h-4" />
                  {saving ? 'Menyimpan...' : 'Selesaikan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
