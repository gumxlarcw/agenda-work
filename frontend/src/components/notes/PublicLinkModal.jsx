import { useState, useEffect, useCallback } from 'react';
import { notePublicShareAPI } from '../../services/api';
import {
  HiOutlineLink,
  HiOutlineClipboardCopy,
  HiOutlineX,
  HiOutlineTrash,
  HiOutlineEye,
  HiOutlineFolder,
  HiOutlineDocumentText,
  HiOutlineCheck,
} from 'react-icons/hi';
import toast from 'react-hot-toast';

const BASE_URL = import.meta.env.PROD
  ? 'https://agenda.bpsmalut.com'
  : window.location.origin;

export default function PublicLinkModal({ onClose, noteId = null, folderId = null, folderName = null, noteTitle = null }) {
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [ttl, setTtl] = useState('never');

  const shareType = folderId ? 'folder' : 'note';
  const itemName = folderId ? folderName : noteTitle;

  const fetchShares = useCallback(async () => {
    try {
      const res = await notePublicShareAPI.list();
      const all = res.data?.data || [];
      // Filter to relevant shares
      const filtered = all.filter(s => {
        if (shareType === 'note') return s.share_type === 'note' && s.note_id === noteId;
        return s.share_type === 'folder' && s.folder_id === folderId;
      });
      setShares(filtered);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [noteId, folderId, shareType]);

  useEffect(() => { fetchShares(); }, [fetchShares]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const payload = { share_type: shareType };
      if (shareType === 'note') payload.note_id = noteId;
      else payload.folder_id = folderId;
      const expires_at = ttl === 'never'
        ? null
        : new Date(Date.now() + ({ '7d': 7, '30d': 30, '90d': 90 }[ttl]) * 24 * 60 * 60 * 1000).toISOString();
      payload.expires_at = expires_at;
      await notePublicShareAPI.create(payload);
      await fetchShares();
      toast.success('Public link dibuat');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal membuat link');
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (share) => {
    try {
      await notePublicShareAPI.toggle(share.id);
      await fetchShares();
      toast.success(share.is_active ? 'Link dinonaktifkan' : 'Link diaktifkan');
    } catch {
      toast.error('Gagal mengubah status');
    }
  };

  const handleDelete = async (share) => {
    try {
      await notePublicShareAPI.delete(share.id);
      setShares(prev => prev.filter(s => s.id !== share.id));
      toast.success('Link dihapus');
    } catch {
      toast.error('Gagal menghapus');
    }
  };

  const getLink = (share) => {
    const prefix = share.share_type === 'folder' ? 'f' : 'n';
    return `${BASE_URL}/public/${prefix}/${share.share_token}`;
  };

  const copyLink = (share) => {
    navigator.clipboard.writeText(getLink(share));
    setCopiedId(share.id);
    toast.success('Link disalin');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const existingShare = shares[0]; // Usually only one per note/folder

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-fadeIn">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
              <HiOutlineLink className="w-4 h-4 text-primary-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-800 text-sm">Public Link</h3>
              <p className="text-[10px] text-gray-400 flex items-center gap-1">
                {shareType === 'folder' ? <HiOutlineFolder className="w-3 h-3" /> : <HiOutlineDocumentText className="w-3 h-3" />}
                {itemName || 'Untitled'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
            <HiOutlineX className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : existingShare ? (
            <div className="space-y-3">
              {/* Link display */}
              <div className="flex items-center gap-2 bg-gray-50 rounded-xl p-3 border border-gray-200">
                <input
                  type="text"
                  readOnly
                  value={getLink(existingShare)}
                  className="flex-1 text-xs text-gray-600 bg-transparent border-none outline-none font-mono truncate"
                />
                <button
                  onClick={() => copyLink(existingShare)}
                  className={`p-2 rounded-lg transition-colors flex-shrink-0 ${
                    copiedId === existingShare.id
                      ? 'bg-green-100 text-green-600'
                      : 'bg-white hover:bg-gray-100 text-gray-500 border border-gray-200'
                  }`}
                >
                  {copiedId === existingShare.id ? <HiOutlineCheck className="w-4 h-4" /> : <HiOutlineClipboardCopy className="w-4 h-4" />}
                </button>
              </div>

              {/* Status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${
                    existingShare.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${existingShare.is_active ? 'bg-green-500' : 'bg-gray-400'}`} />
                    {existingShare.is_active ? 'Aktif' : 'Nonaktif'}
                  </span>
                  <span className="text-[10px] text-gray-400 flex items-center gap-1">
                    <HiOutlineEye className="w-3 h-3" /> {existingShare.view_count || 0} views
                  </span>
                  {existingShare.expires_at && (
                    <span className="text-[10px] text-amber-600 font-medium">
                      Berlaku hingga {new Date(existingShare.expires_at).toLocaleDateString('id-ID')}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-gray-400">
                  {new Date(existingShare.created_at).toLocaleDateString('id-ID')}
                </span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                <button
                  onClick={() => handleToggle(existingShare)}
                  className={`flex-1 py-2 text-xs font-medium rounded-xl border transition-colors ${
                    existingShare.is_active
                      ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                      : 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                  }`}
                >
                  {existingShare.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                </button>
                <button
                  onClick={() => handleDelete(existingShare)}
                  className="py-2 px-3 text-xs font-medium rounded-xl border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                >
                  <HiOutlineTrash className="w-3.5 h-3.5" />
                </button>
              </div>

              <p className="text-[10px] text-gray-400 text-center">
                Siapa saja yang memiliki link ini dapat melihat {shareType === 'folder' ? 'seluruh catatan dalam folder' : 'catatan ini'}
              </p>
            </div>
          ) : (
            <div className="text-center py-6">
              <div className="w-12 h-12 bg-primary-50 rounded-full flex items-center justify-center mx-auto mb-3">
                <HiOutlineLink className="w-6 h-6 text-primary-500" />
              </div>
              <h4 className="text-sm font-medium text-gray-700 mb-1">Buat Public Link</h4>
              <p className="text-xs text-gray-400 mb-4">
                Siapa saja yang memiliki link dapat melihat {shareType === 'folder' ? 'seluruh catatan dalam folder ini' : 'catatan ini'} tanpa login.
              </p>
              <div className="flex items-center gap-2 mb-3">
                <label className="text-xs text-gray-500">Berlaku</label>
                <select
                  value={ttl}
                  onChange={(e) => setTtl(e.target.value)}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
                >
                  <option value="never">Tanpa batas waktu</option>
                  <option value="7d">7 hari</option>
                  <option value="30d">30 hari</option>
                  <option value="90d">90 hari</option>
                </select>
              </div>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-xl hover:bg-primary-700 transition-colors disabled:opacity-50"
              >
                {creating ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <HiOutlineLink className="w-4 h-4" />
                )}
                Generate Link
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
