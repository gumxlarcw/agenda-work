/**
 * Shared Task Form — used by Tasks page and Dashboard QuickAddBar.
 * Features a visual mini calendar date picker with click-to-select range.
 */
import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { HiOutlineX, HiChevronLeft, HiChevronRight } from 'react-icons/hi';
import { tasksAPI } from '../../services/api';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';

const PREFIXES = ['Membuat', 'Melakukan', 'Mengikuti', 'Mengisi', 'Memberikan', 'Mengumpulkan'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const STATUSES = ['Pending', 'In Progress', 'Completed', 'On Hold', 'Cancelled'];
const DAY_NAMES = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

const PRIORITY_STYLES = {
  P0: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', ring: 'ring-red-500/20' },
  P1: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', ring: 'ring-orange-500/20' },
  P2: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', ring: 'ring-blue-500/20' },
  P3: { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-600', ring: 'ring-gray-500/20' },
};

const initialFormData = {
  task: '', prefix: 'Membuat', rencana_kinerja: '', priority: 'P2',
  status: 'Pending', start_date: '', end_date: '',
  capaian: '', bukti_dukung: '', notes: '',
};

const isValidUrl = (string) => {
  try { new URL(string); return true; } catch {
    return /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/.test(string);
  }
};

/* ─── Dropdown Calendar Date Picker ─────────────────────────────── */
function CalendarDropdown({ startDate, endDate, onChange }) {
  const today = dayjs().format('YYYY-MM-DD');
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => {
    if (startDate) return dayjs(startDate).startOf('month');
    return dayjs().startOf('month');
  });
  const [phase, setPhase] = useState(() => {
    if (startDate && !endDate) return 'end';
    return 'start';
  });
  const [hoverDate, setHoverDate] = useState(null);
  const wrapperRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const daysInMonth = viewMonth.daysInMonth();
  const firstDayOffset = (viewMonth.day() + 6) % 7;
  const days = [];
  for (let i = 0; i < firstDayOffset; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(viewMonth.date(d).format('YYYY-MM-DD'));

  const prevMonth = () => setViewMonth(v => v.subtract(1, 'month'));
  const nextMonth = () => setViewMonth(v => v.add(1, 'month'));

  const handleDayClick = useCallback((dateStr) => {
    if (phase === 'start') {
      onChange(dateStr, '');
      setPhase('end');
    } else {
      let s = startDate, e = dateStr;
      if (dayjs(e).isBefore(dayjs(s))) { [s, e] = [e, s]; }
      onChange(s, e);
      setPhase('start');
      setOpen(false); // auto-close after selecting range
    }
  }, [phase, startDate, onChange]);

  const isInRange = (dateStr) => {
    if (!dateStr) return false;
    if (phase === 'end' && startDate && hoverDate) {
      let s = startDate, e = hoverDate;
      if (dayjs(e).isBefore(dayjs(s))) [s, e] = [e, s];
      return dateStr >= s && dateStr <= e;
    }
    if (startDate && endDate) {
      return dateStr >= startDate && dateStr <= endDate;
    }
    return false;
  };

  const isStart = (d) => d === startDate;
  const isEnd = (d) => d === endDate;
  const isToday = (d) => d === today;

  // Display text for the trigger field
  const displayText = useMemo(() => {
    if (startDate && endDate) {
      const s = dayjs(startDate);
      const e = dayjs(endDate);
      if (s.isSame(e, 'day')) return s.format('D MMMM YYYY');
      if (s.isSame(e, 'month')) return `${s.format('D')}–${e.format('D MMMM YYYY')}`;
      return `${s.format('D MMM')} – ${e.format('D MMM YYYY')}`;
    }
    if (startDate) return `${dayjs(startDate).format('D MMM YYYY')} → ...`;
    return '';
  }, [startDate, endDate]);

  const handleTriggerClick = () => {
    setOpen(!open);
    // If both dates selected, re-opening starts fresh selection
    if (!open && startDate && endDate) setPhase('start');
  };

  return (
    <div ref={wrapperRef} className="relative">
      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Tanggal *</label>

      {/* Trigger field */}
      <button
        type="button"
        onClick={handleTriggerClick}
        className={`form-input text-sm w-full text-left flex items-center justify-between ${
          open ? 'ring-2 ring-primary-500 border-transparent' : ''
        } ${!displayText ? 'text-gray-400' : 'text-gray-800'}`}
      >
        <span>{displayText || 'Pilih tanggal...'}</span>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown calendar */}
      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden animate-fadeIn">
          {/* Phase hint */}
          {phase === 'end' && (
            <div className="px-3 py-1.5 bg-primary-50 border-b border-primary-100 text-center">
              <span className="text-[11px] font-medium text-primary-600">
                Pilih tanggal selesai (atau klik tanggal yang sama untuk satu hari)
              </span>
            </div>
          )}

          {/* Month navigation */}
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50/80 border-b border-gray-100">
            <button type="button" onClick={prevMonth}
              className="p-1 rounded-md hover:bg-gray-200/60 text-gray-500 transition-colors">
              <HiChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold text-gray-800">
              {MONTH_NAMES[viewMonth.month()]} {viewMonth.year()}
            </span>
            <button type="button" onClick={nextMonth}
              className="p-1 rounded-md hover:bg-gray-200/60 text-gray-500 transition-colors">
              <HiChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 text-center border-b border-gray-100">
            {DAY_NAMES.map(d => (
              <div key={d} className="py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{d}</div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 p-1.5 gap-y-0.5">
            {days.map((dateStr, i) => {
              if (!dateStr) return <div key={`empty-${i}`} />;
              const dayNum = dayjs(dateStr).date();
              const inRange = isInRange(dateStr);
              const start = isStart(dateStr);
              const end = isEnd(dateStr);
              const tdToday = isToday(dateStr);
              const isPast = dateStr < today;
              const isSingleDay = startDate && endDate && startDate === endDate && start;

              let cellClass = 'relative flex items-center justify-center h-8 text-xs font-medium rounded-md transition-all duration-100 cursor-pointer ';

              if (isSingleDay) {
                cellClass += 'bg-primary-600 text-white shadow-sm shadow-primary-200 ';
              } else if (start) {
                cellClass += 'bg-primary-600 text-white rounded-r-none ';
              } else if (end) {
                cellClass += 'bg-primary-600 text-white rounded-l-none ';
              } else if (inRange) {
                cellClass += 'bg-primary-100 text-primary-800 rounded-none ';
              } else if (tdToday) {
                cellClass += 'font-bold text-primary-600 ring-1 ring-primary-300 ';
              } else if (isPast) {
                cellClass += 'text-gray-300 hover:bg-gray-50 ';
              } else {
                cellClass += 'text-gray-700 hover:bg-primary-50 hover:text-primary-700 ';
              }

              return (
                <button
                  key={dateStr} type="button"
                  className={cellClass}
                  onClick={() => handleDayClick(dateStr)}
                  onMouseEnter={() => phase === 'end' && setHoverDate(dateStr)}
                  onMouseLeave={() => setHoverDate(null)}
                >
                  {dayNum}
                </button>
              );
            })}
          </div>

          {/* Footer: reset */}
          {(startDate || endDate) && (
            <div className="px-3 py-2 border-t border-gray-100 bg-gray-50/50 text-right">
              <button
                type="button"
                onClick={() => { onChange('', ''); setPhase('start'); }}
                className="text-[11px] text-gray-400 hover:text-red-500 transition-colors"
              >
                Reset tanggal
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Task Form ────────────────────────────────────────────────── */
export default function TaskForm({ onClose, onSaved, editingTask = null, taskSuggestions = [], datePickerSlot = null }) {
  const [formData, setFormData] = useState(() => {
    if (editingTask) {
      return {
        task: editingTask.task || '',
        prefix: editingTask.prefix || 'Membuat',
        rencana_kinerja: editingTask.rencana_kinerja || '',
        priority: editingTask.priority || 'P2',
        status: editingTask.status || 'Pending',
        start_date: editingTask.start_date ? dayjs(editingTask.start_date).format('YYYY-MM-DD') : '',
        end_date: editingTask.end_date ? dayjs(editingTask.end_date).format('YYYY-MM-DD') : '',
        capaian: editingTask.capaian || '',
        bukti_dukung: editingTask.bukti_dukung || '',
        notes: editingTask.notes || '',
      };
    }
    return { ...initialFormData };
  });
  const [saving, setSaving] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const taskInputRef = useRef(null);
  const suggestionsRef = useRef(null);

  useEffect(() => { taskInputRef.current?.focus(); }, []);

  useEffect(() => {
    const handler = (e) => {
      if (
        suggestionsRef.current && !suggestionsRef.current.contains(e.target) &&
        taskInputRef.current && !taskInputRef.current.contains(e.target)
      ) { setShowSuggestions(false); }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filteredSuggestions = useMemo(() => {
    if (!taskSuggestions.length) return [];
    if (!formData.task) return taskSuggestions;
    const q = formData.task.toLowerCase();
    return taskSuggestions.filter(n => n.toLowerCase().includes(q));
  }, [formData.task, taskSuggestions]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.task.trim()) { toast.error('Task name wajib diisi'); return; }
    if (!formData.start_date || !formData.end_date) {
      toast.error('Start Date dan End Date wajib diisi untuk reminder otomatis');
      return;
    }
    if (formData.start_date > formData.end_date) {
      toast.error('End Date harus setelah Start Date');
      return;
    }
    if (formData.status === 'Completed') {
      if (!formData.capaian) { toast.error('Capaian wajib diisi sebelum menyelesaikan task'); return; }
      if (!formData.bukti_dukung) { toast.error('Bukti Dukung (URL) wajib diisi sebelum menyelesaikan task'); return; }
    }
    if (formData.bukti_dukung && !isValidUrl(formData.bukti_dukung)) {
      toast.error('Format URL Bukti Dukung tidak valid');
      return;
    }

    setSaving(true);
    try {
      const dataToSend = { ...formData, kegiatan: `${formData.prefix} ${formData.task}` };

      if (editingTask) {
        await tasksAPI.update(editingTask.id, dataToSend);
        toast.success(formData.status === 'Completed' ? 'Task completed!' : 'Task updated successfully');
        if (dataToSend.status === 'Completed' || dataToSend.status === 'Cancelled') {
          try { new BroadcastChannel('task-updates').postMessage({ type: 'task-completed' }); } catch {}
        }
      } else {
        await tasksAPI.create(dataToSend);
        toast.success('Task created! Reminder otomatis telah dibuat.');
      }

      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal menyimpan task');
    } finally {
      setSaving(false);
    }
  };

  const isCompleted = formData.status === 'Completed';
  const pStyle = PRIORITY_STYLES[formData.priority] || PRIORITY_STYLES.P2;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-2xl max-h-[95vh] overflow-y-auto shadow-2xl animate-fadeIn"
        style={{ boxShadow: '0 25px 60px -12px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)' }}
      >
        {/* Header with priority accent */}
        <div className={`px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white rounded-t-2xl z-10`}>
          <div className="flex items-center gap-3">
            <div className={`w-2 h-8 rounded-full ${pStyle.bg.replace('bg-', 'bg-')} ${pStyle.border} border`}
              style={{ backgroundColor: formData.priority === 'P0' ? '#ef4444' : formData.priority === 'P1' ? '#f97316' : formData.priority === 'P2' ? '#3b82f6' : '#9ca3af' }} />
            <h2 className="text-lg font-bold text-gray-900">
              {editingTask ? 'Edit Task' : 'Buat Task'}
            </h2>
          </div>
          <button type="button" onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <HiOutlineX className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Form body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Task Name with suggestions */}
          <div className="relative">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Task Name *</label>
            <input
              ref={taskInputRef} type="text" name="task"
              value={formData.task}
              onChange={(e) => { handleChange(e); setShowSuggestions(true); }}
              onFocus={() => setShowSuggestions(true)}
              className="form-input text-sm" required
              placeholder="Ketik atau pilih dari riwayat..."
              autoComplete="off"
            />
            {showSuggestions && filteredSuggestions.length > 0 && (
              <div ref={suggestionsRef}
                className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                {filteredSuggestions.map((name, i) => (
                  <button key={i} type="button"
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-primary-50 hover:text-primary-700 transition-colors border-b border-gray-50 last:border-0"
                    onClick={() => { setFormData(prev => ({ ...prev, task: name })); setShowSuggestions(false); }}>
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Prefix + Priority row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Prefix *</label>
              <select name="prefix" value={formData.prefix} onChange={handleChange} className="form-input text-sm" required>
                {PREFIXES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Priority *</label>
              <div className="flex gap-1.5">
                {PRIORITIES.map(p => {
                  const s = PRIORITY_STYLES[p];
                  const active = formData.priority === p;
                  return (
                    <button key={p} type="button"
                      onClick={() => setFormData(prev => ({ ...prev, priority: p }))}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold border-2 transition-all ${
                        active
                          ? `${s.bg} ${s.border} ${s.text} ring-2 ${s.ring} scale-[1.02]`
                          : 'border-gray-200 text-gray-400 hover:border-gray-300'
                      }`}>
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Rencana Kinerja */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">
              Rencana Kinerja <span className="text-gray-300 normal-case font-normal">(opsional)</span>
            </label>
            <textarea
              name="rencana_kinerja" value={formData.rencana_kinerja} onChange={handleChange}
              className="form-input text-sm" rows={2}
              placeholder="Contoh: Terlaksananya Pelayanan Data Statistik yang Berkualitas"
            />
          </div>

          {/* Status */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Status</label>
            <div className="flex gap-1.5 flex-wrap">
              {STATUSES.map(s => {
                const active = formData.status === s;
                const colors = {
                  'Pending': active ? 'bg-gray-100 border-gray-300 text-gray-700' : '',
                  'In Progress': active ? 'bg-blue-50 border-blue-300 text-blue-700' : '',
                  'Completed': active ? 'bg-green-50 border-green-300 text-green-700' : '',
                  'On Hold': active ? 'bg-amber-50 border-amber-300 text-amber-700' : '',
                  'Cancelled': active ? 'bg-red-50 border-red-300 text-red-700' : '',
                };
                return (
                  <button key={s} type="button"
                    onClick={() => setFormData(prev => ({ ...prev, status: s }))}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition-all ${
                      active ? colors[s] : 'border-gray-200 text-gray-400 hover:border-gray-300'
                    }`}>
                    {s}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Calendar Date Picker (dropdown) */}
          {datePickerSlot ? datePickerSlot : (
            <CalendarDropdown
              startDate={formData.start_date}
              endDate={formData.end_date}
              onChange={(s, e) => setFormData(prev => ({ ...prev, start_date: s, end_date: e }))}
            />
          )}

          {/* Completion fields (only prominent when status = Completed) */}
          <div className={`space-y-4 transition-all duration-200 ${isCompleted ? 'opacity-100' : 'opacity-60'}`}>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">
                Capaian {isCompleted && <span className="text-red-500">*</span>}
              </label>
              <textarea
                name="capaian" value={formData.capaian} onChange={handleChange}
                className={`form-input text-sm ${isCompleted && !formData.capaian ? 'border-red-300 focus:ring-red-500' : ''}`}
                rows={2} placeholder="e.g., Laporan selesai 100 persen dan tepat waktu"
                required={isCompleted}
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">
                Bukti Dukung (URL) {isCompleted && <span className="text-red-500">*</span>}
              </label>
              <input
                type="text" name="bukti_dukung" value={formData.bukti_dukung} onChange={handleChange}
                className={`form-input text-sm ${isCompleted && !formData.bukti_dukung ? 'border-red-300 focus:ring-red-500' : ''}`}
                placeholder="https://docs.google.com/..." required={isCompleted}
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">
              Notes <span className="text-gray-300 normal-case font-normal">(opsional)</span>
            </label>
            <textarea
              name="notes" value={formData.notes} onChange={handleChange}
              className="form-input text-sm" rows={2} placeholder="Catatan tambahan..."
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <button type="button" onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors">
              Batal
            </button>
            <button type="submit" disabled={saving}
              className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 shadow-sm shadow-primary-200 disabled:opacity-50 transition-all">
              {saving ? 'Menyimpan...' : (editingTask ? 'Update Task' : 'Buat Task')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
