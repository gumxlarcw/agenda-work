import { useState, useEffect } from 'react';
import { HiOutlineX, HiOutlineCheck, HiOutlineEye, HiOutlinePencil } from 'react-icons/hi';
import toast from 'react-hot-toast';
import api from '../../services/api';

export default function ShareModal({ note, onClose, onSave }) {
  const [users, setUsers] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [roles, setRoles] = useState({}); // { userId: 'viewer'|'editor' }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchUsers();
    // Parse current shared_with
    if (note.shared_with) {
      try {
        const shared = typeof note.shared_with === 'string' ? JSON.parse(note.shared_with) : note.shared_with;
        setSelectedIds(Array.isArray(shared) ? shared : []);
      } catch { setSelectedIds([]); }
    }
    // Parse current shared_roles
    if (note.shared_roles) {
      try {
        const r = typeof note.shared_roles === 'string' ? JSON.parse(note.shared_roles) : note.shared_roles;
        if (r && typeof r === 'object') setRoles(r);
      } catch { /* ignore */ }
    }
  }, [note]);

  const fetchUsers = async () => {
    try {
      const res = await api.get('/notes/shareable-users');
      setUsers(res.data.data || []);
    } catch (err) {
      toast.error('Gagal memuat daftar pengguna');
    } finally {
      setLoading(false);
    }
  };

  const toggleUser = (userId) => {
    setSelectedIds(prev => {
      if (prev.includes(userId)) {
        // Remove user — also clean up role
        const newRoles = { ...roles };
        delete newRoles[userId];
        setRoles(newRoles);
        return prev.filter(id => id !== userId);
      } else {
        // Add user — default to viewer
        setRoles(r => ({ ...r, [userId]: 'viewer' }));
        return [...prev, userId];
      }
    });
  };

  const toggleRole = (userId) => {
    setRoles(r => ({
      ...r,
      [userId]: r[userId] === 'editor' ? 'viewer' : 'editor',
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(selectedIds, roles);
      onClose();
    } catch (err) {
      toast.error('Gagal menyimpan sharing');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-xl w-full max-w-sm shadow-2xl">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Bagikan Note</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg" aria-label="Tutup">
            <HiOutlineX className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 max-h-[50vh] overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
            </div>
          ) : users.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">Tidak ada pengguna lain</p>
          ) : (
            <div className="space-y-1">
              {users.map(user => {
                const isSelected = selectedIds.includes(user.id);
                const role = roles[user.id] || 'viewer';
                return (
                  <div
                    key={user.id}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-lg transition-colors ${
                      isSelected ? 'bg-primary-50 border border-primary-200' : 'hover:bg-gray-50 border border-transparent'
                    }`}
                  >
                    {/* Select toggle */}
                    <button
                      onClick={() => toggleUser(user.id)}
                      className="flex items-center gap-2.5 flex-1 min-w-0"
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0 ${
                        isSelected ? 'bg-primary-100 text-primary-700' : 'bg-gray-200 text-gray-600'
                      }`}>
                        {(user.name || user.username)?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div className="min-w-0 text-left">
                        <p className="text-sm text-gray-700 truncate">{user.name || user.username}</p>
                        {user.tim && <p className="text-[10px] text-gray-400 truncate">{user.tim}</p>}
                      </div>
                    </button>

                    {/* Role toggle — only shown when selected */}
                    {isSelected && (
                      <button
                        onClick={() => toggleRole(user.id)}
                        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors flex-shrink-0 ${
                          role === 'editor'
                            ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                        title={role === 'editor' ? 'Bisa mengedit' : 'Hanya baca'}
                      >
                        {role === 'editor' ? (
                          <><HiOutlinePencil className="w-3 h-3" /> Editor</>
                        ) : (
                          <><HiOutlineEye className="w-3 h-3" /> Viewer</>
                        )}
                      </button>
                    )}

                    {isSelected && <HiOutlineCheck className="w-4 h-4 text-primary-600 flex-shrink-0" />}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-4 border-t flex justify-between items-center">
          <span className="text-xs text-gray-400">
            {selectedIds.length} pengguna dipilih
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary text-sm py-2">Batal</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary text-sm py-2">
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
