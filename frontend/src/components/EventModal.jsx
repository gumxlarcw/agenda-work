import { useState, useEffect } from 'react';
import { HiOutlineX, HiOutlineTrash, HiOutlinePencil } from 'react-icons/hi';
import { eventsAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import DateRangePicker from './DateRangePicker';

const DEFAULT_COLORS = [
  '#6366f1', '#3b82f6', '#10b981', '#f97316', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b', '#64748b',
];

export default function EventModal({ date, eventList = [], onClose, onSaved, heatmapData = [] }) {
  const { user, isAdmin } = useAuth();
  const [mode, setMode] = useState('list');
  const [editingItem, setEditingItem] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [categories, setCategories] = useState([]);
  const [showCatSuggestions, setShowCatSuggestions] = useState(false);
  const [form, setForm] = useState({
    title: '',
    start_date: date,
    end_date: date,
    description: '',
    category: '',
    color: '#6366f1',
  });

  useEffect(() => {
    setForm(f => ({ ...f, start_date: date, end_date: date }));
  }, [date]);

  useEffect(() => {
    eventsAPI.getCategories()
      .then(res => setCategories(res.data.data || []))
      .catch(() => {});
  }, []);

  const resetForm = () => {
    setForm({
      title: '',
      start_date: date,
      end_date: date,
      description: '',
      category: '',
      color: '#6366f1',
    });
    setEditingItem(null);
    setMode('list');
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setForm({
      title: item.title,
      start_date: dayjs(item.start_date).format('YYYY-MM-DD'),
      end_date: dayjs(item.end_date).format('YYYY-MM-DD'),
      description: item.description || '',
      category: item.category || '',
      color: item.color || '#6366f1',
    });
    setMode('edit');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return toast.error('Title is required');

    setSaving(true);
    try {
      if (mode === 'edit' && editingItem) {
        await eventsAPI.update(editingItem.id, form);
        toast.success('Event updated');
      } else {
        await eventsAPI.create(form);
        toast.success('Event created');
      }
      resetForm();
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save event');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (deletingId) return;
    if (!confirm('Delete this event?')) return;
    setDeletingId(id);
    try {
      await eventsAPI.delete(id);
      toast.success('Event deleted');
      onSaved();
    } catch (err) {
      toast.error('Failed to delete event');
    } finally {
      setDeletingId(null);
    }
  };

  const dayEvents = eventList.filter(k => {
    const s = dayjs(k.start_date).format('YYYY-MM-DD');
    const ed = dayjs(k.end_date).format('YYYY-MM-DD');
    return date >= s && date <= ed;
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-lg mx-2 sm:mx-0 max-h-[95vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-900">
            Events - {dayjs(date).format('DD MMMM YYYY')}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <HiOutlineX className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {(mode === 'list') && (
            <>
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Events</h3>
                {dayEvents.length === 0 ? (
                  <p className="text-sm text-gray-400 py-2">No events for this day</p>
                ) : (
                  <div className="space-y-2">
                    {dayEvents.map(k => (
                      <div key={k.id} className="flex items-center gap-3 p-3 rounded-lg" style={{ backgroundColor: k.color + '15' }}>
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: k.color }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 break-words">{k.title}</p>
                          {k.description && <p className="text-xs text-gray-500 break-words">{k.description}</p>}
                          <div className="flex items-center gap-2 mt-1">
                            {k.category && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{k.category}</span>
                            )}
                            {k.creator_username && (
                              <span className="text-[10px] text-gray-400">by {k.creator_name || k.creator_username}</span>
                            )}
                          </div>
                        </div>
                        {(k.user_id === user?.id || isAdmin) && (
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleEdit(k)} className="p-1.5 hover:bg-white/60 rounded">
                            <HiOutlinePencil className="w-4 h-4 text-gray-500" />
                          </button>
                          <button onClick={() => handleDelete(k.id)} disabled={deletingId === k.id} className="p-1.5 hover:bg-red-50 rounded disabled:opacity-50">
                            <HiOutlineTrash className="w-4 h-4 text-red-400" />
                          </button>
                        </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={() => setMode('add')}
                className="w-full py-2.5 rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-primary-400 hover:text-primary-600 transition-colors"
              >
                + Add Event
              </button>
            </>
          )}

          {(mode === 'add' || mode === 'edit') && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  placeholder="Event title"
                  autoFocus
                />
              </div>

              <div>
                <DateRangePicker
                  startDate={form.start_date}
                  endDate={form.end_date}
                  onChange={(s, e) => setForm({ ...form, start_date: s, end_date: e })}
                  heatmapData={heatmapData}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  rows={2}
                  placeholder="Optional description"
                />
              </div>

              <div className="relative">
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <input
                  type="text"
                  value={form.category}
                  onChange={e => {
                    setForm({ ...form, category: e.target.value });
                    setShowCatSuggestions(true);
                  }}
                  onFocus={() => setShowCatSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowCatSuggestions(false), 150)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  placeholder="e.g. PEKPPP, PSS, EPSS, etc"
                  autoComplete="off"
                />
                {showCatSuggestions && (() => {
                  const filtered = categories.filter(c =>
                    c.toLowerCase().includes((form.category || '').toLowerCase())
                  );
                  if (filtered.length === 0) return null;
                  if (filtered.length === 1 && filtered[0].toLowerCase() === (form.category || '').toLowerCase()) return null;
                  return (
                    <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                      {filtered.map(cat => (
                        <button
                          key={cat}
                          type="button"
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => {
                            setForm({ ...form, category: cat });
                            setShowCatSuggestions(false);
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-primary-50 text-gray-700"
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
                <div className="flex items-center gap-2 flex-wrap">
                  {DEFAULT_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm({ ...form, color: c })}
                      className={`w-7 h-7 rounded-full transition-transform ${form.color === c ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : 'hover:scale-110'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={resetForm}
                  className="flex-1 py-2.5 border rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : mode === 'edit' ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
