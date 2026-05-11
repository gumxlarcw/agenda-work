import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authAPI } from '../services/api';
import toast from 'react-hot-toast';
import { HiOutlineLockClosed } from 'react-icons/hi';

export default function ChangePassword() {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (formData.newPassword !== formData.confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    if (formData.newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    try {
      await authAPI.changePassword(formData.currentPassword, formData.newPassword);

      // Update user to remove must_change_password flag
      if (user.must_change_password) {
        updateUser({ ...user, must_change_password: false });
      }

      toast.success('Password changed successfully');
      navigate('/dashboard');
    } catch (error) {
      const data = error.response?.data;
      toast.error(data?.message || data?.errors?.[0]?.msg || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto animate-fadeIn">
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-primary-100 flex items-center justify-center">
            <HiOutlineLockClosed className="w-6 h-6 text-primary-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Change Password</h1>
            <p className="text-gray-500 text-sm">Update your account password</p>
          </div>
        </div>

        {user?.must_change_password && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <p className="text-yellow-800 text-sm">
              ⚠️ You are required to change your password before continuing.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="form-label">Current Password</label>
            <input
              type="password"
              name="currentPassword"
              value={formData.currentPassword}
              onChange={handleChange}
              className="form-input"
              required
              placeholder="Enter current password"
            />
          </div>

          <div>
            <label className="form-label">New Password</label>
            <input
              type="password"
              name="newPassword"
              value={formData.newPassword}
              onChange={handleChange}
              className="form-input"
              required
              minLength={6}
              placeholder="Enter new password"
            />
          </div>

          <div>
            <label className="form-label">Confirm New Password</label>
            <input
              type="password"
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleChange}
              className="form-input"
              required
              placeholder="Confirm new password"
            />
          </div>

          <div className="flex gap-3 pt-4">
            {!user?.must_change_password && (
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={loading}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              {loading ? 'Changing...' : 'Change Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
