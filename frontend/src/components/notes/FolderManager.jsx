import { useState } from 'react';
import { HiOutlineX, HiOutlineTrash, HiOutlinePencil, HiOutlineCheck } from 'react-icons/hi';
import toast from 'react-hot-toast';

const FOLDER_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6b7280'];

export default function FolderManager({ folders, onClose, onCreate, onUpdate, onDelete }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [parentId, setParentId] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');

  const rootFolders = folders.filter(f => !f.parent_id);
  const getChildren = (pid) => folders.filter(f => f.parent_id === pid);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await onCreate({ name: name.trim(), color, parent_id: parentId ? parseInt(parentId) : null });
      setName('');
      setColor('#3b82f6');
      setParentId('');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal membuat folder');
    }
  };

  const handleUpdate = async (id) => {
    if (!editName.trim()) return;
    try {
      await onUpdate(id, { name: editName.trim() });
      setEditingId(null);
    } catch (err) {
      toast.error('Gagal mengupdate folder');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Hapus folder ini? Notes di dalamnya akan dipindah ke root.')) return;
    try {
      await onDelete(id);
    } catch (err) {
      toast.error('Gagal menghapus folder');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Kelola Folder</h2>
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
              placeholder="Nama folder baru"
              className="form-input text-sm"
            />
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                {FOLDER_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-6 h-6 rounded-full border-2 ${color === c ? 'border-gray-800' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <select
                value={parentId}
                onChange={e => setParentId(e.target.value)}
                className="form-input text-sm flex-1"
              >
                <option value="">Root</option>
                {rootFolders.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
              <button type="submit" className="btn-primary text-sm py-2">Buat</button>
            </div>
          </form>

          {/* Folder list */}
          <div className="space-y-1">
            {rootFolders.map(folder => (
              <div key={folder.id}>
                <FolderItem
                  folder={folder}
                  isEditing={editingId === folder.id}
                  editName={editName}
                  onStartEdit={() => { setEditingId(folder.id); setEditName(folder.name); }}
                  onEditChange={setEditName}
                  onSaveEdit={() => handleUpdate(folder.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onDelete={() => handleDelete(folder.id)}
                />
                {getChildren(folder.id).map(child => (
                  <div key={child.id} className="ml-6">
                    <FolderItem
                      folder={child}
                      isEditing={editingId === child.id}
                      editName={editName}
                      onStartEdit={() => { setEditingId(child.id); setEditName(child.name); }}
                      onEditChange={setEditName}
                      onSaveEdit={() => handleUpdate(child.id)}
                      onCancelEdit={() => setEditingId(null)}
                      onDelete={() => handleDelete(child.id)}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FolderItem({ folder, isEditing, editName, onStartEdit, onEditChange, onSaveEdit, onCancelEdit, onDelete }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 group">
      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: folder.color || '#6b7280' }} />
      {isEditing ? (
        <div className="flex-1 flex items-center gap-1">
          <input
            type="text"
            value={editName}
            onChange={e => onEditChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSaveEdit(); if (e.key === 'Escape') onCancelEdit(); }}
            className="form-input text-sm py-1 flex-1"
            autoFocus
          />
          <button onClick={onSaveEdit} className="p-1 text-green-600 hover:bg-green-50 rounded">
            <HiOutlineCheck className="w-4 h-4" />
          </button>
          <button onClick={onCancelEdit} className="p-1 text-gray-400 hover:bg-gray-100 rounded">
            <HiOutlineX className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <>
          <span className="flex-1 text-sm text-gray-700">{folder.name}</span>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={onStartEdit} className="p-1 hover:bg-gray-200 rounded">
              <HiOutlinePencil className="w-3.5 h-3.5 text-gray-400" />
            </button>
            <button onClick={onDelete} className="p-1 hover:bg-red-100 rounded">
              <HiOutlineTrash className="w-3.5 h-3.5 text-red-400" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
