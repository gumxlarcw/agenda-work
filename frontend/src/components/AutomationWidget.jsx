import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAutomationRun } from '../context/AutomationRunContext';
import toast from 'react-hot-toast';
import {
  HiOutlineLightningBolt,
  HiOutlineChevronUp,
  HiOutlineStop,
  HiOutlineX,
  HiOutlineKey,
  HiOutlineCheckCircle,
  HiOutlineXCircle,
} from 'react-icons/hi';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

function PulsingDot({ color = 'bg-blue-500' }) {
  return (
    <span className="relative flex h-2 w-2">
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${color} opacity-75`} />
      <span className={`relative inline-flex rounded-full h-2 w-2 ${color}`} />
    </span>
  );
}

export default function AutomationWidget() {
  const {
    currentRun, runLog, isRunning, isWaitingOtp, isFinished,
    hasActiveRun, isMinimized, setIsMinimized, cancelRun,
    submitOtp, clearRun,
  } = useAutomationRun();

  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpSubmitting, setOtpSubmitting] = useState(false);
  const otpInputRef = useRef(null);

  // Focus OTP input when expanded and waiting
  useEffect(() => {
    if (expanded && isWaitingOtp && otpInputRef.current) {
      otpInputRef.current.focus();
    }
  }, [expanded, isWaitingOtp]);

  // Don't render if no active run or not minimized
  if (!hasActiveRun || !isMinimized) return null;

  const progressPercent = currentRun.total_tasks > 0
    ? Math.round((currentRun.processed / currentRun.total_tasks) * 100)
    : 0;

  const periodLabel = currentRun.month && currentRun.year
    ? `${MONTHS[currentRun.month - 1]} ${currentRun.year}`
    : '';

  const statusColor =
    currentRun.status === 'completed' ? 'bg-green-500' :
    currentRun.status === 'failed' ? 'bg-red-500' :
    currentRun.status === 'cancelled' ? 'bg-gray-500' :
    currentRun.status === 'waiting_otp' ? 'bg-orange-500' :
    'bg-blue-500';

  const handleOpenFull = () => {
    setIsMinimized(false);
    navigate('/automation');
  };

  const handleCancel = async () => {
    await cancelRun();
    toast.success('Automation dibatalkan');
  };

  const handleSubmitOtp = async () => {
    if (!otpCode || otpCode.length < 4) return;
    setOtpSubmitting(true);
    try {
      await submitOtp(otpCode);
      toast.success('OTP dikirim');
      setOtpCode('');
    } catch {
      toast.error('Gagal mengirim OTP');
    } finally {
      setOtpSubmitting(false);
    }
  };

  const handleClose = () => {
    if (isRunning) return;
    clearRun();
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 shadow-2xl rounded-xl overflow-hidden border border-gray-200 bg-white transition-all duration-300">
      {/* Header — always visible */}
      <div
        className="flex items-center justify-between px-3 py-2.5 bg-gray-900 text-white cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <HiOutlineLightningBolt className="w-4 h-4 flex-shrink-0 text-yellow-400" />
          <span className="text-xs font-medium truncate">
            KipApp {currentRun.run_type === 'dry-run' ? 'Dry' : 'Run'} — {periodLabel}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {isRunning && <PulsingDot color={currentRun.status === 'waiting_otp' ? 'bg-orange-400' : 'bg-green-400'} />}
          {isFinished && (
            currentRun.status === 'completed'
              ? <HiOutlineCheckCircle className="w-4 h-4 text-green-400" />
              : <HiOutlineXCircle className="w-4 h-4 text-red-400" />
          )}
          <HiOutlineChevronUp className={`w-4 h-4 transition-transform ${expanded ? '' : 'rotate-180'}`} />
        </div>
      </div>

      {/* Progress bar strip */}
      <div className="h-1 bg-gray-200">
        <div
          className={`h-full transition-all duration-500 ${statusColor}`}
          style={{ width: `${Math.max(progressPercent, isRunning ? 3 : 0)}%` }}
        />
      </div>

      {/* Compact status — visible when collapsed */}
      {!expanded && (
        <div className="px-3 py-2 flex items-center justify-between text-xs text-gray-600">
          <span>
            {isWaitingOtp ? 'Menunggu OTP...' :
             isRunning ? `${currentRun.processed || 0}/${currentRun.total_tasks || 0} task` :
             currentRun.status === 'completed' ? 'Selesai' :
             currentRun.status === 'failed' ? 'Gagal' :
             'Dibatalkan'}
          </span>
          <span className="font-medium">{progressPercent}%</span>
        </div>
      )}

      {/* Expanded content */}
      {expanded && (
        <div className="p-3 space-y-2.5 max-h-64 overflow-y-auto">
          {/* Stats row */}
          <div className="flex items-center gap-3 text-xs">
            <span className="text-gray-500">Progress:</span>
            <span className="font-medium text-gray-900">
              {currentRun.processed || 0}/{currentRun.total_tasks || 0}
            </span>
            {(currentRun.skipped || 0) > 0 && (
              <span className="text-yellow-600">{currentRun.skipped} skip</span>
            )}
            {(currentRun.failed_tasks || 0) > 0 && (
              <span className="text-red-600">{currentRun.failed_tasks} fail</span>
            )}
          </div>

          {/* OTP input — inline in widget */}
          {isWaitingOtp && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-2.5">
              <div className="flex items-center gap-1.5 mb-1.5">
                <HiOutlineKey className="w-3.5 h-3.5 text-orange-500" />
                <span className="text-xs font-semibold text-orange-800">Masukkan OTP</span>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  ref={otpInputRef}
                  type="text"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSubmitOtp(); }}
                  placeholder="000000"
                  maxLength={6}
                  className="w-24 border border-orange-300 rounded px-2 py-1.5 text-center text-sm font-mono tracking-widest focus:ring-1 focus:ring-orange-500 focus:border-transparent"
                  autoComplete="one-time-code"
                />
                <button
                  onClick={handleSubmitOtp}
                  disabled={otpSubmitting || otpCode.length < 4}
                  className="px-3 py-1.5 bg-orange-500 text-white rounded text-xs font-medium hover:bg-orange-600 disabled:opacity-50"
                >
                  {otpSubmitting ? '...' : 'Kirim'}
                </button>
              </div>
            </div>
          )}

          {/* Last log line */}
          {runLog && (
            <div className="bg-gray-900 rounded px-2 py-1.5 text-[10px] text-green-400 font-mono truncate">
              {runLog.trim().split('\n').filter(l => l.trim() && !l.includes('====') && !l.includes('----')).slice(-1)[0]?.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, '') || '...'}
            </div>
          )}

          {/* Error message */}
          {currentRun.error_message && isFinished && (
            <p className="text-xs text-red-600 truncate" title={currentRun.error_message}>
              {currentRun.error_message}
            </p>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleOpenFull}
              className="flex-1 text-xs text-center py-1.5 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors font-medium"
            >
              Buka Penuh
            </button>
            {isRunning && (
              <button
                onClick={handleCancel}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-red-600 border border-red-300 rounded hover:bg-red-50 transition-colors font-medium"
              >
                <HiOutlineStop className="w-3 h-3" />
                Stop
              </button>
            )}
            {!isRunning && (
              <button
                onClick={handleClose}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
              >
                <HiOutlineX className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
