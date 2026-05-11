import { useState } from 'react';
import { HiOutlineX, HiOutlineTrash, HiOutlinePencil, HiOutlineCheck } from 'react-icons/hi';
import toast from 'react-hot-toast';

const TAG_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280', '#14b8a6', '#f97316'];

export default function TagManager({ tags, onClose, onCreate, onUpdate, onDelete }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await onCreate({ name: name.trim(), color });
      setName('');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal membuat tag');
    }
  };

  const handleUpdate = async (id) => {
    if (!editName.trim()) return;
    try {
      await onUpdate(id, { name: editName.trim(), color: editColor });
      setEditingId(null);
    } catch (err) {
      toast.error('Gagal mengupdate tag');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Hapus tag ini? Tag akan dihapus dari semua notes.')) return;
    try {
      await onDelete(id);
    } catch (err) {
      toast.error('Gagal menghapus tag');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Kelola Tag</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <HiOutlineX className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Create form */}
          <form onSubmit={handleCreate} className="space-y-3">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Nama tag baru"
              className="form-input text-sm"
            />
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5 flex-wrap">
                {TAG_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-6 h-6 rounded-full border-2 ${color === c ? 'border-gray-800' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <button type="submit" className="btn-primary text-sm py-2 ml-auto">Buat</button>
            </div>
          </form>

          {/* Tag list */}
          <div className="space-y-1">
            {tags.map(tag => (
              <div key={tag.id} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 group">
                {editingId === tag.id ? (
                  <div className="flex-1 flex items-center gap-2">
                    <div className="flex gap-1">
                      {TAG_COLORS.map(c => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setEditColor(c)}
                          className={`w-4 h-4 rounded-full border ${editColor === c ? 'border-gray-800' : 'border-transparent'}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                    <input
                      type="text"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleUpdate(tag.id); if (e.key === 'Escape') setEditingId(null); }}
                      className="form-input text-sm py-1 flex-1"
                      autoFocus
                    />
                    <button onClick={() => handleUpdate(tag.id)} className="p-1 text-green-600 hover:bg-green-50 rounded">
                      <HiOutlineCheck className="w-4 h-4" />
                    </button>
                    <button onClick={() => setEditingId(null)} className="p-1 text-gray-400 hover:bg-gray-100 rounded">
                      <HiOutlineX className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                    <span className="flex-1 text-sm text-gray-700">{tag.name}</span>
                    <span className="text-xs text-gray-400">{tag.note_count || 0} notes</span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { setEditingId(tag.id); setEditName(tag.name); setEditColor(tag.color); }} className="p-1 hover:bg-gray-200 rounded">
                        <HiOutlinePencil className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                      <button onClick={() => handleDelete(tag.id)} className="p-1 hover:bg-red-100 rounded">
                        <HiOutlineTrash className="w-3.5 h-3.5 text-red-400" />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
