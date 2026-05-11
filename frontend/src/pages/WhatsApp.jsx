import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import api from '../services/api';

export default function WhatsApp() {
  const [status, setStatus] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [usersWithPhone, setUsersWithPhone] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [testNumber, setTestNumber] = useState('');
  const [customMessage, setCustomMessage] = useState('');
  const [customNumber, setCustomNumber] = useState('');
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [broadcastMessage, setBroadcastMessage] = useState('');

  const fetchStatus = useCallback(async () => {
    try {
      const response = await api.get('/whatsapp/status');
      setStatus(response.data.data);
    } catch (error) {
      console.error('Failed to fetch status:', error);
    }
  }, []);

  const fetchAccounts = useCallback(async () => {
    try {
      const response = await api.get('/whatsapp/accounts');
      setAccounts(response.data.data?.data?.accounts || []);
    } catch (error) {
      console.error('Failed to fetch accounts:', error);
    }
  }, []);

  const fetchUsersWithPhone = useCallback(async () => {
    try {
      const response = await api.get('/whatsapp/users-with-phone');
      setUsersWithPhone(response.data.data || []);
    } catch (error) {
      console.error('Failed to fetch users:', error);
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchStatus(), fetchAccounts(), fetchUsersWithPhone()]);
      setLoading(false);
    };
    loadData();

    // Refresh status every 30 seconds
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchAccounts, fetchUsersWithPhone]);

  const handleSendTest = async (e) => {
    e.preventDefault();
    if (!testNumber) {
      toast.error('Masukkan nomor WhatsApp');
      return;
    }
    setSending(true);
    try {
      await api.post('/whatsapp/test', { phone_number: testNumber });
      toast.success('Pesan test berhasil dikirim!');
      setTestNumber('');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Gagal mengirim pesan test');
    } finally {
      setSending(false);
    }
  };

  const handleSendCustom = async (e) => {
    e.preventDefault();
    if (!customNumber || !customMessage) {
      toast.error('Masukkan nomor dan pesan');
      return;
    }
    setSending(true);
    try {
      await api.post('/whatsapp/send', { 
        phone_number: customNumber, 
        message: customMessage 
      });
      toast.success('Pesan berhasil dikirim!');
      setCustomNumber('');
      setCustomMessage('');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Gagal mengirim pesan');
    } finally {
      setSending(false);
    }
  };

  const handleBroadcast = async (e) => {
    e.preventDefault();
    if (selectedUsers.length === 0) {
      toast.error('Pilih minimal satu pengguna');
      return;
    }
    if (!broadcastMessage) {
      toast.error('Masukkan pesan broadcast');
      return;
    }
    setSending(true);
    try {
      const response = await api.post('/whatsapp/broadcast', {
        user_ids: selectedUsers,
        message: broadcastMessage
      });
      toast.success(response.data.message);
      setSelectedUsers([]);
      setBroadcastMessage('');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Gagal mengirim broadcast');
    } finally {
      setSending(false);
    }
  };

  const toggleUserSelection = (userId) => {
    setSelectedUsers(prev => 
      prev.includes(userId) 
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const selectAllUsers = () => {
    if (selectedUsers.length === usersWithPhone.length) {
      setSelectedUsers([]);
    } else {
      setSelectedUsers(usersWithPhone.map(u => u.id));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">WhatsApp Management</h1>
        <button
          onClick={() => { fetchStatus(); fetchAccounts(); }}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Connection Status */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Status Koneksi</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-gray-50">
            <p className="text-sm text-gray-500">Status</p>
            <div className="flex items-center gap-2 mt-1">
              <span className={`w-3 h-3 rounded-full ${status?.data?.ready ? 'bg-green-500' : 'bg-red-500'}`}></span>
              <span className="font-semibold">{status?.data?.ready ? 'Terhubung' : 'Tidak Terhubung'}</span>
            </div>
          </div>
          <div className="p-4 rounded-lg bg-gray-50">
            <p className="text-sm text-gray-500">Nomor WhatsApp</p>
            <p className="font-semibold text-lg mt-1">
              {status?.linkedNumber ? `+${status.linkedNumber}` : '-'}
            </p>
            <p className="text-xs text-gray-400">{status?.linkedNumber ? `+${status.linkedNumber}` : ''}</p>
          </div>
          <div className="p-4 rounded-lg bg-gray-50">
            <p className="text-sm text-gray-500">Akun Tersedia</p>
            <p className="font-semibold text-lg mt-1">{accounts.length}</p>
          </div>
        </div>

        {/* Accounts List */}
        {accounts.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-medium text-gray-700 mb-2">Daftar Akun:</p>
            <div className="flex flex-wrap gap-2">
              {accounts.map((acc, idx) => (
                <div key={idx} className={`px-3 py-1 rounded-full text-sm ${acc.linked ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                  {acc.name || acc.id} {acc.linked && '✓'}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Test Connection */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Test Koneksi</h2>
        <form onSubmit={handleSendTest} className="flex gap-4">
          <input
            type="text"
            placeholder="Nomor WhatsApp (cth: 08123456789)"
            value={testNumber}
            onChange={(e) => setTestNumber(e.target.value)}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
          <button
            type="submit"
            disabled={sending || !status?.data?.ready}
            className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {sending ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Mengirim...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                Kirim Test
              </>
            )}
          </button>
        </form>
      </div>

      {/* Send Custom Message */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Kirim Pesan</h2>
        <form onSubmit={handleSendCustom} className="space-y-4">
          <input
            type="text"
            placeholder="Nomor WhatsApp (cth: 08123456789)"
            value={customNumber}
            onChange={(e) => setCustomNumber(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
          <textarea
            placeholder="Pesan..."
            value={customMessage}
            onChange={(e) => setCustomMessage(e.target.value)}
            rows={4}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
          />
          <button
            type="submit"
            disabled={sending || !status?.data?.ready}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? 'Mengirim...' : 'Kirim Pesan'}
          </button>
        </form>
      </div>

      {/* Broadcast Message */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Broadcast ke Pengguna</h2>
        
        {usersWithPhone.length === 0 ? (
          <p className="text-gray-500">Tidak ada pengguna dengan nomor WhatsApp</p>
        ) : (
          <form onSubmit={handleBroadcast} className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-2">
                <p className="text-sm font-medium text-gray-700">Pilih Pengguna:</p>
                <button
                  type="button"
                  onClick={selectAllUsers}
                  className="text-sm text-indigo-600 hover:text-indigo-800"
                >
                  {selectedUsers.length === usersWithPhone.length ? 'Hapus Semua' : 'Pilih Semua'}
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y">
                {usersWithPhone.map(user => (
                  <label
                    key={user.id}
                    className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedUsers.includes(user.id)}
                      onChange={() => toggleUserSelection(user.id)}
                      className="h-4 w-4 text-indigo-600 rounded border-gray-300"
                    />
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{user.username}</p>
                      <p className="text-sm text-gray-500">{user.phone_display}</p>
                    </div>
                  </label>
                ))}
              </div>
              <p className="text-sm text-gray-500 mt-1">
                {selectedUsers.length} pengguna dipilih
              </p>
            </div>

            <textarea
              placeholder="Pesan broadcast..."
              value={broadcastMessage}
              onChange={(e) => setBroadcastMessage(e.target.value)}
              rows={4}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
            />

            <button
              type="submit"
              disabled={sending || !status?.data?.ready || selectedUsers.length === 0}
              className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? 'Mengirim...' : `Kirim Broadcast (${selectedUsers.length} pengguna)`}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
