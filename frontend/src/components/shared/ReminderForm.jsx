/**
 * Shared Reminder Form — used by Reminders page and Dashboard QuickAddBar.
 */
import { useState, useRef, useEffect } from 'react';
import { HiOutlineX, HiOutlineBell, HiOutlineRefresh } from 'react-icons/hi';
import { remindersAPI } from '../../services/api';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';

const REPEAT_TYPES = [
  { value: 'None', label: 'Tidak', icon: null },
  { value: 'Daily', label: 'Harian', desc: 'Setiap hari' },
  { value: 'Weekly', label: 'Mingguan', desc: 'Sekali seminggu' },
  { value: 'Monthly', label: 'Bulanan', desc: 'Sekali sebulan' },
  { value: 'Yearly', label: 'Tahunan', desc: 'Sekali setahun' },
];

const initialFormData = {
  title: '', description: '', reminder_datetime: '', repeat_type: 'None', is_active: true,
};

export default function ReminderForm({ onClose, onSaved, editingReminder = null }) {
  const [formData, setFormData] = useState(() => {
    if (editingReminder) {
      return {
        title: editingReminder.title || '',
        description: editingReminder.description || '',
        reminder_datetime: dayjs(editingReminder.reminder_datetime).format('YYYY-MM-DDTHH:mm'),
        repeat_type: editingReminder.repeat_type || 'None',
        is_active: editingReminder.is_active !== false,
      };
    }
    const now = new Date();
    now.setHours(now.getHours() + 1, 0, 0, 0);
    return { ...initialFormData, reminder_datetime: dayjs(now).format('YYYY-MM-DDTHH:mm') };
  });
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.title.trim()) { toast.error('Judul wajib diisi'); return; }
    if (!formData.reminder_datetime) { toast.error('Tanggal & Jam wajib diisi'); return; }

    setSaving(true);
    try {
      const data = { ...formData, reminder_datetime: new Date(formData.reminder_datetime).toISOString() };
      if (editingReminder) {
        await remindersAPI.update(editingReminder.id, data);
        toast.success('Reminder diperbarui');
      } else {
        await remindersAPI.create(data);
        toast.success('Reminder dibuat');
      }
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal menyimpan reminder');
    } finally {
      setSaving(false);
    }
  };

  const dtParsed = formData.reminder_datetime ? dayjs(formData.reminder_datetime) : null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-lg shadow-2xl animate-fadeIn"
        style={{ boxShadow: '0 25px 60px -12px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)' }}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center">
              <HiOutlineBell className="w-4.5 h-4.5 text-orange-500" />
            </div>
            <h2 className="text-lg font-bold text-gray-900">
              {editingReminder ? 'Edit Reminder' : 'Reminder Baru'}
            </h2>
          </div>
          <button type="button" onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <HiOutlineX className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Title */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Judul *</label>
            <input
              ref={inputRef} type="text" name="title" value={formData.title} onChange={handleChange}
              className="form-input text-sm" required placeholder="Contoh: Follow up laporan..."
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">
              Deskripsi <span className="text-gray-300 normal-case font-normal">(opsional)</span>
            </label>
            <textarea
              name="description" value={formData.description} onChange={handleChange}
              className="form-input text-sm" rows={3} placeholder="Detail tambahan..."
            />
          </div>

          {/* Date & Time */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Tanggal & Jam *</label>
            <input
              type="datetime-local" name="reminder_datetime"
              value={formData.reminder_datetime} onChange={handleChange}
              className="form-input text-sm" required
            />
            {dtParsed && (
              <p className="text-xs text-gray-400 mt-1">
                {dtParsed.format('dddd, D MMMM YYYY')} pukul {dtParsed.format('HH:mm')}
              </p>
            )}
          </div>

          {/* Repeat Type — pill selector */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5 block">
              <HiOutlineRefresh className="w-3.5 h-3.5" /> Pengulangan
            </label>
            <div className="flex gap-1.5 flex-wrap">
              {REPEAT_TYPES.map(rt => {
                const active = formData.repeat_type === rt.value;
                return (
                  <button
                    key={rt.value} type="button"
                    onClick={() => setFormData(prev => ({ ...prev, repeat_type: rt.value }))}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition-all ${
                      active
                        ? 'bg-orange-50 border-orange-300 text-orange-700'
                        : 'border-gray-200 text-gray-400 hover:border-gray-300'
                    }`}
                  >
                    {rt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <button type="button" onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors">
              Batal
            </button>
            <button type="submit" disabled={saving}
              className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-orange-500 hover:bg-orange-600 shadow-sm shadow-orange-200 disabled:opacity-50 transition-all">
              {saving ? 'Menyimpan...' : (editingReminder ? 'Perbarui' : 'Buat Reminder')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
