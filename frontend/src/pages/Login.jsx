import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { HiOutlineMail, HiOutlineLockClosed, HiOutlineEye, HiOutlineEyeOff } from 'react-icons/hi';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const user = await login(email, password);
      toast.success(`Welcome back, ${user.username}!`);

      if (user.must_change_password) {
        navigate('/settings');
        toast('Silakan ubah password Anda', { icon: '🔑' });
      } else {
        navigate('/dashboard');
      }
    } catch (error) {
      console.error('Login error:', error);
      toast.error(error.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-[45%] relative overflow-hidden sidebar-gradient flex-col justify-between p-10">
        {/* Decorative circles */}
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-white/5 rounded-full" />
        <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] bg-white/[0.03] rounded-full" />
        <div className="absolute top-1/2 left-1/3 w-64 h-64 bg-indigo-400/10 rounded-full blur-3xl" />

        {/* Logo area */}
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-10 h-10">
              <rect x="2" y="4" width="32" height="28" rx="6" fill="url(#lgGrad)" />
              <rect x="2" y="4" width="32" height="9" rx="6" fill="url(#lgGradTop)" />
              <rect x="2" y="10" width="32" height="3" fill="url(#lgGradTop)" />
              <rect x="10" y="2" width="3" height="6" rx="1.5" fill="white" opacity="0.9" />
              <rect x="23" y="2" width="3" height="6" rx="1.5" fill="white" opacity="0.9" />
              <path d="M12 21L16 25L25 16" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.95" />
              <defs>
                <linearGradient id="lgGrad" x1="2" y1="4" x2="34" y2="32" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#818cf8" />
                  <stop offset="1" stopColor="#a78bfa" />
                </linearGradient>
                <linearGradient id="lgGradTop" x1="2" y1="4" x2="34" y2="13" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#6366f1" />
                  <stop offset="1" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>
            </svg>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Agenda Work</h2>
              <p className="text-[11px] text-indigo-300/50 font-medium tracking-wide">Team Workspace</p>
            </div>
          </div>
        </div>

        {/* Tagline */}
        <div className="relative z-10 max-w-sm">
          <h1 className="text-3xl font-extrabold text-white leading-tight mb-4">
            Kelola tugas tim<br />
            <span className="text-indigo-300">dalam satu tempat.</span>
          </h1>
          <p className="text-indigo-200/60 text-sm leading-relaxed">
            Timeline, catatan, reminder, dan automasi — semua terintegrasi untuk produktivitas tim BPS Provinsi Maluku Utara.
          </p>
        </div>

        {/* Footer */}
        <p className="relative z-10 text-[11px] text-indigo-300/30">
          &copy; {new Date().getFullYear()} BPS Provinsi Maluku Utara
        </p>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center bg-gray-50 px-6 py-10">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2.5 mb-8 justify-center">
            <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-9 h-9">
              <rect x="2" y="4" width="32" height="28" rx="6" fill="url(#mGrad)" />
              <rect x="2" y="4" width="32" height="9" rx="6" fill="url(#mGradTop)" />
              <rect x="2" y="10" width="32" height="3" fill="url(#mGradTop)" />
              <rect x="10" y="2" width="3" height="6" rx="1.5" fill="white" opacity="0.9" />
              <rect x="23" y="2" width="3" height="6" rx="1.5" fill="white" opacity="0.9" />
              <path d="M12 21L16 25L25 16" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.95" />
              <defs>
                <linearGradient id="mGrad" x1="2" y1="4" x2="34" y2="32" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#6366f1" /><stop offset="1" stopColor="#8b5cf6" />
                </linearGradient>
                <linearGradient id="mGradTop" x1="2" y1="4" x2="34" y2="13" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#4f46e5" /><stop offset="1" stopColor="#7c3aed" />
                </linearGradient>
              </defs>
            </svg>
            <span className="text-lg font-bold text-gray-900 tracking-tight">Agenda Work</span>
          </div>

          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">Masuk</h1>
            <p className="text-sm text-gray-500 mb-8">Masukkan email dan password untuk melanjutkan</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Email</label>
              <div className="relative">
                <HiOutlineMail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition"
                  placeholder="nama@bps.go.id"
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Password</label>
              <div className="relative">
                <HiOutlineLockClosed className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-gray-400" />
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-11 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition"
                  placeholder="Masukkan password"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 transition-colors"
                  tabIndex={-1}
                >
                  {showPw ? <HiOutlineEyeOff className="w-4 h-4" /> : <HiOutlineEye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl shadow-sm shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Masuk...
                </span>
              ) : 'Masuk'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-500">
            Belum punya akun?{' '}
            <Link to="/register" className="text-indigo-600 hover:text-indigo-700 font-semibold">
              Daftar
            </Link>
          </p>

          {/* Mobile copyright */}
          <p className="lg:hidden mt-10 text-center text-[11px] text-gray-400">
            &copy; {new Date().getFullYear()} BPS Provinsi Maluku Utara
          </p>
        </div>
      </div>
    </div>
  );
}
