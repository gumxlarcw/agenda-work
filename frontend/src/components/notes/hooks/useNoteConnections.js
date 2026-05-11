import { useState, useEffect, useCallback } from 'react';
import { noteConnectionsAPI } from '../../../services/api';
import toast from 'react-hot-toast';

export default function useNoteConnections(sharedOwnerId = null) {
  const [connections, setConnections] = useState([]);
  const [connectMode, setConnectMode] = useState(false);
  const [connectSource, setConnectSource] = useState(null);

  const fetchConnections = useCallback(async () => {
    try {
      const params = sharedOwnerId ? { owner_id: sharedOwnerId } : {};
      const res = await noteConnectionsAPI.getAll(params);
      setConnections(res.data?.data || []);
    } catch { /* ignore on initial load */ }
  }, [sharedOwnerId]);

  useEffect(() => { fetchConnections(); }, [fetchConnections]);

  const createConnection = useCallback(async (sourceId, targetId, label = null) => {
    try {
      await noteConnectionsAPI.create({ source_note_id: sourceId, target_note_id: targetId, label });
      await fetchConnections();
      toast.success('Koneksi dibuat');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal membuat koneksi');
    }
  }, [fetchConnections]);

  const deleteConnection = useCallback(async (connId) => {
    try {
      await noteConnectionsAPI.delete(connId);
      setConnections(prev => prev.filter(c => c.id !== connId));
      toast.success('Koneksi dihapus');
    } catch {
      toast.error('Gagal menghapus koneksi');
    }
  }, []);

  // Connect mode: user clicks source, then target
  const startConnectMode = useCallback(() => {
    setConnectMode(true);
    setConnectSource(null);
  }, []);

  const cancelConnectMode = useCallback(() => {
    setConnectMode(false);
    setConnectSource(null);
  }, []);

  const handleConnectClick = useCallback((noteId) => {
    if (!connectMode) return false;
    if (!connectSource) {
      setConnectSource(noteId);
      return true; // consumed
    }
    if (noteId === connectSource) {
      toast.error('Tidak bisa menghubungkan ke catatan yang sama');
      return true;
    }
    createConnection(connectSource, noteId);
    setConnectMode(false);
    setConnectSource(null);
    return true; // consumed
  }, [connectMode, connectSource, createConnection]);

  return {
    connections, connectMode, connectSource,
    fetchConnections, createConnection, deleteConnection,
    startConnectMode, cancelConnectMode, handleConnectClick,
  };
}
