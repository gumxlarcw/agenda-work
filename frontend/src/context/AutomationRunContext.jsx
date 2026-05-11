import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';
import { automationAPI } from '../services/api';
import { useAuth } from './AuthContext';

const AutomationRunContext = createContext(null);

const POLL_INTERVAL = 2000; // 2 seconds

export function AutomationRunProvider({ children }) {
  const { isAuthenticated } = useAuth();

  // Run state
  const [currentRun, setCurrentRun] = useState(null);
  const [runLog, setRunLog] = useState('');
  const [isMinimized, setIsMinimized] = useState(false);
  const pollingRef = useRef(null);
  const mountedRef = useRef(true);

  const isQueued = currentRun && currentRun.status === 'queued';
  const isRunning = currentRun && ['pending', 'running', 'waiting_otp', 'queued'].includes(currentRun.status);
  const isWaitingOtp = currentRun && currentRun.status === 'waiting_otp';
  const isFinished = currentRun && ['completed', 'failed', 'cancelled'].includes(currentRun.status);
  const hasActiveRun = !!currentRun;

  // Start polling for a given runId
  const startPolling = useCallback((runId) => {
    // Clean up existing polling
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }

    const poll = async () => {
      if (!mountedRef.current) return;
      try {
        const res = await automationAPI.getRunStatus(runId);
        if (!mountedRef.current) return;
        const data = res.data.data;
        if (!data) return;

        setCurrentRun(data);
        if (data.log) setRunLog(data.log);

        // Continue polling if still running
        if (!['completed', 'failed', 'cancelled'].includes(data.status)) {
          pollingRef.current = setTimeout(poll, POLL_INTERVAL);
        }
      } catch (err) {
        // If 401/403, stop polling (token expired). Otherwise retry.
        if (err.response?.status === 401 || err.response?.status === 403) return;
        pollingRef.current = setTimeout(poll, POLL_INTERVAL * 2);
      }
    };

    poll();
  }, []);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // Clear run state
  const clearRun = useCallback(() => {
    stopPolling();
    setCurrentRun(null);
    setRunLog('');
    setIsMinimized(false);
  }, [stopPolling]);

  // Cancel running automation
  const cancelRun = useCallback(async () => {
    if (!currentRun) return;
    try {
      await automationAPI.cancel(currentRun.id);
    } catch {
      // ignore
    }
  }, [currentRun]);

  // Submit OTP
  const submitOtp = useCallback(async (otp) => {
    if (!currentRun) throw new Error('No active run');
    await automationAPI.submitOtp(currentRun.id, otp);
  }, [currentRun]);

  // Start a new run
  const startRun = useCallback(async ({ year, month, dryRun, kipappUsername, kipappPassword }) => {
    const res = await automationAPI.run({
      year, month, dryRun,
      kipappUsername, kipappPassword,
    });
    const { runId, status: initialStatus, queuePosition, message: queueMessage } = res.data.data;

    // Set initial state immediately (don't wait for first poll)
    setCurrentRun({
      id: runId,
      status: initialStatus || 'pending',
      run_type: dryRun ? 'dry-run' : 'live',
      year, month,
      total_tasks: 0,
      processed: 0,
      skipped: 0,
      failed_tasks: 0,
      log: null,
      queue_position: queuePosition || null,
      queue_message: queueMessage || null,
    });
    setRunLog('');

    // Start polling for updates
    startPolling(runId);

    return runId;
  }, [startPolling]);

  // Check for active run on mount / auth change (handles page refresh)
  useEffect(() => {
    if (!isAuthenticated) return;

    let cancelled = false;
    automationAPI.activeRun()
      .then((res) => {
        if (cancelled) return;
        const activeRun = res.data.data;
        if (activeRun) {
          setCurrentRun(activeRun);
          if (activeRun.log) setRunLog(activeRun.log);
          setIsMinimized(true);
          startPolling(activeRun.id);
        }
      })
      .catch(() => {
        // ignore — not critical
      });

    return () => { cancelled = true; };
  }, [isAuthenticated, startPolling]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopPolling();
    };
  }, [stopPolling]);

  return (
    <AutomationRunContext.Provider value={{
      currentRun,
      setCurrentRun,
      runLog,
      setRunLog,
      isQueued,
      isRunning,
      isWaitingOtp,
      isFinished,
      hasActiveRun,
      isMinimized,
      setIsMinimized,
      startPolling,
      stopPolling,
      clearRun,
      cancelRun,
      submitOtp,
      startRun,
    }}>
      {children}
    </AutomationRunContext.Provider>
  );
}

export function useAutomationRun() {
  const ctx = useContext(AutomationRunContext);
  if (!ctx) throw new Error('useAutomationRun must be used inside AutomationRunProvider');
  return ctx;
}
