import { useState, useEffect } from 'react';
import { noteFoldersAPI } from '../../services/api';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { HiOutlineX, HiOutlineUserAdd, HiOutlineTrash } from 'react-icons/hi';

export default function FolderShareModal({ folderId, folderName, onClose }) {
  const [users, setUsers] = useState([]); // all shareable users
  const [shares, setShares] = useState([]); // current shares
  const [selectedUserId, setSelectedUserId] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [usersRes, sharesRes] = await Promise.all([
        api.get('/notes/shareable-users'),
        noteFoldersAPI.getShares(folderId),
      ]);
      setUsers(usersRes.data.data || []);
      setShares(sharesRes.data.data || []);
    } catch {
      toast.error('Gagal memuat data');
    } finally {
      setLoading(false);
    }
  }

  async function handleShare() {
    if (!selectedUserId) return;
    try {
      await noteFoldersAPI.share(folderId, [parseInt(selectedUserId)], 'editor');
      toast.success('Folder berhasil di-share');
      setSelectedUserId('');
      loadData();
    } catch {
      toast.error('Gagal share folder');
    }
  }

  async function handleRemove(userId) {
    try {
      await noteFoldersAPI.removeShare(folderId, userId);
      toast.success('Share dihapus');
      loadData();
    } catch {
      toast.error('Gagal menghapus share');
    }
  }

  // Filter out already-shared users
  const sharedIds = new Set(shares.map(s => s.shared_with_user_id));
  const availableUsers = users.filter(u => !sharedIds.has(u.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4 animate-fadeIn" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">Share Folder: {folderName}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <HiOutlineX className="w-5 h-5" />
          </button>
        </div>

        {/* Add user */}
        <div className="flex gap-2">
          <select
            value={selectedUserId}
            onChange={e => setSelectedUserId(e.target.value)}
            className="form-input flex-1 text-sm"
          >
            <option value="">Pilih user...</option>
            {availableUsers.map(u => (
              <option key={u.id} value={u.id}>{u.name || u.username}</option>
            ))}
          </select>
          <button
            onClick={handleShare}
            disabled={!selectedUserId}
            className="btn btn-primary text-sm px-3 disabled:opacity-50"
          >
            <HiOutlineUserAdd className="w-4 h-4" />
          </button>
        </div>

        {/* Current shares */}
        {loading ? (
          <div className="text-sm text-gray-400 text-center py-4">Memuat...</div>
        ) : shares.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">Folder belum di-share ke siapapun</p>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {shares.map(s => (
              <div key={s.id} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">{s.user_name}</p>
                  <p className="text-xs text-gray-400">{s.username} &middot; {s.role}</p>
                </div>
                <button
                  onClick={() => handleRemove(s.shared_with_user_id)}
                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <HiOutlineTrash className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-gray-400">
          User yang di-share bisa melihat dan mengedit notes di folder ini, tapi tidak bisa menambah atau menghapus notes.
        </p>
      </div>
    </div>
  );
}
