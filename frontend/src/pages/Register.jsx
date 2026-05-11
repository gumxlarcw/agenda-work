import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import {
  HiOutlineMail, HiOutlineLockClosed, HiOutlineUser,
  HiOutlinePhone, HiOutlineUserGroup, HiOutlineEye, HiOutlineEyeOff
} from 'react-icons/hi';

const TIM_OPTIONS = [
  'Tim Tata Usaha', 'Tim Binagram', 'Tim Keuangan', 'Tim Kepegawaian',
  'Tim IPDS', 'Tim NWAS', 'Tim Sosial', 'Tim Distribusi', 'Tim Produksi', 'Solo-ist'
];

export default function Register() {
  const [formData, setFormData] = useState({
    username: '', name: '', email: '', password: '',
    confirmPassword: '', phone_number: '', tim: ''
  });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formData.password !== formData.confirmPassword) {
      toast.error('Password tidak cocok');
      return;
    }
    if (formData.password.length < 10) {
      toast.error('Password minimal 10 karakter');
      return;
    }
    if (!/^[+]?[0-9]{10,15}$/.test(formData.phone_number)) {
      toast.error('Nomor HP tidak valid (10–15 digit, boleh diawali +)');
      return;
    }
    setLoading(true);
    try {
      const { confirmPassword, ...registerData } = formData;
      await register(registerData);
      toast.success('Registrasi berhasil!');
      navigate('/dashboard');
    } catch (error) {
      console.error('Register error:', error);
      toast.error(error.response?.data?.message || 'Registrasi gagal');
    } finally {
      setLoading(false);
    }
  };

  const inputCls = 'w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition';
  const labelCls = 'block text-[11px] font-semibold text-gray-500 mb-1 uppercase tracking-wide';
  const iconCls = 'absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-gray-400';

  return (
    <div className="min-h-screen flex">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-[45%] relative overflow-hidden sidebar-gradient flex-col justify-between p-10">
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-white/5 rounded-full" />
        <div className="absolute -bottom-32 -right-32 w-[500px] h-[500px] bg-white/[0.03] rounded-full" />
        <div className="absolute top-1/2 left-1/3 w-64 h-64 bg-indigo-400/10 rounded-full blur-3xl" />

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-10 h-10">
              <rect x="2" y="4" width="32" height="28" rx="6" fill="url(#rgGrad)" />
              <rect x="2" y="4" width="32" height="9" rx="6" fill="url(#rgGradTop)" />
              <rect x="2" y="10" width="32" height="3" fill="url(#rgGradTop)" />
              <rect x="10" y="2" width="3" height="6" rx="1.5" fill="white" opacity="0.9" />
              <rect x="23" y="2" width="3" height="6" rx="1.5" fill="white" opacity="0.9" />
              <path d="M12 21L16 25L25 16" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.95" />
              <defs>
                <linearGradient id="rgGrad" x1="2" y1="4" x2="34" y2="32" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#818cf8" /><stop offset="1" stopColor="#a78bfa" />
                </linearGradient>
                <linearGradient id="rgGradTop" x1="2" y1="4" x2="34" y2="13" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#6366f1" /><stop offset="1" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>
            </svg>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Agenda Work</h2>
              <p className="text-[11px] text-indigo-300/50 font-medium tracking-wide">Team Workspace</p>
            </div>
          </div>
        </div>

        <div className="relative z-10 max-w-sm">
          <h1 className="text-3xl font-extrabold text-white leading-tight mb-4">
            Bergabung dengan<br />
            <span className="text-indigo-300">tim Anda.</span>
          </h1>
          <p className="text-indigo-200/60 text-sm leading-relaxed">
            Daftarkan akun dan mulai berkolaborasi dengan rekan satu tim di BPS Provinsi Maluku Utara.
          </p>
        </div>

        <p className="relative z-10 text-[11px] text-indigo-300/30">
          &copy; {new Date().getFullYear()} BPS Provinsi Maluku Utara
        </p>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center bg-gray-50 px-6 py-8">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-2.5 mb-6 justify-center">
            <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-9 h-9">
              <rect x="2" y="4" width="32" height="28" rx="6" fill="url(#mrGrad)" />
              <rect x="2" y="4" width="32" height="9" rx="6" fill="url(#mrGradTop)" />
              <rect x="2" y="10" width="32" height="3" fill="url(#mrGradTop)" />
              <rect x="10" y="2" width="3" height="6" rx="1.5" fill="white" opacity="0.9" />
              <rect x="23" y="2" width="3" height="6" rx="1.5" fill="white" opacity="0.9" />
              <path d="M12 21L16 25L25 16" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.95" />
              <defs>
                <linearGradient id="mrGrad" x1="2" y1="4" x2="34" y2="32" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#6366f1" /><stop offset="1" stopColor="#8b5cf6" />
                </linearGradient>
                <linearGradient id="mrGradTop" x1="2" y1="4" x2="34" y2="13" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#4f46e5" /><stop offset="1" stopColor="#7c3aed" />
                </linearGradient>
              </defs>
            </svg>
            <span className="text-lg font-bold text-gray-900 tracking-tight">Agenda Work</span>
          </div>

          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">Buat Akun</h1>
            <p className="text-sm text-gray-500 mb-6">Lengkapi data di bawah untuk mendaftar</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {/* Username + Name — side by side */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Username</label>
                <div className="relative">
                  <HiOutlineUser className={iconCls} />
                  <input type="text" name="username" value={formData.username} onChange={handleChange}
                    className={inputCls} placeholder="username" required minLength={3} autoComplete="username" />
                </div>
              </div>
              <div>
                <label className={labelCls}>Nama Lengkap</label>
                <div className="relative">
                  <HiOutlineUser className={iconCls} />
                  <input type="text" name="name" value={formData.name} onChange={handleChange}
                    className={inputCls} placeholder="Nama Anda" required />
                </div>
              </div>
            </div>

            <div>
              <label className={labelCls}>Email</label>
              <div className="relative">
                <HiOutlineMail className={iconCls} />
                <input type="email" name="email" value={formData.email} onChange={handleChange}
                  className={inputCls} placeholder="nama@bps.go.id" required autoComplete="email" />
              </div>
            </div>

            {/* Phone + Tim — side by side */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>No. HP (WhatsApp)</label>
                <div className="relative">
                  <HiOutlinePhone className={iconCls} />
                  <input type="tel" name="phone_number" value={formData.phone_number} onChange={handleChange}
                    className={inputCls} placeholder="+628xxx" required pattern="^[+]?[0-9]{10,15}$"
                    title="10–15 digit, boleh diawali +" autoComplete="tel" />
                </div>
              </div>
              <div>
                <label className={labelCls}>Tim</label>
                <div className="relative">
                  <HiOutlineUserGroup className={iconCls} />
                  <select name="tim" value={formData.tim} onChange={handleChange}
                    className={`${inputCls} appearance-none`} required>
                    <option value="">Pilih Tim</option>
                    {TIM_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div>
              <label className={labelCls}>Password</label>
              <div className="relative">
                <HiOutlineLockClosed className={iconCls} />
                <input type={showPw ? 'text' : 'password'} name="password" value={formData.password} onChange={handleChange}
                  className="w-full pl-10 pr-11 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 transition"
                  placeholder="Min. 10 karakter" required minLength={10} autoComplete="new-password" />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 transition-colors" tabIndex={-1}>
                  {showPw ? <HiOutlineEyeOff className="w-4 h-4" /> : <HiOutlineEye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className={labelCls}>Konfirmasi Password</label>
              <div className="relative">
                <HiOutlineLockClosed className={iconCls} />
                <input type={showPw ? 'text' : 'password'} name="confirmPassword" value={formData.confirmPassword} onChange={handleChange}
                  className={inputCls} placeholder="Ulangi password" required autoComplete="new-password" />
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl shadow-sm shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-1">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Mendaftar...
                </span>
              ) : 'Buat Akun'}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-gray-500">
            Sudah punya akun?{' '}
            <Link to="/login" className="text-indigo-600 hover:text-indigo-700 font-semibold">
              Masuk
            </Link>
          </p>

          <p className="lg:hidden mt-8 text-center text-[11px] text-gray-400">
            &copy; {new Date().getFullYear()} BPS Provinsi Maluku Utara
          </p>
        </div>
      </div>
    </div>
  );
}
