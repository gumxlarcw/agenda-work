import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { authAPI, notificationSettingsAPI, dashboardAPI } from '../services/api';
import toast from 'react-hot-toast';
import {
  HiOutlineCog, HiOutlineBell, HiOutlineUser,
  HiOutlinePaperAirplane, HiOutlineCheck,
  HiOutlineShieldCheck, HiOutlineEye, HiOutlineEyeOff,
  HiOutlineDesktopComputer, HiOutlineMoon, HiOutlineSun,
  HiOutlineViewGrid, HiOutlineExclamation,
} from 'react-icons/hi';

/* ─── Constants ─────────────────────── */
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_SHORT = { Monday: 'Sen', Tuesday: 'Sel', Wednesday: 'Rab', Thursday: 'Kam', Friday: 'Jum', Saturday: 'Sab', Sunday: 'Min' };
const TYPES = [
  { value: 'daily', label: 'Daily', desc: 'Hari ini', scopeDesc: ['Hari ini saja', 'Hari ini + besok'] },
  { value: 'weekly', label: 'Weekly', desc: 'Minggu ini', scopeDesc: ['Minggu ini saja', 'Minggu ini + depan'] },
  { value: 'monthly', label: 'Monthly', desc: 'Bulan ini', scopeDesc: ['Bulan ini saja', 'Bulan ini + depan'] },
  { value: 'yearly', label: 'Yearly', desc: 'Tahun ini', scopeDesc: ['Tahun ini saja', 'Tahun ini + depan'] },
];
const SINGLE_DATE_LEVELS = [
  { value: 'H-7', label: 'H-7' },
  { value: 'H-3', label: 'H-3' },
  { value: 'H-1', label: 'H-1' },
  { value: 'Hari-H', label: 'Hari H' },
  { value: 'Overdue', label: 'Overdue' },
];
const RANGE_DATE_LEVELS = [
  { value: 'Dimulai', label: 'Dimulai' },
  { value: 'Sedang-Berlangsung', label: 'Sedang Berlangsung' },
  { value: 'Berakhir', label: 'Berakhir' },
];

const DASHBOARD_WIDGETS = [
  { key: 'stat-0', label: 'Total Tasks', group: 'Statistik' },
  { key: 'stat-1', label: 'Pending', group: 'Statistik' },
  { key: 'stat-2', label: 'In Progress', group: 'Statistik' },
  { key: 'stat-3', label: 'Completed', group: 'Statistik' },
  { key: 'stat-4', label: 'On Hold', group: 'Statistik' },
  { key: 'stat-5', label: 'Overdue', group: 'Statistik' },
  { key: 'today-focus', label: 'Fokus Hari Ini', group: 'Widget' },
  { key: 'calendar-heatmap', label: 'Calendar Heatmap', group: 'Widget' },
  { key: 'event-calendar', label: 'Kalender Event', group: 'Widget' },
  { key: 'recent-tasks', label: 'Task Terbaru', group: 'Widget' },
  { key: 'activity-feed', label: 'Activity Feed', group: 'Widget' },
  { key: 'recent-notes', label: 'Catatan Terbaru', group: 'Widget' },
];

/* ─── Theme helper ──────────────────── */
function applyThemeClass(theme) {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

export default function Settings() {
  const { user, updateUser } = useAuth();

  // ─── Profile state (single form)
  const [displayName, setDisplayName] = useState(user?.name || user?.username || '');
  const [phoneNumber, setPhoneNumber] = useState(user?.phone_number || '');
  const [savingProfile, setSavingProfile] = useState(false);

  // ─── Password state
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [savingPw, setSavingPw] = useState(false);

  // ─── Appearance state
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const [hiddenWidgets, setHiddenWidgets] = useState([]);
  const [loadingWidgets, setLoadingWidgets] = useState(true);

  // ─── Notification state
  const [sendingTest, setSendingTest] = useState(false);
  const [settings, setSettings] = useState({
    is_active: false,
    notification_time: '07:00',
    notification_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    notification_types: ['daily'],
    reminder_levels: ['H-1', 'Hari-H'],
    scope_lookahead: true,
  });
  const [loading, setLoading] = useState(true);
  const [autoSaving, setAutoSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const saveTimeoutRef = useRef(null);
  const settingsRef = useRef(settings);

  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // Apply theme class on mount
  useEffect(() => { applyThemeClass(theme); }, []);

  // ─── Load notification settings
  useEffect(() => {
    fetchSettings();
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, []);

  // ─── Load dashboard widget visibility
  useEffect(() => {
    (async () => {
      try {
        const res = await dashboardAPI.getLayout();
        let saved = res.data?.data;
        if (typeof saved === 'string') try { saved = JSON.parse(saved); } catch { saved = null; }
        if (saved?.hiddenWidgets && Array.isArray(saved.hiddenWidgets)) {
          setHiddenWidgets(saved.hiddenWidgets);
        }
      } catch { /* no saved layout */ }
      finally { setLoadingWidgets(false); }
    })();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await notificationSettingsAPI.get();
      const data = res.data.data;
      const s = {
        is_active: data.is_active || false,
        notification_time: data.notification_time ? data.notification_time.slice(0, 5) : '07:00',
        notification_days: data.notification_days || ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        notification_types: data.notification_types || ['daily'],
        reminder_levels: data.reminder_levels || ['H-1', 'Hari-H'],
        scope_lookahead: data.scope_lookahead !== undefined ? Boolean(data.scope_lookahead) : true,
      };
      setSettings(s);
      settingsRef.current = s;
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setLoading(false);
    }
  };

  // ─── Auto-save notification settings
  const autoSave = useCallback(async (newSettings, immediate = false) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    const doSave = async () => {
      setAutoSaving(true);
      try {
        await notificationSettingsAPI.update(newSettings);
        setLastSaved(Date.now());
      } catch (err) {
        toast.error(err.response?.data?.message || 'Gagal menyimpan');
      } finally {
        setAutoSaving(false);
      }
    };
    if (immediate) await doSave();
    else saveTimeoutRef.current = setTimeout(doSave, 800);
  }, []);

  const updateSetting = useCallback((key, value, immediate = true) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      autoSave(next, immediate);
      return next;
    });
  }, [autoSave]);

  // ─── Handlers: notification settings
  const handleToggleActive = () => {
    const newActive = !settings.is_active;
    if (newActive && !user?.phone_number && !phoneNumber) return toast.error('Set nomor HP terlebih dahulu');
    updateSetting('is_active', newActive, true);
    if (newActive) toast.success('Notifikasi diaktifkan');
  };
  const handleToggleDay = (day) => {
    const days = settings.notification_days.includes(day) ? settings.notification_days.filter(d => d !== day) : [...settings.notification_days, day];
    if (days.length === 0) return toast.error('Minimal 1 hari harus dipilih');
    updateSetting('notification_days', days, true);
  };
  const handleToggleLevel = (level) => {
    const levels = settings.reminder_levels.includes(level) ? settings.reminder_levels.filter(l => l !== level) : [...settings.reminder_levels, level];
    if (levels.length === 0) return toast.error('Minimal 1 level harus dipilih');
    updateSetting('reminder_levels', levels, true);
  };
  const handleToggleType = (type) => {
    const types = settings.notification_types.includes(type) ? settings.notification_types.filter(v => v !== type) : [...settings.notification_types, type];
    if (types.length === 0) return toast.error('Minimal 1 scope harus dipilih');
    updateSetting('notification_types', types, true);
  };
  const handleTimeChange = (e) => updateSetting('notification_time', e.target.value, false);
  const handleToggleLookahead = () => updateSetting('scope_lookahead', !settings.scope_lookahead, true);

  // ─── Handlers: profile (single save)
  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!displayName.trim()) return toast.error('Nama tidak boleh kosong');
    const payload = { name: displayName.trim() };
    // Only include phone if changed
    if (phoneNumber !== (user?.phone_number || '')) {
      if (phoneNumber && !phoneNumber.match(/^[+]?[0-9]{10,15}$/)) return toast.error('Nomor HP tidak valid (10-15 digit)');
      payload.phone_number = phoneNumber || null;
    }
    setSavingProfile(true);
    try {
      const res = await authAPI.updateProfile(payload);
      updateUser(res.data.data.user);
      toast.success('Profil berhasil disimpan');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal menyimpan profil');
    } finally { setSavingProfile(false); }
  };

  // ─── Handlers: password
  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (pwForm.newPassword !== pwForm.confirmPassword) return toast.error('Password baru tidak cocok');
    if (pwForm.newPassword.length < 6) return toast.error('Password baru minimal 6 karakter');
    setSavingPw(true);
    try {
      await authAPI.changePassword(pwForm.currentPassword, pwForm.newPassword);
      if (user.must_change_password) updateUser({ ...user, must_change_password: false });
      toast.success('Password berhasil diubah');
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      const data = err.response?.data;
      toast.error(data?.message || data?.errors?.[0]?.msg || 'Gagal mengubah password');
    } finally { setSavingPw(false); }
  };

  // ─── Handlers: theme
  const handleThemeChange = (newTheme) => {
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    applyThemeClass(newTheme);
    saveWidgetPrefs({ theme: newTheme });
  };

  // ─── Handlers: widget visibility
  const handleToggleWidget = (widgetKey) => {
    setHiddenWidgets(prev => {
      const next = prev.includes(widgetKey) ? prev.filter(k => k !== widgetKey) : [...prev, widgetKey];
      saveWidgetPrefs({ hiddenWidgets: next });
      return next;
    });
  };

  const saveWidgetPrefs = useCallback(async (partial) => {
    try {
      const res = await dashboardAPI.getLayout();
      let saved = res.data?.data;
      if (typeof saved === 'string') try { saved = JSON.parse(saved); } catch { saved = {}; }
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
      const merged = { ...saved, ...partial };
      await dashboardAPI.saveLayout(merged);
    } catch {
      try { await dashboardAPI.saveLayout(partial); } catch { /* ignore */ }
    }
  }, []);

  // ─── Handlers: test digest
  const handleTestNotification = async () => {
    setSendingTest(true);
    try {
      await notificationSettingsAPI.test();
      toast.success('Test digest terkirim! Cek WhatsApp.');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal mengirim test digest');
    } finally { setSendingTest(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  const initial = (user?.name || user?.username || '?')[0].toUpperCase();

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* ══════ Header ══════ */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center shadow-lg shadow-slate-200">
          <HiOutlineCog className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pengaturan</h1>
          <p className="text-xs text-gray-400 mt-0.5">Kelola profil, keamanan, dan preferensi</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ═══════ LEFT COLUMN ═══════ */}
        <div className="space-y-5">

          {/* ─── Profil Card ─── */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 pt-5 pb-4">
              <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2 mb-4">
                <HiOutlineUser className="w-4 h-4 text-primary-500" />
                Profil
              </h2>

              {/* Avatar + info */}
              <div className="flex items-center gap-3 p-3.5 bg-gray-50 rounded-xl mb-5">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-white font-bold text-lg shadow-sm">
                  {initial}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900 truncate">{user?.name || user?.username}</p>
                  <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="inline-block px-2 py-0.5 text-[10px] font-semibold bg-primary-100 text-primary-700 rounded-full uppercase">
                      {user?.role || 'user'}
                    </span>
                    {user?.tim ? (
                      <span className="inline-block px-2 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-600 rounded-full">
                        {user.tim}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Single profile form */}
              <form onSubmit={handleSaveProfile} className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Nama</label>
                  <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
                    className="form-input w-full text-sm" placeholder="Nama lengkap" />
                </div>

                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Email</label>
                  <input type="email" value={user?.email || ''} disabled
                    className="form-input w-full text-sm bg-gray-50 text-gray-400 cursor-not-allowed" />
                </div>

                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Nomor WhatsApp</label>
                  {!user?.phone_number ? (
                    <p className="text-xs text-amber-600 mb-1.5">Wajib diisi untuk menerima notifikasi</p>
                  ) : null}
                  <input type="text" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)}
                    className="form-input w-full text-sm" placeholder="6281234567890" />
                </div>

                <button type="submit" disabled={savingProfile}
                  className="w-full py-2.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors">
                  {savingProfile ? 'Menyimpan...' : 'Simpan Profil'}
                </button>
              </form>
            </div>
          </div>

          {/* ─── Tampilan Card ─── */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 pt-5 pb-5">
              <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2 mb-4">
                <HiOutlineDesktopComputer className="w-4 h-4 text-violet-500" />
                Tampilan
              </h2>

              {/* Theme Toggle */}
              <div className="mb-5">
                <label className="text-xs font-medium text-gray-500 mb-2 block">Tema</label>
                <div className="inline-flex rounded-lg bg-gray-100 p-0.5">
                  <button
                    onClick={() => handleThemeChange('light')}
                    className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md transition-all ${
                      theme === 'light' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <HiOutlineSun className="w-3.5 h-3.5" />
                    Light
                  </button>
                  <button
                    onClick={() => handleThemeChange('dark')}
                    className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md transition-all ${
                      theme === 'dark' ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <HiOutlineMoon className="w-3.5 h-3.5" />
                    Dark
                  </button>
                </div>
                {theme === 'dark' ? (
                  <p className="text-[11px] text-amber-500 mt-2 flex items-center gap-1">
                    <HiOutlineExclamation className="w-3 h-3" />
                    Dark mode visual akan tersedia di update mendatang. Preferensi disimpan.
                  </p>
                ) : null}
              </div>

              {/* Dashboard Widget Visibility */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <HiOutlineViewGrid className="w-3.5 h-3.5 text-gray-400" />
                  <label className="text-xs font-medium text-gray-500">Widget Dashboard</label>
                </div>
                <p className="text-[11px] text-gray-400 mb-3">Pilih widget yang tampil di dashboard</p>

                {loadingWidgets ? (
                  <div className="flex justify-center py-4">
                    <div className="w-5 h-5 border-2 border-gray-200 border-t-violet-500 rounded-full animate-spin" />
                  </div>
                ) : (
                  <div className="space-y-3">
                    {['Statistik', 'Widget'].map(group => (
                      <div key={group}>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{group}</p>
                        <div className="space-y-0.5">
                          {DASHBOARD_WIDGETS.filter(w => w.group === group).map(w => {
                            const visible = !hiddenWidgets.includes(w.key);
                            return (
                              <button
                                key={w.key}
                                onClick={() => handleToggleWidget(w.key)}
                                className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors"
                              >
                                <span className={`text-xs ${visible ? 'text-gray-700 font-medium' : 'text-gray-400'}`}>{w.label}</span>
                                <div className={`relative w-8 h-[18px] rounded-full transition-colors ${visible ? 'bg-violet-500' : 'bg-gray-200'}`}>
                                  <span className={`absolute top-[2px] left-[2px] w-[14px] h-[14px] bg-white rounded-full shadow transition-transform ${visible ? 'translate-x-[14px]' : ''}`} />
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ═══════ RIGHT COLUMN ═══════ */}
        <div className="space-y-5">

          {/* ─── Keamanan Card ─── */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            {user?.must_change_password ? (
              <div className="bg-amber-50 border-b border-amber-200 px-5 py-3 flex items-center gap-2">
                <HiOutlineExclamation className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <p className="text-xs text-amber-700 font-medium">Anda wajib mengubah password sebelum melanjutkan.</p>
              </div>
            ) : null}
            <div className="px-5 pt-5 pb-5">
              <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2 mb-4">
                <HiOutlineShieldCheck className="w-4 h-4 text-slate-500" />
                Keamanan
              </h2>
              <form onSubmit={handlePasswordChange} className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Password Saat Ini</label>
                  <div className="relative">
                    <input
                      type={showCurrentPw ? 'text' : 'password'}
                      value={pwForm.currentPassword}
                      onChange={e => setPwForm(p => ({ ...p, currentPassword: e.target.value }))}
                      className="form-input w-full text-sm pr-10" placeholder="Masukkan password saat ini" required
                    />
                    <button type="button" onClick={() => setShowCurrentPw(!showCurrentPw)}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600">
                      {showCurrentPw ? <HiOutlineEyeOff className="w-4 h-4" /> : <HiOutlineEye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Password Baru</label>
                  <div className="relative">
                    <input
                      type={showNewPw ? 'text' : 'password'}
                      value={pwForm.newPassword}
                      onChange={e => setPwForm(p => ({ ...p, newPassword: e.target.value }))}
                      className="form-input w-full text-sm pr-10" placeholder="Minimal 6 karakter" required minLength={6}
                    />
                    <button type="button" onClick={() => setShowNewPw(!showNewPw)}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600">
                      {showNewPw ? <HiOutlineEyeOff className="w-4 h-4" /> : <HiOutlineEye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">Password harus minimal 6 karakter.</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Konfirmasi Password Baru</label>
                  <input
                    type="password"
                    value={pwForm.confirmPassword}
                    onChange={e => setPwForm(p => ({ ...p, confirmPassword: e.target.value }))}
                    className="form-input w-full text-sm" placeholder="Ulangi password baru" required
                  />
                </div>
                <button type="submit" disabled={savingPw}
                  className="w-full py-2.5 bg-slate-700 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors">
                  {savingPw ? 'Menyimpan...' : 'Ubah Password'}
                </button>
              </form>
            </div>
          </div>

          {/* ─── WhatsApp Digest Card ─── */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 pt-5 pb-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                  <HiOutlineBell className="w-4 h-4 text-emerald-500" />
                  WhatsApp Digest
                </h2>
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  {autoSaving ? (
                    <>
                      <div className="w-3 h-3 border-2 border-gray-300 border-t-emerald-500 rounded-full animate-spin" />
                      <span>Menyimpan...</span>
                    </>
                  ) : lastSaved ? (
                    <>
                      <HiOutlineCheck className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="text-emerald-600">Tersimpan</span>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="space-y-5">
                {/* Enable Toggle */}
                <div className={`flex items-center justify-between p-3 rounded-lg transition-colors ${settings.is_active ? 'bg-emerald-50 border border-emerald-200' : 'bg-gray-50 border border-transparent'}`}>
                  <div>
                    <span className="text-sm font-semibold text-gray-800">Aktifkan Notifikasi</span>
                    <p className="text-xs text-gray-500 mt-0.5">Ringkasan agenda via WhatsApp (AI-powered)</p>
                  </div>
                  <button type="button" onClick={handleToggleActive} disabled={autoSaving}
                    className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${settings.is_active ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.is_active ? 'translate-x-5' : ''}`} />
                  </button>
                </div>

                {/* Notification Time */}
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Jam Notifikasi</label>
                  <input type="time" value={settings.notification_time} onChange={handleTimeChange} className="form-input text-sm w-auto" />
                </div>

                {/* Notification Days */}
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-2 block">Hari Notifikasi</label>
                  <div className="flex gap-1.5">
                    {DAYS.map(day => {
                      const active = settings.notification_days.includes(day);
                      return (
                        <button key={day} type="button" onClick={() => handleToggleDay(day)} disabled={autoSaving}
                          className={`flex-1 py-2 text-xs font-semibold rounded-lg border transition-all ${
                            active ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                          }`}>{DAY_SHORT[day]}</button>
                      );
                    })}
                  </div>
                </div>

                {/* Reminder Levels */}
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Reminder Level</label>
                  <p className="text-[11px] text-gray-400 mb-3">Kapan reminder muncul berdasarkan tipe tanggal</p>

                  <div className="mb-3">
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Single Date</span>
                    <div className="flex flex-wrap gap-1.5">
                      {SINGLE_DATE_LEVELS.map(l => {
                        const active = settings.reminder_levels.includes(l.value);
                        return (
                          <button key={l.value} type="button" onClick={() => handleToggleLevel(l.value)} disabled={autoSaving}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                              active ? 'bg-amber-500 border-amber-500 text-white shadow-sm' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                            }`}>{l.label}</button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Rentang Tanggal</span>
                    <div className="flex flex-wrap gap-1.5">
                      {RANGE_DATE_LEVELS.map(l => {
                        const active = settings.reminder_levels.includes(l.value);
                        return (
                          <button key={l.value} type="button" onClick={() => handleToggleLevel(l.value)} disabled={autoSaving}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                              active ? 'bg-blue-500 border-blue-500 text-white shadow-sm' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                            }`}>{l.label}</button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Summary Scope */}
                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Cakupan Ringkasan</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {TYPES.map(t => {
                      const active = settings.notification_types.includes(t.value);
                      return (
                        <button key={t.value} type="button" onClick={() => handleToggleType(t.value)} disabled={autoSaving}
                          className={`p-2.5 rounded-lg border text-left transition-all ${
                            active ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-gray-200 hover:border-gray-300'
                          }`}>
                          <span className={`text-sm font-semibold ${active ? 'text-emerald-700' : 'text-gray-600'}`}>{t.label}</span>
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            {active && settings.scope_lookahead ? t.scopeDesc[1] : active ? t.scopeDesc[0] : t.desc}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Lookahead */}
                <div className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                  settings.scope_lookahead ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200'
                }`}>
                  <div>
                    <span className="text-sm font-medium text-gray-700">Lihat Periode Berikutnya</span>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {settings.scope_lookahead ? 'Digest mencakup periode aktif + berikutnya' : 'Hanya periode aktif saat ini'}
                    </p>
                  </div>
                  <button type="button" onClick={handleToggleLookahead} disabled={autoSaving}
                    className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${settings.scope_lookahead ? 'bg-blue-500' : 'bg-gray-300'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${settings.scope_lookahead ? 'translate-x-5' : ''}`} />
                  </button>
                </div>

                {/* Test Digest */}
                <div className="pt-2 border-t border-gray-100">
                  <div className="flex items-center gap-2 mb-2">
                    <HiOutlinePaperAirplane className="w-3.5 h-3.5 text-blue-500" />
                    <span className="text-xs font-semibold text-gray-600">Test Digest</span>
                  </div>
                  {user?.phone_number ? (
                    <button onClick={handleTestNotification} disabled={sendingTest}
                      className="w-full py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                      {sendingTest ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Mengirim...
                        </>
                      ) : (
                        <>
                          <HiOutlinePaperAirplane className="w-4 h-4" />
                          Kirim ke {user.phone_number}
                        </>
                      )}
                    </button>
                  ) : (
                    <p className="text-xs text-gray-400 text-center py-2">Isi nomor HP di profil terlebih dahulu</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
