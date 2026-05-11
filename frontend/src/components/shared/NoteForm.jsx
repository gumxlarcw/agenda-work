/**
 * Shared Note Form — used by Notes page and Dashboard QuickAddBar.
 * Plain textarea for lightweight use (full TipTap editor on Notes page).
 */
import { useState, useRef, useEffect } from 'react';
import {
  HiOutlineX, HiOutlineFolder, HiOutlineTag,
  HiOutlineStar, HiCheck,
} from 'react-icons/hi';
import { notesAPI, noteFoldersAPI, noteTagsAPI } from '../../services/api';
import toast from 'react-hot-toast';

const NOTE_COLORS = [
  { hex: '#ffffff', name: 'Putih' },
  { hex: '#fef3c7', name: 'Kuning' },
  { hex: '#d1fae5', name: 'Hijau' },
  { hex: '#dbeafe', name: 'Biru' },
  { hex: '#ede9fe', name: 'Ungu' },
  { hex: '#fce7f3', name: 'Pink' },
  { hex: '#fee2e2', name: 'Merah' },
];

export default function NoteForm({ onClose, onSaved }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [folderId, setFolderId] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [color, setColor] = useState('#ffffff');
  const [pinned, setPinned] = useState(false);
  const [saving, setSaving] = useState(false);

  const [folders, setFolders] = useState([]);
  const [tags, setTags] = useState([]);
  const [metaLoading, setMetaLoading] = useState(true);
  const [showTagSelect, setShowTagSelect] = useState(false);

  const inputRef = useRef(null);
  const tagRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    (async () => {
      try {
        const [fRes, tRes] = await Promise.all([noteFoldersAPI.getAll(), noteTagsAPI.getAll()]);
        setFolders(fRes.data.data || fRes.data || []);
        setTags(tRes.data.data || tRes.data || []);
      } catch { /* silent */ }
      finally { setMetaLoading(false); }
    })();
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (tagRef.current && !tagRef.current.contains(e.target)) setShowTagSelect(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggleTag = (tagId) => {
    setSelectedTags(prev => prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) { toast.error('Judul tidak boleh kosong'); return; }
    setSaving(true);
    try {
      await notesAPI.create({
        title: title.trim(), content,
        folder_id: folderId || null,
        tag_ids: selectedTags, color,
        is_pinned: pinned,
      });
      toast.success('Catatan dibuat');
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal membuat catatan');
    } finally {
      setSaving(false);
    }
  };

  const selectedColor = NOTE_COLORS.find(c => c.hex === color) || NOTE_COLORS[0];

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl w-full max-w-2xl max-h-[95vh] overflow-y-auto shadow-2xl animate-fadeIn"
        style={{ boxShadow: '0 25px 60px -12px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)' }}
      >
        {/* Header with color preview */}
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white rounded-t-2xl z-10"
          style={{ borderBottomColor: color !== '#ffffff' ? color : undefined }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl border border-gray-200 flex items-center justify-center"
              style={{ backgroundColor: color }}>
              <span className="text-sm">📝</span>
            </div>
            <h2 className="text-lg font-bold text-gray-900">Catatan Baru</h2>
          </div>
          <div className="flex items-center gap-2">
            {/* Pin toggle in header */}
            <button type="button" onClick={() => setPinned(!pinned)}
              className={`p-2 rounded-xl transition-all ${
                pinned
                  ? 'bg-amber-50 text-amber-500 ring-2 ring-amber-200'
                  : 'text-gray-300 hover:bg-gray-100 hover:text-gray-500'
              }`}
              title={pinned ? 'Unpin' : 'Pin catatan'}>
              <HiOutlineStar className="w-5 h-5" />
            </button>
            <button type="button" onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
              <HiOutlineX className="w-5 h-5 text-gray-400" />
            </button>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Title */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Judul *</label>
            <input
              ref={inputRef} type="text" value={title} onChange={e => setTitle(e.target.value)}
              className="form-input text-sm" required placeholder="Judul catatan..."
            />
          </div>

          {/* Content */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 block">Isi Catatan</label>
            <textarea
              value={content} onChange={e => setContent(e.target.value)}
              className="form-input text-sm" rows={6}
              placeholder="Tulis catatan di sini..."
              style={color !== '#ffffff' ? { backgroundColor: `${color}40` } : undefined}
            />
          </div>

          {/* Folder + Tags row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Folder */}
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5 block">
                <HiOutlineFolder className="w-3.5 h-3.5" /> Folder
              </label>
              <select value={folderId} onChange={e => setFolderId(e.target.value)}
                className="form-input text-sm" disabled={metaLoading}>
                <option value="">Tanpa folder</option>
                {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>

            {/* Tags */}
            <div ref={tagRef} className="relative">
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5 block">
                <HiOutlineTag className="w-3.5 h-3.5" /> Tags
              </label>
              <button type="button" onClick={() => setShowTagSelect(!showTagSelect)}
                className="form-input text-sm w-full text-left flex items-center gap-1.5 flex-wrap min-h-[42px]"
                disabled={metaLoading}>
                {selectedTags.length === 0 ? (
                  <span className="text-gray-400">Pilih tags...</span>
                ) : (
                  selectedTags.map(id => {
                    const tag = tags.find(t => t.id === id);
                    return tag ? (
                      <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary-50 text-primary-700 rounded-md text-xs font-medium">
                        {tag.name}
                        <button type="button" onClick={e => { e.stopPropagation(); toggleTag(id); }}
                          className="hover:text-red-500 ml-0.5 font-bold">×</button>
                      </span>
                    ) : null;
                  })
                )}
              </button>
              {showTagSelect && tags.length > 0 && (
                <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-40 overflow-y-auto">
                  {tags.map(tag => {
                    const selected = selectedTags.includes(tag.id);
                    return (
                      <button key={tag.id} type="button" onClick={() => toggleTag(tag.id)}
                        className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center justify-between transition-colors ${
                          selected ? 'bg-primary-50 text-primary-700' : 'text-gray-700'
                        }`}>
                        {tag.name}
                        {selected && <HiCheck className="w-4 h-4 text-primary-500" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Color picker — inline swatches */}
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">Warna</label>
            <div className="flex items-center gap-2">
              {NOTE_COLORS.map(c => {
                const active = color === c.hex;
                return (
                  <button key={c.hex} type="button"
                    onClick={() => setColor(c.hex)}
                    className={`w-8 h-8 rounded-lg border-2 transition-all flex items-center justify-center ${
                      active
                        ? 'border-gray-500 scale-110 shadow-sm'
                        : 'border-gray-200 hover:border-gray-400 hover:scale-105'
                    }`}
                    style={{ backgroundColor: c.hex }}
                    title={c.name}>
                    {active && <HiCheck className="w-3.5 h-3.5 text-gray-600" />}
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
              className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 shadow-sm shadow-primary-200 disabled:opacity-50 transition-all">
              {saving ? 'Menyimpan...' : 'Buat Catatan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
