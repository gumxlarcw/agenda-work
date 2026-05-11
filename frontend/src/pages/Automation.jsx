import { useState, useEffect, useRef, useMemo } from 'react';
import { automationAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useAutomationRun } from '../context/AutomationRunContext';
import toast from 'react-hot-toast';
import { sanitizeUrl } from '../utils/sanitizeUrl';
import dayjs from 'dayjs';
import ConfirmDialog from '../components/notes/ConfirmDialog';
import {
  HiOutlineEye,
  HiOutlinePlay,
  HiOutlineStop,
  HiOutlineRefresh,
  HiOutlineChevronDown,
  HiOutlineChevronUp,
  HiOutlineExternalLink,
  HiOutlineKey,
  HiOutlineLockClosed,
  HiOutlineCheckCircle,
  HiOutlineXCircle,
  HiOutlineClock,
  HiOutlineX,
  HiOutlineMinusSm,
  HiOutlineLightningBolt,
  HiOutlineCollection,
  HiOutlineExclamation,
  HiOutlineCalendar,
} from 'react-icons/hi';

const MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

const STATUS_COLORS = {
  queued: 'bg-purple-100 text-purple-800',
  pending: 'bg-yellow-100 text-yellow-800',
  running: 'bg-blue-100 text-blue-800',
  waiting_otp: 'bg-orange-100 text-orange-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-800',
};

const STATUS_BORDER = {
  completed: 'border-l-green-500',
  failed: 'border-l-red-500',
  cancelled: 'border-l-gray-400',
  running: 'border-l-blue-500',
  waiting_otp: 'border-l-orange-500',
  queued: 'border-l-purple-500',
  pending: 'border-l-yellow-500',
};

/* ─── Stat config ─────────────────────── */
const STAT_CONFIG = [
  { key: 'total', label: 'Total Run', icon: HiOutlineCollection, color: 'from-indigo-500 to-indigo-700' },
  { key: 'completed', label: 'Berhasil', icon: HiOutlineCheckCircle, color: 'from-green-500 to-green-600' },
  { key: 'failed', label: 'Gagal', icon: HiOutlineXCircle, color: 'from-red-500 to-red-600' },
  { key: 'last', label: 'Terakhir', icon: HiOutlineClock, color: 'from-amber-500 to-amber-600' },
];

// Modal steps
const STEP_CREDENTIALS = 'credentials';
const STEP_PROGRESS = 'progress';

// Parse log into phases for visual step indicator
function parseLogPhases(log) {
  if (!log) return { currentPhase: 'init', phases: [] };

  const phases = [
    { id: 'db', label: 'Ambil Data', icon: 'db', status: 'pending' },
    { id: 'browser', label: 'Mulai Browser', icon: 'browser', status: 'pending' },
    { id: 'login', label: 'Login SSO', icon: 'login', status: 'pending' },
    { id: 'setup', label: 'Persiapan', icon: 'setup', status: 'pending' },
    { id: 'tasks', label: 'Isi Task', icon: 'tasks', status: 'pending' },
    { id: 'done', label: 'Selesai', icon: 'done', status: 'pending' },
  ];

  if (log.includes('Mengambil data task')) phases[0].status = 'active';
  if (log.includes('Ditemukan') || log.includes('Tidak ada task')) phases[0].status = 'done';

  if (log.includes('Memulai browser')) phases[1].status = 'active';
  if (log.includes('Browser berhasil')) phases[1].status = 'done';

  if (log.includes('FASE LOGIN')) phases[2].status = 'active';
  if (log.includes('Menunggu input OTP') && !log.includes('Login berhasil')) phases[2].status = 'otp';
  if (log.includes('Login berhasil')) phases[2].status = 'done';

  if (log.includes('FASE PERSIAPAN')) phases[3].status = 'active';
  if (log.includes('Persiapan selesai')) phases[3].status = 'done';

  if (log.includes('FASE PENGISIAN')) phases[4].status = 'active';
  if (log.includes('SELESAI')) { phases[4].status = 'done'; phases[5].status = 'done'; }

  if (log.includes('ERROR') || log.includes('FATAL')) {
    const activeIdx = phases.findIndex(p => p.status === 'active');
    if (activeIdx >= 0) phases[activeIdx].status = 'error';
  }

  const currentPhase = phases.find(p => p.status === 'active' || p.status === 'otp')?.id ||
                       (phases.every(p => p.status === 'done') ? 'done' : 'init');

  return { currentPhase, phases };
}

function getLastActivity(log) {
  if (!log) return '';
  const lines = log.trim().split('\n').filter(l => l.trim() && !l.includes('====') && !l.includes('----'));
  return lines.length > 0 ? lines[lines.length - 1].replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, '') : '';
}

function PulsingDot({ color = 'bg-blue-500' }) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${color} opacity-75`} />
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${color}`} />
    </span>
  );
}

export default function Automation() {
  const { user } = useAuth();
  const {
    currentRun, runLog,
    isQueued, isRunning, isWaitingOtp, isFinished, hasActiveRun,
    isMinimized, setIsMinimized,
    clearRun, cancelRun, submitOtp, startRun: contextStartRun,
  } = useAutomationRun();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [tasks, setTasks] = useState([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewed, setPreviewed] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState(STEP_CREDENTIALS);
  const [modalDryRun, setModalDryRun] = useState(false);

  // Credentials
  const [kipappUsername, setKipappUsername] = useState('');
  const [kipappPassword, setKipappPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [credentialError, setCredentialError] = useState('');

  // OTP
  const [otpCode, setOtpCode] = useState('');
  const [otpSubmitting, setOtpSubmitting] = useState(false);

  const logRef = useRef(null);
  const otpInputRef = useRef(null);

  // History
  const [history, setHistory] = useState([]);
  const [expandedRun, setExpandedRun] = useState(null);

  // Confirm modal
  const [confirmDialog, setConfirmDialog] = useState(null);

  // Stats from history
  const stats = useMemo(() => {
    const total = history.length;
    const completed = history.filter(r => r.status === 'completed').length;
    const failed = history.filter(r => r.status === 'failed').length;
    const lastRun = history.length > 0 ? history[0] : null;
    return { total, completed, failed, last: lastRun };
  }, [history]);

  // When navigating to /automation, if there's an active run in context, show modal
  useEffect(() => {
    if (hasActiveRun && isMinimized) {
      setIsMinimized(false);
      setModalOpen(true);
      setModalStep(STEP_PROGRESS);
    }
  }, []); // Only on mount

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [runLog]);

  // Focus OTP input when waiting
  useEffect(() => {
    if (isWaitingOtp && otpInputRef.current) otpInputRef.current.focus();
  }, [isWaitingOtp]);

  // Load history on mount
  useEffect(() => { loadHistory(); }, []);

  // Detect credential failure from SSE
  useEffect(() => {
    if (currentRun && currentRun.status === 'failed' && modalStep === STEP_PROGRESS) {
      const errMsg = currentRun.error_message || '';
      if (errMsg.includes('Login gagal') || errMsg.includes('Login failed') || errMsg.includes('password SSO salah')) {
        setCredentialError(errMsg);
        setModalStep(STEP_CREDENTIALS);
        clearRun();
      }
    }
  }, [currentRun, modalStep, clearRun]);

  // Reload history when run finishes
  useEffect(() => { if (isFinished) loadHistory(); }, [isFinished]);

  const loadHistory = async () => {
    try {
      const res = await automationAPI.history();
      setHistory(res.data.data || []);
    } catch { /* ignore */ }
  };

  const handlePreview = async () => {
    setLoadingPreview(true);
    try {
      const res = await automationAPI.preview(year, month);
      setTasks(res.data.data || []);
      setPreviewed(true);
      if (res.data.total === 0) toast('Tidak ada task untuk periode ini', { icon: '\u{1F4ED}' });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal memuat pratinjau');
    } finally {
      setLoadingPreview(false);
    }
  };

  const openRunModal = (dryRun) => {
    setKipappUsername('');
    setKipappPassword('');
    setShowPassword(false);
    setCredentialError('');
    setOtpCode('');
    setModalDryRun(dryRun);
    setModalStep(STEP_CREDENTIALS);
    clearRun();
    setModalOpen(true);
  };

  const closeModal = () => {
    if (isRunning) return;
    setModalOpen(false);
    clearRun();
    setKipappUsername('');
    setKipappPassword('');
    setCredentialError('');
  };

  const handleMinimize = () => {
    setIsMinimized(true);
    setModalOpen(false);
  };

  const handleStartRun = async () => {
    if (!kipappUsername || !kipappPassword) {
      setCredentialError('Masukkan username dan password SSO');
      return;
    }
    setCredentialError('');
    try {
      await contextStartRun({ year, month, dryRun: modalDryRun, kipappUsername, kipappPassword });
      setOtpCode('');
      setModalStep(STEP_PROGRESS);
    } catch (err) {
      setCredentialError(err.response?.data?.message || 'Gagal memulai automasi');
    }
  };

  const handleCancel = async () => {
    await cancelRun();
    toast.success('Automasi dibatalkan');
  };

  const handleSubmitOtp = async () => {
    if (!otpCode || otpCode.length < 4) {
      toast.error('Masukkan kode OTP yang valid');
      return;
    }
    setOtpSubmitting(true);
    try {
      await submitOtp(otpCode);
      toast.success('OTP dikirim');
      setOtpCode('');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal mengirim OTP');
    } finally {
      setOtpSubmitting(false);
    }
  };

  const handleDryRun = () => openRunModal(true);

  const handleLiveRun = () => {
    setConfirmDialog({
      message: `Ini akan mengirim ${tasks.length} task ke KipApp untuk periode ${MONTHS[month - 1]} ${year}. Lanjutkan?`,
      confirmLabel: 'Jalankan',
      onConfirm: () => {
        setConfirmDialog(null);
        openRunModal(false);
      },
    });
  };

  const progressPercent = currentRun && currentRun.total_tasks > 0
    ? Math.round((currentRun.processed / currentRun.total_tasks) * 100)
    : 0;

  const yearOptions = [];
  for (let y = now.getFullYear() - 1; y <= now.getFullYear() + 1; y++) yearOptions.push(y);

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* ═══ Header ═══ */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-200">
            <HiOutlineLightningBolt className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">KipApp Automation</h1>
            <p className="text-gray-500 text-sm">Otomasi pengisian task ke kipapp.bps.go.id</p>
          </div>
        </div>
        {hasActiveRun && !modalOpen && (
          <button
            onClick={() => { setModalOpen(true); setModalStep(STEP_PROGRESS); setIsMinimized(false); }}
            className="flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg border border-blue-200 hover:bg-blue-100 transition-colors text-sm font-medium"
          >
            <PulsingDot color="bg-blue-500" />
            Lihat Progress
          </button>
        )}
      </div>

      {/* ═══ Stats Strip ═══ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {STAT_CONFIG.map(sc => {
          const Icon = sc.icon;
          let value;
          if (sc.key === 'total') value = stats.total;
          else if (sc.key === 'completed') value = stats.completed;
          else if (sc.key === 'failed') value = stats.failed;
          else if (sc.key === 'last') value = stats.last ? dayjs(stats.last.created_at).format('DD MMM') : '-';

          return (
            <div key={sc.key} className="bg-white rounded-xl shadow-sm p-3.5 flex items-center gap-3 border border-gray-100">
              <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${sc.color} flex items-center justify-center flex-shrink-0`}>
                <Icon className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-lg font-bold text-gray-900 leading-tight">{value}</p>
                <p className="text-xs text-gray-500 truncate">{sc.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* ═══ Controls Card ═══ */}
      <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-100">
        <div className="flex items-center gap-2 mb-3">
          <HiOutlineCalendar className="w-4 h-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-700">Periode & Aksi</h2>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Tahun</label>
            <select
              value={year}
              onChange={(e) => { setYear(Number(e.target.value)); setPreviewed(false); }}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-gray-50"
              disabled={isRunning}
            >
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Bulan</label>
            <select
              value={month}
              onChange={(e) => { setMonth(Number(e.target.value)); setPreviewed(false); }}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-gray-50"
              disabled={isRunning}
            >
              {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <button
              onClick={handlePreview}
              disabled={loadingPreview || isRunning}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors text-sm font-medium"
            >
              <HiOutlineEye className="w-4 h-4" />
              {loadingPreview ? 'Memuat...' : 'Pratinjau'}
            </button>
            <button
              onClick={handleDryRun}
              disabled={!previewed || tasks.length === 0 || isRunning}
              className="flex items-center gap-2 px-4 py-2 border border-indigo-400 text-indigo-600 rounded-lg hover:bg-indigo-50 disabled:opacity-50 transition-colors text-sm font-medium"
            >
              <HiOutlineRefresh className="w-4 h-4" />
              Dry Run
            </button>
            <button
              onClick={handleLiveRun}
              disabled={!previewed || tasks.length === 0 || isRunning}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-lg hover:from-indigo-700 hover:to-violet-700 disabled:opacity-50 transition-all text-sm font-medium shadow-sm"
            >
              <HiOutlinePlay className="w-4 h-4" />
              Jalankan
            </button>
          </div>
        </div>
      </div>

      {/* ═══ Preview Table ═══ */}
      {previewed && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HiOutlineEye className="w-4 h-4 text-gray-400" />
              <h2 className="font-semibold text-gray-900 text-sm">Pratinjau Task</h2>
            </div>
            <span className="text-xs bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full font-semibold">
              {tasks.length} task
            </span>
          </div>
          {tasks.length === 0 ? (
            <div className="py-12 text-center">
              <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
                <HiOutlineCollection className="w-8 h-8 text-gray-300" />
              </div>
              <p className="text-gray-500 text-sm">Tidak ada task untuk {MONTHS[month - 1]} {year}</p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="overflow-x-auto hidden md:block">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-medium w-10">#</th>
                      <th className="px-4 py-2.5 text-left font-medium">Task</th>
                      <th className="px-4 py-2.5 text-left font-medium">Rencana Kinerja</th>
                      <th className="px-4 py-2.5 text-left font-medium w-24">Mulai</th>
                      <th className="px-4 py-2.5 text-left font-medium w-24">Selesai</th>
                      <th className="px-4 py-2.5 text-left font-medium">Capaian</th>
                      <th className="px-4 py-2.5 text-left font-medium w-16">Bukti</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {tasks.map((t, i) => (
                      <tr key={t.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-2.5 text-gray-400 text-xs">{i + 1}</td>
                        <td className="px-4 py-2.5 font-medium text-gray-900">{t.task_name}</td>
                        <td className="px-4 py-2.5 text-gray-600">{t.rencana_kinerja}</td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">{t.start_date ? dayjs(t.start_date).format('DD/MM/YY') : '-'}</td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">{t.end_date ? dayjs(t.end_date).format('DD/MM/YY') : '-'}</td>
                        <td className="px-4 py-2.5 text-gray-600">{t.capaian || '-'}</td>
                        <td className="px-4 py-2.5">
                          {t.bukti_dukung ? (
                            <a href={sanitizeUrl(t.bukti_dukung)} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:text-indigo-700">
                              <HiOutlineExternalLink className="w-4 h-4" />
                            </a>
                          ) : <span className="text-gray-300">-</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile cards */}
              <div className="block md:hidden divide-y divide-gray-50">
                {tasks.map((t, i) => (
                  <div key={t.id} className="p-4 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-gray-900 text-sm leading-snug">{i + 1}. {t.task_name}</p>
                      {t.bukti_dukung && (
                        <a href={sanitizeUrl(t.bukti_dukung)} target="_blank" rel="noopener noreferrer" className="text-indigo-600 flex-shrink-0">
                          <HiOutlineExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                    {t.rencana_kinerja && <p className="text-xs text-gray-500">{t.rencana_kinerja}</p>}
                    <div className="flex flex-wrap gap-2 text-xs text-gray-400">
                      <span>{t.start_date ? dayjs(t.start_date).format('DD/MM/YY') : '-'} - {t.end_date ? dayjs(t.end_date).format('DD/MM/YY') : '-'}</span>
                      {t.capaian && <span className="text-green-600 font-medium">{t.capaian}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ Run Modal — Credentials + Progress + OTP ═══ */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="sticky top-0 bg-white px-5 py-4 border-b flex items-center justify-between rounded-t-xl z-10">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  modalStep === STEP_CREDENTIALS ? 'bg-indigo-100' : isFinished ? (currentRun?.status === 'completed' ? 'bg-green-100' : 'bg-red-100') : 'bg-blue-100'
                }`}>
                  {modalStep === STEP_CREDENTIALS ? (
                    <HiOutlineLockClosed className="w-4 h-4 text-indigo-600" />
                  ) : (
                    <HiOutlineLightningBolt className={`w-4 h-4 ${isFinished ? (currentRun?.status === 'completed' ? 'text-green-600' : 'text-red-600') : 'text-blue-600'}`} />
                  )}
                </div>
                <div>
                  <h2 className="font-semibold text-gray-900 text-sm">
                    {modalStep === STEP_CREDENTIALS ? 'Login SSO' : 'Status Automasi'}
                  </h2>
                  <div className="flex items-center gap-2 mt-0.5">
                    {currentRun && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[currentRun.status] || ''}`}>
                        {currentRun.status === 'waiting_otp' ? 'Waiting OTP' : currentRun.status}
                      </span>
                    )}
                    <span className="text-xs text-gray-400">
                      {modalDryRun ? 'Dry Run' : 'Live'} &mdash; {MONTHS[month - 1]} {year}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {isRunning && (
                  <button
                    onClick={handleCancel}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors font-medium"
                  >
                    <HiOutlineStop className="w-3.5 h-3.5" />
                    Stop
                  </button>
                )}
                {(isRunning || (currentRun && !isFinished)) && (
                  <button
                    onClick={handleMinimize}
                    className="p-1.5 rounded-lg transition-colors text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                    title="Minimize ke widget"
                  >
                    <HiOutlineMinusSm className="w-5 h-5" />
                  </button>
                )}
                <button
                  onClick={closeModal}
                  disabled={isRunning}
                  className={`p-1.5 rounded-lg transition-colors ${isRunning ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                  title={isRunning ? 'Stop automasi terlebih dahulu' : 'Tutup'}
                >
                  <HiOutlineX className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4">
              {/* STEP: Credentials */}
              {modalStep === STEP_CREDENTIALS && (
                <form onSubmit={(e) => { e.preventDefault(); handleStartRun(); }} autoComplete="off">
                  <div className="space-y-4">
                    <div className="flex items-start gap-3 bg-indigo-50 border border-indigo-200 rounded-lg p-3">
                      <HiOutlineLockClosed className="w-5 h-5 text-indigo-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm text-indigo-800 font-medium">Masukkan Credential SSO BPS</p>
                        <p className="text-xs text-indigo-600 mt-0.5">
                          Credential tidak disimpan di server. Hanya digunakan untuk sesi ini.
                        </p>
                      </div>
                    </div>

                    {credentialError && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                        <strong>Error:</strong> {credentialError}
                      </div>
                    )}

                    <input type="text" name="fake_user_field" style={{ display: 'none' }} tabIndex={-1} autoComplete="username" />
                    <input type="password" name="fake_pass_field" style={{ display: 'none' }} tabIndex={-1} autoComplete="current-password" />

                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Username SSO</label>
                      <input
                        type="text"
                        value={kipappUsername}
                        onChange={(e) => { setKipappUsername(e.target.value); setCredentialError(''); }}
                        placeholder="username.sso"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-gray-50"
                        autoComplete="new-password"
                        name={`sso_usr_${Date.now()}`}
                        data-lpignore="true"
                        data-form-type="other"
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Password SSO</label>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={kipappPassword}
                          onChange={(e) => { setKipappPassword(e.target.value); setCredentialError(''); }}
                          placeholder="********"
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 pr-10 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-gray-50"
                          autoComplete="new-password"
                          name={`sso_pwd_${Date.now()}`}
                          data-lpignore="true"
                          data-form-type="other"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                        >
                          <HiOutlineEye className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={!kipappUsername || !kipappPassword}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-lg hover:from-indigo-700 hover:to-violet-700 disabled:opacity-50 transition-all text-sm font-medium shadow-sm"
                    >
                      <HiOutlinePlay className="w-4 h-4" />
                      {modalDryRun ? 'Mulai Dry Run' : 'Mulai Automasi'}
                    </button>
                  </div>
                </form>
              )}

              {/* STEP: Progress */}
              {modalStep === STEP_PROGRESS && currentRun && (() => {
                const { phases } = parseLogPhases(runLog);
                const lastActivity = getLastActivity(runLog);
                return (
                <>
                  {/* Queue Waiting */}
                  {isQueued && (
                    <div className="flex flex-col items-center gap-3 py-6">
                      <div className="w-16 h-16 rounded-full bg-purple-100 flex items-center justify-center">
                        <svg className="w-8 h-8 text-purple-500 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      </div>
                      <div className="text-center space-y-1">
                        <p className="text-lg font-semibold text-purple-800">Menunggu Giliran</p>
                        {currentRun.queue_position && (
                          <p className="text-2xl font-bold text-purple-600">Antrian #{currentRun.queue_position}</p>
                        )}
                        <p className="text-sm text-gray-500 max-w-xs">
                          Server sedang memproses automasi user lain. Automasi kamu akan dimulai otomatis begitu giliran tiba.
                        </p>
                      </div>
                      <div className="flex items-center gap-2 bg-purple-50 border border-purple-200 rounded-lg px-4 py-2 mt-2">
                        <PulsingDot color="bg-purple-500" />
                        <span className="text-sm text-purple-700">Menunggu slot tersedia...</span>
                      </div>
                    </div>
                  )}

                  {/* Current Activity */}
                  {!isQueued && isRunning && lastActivity && (
                    <div className="flex items-center gap-2.5 bg-blue-50 border border-blue-100 rounded-lg px-3.5 py-2.5">
                      <PulsingDot color="bg-blue-500" />
                      <span className="text-sm text-blue-800 truncate">{lastActivity}</span>
                    </div>
                  )}

                  {/* Phase Steps */}
                  {!isQueued && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="flex items-center justify-between gap-1">
                        {phases.map((phase, idx) => (
                          <div key={phase.id} className="flex items-center flex-1 last:flex-initial">
                            <div className="flex flex-col items-center gap-1 min-w-0">
                              <div className={`flex items-center justify-center w-7 h-7 rounded-full transition-all duration-300 ${
                                phase.status === 'done' ? 'bg-green-500 text-white' :
                                phase.status === 'active' ? 'bg-blue-500 text-white ring-4 ring-blue-100' :
                                phase.status === 'otp' ? 'bg-orange-500 text-white ring-4 ring-orange-100' :
                                phase.status === 'error' ? 'bg-red-500 text-white' :
                                'bg-gray-200 text-gray-400'
                              }`}>
                                {phase.status === 'done' ? <HiOutlineCheckCircle className="w-4 h-4" /> :
                                 phase.status === 'error' ? <HiOutlineXCircle className="w-4 h-4" /> :
                                 phase.status === 'active' || phase.status === 'otp' ? <div className="w-2 h-2 bg-white rounded-full animate-pulse" /> :
                                 <span className="text-xs font-medium">{idx + 1}</span>}
                              </div>
                              <span className={`text-[10px] leading-tight text-center font-medium ${
                                phase.status === 'done' ? 'text-green-700' :
                                phase.status === 'active' || phase.status === 'otp' ? 'text-blue-700' :
                                phase.status === 'error' ? 'text-red-700' : 'text-gray-400'
                              }`}>{phase.label}</span>
                            </div>
                            {idx < phases.length - 1 && (
                              <div className={`flex-1 h-0.5 mx-1 mt-[-16px] rounded transition-colors duration-300 ${
                                phase.status === 'done' ? 'bg-green-400' : 'bg-gray-200'
                              }`} />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* OTP Input */}
                  {isWaitingOtp && (
                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 animate-fadeIn">
                      <div className="flex items-start gap-3">
                        <div className="relative">
                          <HiOutlineKey className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
                          <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500" />
                          </span>
                        </div>
                        <div className="flex-1">
                          <h3 className="text-sm font-semibold text-orange-800">OTP Diperlukan</h3>
                          <p className="text-xs text-orange-700 mt-1">
                            Masukkan kode OTP dari aplikasi authenticator. Kode berlaku singkat, segera masukkan.
                          </p>
                          <div className="mt-2.5 flex items-center gap-2">
                            <input
                              ref={otpInputRef}
                              type="text"
                              value={otpCode}
                              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmitOtp(); }}
                              placeholder="000000"
                              maxLength={6}
                              className="w-32 border-2 border-orange-300 rounded-lg px-3 py-2 text-center text-lg font-mono tracking-widest focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                              autoComplete="one-time-code"
                              autoFocus
                            />
                            <button
                              onClick={handleSubmitOtp}
                              disabled={otpSubmitting || otpCode.length < 4}
                              className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 transition-colors text-sm font-medium"
                            >
                              {otpSubmitting ? 'Mengirim...' : 'Kirim'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Progress Bar */}
                  <div>
                    <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                      <span className="font-medium">Progress</span>
                      <span>{currentRun.processed || 0} / {currentRun.total_tasks || 0} ({progressPercent}%)</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-2 rounded-full transition-all duration-500 ${
                          currentRun.status === 'failed' ? 'bg-red-500' :
                          currentRun.status === 'completed' ? 'bg-green-500' :
                          currentRun.status === 'waiting_otp' ? 'bg-orange-500 animate-pulse' :
                          'bg-gradient-to-r from-indigo-500 to-violet-500'
                        }`}
                        style={{ width: `${Math.max(progressPercent, isRunning && progressPercent === 0 ? 3 : 0)}%` }}
                      />
                    </div>
                  </div>

                  {/* Stats Cards */}
                  <div className="grid grid-cols-3 gap-2.5">
                    <div className="bg-green-50 border border-green-100 rounded-lg p-2.5 text-center">
                      <div className="text-xl font-bold text-green-700">{currentRun.processed || 0}</div>
                      <div className="text-[10px] text-green-600 font-medium">Diproses</div>
                    </div>
                    <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-2.5 text-center">
                      <div className="text-xl font-bold text-yellow-700">{currentRun.skipped || 0}</div>
                      <div className="text-[10px] text-yellow-600 font-medium">Dilewati</div>
                    </div>
                    <div className="bg-red-50 border border-red-100 rounded-lg p-2.5 text-center">
                      <div className="text-xl font-bold text-red-700">{currentRun.failed_tasks || 0}</div>
                      <div className="text-[10px] text-red-600 font-medium">Gagal</div>
                    </div>
                  </div>

                  {/* Log Output */}
                  {runLog && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <h3 className="text-xs font-semibold text-gray-600">Log Output</h3>
                        {isRunning && (
                          <span className="flex items-center gap-1.5 text-[10px] text-gray-400">
                            <PulsingDot color="bg-green-500" />
                            Live
                          </span>
                        )}
                      </div>
                      <pre
                        ref={logRef}
                        className="bg-gray-900 text-green-400 text-xs p-3 rounded-lg overflow-auto max-h-56 font-mono whitespace-pre-wrap leading-relaxed"
                      >{runLog}</pre>
                    </div>
                  )}

                  {/* Completion */}
                  {currentRun.status === 'completed' && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-3">
                      <HiOutlineCheckCircle className="w-6 h-6 text-green-500 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-green-800">Automasi Selesai</p>
                        <p className="text-xs text-green-700 mt-0.5">
                          {currentRun.processed} task diproses, {currentRun.skipped || 0} dilewati, {currentRun.failed_tasks || 0} gagal
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Error */}
                  {currentRun.error_message && isFinished && currentRun.status !== 'completed' && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-3">
                      <HiOutlineXCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-red-800">Error</p>
                        <p className="text-xs text-red-700 mt-0.5">{currentRun.error_message}</p>
                      </div>
                    </div>
                  )}

                  {/* Cancelled */}
                  {currentRun.status === 'cancelled' && !currentRun.error_message && (
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center gap-3">
                      <HiOutlineClock className="w-5 h-5 text-gray-400 flex-shrink-0" />
                      <p className="text-sm text-gray-600">Automasi dibatalkan oleh user</p>
                    </div>
                  )}
                </>
                );
              })()}

              {/* Loading between credential submit and SSE first response */}
              {modalStep === STEP_PROGRESS && !currentRun && (
                <div className="flex flex-col items-center justify-center py-8 gap-4">
                  <div className="animate-spin rounded-full h-10 w-10 border-2 border-gray-200 border-t-indigo-600" />
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-700">Memulai automasi...</p>
                    <p className="text-xs text-gray-400 mt-1">Menyiapkan browser dan koneksi</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ Run History ═══ */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-100">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HiOutlineClock className="w-4 h-4 text-gray-400" />
            <h2 className="font-semibold text-gray-900 text-sm">Riwayat Run</h2>
            {history.length > 0 && (
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">
                {history.length}
              </span>
            )}
          </div>
          <button
            onClick={loadHistory}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title="Refresh"
          >
            <HiOutlineRefresh className="w-4 h-4" />
          </button>
        </div>

        {history.length === 0 ? (
          <div className="py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <HiOutlineLightningBolt className="w-8 h-8 text-gray-300" />
            </div>
            <p className="text-gray-500 text-sm">Belum ada riwayat automasi</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <table className="w-full text-sm hidden md:table">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Tanggal</th>
                  <th className="px-4 py-2.5 text-left font-medium">Periode</th>
                  <th className="px-4 py-2.5 text-left font-medium">Tipe</th>
                  <th className="px-4 py-2.5 text-left font-medium">Status</th>
                  <th className="px-4 py-2.5 text-left font-medium">Task</th>
                  <th className="px-4 py-2.5 text-left font-medium">Proses</th>
                  <th className="px-4 py-2.5 text-left font-medium">Durasi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {history.map((run) => {
                  const duration = run.started_at && run.completed_at
                    ? Math.round((new Date(run.completed_at) - new Date(run.started_at)) / 1000)
                    : null;
                  return (
                    <tr key={run.id} className="group">
                      <td colSpan="7" className="p-0">
                        <button
                          onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                          className="w-full text-left hover:bg-gray-50/80 transition-colors"
                        >
                          <div className="flex">
                            <div className="px-4 py-2.5 flex-1 text-gray-500 text-xs">
                              {dayjs(run.created_at).format('DD/MM/YY HH:mm')}
                            </div>
                            <div className="px-4 py-2.5 flex-1 text-gray-700 font-medium text-xs">
                              {MONTHS[run.month - 1]} {run.year}
                            </div>
                            <div className="px-4 py-2.5 flex-1">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${run.run_type === 'dry-run' ? 'bg-gray-100 text-gray-600' : 'bg-indigo-50 text-indigo-700'}`}>
                                {run.run_type === 'dry-run' ? 'Dry Run' : 'Live'}
                              </span>
                            </div>
                            <div className="px-4 py-2.5 flex-1">
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[run.status] || ''}`}>
                                {run.status}
                              </span>
                            </div>
                            <div className="px-4 py-2.5 flex-1 text-gray-600 text-xs">{run.total_tasks}</div>
                            <div className="px-4 py-2.5 flex-1 text-gray-600 text-xs">{run.processed}</div>
                            <div className="px-4 py-2.5 flex-1 text-gray-400 text-xs">
                              {duration !== null ? `${duration}s` : '-'}
                            </div>
                          </div>
                        </button>
                        {expandedRun === run.id && run.log && (
                          <div className="px-4 pb-3">
                            <pre className="bg-gray-900 text-green-400 text-xs p-3 rounded-lg overflow-auto max-h-48 font-mono whitespace-pre-wrap">
                              {run.log}
                            </pre>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {/* Mobile cards */}
            <div className="block md:hidden divide-y divide-gray-50">
              {history.map((run) => {
                const duration = run.started_at && run.completed_at
                  ? Math.round((new Date(run.completed_at) - new Date(run.started_at)) / 1000)
                  : null;
                return (
                  <div key={run.id}>
                    <button
                      onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                      className={`w-full text-left p-4 hover:bg-gray-50/80 transition-colors border-l-4 ${STATUS_BORDER[run.status] || 'border-l-gray-200'}`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-semibold text-gray-900">
                          {MONTHS[run.month - 1]} {run.year}
                        </span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[run.status] || ''}`}>
                          {run.status}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                        <span>{dayjs(run.created_at).format('DD/MM/YY HH:mm')}</span>
                        <span className={`px-2 py-0.5 rounded-full font-medium ${run.run_type === 'dry-run' ? 'bg-gray-100 text-gray-600' : 'bg-indigo-50 text-indigo-700'}`}>
                          {run.run_type === 'dry-run' ? 'Dry Run' : 'Live'}
                        </span>
                        <span className="text-gray-500">{run.processed}/{run.total_tasks} task</span>
                        {duration !== null && <span>{duration}s</span>}
                      </div>
                    </button>
                    {expandedRun === run.id && run.log && (
                      <div className="px-4 pb-3">
                        <pre className="bg-gray-900 text-green-400 text-xs p-3 rounded-lg overflow-auto max-h-48 font-mono whitespace-pre-wrap">
                          {run.log}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ═══ Confirm Dialog ═══ */}
      {confirmDialog && (
        <ConfirmDialog
          dialog={confirmDialog}
          onClose={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
}
