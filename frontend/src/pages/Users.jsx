import { useState, useEffect } from 'react';
import { usersAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';
import {
  HiOutlinePlus,
  HiOutlinePencil,
  HiOutlineTrash,
  HiOutlineX,
  HiOutlineKey
} from 'react-icons/hi';

const TIM_OPTIONS = [
  'Tim Tata Usaha', 'Tim Binagram', 'Tim Keuangan', 'Tim Kepegawaian',
  'Tim IPDS', 'Tim NWAS', 'Tim Sosial', 'Tim Distribusi', 'Tim Produksi', 'Solo-ist'
];

const initialFormData = {
  username: '',
  name: '',
  email: '',
  phone_number: '',
  password: '',
  role: 'user',
  tim: 'Tim IPDS'
};

export default function Users() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState(initialFormData);
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // #47: defense-in-depth — ProtectedRoute gate already blocks non-admins, but
    // a client-side guard here avoids an eager 403 request to /api/users if the
    // gate ever regresses.
    if (user && user.role !== 'admin') {
      setLoading(false);
      return;
    }
    if (user) fetchUsers();
  }, [user]);

  const fetchUsers = async () => {
    try {
      const response = await usersAPI.getAll();
      setUsers(response.data.data);
    } catch (error) {
      toast.error('Failed to fetch users');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const openCreateModal = () => {
    setEditingUser(null);
    setFormData(initialFormData);
    setShowModal(true);
  };

  const openEditModal = (user) => {
    setEditingUser(user);
    setFormData({
      username: user.username || '',
      name: user.name || '',
      email: user.email || '',
      phone_number: user.phone_number || '',
      password: '',
      role: user.role || 'user',
      tim: user.tim || 'Tim IPDS'
    });
    setShowModal(true);
  };

  const openPasswordModal = (user) => {
    setEditingUser(user);
    setNewPassword('');
    setShowPasswordModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      if (editingUser) {
        const { password, ...updateData } = formData;
        await usersAPI.update(editingUser.id, updateData);
        toast.success('User updated');
      } else {
        await usersAPI.create(formData);
        toast.success('User created');
      }

      setShowModal(false);
      fetchUsers();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to save user');
    } finally {
      setSaving(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      await usersAPI.resetPassword(editingUser.id, newPassword);
      toast.success('Password reset successfully');
      setShowPasswordModal(false);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to reset password');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this user? This will also delete all their data.')) return;

    try {
      await usersAPI.delete(id);
      toast.success('User deleted');
      fetchUsers();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to delete user');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <p className="text-gray-500">{users.length} users</p>
        </div>
        <button onClick={openCreateModal} className="btn-primary flex items-center gap-2">
          <HiOutlinePlus className="w-5 h-5" />
          Add User
        </button>
      </div>

      {/* Users Table - Desktop */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left p-4 font-medium text-gray-600">User</th>
                <th className="text-left p-4 font-medium text-gray-600">Nama</th>
                <th className="text-left p-4 font-medium text-gray-600">Email</th>
                <th className="text-left p-4 font-medium text-gray-600">Phone</th>
                <th className="text-left p-4 font-medium text-gray-600">Tim</th>
                <th className="text-left p-4 font-medium text-gray-600">Role</th>
                <th className="text-left p-4 font-medium text-gray-600">Created</th>
                <th className="text-left p-4 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                        <span className="text-primary-600 font-semibold">
                          {(user.name || user.username || '?').charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <span className="font-medium text-gray-900">{user.username}</span>
                    </div>
                  </td>
                  <td className="p-4 text-gray-600">{user.name || '-'}</td>
                  <td className="p-4 text-gray-600">{user.email}</td>
                  <td className="p-4 text-gray-600">{user.phone_number || '-'}</td>
                  <td className="p-4">
                    <span className="px-2 py-1 text-xs font-medium rounded bg-blue-50 text-blue-700">
                      {user.tim || '-'}
                    </span>
                  </td>
                  <td className="p-4">
                    <span className={`px-2 py-1 text-xs font-medium rounded ${
                      user.role === 'admin'
                        ? 'bg-primary-100 text-primary-700'
                        : 'bg-gray-100 text-gray-700'
                    }`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="p-4 text-gray-500 text-sm">
                    {dayjs(user.created_at).format('DD MMM YYYY')}
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openPasswordModal(user)}
                        className="p-2 text-gray-500 hover:text-orange-600 hover:bg-orange-50 rounded-lg"
                        title="Reset password"
                      >
                        <HiOutlineKey className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openEditModal(user)}
                        className="p-2 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg"
                      >
                        <HiOutlinePencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(user.id)}
                        className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                      >
                        <HiOutlineTrash className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Users Cards - Mobile */}
      <div className="block md:hidden space-y-3">
        {users.map((user) => (
          <div key={user.id} className="bg-white rounded-xl shadow-sm p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                <span className="text-primary-600 font-semibold">
                  {(user.name || user.username || '?').charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900">{user.name || user.username}</p>
                <p className="text-sm text-gray-500 truncate">{user.email}</p>
              </div>
              <span className={`px-2 py-1 text-xs font-medium rounded flex-shrink-0 ${
                user.role === 'admin'
                  ? 'bg-primary-100 text-primary-700'
                  : 'bg-gray-100 text-gray-700'
              }`}>
                {user.role}
              </span>
            </div>
            <div className="text-sm text-gray-500 space-y-1">
              {user.tim && <p>Tim: <span className="font-medium text-blue-700">{user.tim}</span></p>}
              {user.phone_number && <p>Phone: {user.phone_number}</p>}
              <p>Joined: {dayjs(user.created_at).format('DD MMM YYYY')}</p>
            </div>
            <div className="flex items-center gap-2 pt-1 border-t">
              <button
                onClick={() => openPasswordModal(user)}
                className="p-2 text-gray-500 hover:text-orange-600 hover:bg-orange-50 rounded-lg"
                title="Reset password"
              >
                <HiOutlineKey className="w-5 h-5" />
              </button>
              <button
                onClick={() => openEditModal(user)}
                className="p-2 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg"
              >
                <HiOutlinePencil className="w-5 h-5" />
              </button>
              <button
                onClick={() => handleDelete(user.id)}
                className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
              >
                <HiOutlineTrash className="w-5 h-5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg mx-2 sm:mx-0 max-h-[95vh] overflow-y-auto">
            <div className="p-6 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">
                {editingUser ? 'Edit User' : 'Create User'}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <HiOutlineX className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="form-label">Username *</label>
                <input
                  type="text"
                  name="username"
                  value={formData.username}
                  onChange={handleChange}
                  className="form-input"
                  required
                  minLength={3}
                />
              </div>

              <div>
                <label className="form-label">Nama Lengkap</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  className="form-input"
                  placeholder="Nama lengkap user"
                />
              </div>

              <div>
                <label className="form-label">Email *</label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  className="form-input"
                  required
                />
              </div>

              <div>
                <label className="form-label">Phone Number</label>
                <input
                  type="tel"
                  name="phone_number"
                  value={formData.phone_number}
                  onChange={handleChange}
                  className="form-input"
                  placeholder="+628123456789"
                />
                <p className="text-xs text-gray-500 mt-1">For WhatsApp integration</p>
              </div>

              {!editingUser && (
                <div>
                  <label className="form-label">Password *</label>
                  <input
                    type="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    className="form-input"
                    required={!editingUser}
                    minLength={6}
                  />
                </div>
              )}

              <div>
                <label className="form-label">Tim *</label>
                <select
                  name="tim"
                  value={formData.tim}
                  onChange={handleChange}
                  className="form-input"
                  required
                >
                  {TIM_OPTIONS.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label">Role *</label>
                <select
                  name="role"
                  value={formData.role}
                  onChange={handleChange}
                  className="form-input"
                  required
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary disabled:opacity-50"
                >
                  {saving ? 'Saving...' : (editingUser ? 'Update' : 'Create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md mx-2 sm:mx-0 max-h-[95vh] overflow-y-auto">
            <div className="p-6 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">Reset Password</h2>
              <button
                onClick={() => setShowPasswordModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <HiOutlineX className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleResetPassword} className="p-6 space-y-4">
              <p className="text-gray-600">
                Reset password for <strong>{editingUser?.username}</strong>
              </p>

              <div>
                <label className="form-label">New Password *</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="form-input"
                  required
                  minLength={6}
                  placeholder="Enter new password"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary disabled:opacity-50"
                >
                  {saving ? 'Resetting...' : 'Reset Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
