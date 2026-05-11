import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { tasksAPI, dashboardAPI, notesAPI, eventsAPI } from '../services/api';
import toast from 'react-hot-toast';

// Minimum gap between automatic refetches triggered by window focus. A
// task-tracker doesn't need real-time refresh — 30s is a good balance
// between freshness and avoiding a request storm when alt-tabbing.
const FOCUS_REFETCH_COOLDOWN_MS = 30_000;

// Build today's date range in the browser's local timezone so the backend
// returns "today" according to the user, not to the server (which runs UTC).
const getLocalTodayRange = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const iso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return { start: iso, end: iso };
};

export default function useDashboard() {
  const { user, isAdmin } = useAuth();

  const [stats, setStats] = useState(null);
  const [todayFocus, setTodayFocus] = useState(null);
  const [recentTasks, setRecentTasks] = useState([]);
  const [recentNotes, setRecentNotes] = useState([]);
  const [activityFeed, setActivityFeed] = useState([]);
  const [heatmapData, setHeatmapData] = useState([]);
  const [userStats, setUserStats] = useState([]);
  const [events, setEvents] = useState([]);
  // Month the EventCalendar is currently viewing (user can navigate ± months).
  const now = new Date();
  const [eventMonth, setEventMonth] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });

  const [statsLoading, setStatsLoading] = useState(true);
  const [focusLoading, setFocusLoading] = useState(true);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [notesLoading, setNotesLoading] = useState(true);
  const [activityLoading, setActivityLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(true);

  const [statsError, setStatsError] = useState(null);
  const [focusError, setFocusError] = useState(null);
  const [tasksError, setTasksError] = useState(null);
  const [notesError, setNotesError] = useState(null);
  const [activityError, setActivityError] = useState(null);
  const [eventsError, setEventsError] = useState(null);

  const lastRefetchRef = useRef(0);

  const fetchSection = useCallback(async (fetcher, setter, setLoading, setError) => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetcher();
      setter(res.data.data || res.data || []);
    } catch (err) {
      console.error('Dashboard section error:', err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchEvents = useCallback((year, month) => {
    fetchSection(
      () => eventsAPI.getAll({ year, month }),
      setEvents, setEventsLoading, setEventsError
    );
  }, [fetchSection]);

  const refetchAll = useCallback(() => {
    lastRefetchRef.current = Date.now();
    fetchSection(tasksAPI.getStats, setStats, setStatsLoading, setStatsError);
    fetchSection(
      () => dashboardAPI.getTodayFocus(getLocalTodayRange()),
      setTodayFocus, setFocusLoading, setFocusError
    );
    fetchSection(
      () => tasksAPI.getAll({ limit: 5, sortBy: 'created_at', sortOrder: 'desc' }),
      setRecentTasks, setTasksLoading, setTasksError
    );
    fetchSection(() => notesAPI.getRecent(3), setRecentNotes, setNotesLoading, setNotesError);
    fetchSection(() => dashboardAPI.getActivityFeed(10), setActivityFeed, setActivityLoading, setActivityError);
    fetchEvents(eventMonth.year, eventMonth.month);
    tasksAPI.getHeatmapData()
      .then(r => setHeatmapData(r.data.data || []))
      .catch(err => console.error('Heatmap fetch failed:', err));
    if (isAdmin) {
      tasksAPI.getUserStats()
        .then(r => setUserStats(r.data.data || []))
        .catch(err => console.error('User stats fetch failed:', err));
    }
  }, [isAdmin, fetchSection, fetchEvents, eventMonth.year, eventMonth.month]);

  const changeEventMonth = useCallback((year, month) => {
    setEventMonth({ year, month });
    fetchEvents(year, month);
  }, [fetchEvents]);

  const refetchFocus = useCallback(() => {
    fetchSection(
      () => dashboardAPI.getTodayFocus(getLocalTodayRange()),
      setTodayFocus, setFocusLoading, setFocusError
    );
  }, [fetchSection]);

  // Smaller refetch for QuickAddBar — only the things a quick-add can affect.
  // Events included because QuickAddBar can create events too.
  const refetchAfterQuickAdd = useCallback(() => {
    fetchSection(tasksAPI.getStats, setStats, setStatsLoading, setStatsError);
    fetchSection(
      () => tasksAPI.getAll({ limit: 5, sortBy: 'created_at', sortOrder: 'desc' }),
      setRecentTasks, setTasksLoading, setTasksError
    );
    fetchSection(() => dashboardAPI.getActivityFeed(10), setActivityFeed, setActivityLoading, setActivityError);
    fetchSection(
      () => dashboardAPI.getTodayFocus(getLocalTodayRange()),
      setTodayFocus, setFocusLoading, setFocusError
    );
    fetchEvents(eventMonth.year, eventMonth.month);
  }, [fetchSection, fetchEvents, eventMonth.year, eventMonth.month]);

  const completeTask = useCallback(async (taskId) => {
    // Optimistic focus update
    let wasOverdue = false;
    setTodayFocus(prev => {
      if (!prev) return prev;
      wasOverdue = prev.overdue.some(t => t.id === taskId);
      return {
        due_today: prev.due_today.filter(t => t.id !== taskId),
        overdue: prev.overdue.filter(t => t.id !== taskId),
        today_reminders: prev.today_reminders,
      };
    });
    // Optimistic stats update — matches what the refetch will eventually show.
    setStats(prev => {
      if (!prev) return prev;
      const next = { ...prev };
      if (typeof next.completed === 'number') next.completed += 1;
      if (typeof next.in_progress === 'number' && next.in_progress > 0) next.in_progress -= 1;
      if (wasOverdue && typeof next.overdue === 'number' && next.overdue > 0) next.overdue -= 1;
      return next;
    });

    try {
      await tasksAPI.update(taskId, { status: 'Completed' });
      toast.success('Task selesai!');
      // Reconcile with server truth.
      fetchSection(tasksAPI.getStats, setStats, setStatsLoading, setStatsError);
      fetchSection(
        () => tasksAPI.getAll({ limit: 5, sortBy: 'created_at', sortOrder: 'desc' }),
        setRecentTasks, setTasksLoading, setTasksError
      );
    } catch (err) {
      toast.error('Gagal menyelesaikan task');
      // Full refetch to rollback optimistic changes.
      refetchFocus();
      fetchSection(tasksAPI.getStats, setStats, setStatsLoading, setStatsError);
    }
  }, [fetchSection, refetchFocus]);

  useEffect(() => {
    refetchAll();

    const handleFocus = () => {
      const since = Date.now() - lastRefetchRef.current;
      if (since >= FOCUS_REFETCH_COOLDOWN_MS) refetchAll();
    };
    window.addEventListener('focus', handleFocus);

    let bc;
    try {
      bc = new BroadcastChannel('task-updates');
      bc.onmessage = () => refetchAll();
    } catch {}

    return () => {
      window.removeEventListener('focus', handleFocus);
      try { bc?.close(); } catch {}
    };
  }, [refetchAll]);

  return {
    user, isAdmin,
    stats, todayFocus, recentTasks, recentNotes, activityFeed,
    heatmapData, userStats, events,
    statsLoading, focusLoading, tasksLoading, notesLoading, activityLoading, eventsLoading,
    statsError, focusError, tasksError, notesError, activityError, eventsError,
    completeTask,
    refetchAll: refetchAfterQuickAdd,
    refetchFocus,
    changeEventMonth,
  };
}
