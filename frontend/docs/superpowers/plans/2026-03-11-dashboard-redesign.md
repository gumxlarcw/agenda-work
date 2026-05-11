# Dashboard Bento Redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Dashboard.jsx into a modern bento-grid layout with glassmorphism, trend stats, today's focus panel, activity feed, recent notes, and quick-add actions.

**Architecture:** 4 new/extended backend endpoints feed a `useDashboard` hook. 8 focused frontend components render in a responsive 12-column bento grid. Each section loads independently with per-section skeleton/error states.

**Tech Stack:** React, Tailwind CSS, dayjs, react-icons/hi, Express.js, MySQL (pool.query)

**Spec:** `docs/superpowers/specs/2026-03-11-dashboard-redesign.md`

---

## File Structure

### Backend (Create)
| File | Responsibility |
|------|---------------|
| `backend/src/routes/dashboard.routes.js` | New route file: `/today-focus`, `/activity/feed` |

### Backend (Modify)
| File | Change |
|------|--------|
| `backend/src/routes/task.routes.js` | Extend `/stats/summary` with trends, completion_rate, overdue, streak |
| `backend/src/routes/note.routes.js` | Add `/recent` endpoint |
| `backend/src/server.js` | Register dashboard routes |

### Frontend (Create)
| File | Responsibility |
|------|---------------|
| `frontend/src/hooks/useDashboard.js` | Fetch all dashboard data, per-section loading/error |
| `frontend/src/components/dashboard/BentoGrid.jsx` | Responsive CSS grid layout wrapper |
| `frontend/src/components/dashboard/WelcomeBanner.jsx` | Time-aware greeting + progress ring + streak |
| `frontend/src/components/dashboard/StatCard.jsx` | Glassmorphism card + trend + count-up |
| `frontend/src/components/dashboard/TodayFocus.jsx` | Due today + overdue + quick checkboxes |
| `frontend/src/components/dashboard/RecentTasks.jsx` | Task list + inline complete + due warning |
| `frontend/src/components/dashboard/RecentNotes.jsx` | Note preview cards with color accent |
| `frontend/src/components/dashboard/ActivityFeed.jsx` | Cross-module timeline |
| `frontend/src/components/dashboard/QuickAddBar.jsx` | Quick-create buttons / mobile FAB |
| `frontend/src/components/dashboard/SkeletonCard.jsx` | Reusable skeleton loader for glass cards |

### Frontend (Modify)
| File | Change |
|------|--------|
| `frontend/src/services/api.js` | Add dashboardAPI, notesAPI.getRecent |
| `frontend/src/pages/Dashboard.jsx` | Full rewrite → thin orchestrator |

---

## Chunk 1: Backend Endpoints

### Task 1: Extend task stats with trends, completion_rate, overdue, streak

**Files:**
- Modify: `backend/src/routes/task.routes.js` (the `/stats/summary` endpoint, ~line 314-346)

**Context:** The existing `/stats/summary` endpoint runs a simple COUNT/SUM aggregation. We need to add: `overdue` count, `completion_rate` percentage, `trends` object (vs 7 days ago), and `streak_days`.

- [ ] **Step 1: Read existing stats endpoint**

Read `backend/src/routes/task.routes.js` lines 314-346 to understand the current SQL.

- [ ] **Step 2: Backup the file**

```bash
cp backend/src/routes/task.routes.js backend/src/routes/task.routes.js.backup
```

- [ ] **Step 3: Extend the stats query**

Add these to the existing `/stats/summary` handler (after the current query, same handler):

```javascript
// After existing stats query, add:

// Overdue count
const [overdueResult] = await pool.query(
  `SELECT COUNT(*) as overdue FROM tasks
   WHERE end_date < CURDATE() AND status NOT IN ('Completed', 'Cancelled')
   ${userFilter ? 'AND user_id = ?' : ''}`,
  userFilter ? [userFilter.user_id] : []
);

// Completion rate
const completionRate = stats.total > 0
  ? Math.round((stats.completed / stats.total) * 100)
  : 0;

// Trends: activity-based — how many tasks created/completed/became overdue in last 7 days
const [trendsResult] = await pool.query(
  `SELECT
    SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as created_last_7d,
    SUM(CASE WHEN status = 'Completed' AND updated_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as completed_last_7d,
    SUM(CASE WHEN status = 'In Progress' AND updated_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as started_last_7d,
    SUM(CASE WHEN end_date < CURDATE() AND end_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      AND status NOT IN ('Completed', 'Cancelled') THEN 1 ELSE 0 END) as became_overdue_last_7d
   FROM tasks
   ${userFilter ? 'WHERE user_id = ?' : ''}`,
  userFilter ? [userFilter.user_id] : []
);
const trends7d = trendsResult[0] || {};

// Streak: consecutive days with ≥1 task completed
const [streakResult] = await pool.query(
  `SELECT DATE(updated_at) as d FROM tasks
   WHERE status = 'Completed'
   ${userFilter ? 'AND user_id = ?' : ''}
   GROUP BY DATE(updated_at)
   ORDER BY d DESC`,
  userFilter ? [userFilter.user_id] : []
);
let streakDays = 0;
const today = new Date();
today.setHours(0, 0, 0, 0);
for (const row of streakResult) {
  const d = new Date(row.d);
  d.setHours(0, 0, 0, 0);
  const expectedDate = new Date(today);
  expectedDate.setDate(expectedDate.getDate() - streakDays);
  if (d.getTime() === expectedDate.getTime()) {
    streakDays++;
  } else {
    break;
  }
}

// Merge into response
res.json({
  success: true,
  data: {
    ...stats,
    overdue: overdueResult[0]?.overdue || 0,
    completion_rate: completionRate,
    trends: {
      total_change: Number(trends7d.created_last_7d) || 0,
      completed_change: Number(trends7d.completed_last_7d) || 0,
      in_progress_change: Number(trends7d.started_last_7d) || 0,
      overdue_change: Number(trends7d.became_overdue_last_7d) || 0,
    },
    streak_days: streakDays,
  }
});
```

- [ ] **Step 4: Test manually**

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:5000/api/tasks/stats/summary | jq .
```

Expected: response includes `overdue`, `completion_rate`, `trends`, `streak_days` fields.

- [ ] **Step 5: Reload backend**

```bash
pm2 reload pds-backend --update-env
```

- [ ] **Step 6: Commit**

```bash
cd /var/www/html/agenda_work && git add backend/src/routes/task.routes.js
git commit -m "feat(dashboard): extend task stats with trends, completion rate, overdue, streak"
```

---

### Task 2: Create today-focus endpoint

**Files:**
- Create: `backend/src/routes/dashboard.routes.js`
- Modify: `backend/src/server.js` (~line 157-174, route registration)

**Context:** New route file for dashboard-specific endpoints. First endpoint: `/today-focus` returns tasks due today, overdue tasks, and today's reminders.

- [ ] **Step 1: Create the dashboard routes file**

```javascript
// backend/src/routes/dashboard.routes.js
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verifyToken, addUserFilter } = require('../middleware/auth.middleware');

// GET /api/dashboard/today-focus
router.get('/today-focus', verifyToken, addUserFilter, async (req, res) => {
  try {
    const userFilter = req.userFilter;
    const userClause = userFilter ? 'AND user_id = ?' : '';
    const userParam = userFilter ? [userFilter.user_id] : [];

    // Tasks due today
    const [dueToday] = await pool.query(
      `SELECT id, task, priority, status, end_date as due_date, kegiatan
       FROM tasks
       WHERE DATE(end_date) = CURDATE()
       AND status NOT IN ('Completed', 'Cancelled')
       ${userClause}
       ORDER BY FIELD(priority, 'P0', 'P1', 'P2', 'P3')`,
      userParam
    );

    // Overdue tasks
    const [overdue] = await pool.query(
      `SELECT id, task, priority, end_date as due_date,
       DATEDIFF(CURDATE(), end_date) as days_overdue
       FROM tasks
       WHERE end_date < CURDATE()
       AND status NOT IN ('Completed', 'Cancelled')
       ${userClause}
       ORDER BY end_date ASC`,
      userParam
    );

    // Today's reminders
    const [todayReminders] = await pool.query(
      `SELECT id, title, reminder_datetime
       FROM reminders
       WHERE DATE(reminder_datetime) = CURDATE()
       AND is_active = TRUE AND is_completed = FALSE
       ${userClause}
       ORDER BY reminder_datetime ASC`,
      userParam
    );

    res.json({
      success: true,
      data: { due_today: dueToday, overdue, today_reminders: todayReminders }
    });
  } catch (error) {
    console.error('Today focus error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch today focus' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Register route in server.js**

In `backend/src/server.js`, add after the existing route registrations (~line 174):

```javascript
const dashboardRoutes = require('./routes/dashboard.routes');
// Add with other app.use lines:
app.use('/api/dashboard', dashboardRoutes);
```

- [ ] **Step 3: Reload and test**

```bash
pm2 reload pds-backend --update-env
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:5000/api/dashboard/today-focus | jq .
```

Expected: `{ success: true, data: { due_today: [...], overdue: [...], today_reminders: [...] } }`

- [ ] **Step 4: Commit**

```bash
cd /var/www/html/agenda_work && git add backend/src/routes/dashboard.routes.js backend/src/server.js
git commit -m "feat(dashboard): add today-focus endpoint"
```

---

### Task 3: Add notes/recent endpoint

**Files:**
- Modify: `backend/src/routes/note.routes.js` (add new route before the catch-all GET /)

**Context:** Add `GET /notes/recent?limit=3` that returns recent notes with plain_text preview and folder name. Must be registered BEFORE the existing `GET /` route so Express matches it first.

- [ ] **Step 1: Backup**

```bash
cp backend/src/routes/note.routes.js backend/src/routes/note.routes.js.backup
```

- [ ] **Step 2: Add the recent endpoint**

Add this route BEFORE the existing `router.get('/', ...)` in note.routes.js:

```javascript
// GET /api/notes/recent — dashboard preview
router.get('/recent', verifyToken, addUserFilter, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 3, 10);
    const userFilter = req.userFilter;
    const userClause = userFilter ? 'AND n.user_id = ?' : '';
    const userParam = userFilter ? [userFilter.user_id] : [];

    const [notes] = await pool.query(
      `SELECT n.id, n.title, SUBSTRING(n.content, 1, 100) as plain_text_preview,
       n.updated_at, n.color, nf.name as folder_name
       FROM notes n
       LEFT JOIN note_folders nf ON n.folder_id = nf.id
       WHERE n.is_archived = 0 ${userClause}
       ORDER BY n.updated_at DESC
       LIMIT ?`,
      [...userParam, limit]
    );

    res.json({ success: true, data: notes });
  } catch (error) {
    console.error('Recent notes error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch recent notes' });
  }
});
```

- [ ] **Step 3: Reload and test**

```bash
pm2 reload pds-backend --update-env
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:5000/api/notes/recent?limit=3" | jq .
```

Expected: array of 3 notes with `plain_text_preview`, `folder_name` fields.

- [ ] **Step 4: Commit**

```bash
cd /var/www/html/agenda_work && git add backend/src/routes/note.routes.js
git commit -m "feat(dashboard): add notes/recent endpoint for dashboard preview"
```

---

### Task 4: Add activity feed endpoint

**Files:**
- Modify: `backend/src/routes/dashboard.routes.js` (add second route)

**Context:** UNION query across tasks, notes, reminders sorted by timestamp. Uses `updated_at` for tasks/notes, `reminder_datetime` for reminders.

- [ ] **Step 1: Add activity feed route to dashboard.routes.js**

Add before `module.exports`:

```javascript
// GET /api/dashboard/activity-feed
router.get('/activity-feed', verifyToken, addUserFilter, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 30);
    const userFilter = req.userFilter;
    const userClause = userFilter ? 'AND user_id = ?' : '';
    const userParam = userFilter ? [userFilter.user_id] : [];

    const [rows] = await pool.query(
      `(SELECT 'task_completed' as type, task as title, updated_at as timestamp,
        id as ref_id, 'task' as ref_type
        FROM tasks WHERE status = 'Completed' ${userClause}
        ORDER BY updated_at DESC LIMIT ?)
       UNION ALL
       (SELECT 'task_created' as type, task as title, created_at as timestamp,
        id as ref_id, 'task' as ref_type
        FROM tasks WHERE 1=1 ${userClause}
        ORDER BY created_at DESC LIMIT ?)
       UNION ALL
       (SELECT 'note_updated' as type, title, updated_at as timestamp,
        id as ref_id, 'note' as ref_type
        FROM notes WHERE is_archived = 0 ${userClause}
        ORDER BY updated_at DESC LIMIT ?)
       UNION ALL
       (SELECT 'reminder_due' as type, title, reminder_datetime as timestamp,
        id as ref_id, 'reminder' as ref_type
        FROM reminders WHERE is_active = TRUE ${userClause}
        ORDER BY reminder_datetime DESC LIMIT ?)
       ORDER BY timestamp DESC LIMIT ?`,
      [...userParam, limit, ...userParam, limit, ...userParam, limit, ...userParam, limit, limit]
    );

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Activity feed error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch activity feed' });
  }
});
```

- [ ] **Step 2: Reload and test**

```bash
pm2 reload pds-backend --update-env
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:5000/api/dashboard/activity-feed?limit=5" | jq .
```

Expected: array of activity items with `type`, `title`, `timestamp`, `ref_id`, `ref_type`.

- [ ] **Step 3: Commit**

```bash
cd /var/www/html/agenda_work && git add backend/src/routes/dashboard.routes.js
git commit -m "feat(dashboard): add activity feed endpoint with UNION query"
```

---

## Chunk 2: Frontend Foundation — API, Hook, Grid, WelcomeBanner, StatCard

### Task 5: Update frontend API service

**Files:**
- Modify: `frontend/src/services/api.js` (~line 168, after remindersAPI)

- [ ] **Step 1: Backup**

```bash
cp frontend/src/services/api.js frontend/src/services/api.js.backup
```

- [ ] **Step 2: Add dashboardAPI and notesAPI.getRecent**

Add `dashboardAPI` export after `remindersAPI`:

```javascript
export const dashboardAPI = {
  getTodayFocus: () => api.get('/dashboard/today-focus'),
  getActivityFeed: (limit = 10) => api.get('/dashboard/activity-feed', { params: { limit } }),
};
```

Add `getRecent` to existing `notesAPI` object:

```javascript
// Inside notesAPI, add:
getRecent: (limit = 3) => api.get('/notes/recent', { params: { limit } }),
```

- [ ] **Step 3: Commit**

```bash
cd /var/www/html/agenda_work/frontend && git add src/services/api.js
git commit -m "feat(dashboard): add dashboardAPI and notesAPI.getRecent to api service"
```

---

### Task 6: Create useDashboard hook

**Files:**
- Create: `frontend/src/hooks/useDashboard.js`

**Context:** Single hook that fetches all dashboard data via Promise.allSettled. Each API call gets its own loading/error state so sections are independent.

- [ ] **Step 1: Create hooks directory if needed**

```bash
mkdir -p frontend/src/hooks
```

- [ ] **Step 2: Create the hook**

```javascript
// frontend/src/hooks/useDashboard.js
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { tasksAPI, remindersAPI, notesAPI, dashboardAPI } from '../services/api';
import toast from 'react-hot-toast';

export default function useDashboard() {
  const { user, isAdmin } = useAuth();

  // Data states
  const [stats, setStats] = useState(null);
  const [todayFocus, setTodayFocus] = useState(null);
  const [recentTasks, setRecentTasks] = useState([]);
  const [recentNotes, setRecentNotes] = useState([]);
  const [activityFeed, setActivityFeed] = useState([]);
  const [heatmapData, setHeatmapData] = useState([]);
  const [userStats, setUserStats] = useState([]);

  // Per-section loading
  const [statsLoading, setStatsLoading] = useState(true);
  const [focusLoading, setFocusLoading] = useState(true);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [notesLoading, setNotesLoading] = useState(true);
  const [activityLoading, setActivityLoading] = useState(true);

  // Per-section error
  const [statsError, setStatsError] = useState(null);
  const [focusError, setFocusError] = useState(null);
  const [tasksError, setTasksError] = useState(null);
  const [notesError, setNotesError] = useState(null);
  const [activityError, setActivityError] = useState(null);

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

  const refetchAll = useCallback(() => {
    fetchSection(tasksAPI.getStats, setStats, setStatsLoading, setStatsError);
    fetchSection(dashboardAPI.getTodayFocus, setTodayFocus, setFocusLoading, setFocusError);
    fetchSection(
      () => tasksAPI.getAll({ limit: 5, sortBy: 'created_at', sortOrder: 'desc' }),
      setRecentTasks, setTasksLoading, setTasksError
    );
    fetchSection(() => notesAPI.getRecent(3), setRecentNotes, setNotesLoading, setNotesError);
    fetchSection(() => dashboardAPI.getActivityFeed(10), setActivityFeed, setActivityLoading, setActivityError);
    // Heatmap — no per-section error needed (existing feature)
    tasksAPI.getHeatmapData().then(r => setHeatmapData(r.data.data || [])).catch(() => {});
    // Admin user stats
    if (isAdmin) {
      tasksAPI.getUserStats().then(r => setUserStats(r.data.data || [])).catch(() => {});
    }
  }, [isAdmin, fetchSection]);

  const refetchFocus = useCallback(() => {
    fetchSection(dashboardAPI.getTodayFocus, setTodayFocus, setFocusLoading, setFocusError);
  }, [fetchSection]);

  // Complete task from dashboard (optimistic)
  const completeTask = useCallback(async (taskId) => {
    // Optimistic: remove from focus
    setTodayFocus(prev => {
      if (!prev) return prev;
      return {
        due_today: prev.due_today.filter(t => t.id !== taskId),
        overdue: prev.overdue.filter(t => t.id !== taskId),
        today_reminders: prev.today_reminders,
      };
    });
    try {
      await tasksAPI.update(taskId, { status: 'Completed' });
      toast.success('Task selesai!');
      // Refetch stats and tasks (completion changes counts)
      fetchSection(tasksAPI.getStats, setStats, setStatsLoading, setStatsError);
      fetchSection(
        () => tasksAPI.getAll({ limit: 5, sortBy: 'created_at', sortOrder: 'desc' }),
        setRecentTasks, setTasksLoading, setTasksError
      );
    } catch (err) {
      toast.error('Gagal menyelesaikan task');
      refetchFocus(); // Revert optimistic
    }
  }, [fetchSection, refetchFocus]);

  useEffect(() => {
    refetchAll();

    const handleFocus = () => refetchAll();
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
    heatmapData, userStats,
    statsLoading, focusLoading, tasksLoading, notesLoading, activityLoading,
    statsError, focusError, tasksError, notesError, activityError,
    completeTask, refetchAll, refetchFocus,
  };
}
```

- [ ] **Step 3: Commit**

```bash
cd /var/www/html/agenda_work/frontend && git add src/hooks/useDashboard.js
git commit -m "feat(dashboard): create useDashboard hook with per-section loading"
```

---

### Task 7: Create BentoGrid layout + SkeletonCard

**Files:**
- Create: `frontend/src/components/dashboard/BentoGrid.jsx`
- Create: `frontend/src/components/dashboard/SkeletonCard.jsx`

- [ ] **Step 1: Create directory**

```bash
mkdir -p frontend/src/components/dashboard
```

- [ ] **Step 2: Create BentoGrid.jsx**

```jsx
// frontend/src/components/dashboard/BentoGrid.jsx
export default function BentoGrid({ children }) {
  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 auto-rows-min">
      {children}
    </div>
  );
}

// Grid area helpers — use as className on children
export const bentoSpan = {
  full: 'sm:col-span-2 lg:col-span-12',
  wide: 'sm:col-span-2 lg:col-span-8',
  narrow: 'sm:col-span-1 lg:col-span-4',
  stat: 'sm:col-span-1 lg:col-span-3',
  focusTall: 'sm:col-span-1 lg:col-span-4 lg:row-span-2',
};

export const glassCard =
  'bg-white/70 backdrop-blur-xl border border-white/30 rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.06)] transition-all duration-300';
```

- [ ] **Step 3: Create SkeletonCard.jsx**

```jsx
// frontend/src/components/dashboard/SkeletonCard.jsx
import { glassCard } from './BentoGrid';

export default function SkeletonCard({ className = '', lines = 3, height }) {
  return (
    <div className={`${glassCard} p-5 animate-pulse ${className}`} style={height ? { minHeight: height } : {}}>
      <div className="h-4 bg-gray-200 rounded w-1/3 mb-4" />
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={`h-3 bg-gray-100 rounded mb-2 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
cd /var/www/html/agenda_work/frontend && git add src/components/dashboard/
git commit -m "feat(dashboard): add BentoGrid layout and SkeletonCard components"
```

---

### Task 8: Create WelcomeBanner with progress ring

**Files:**
- Create: `frontend/src/components/dashboard/WelcomeBanner.jsx`

**Context:** Full-width banner with animated gradient, time-aware greeting, SVG progress ring, streak counter, and dynamic nudge text.

- [ ] **Step 1: Create WelcomeBanner.jsx**

```jsx
// frontend/src/components/dashboard/WelcomeBanner.jsx
import { useState, useEffect } from 'react';
import { HiOutlineFire } from 'react-icons/hi';

function getGreeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return { text: 'Selamat Pagi', icon: '☀️' };
  if (h >= 11 && h < 15) return { text: 'Selamat Siang', icon: '🌤️' };
  if (h >= 15 && h < 18) return { text: 'Selamat Sore', icon: '🌅' };
  return { text: 'Selamat Malam', icon: '🌙' };
}

function ProgressRing({ percent }) {
  const [animPercent, setAnimPercent] = useState(0);
  const radius = 40;
  const stroke = 6;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (animPercent / 100) * circumference;

  useEffect(() => {
    const timer = setTimeout(() => setAnimPercent(percent), 100);
    return () => clearTimeout(timer);
  }, [percent]);

  return (
    <div className="relative w-24 h-24 flex-shrink-0">
      <svg className="w-24 h-24 -rotate-90" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={radius} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={stroke} />
        <circle
          cx="48" cy="48" r={radius} fill="none"
          stroke="white" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-white text-lg font-bold">{Math.round(percent)}%</span>
      </div>
    </div>
  );
}

export default function WelcomeBanner({ user, stats, todayFocus }) {
  const greeting = getGreeting();
  const completionRate = stats?.completion_rate || 0;
  const streak = stats?.streak_days || 0;

  const dueCount = todayFocus?.due_today?.length || 0;
  const overdueCount = todayFocus?.overdue?.length || 0;
  let nudge = 'All clear for today! 🎉';
  if (overdueCount > 0) nudge = `${overdueCount} overdue item${overdueCount > 1 ? 's' : ''} butuh perhatian!`;
  else if (dueCount > 0) nudge = `${dueCount} task${dueCount > 1 ? 's' : ''} due today. Semangat!`;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-purple-600 to-indigo-700 p-6 text-white">
      {/* Animated bg circles */}
      <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl animate-pulse" />
      <div className="absolute -bottom-8 -left-8 w-32 h-32 bg-white/5 rounded-full blur-xl" />

      <div className="relative flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold truncate">
            {greeting.text}, {user?.username}! {greeting.icon}
          </h1>
          <p className="text-indigo-100 mt-1 text-sm">{nudge}</p>
          {streak > 0 && (
            <div className="flex items-center gap-1.5 mt-2 text-amber-200 text-sm font-medium">
              <HiOutlineFire className="w-4 h-4" />
              {streak}-day streak!
            </div>
          )}
        </div>
        <ProgressRing percent={completionRate} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /var/www/html/agenda_work/frontend && git add src/components/dashboard/WelcomeBanner.jsx
git commit -m "feat(dashboard): add WelcomeBanner with time greeting, progress ring, streak"
```

---

### Task 9: Create StatCard with trends and count-up

**Files:**
- Create: `frontend/src/components/dashboard/StatCard.jsx`

**Context:** Glassmorphism card with animated count-up, trend arrow, and optional progress bar. Used 4 times in the grid.

- [ ] **Step 1: Create StatCard.jsx**

```jsx
// frontend/src/components/dashboard/StatCard.jsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { glassCard } from './BentoGrid';

function useCountUp(target, duration = 800) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!target) { setCount(0); return; }
    let start = 0;
    const step = Math.max(1, Math.ceil(target / (duration / 16)));
    const timer = setInterval(() => {
      start += step;
      if (start >= target) { setCount(target); clearInterval(timer); }
      else setCount(start);
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration]);
  return count;
}

function TrendBadge({ change }) {
  if (change === undefined || change === null) return null;
  const isUp = change > 0;
  const isDown = change < 0;
  const color = isUp ? 'text-green-600 bg-green-50' : isDown ? 'text-red-600 bg-red-50' : 'text-gray-500 bg-gray-50';
  const arrow = isUp ? '↑' : isDown ? '↓' : '→';
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full ${color}`}>
      {arrow}{Math.abs(change)}
    </span>
  );
}

export default function StatCard({ title, value, icon: Icon, color, link, trend, progressPercent }) {
  const displayValue = useCountUp(value || 0);

  return (
    <Link to={link} className={`${glassCard} p-5 group hover:scale-[1.02] hover:shadow-lg`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">{title}</p>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-3xl font-bold text-gray-900">{displayValue}</span>
            <TrendBadge change={trend} />
          </div>
        </div>
        <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
      {progressPercent !== undefined && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Completion</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-1000"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}
    </Link>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /var/www/html/agenda_work/frontend && git add src/components/dashboard/StatCard.jsx
git commit -m "feat(dashboard): add StatCard with glassmorphism, count-up, trend badge"
```

---

## Chunk 3: Content Components — TodayFocus, RecentTasks, RecentNotes, ActivityFeed, QuickAddBar

### Task 10: Create TodayFocus panel

**Files:**
- Create: `frontend/src/components/dashboard/TodayFocus.jsx`

**Context:** Shows overdue tasks (red accent), due-today tasks, and today's reminders. Quick checkbox to complete tasks via PUT.

- [ ] **Step 1: Create TodayFocus.jsx**

```jsx
// frontend/src/components/dashboard/TodayFocus.jsx
import { HiOutlineExclamation, HiOutlineCheckCircle, HiOutlineBell, HiOutlineCheck } from 'react-icons/hi';
import dayjs from 'dayjs';
import { glassCard } from './BentoGrid';

function FocusItem({ item, type, onComplete }) {
  const isOverdue = type === 'overdue';
  return (
    <div className={`flex items-center gap-3 py-2.5 px-3 rounded-xl transition-colors hover:bg-white/50 ${isOverdue ? 'border-l-3 border-red-400' : ''}`}>
      {type !== 'reminder' ? (
        <button
          onClick={() => onComplete(item.id)}
          className="w-5 h-5 rounded-full border-2 border-gray-300 hover:border-indigo-500 hover:bg-indigo-50 flex items-center justify-center flex-shrink-0 transition-colors group"
        >
          <HiOutlineCheck className="w-3 h-3 text-transparent group-hover:text-indigo-500" />
        </button>
      ) : (
        <HiOutlineBell className="w-5 h-5 text-orange-400 flex-shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-800 truncate">{item.task || item.title}</p>
        {type === 'reminder' && (
          <p className="text-xs text-orange-500">{dayjs(item.reminder_datetime).format('HH:mm')}</p>
        )}
      </div>
      {item.priority && (
        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
          item.priority === 'P0' ? 'bg-red-100 text-red-700' :
          item.priority === 'P1' ? 'bg-orange-100 text-orange-700' :
          'bg-gray-100 text-gray-600'
        }`}>{item.priority}</span>
      )}
      {isOverdue && (
        <span className="text-xs font-medium text-red-500">{item.days_overdue}d</span>
      )}
    </div>
  );
}

export default function TodayFocus({ data, onComplete, loading, error, onRetry }) {
  if (loading) {
    return (
      <div className={`${glassCard} p-5 animate-pulse`}>
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-4" />
        {[1,2,3].map(i => <div key={i} className="h-10 bg-gray-100 rounded-xl mb-2" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${glassCard} p-5 text-center text-gray-400 text-sm`}>
        Gagal memuat focus. <button onClick={onRetry} className="text-indigo-500 underline">Retry</button>
      </div>
    );
  }

  const overdue = data?.overdue || [];
  const dueToday = data?.due_today || [];
  const reminders = data?.today_reminders || [];
  const isEmpty = overdue.length === 0 && dueToday.length === 0 && reminders.length === 0;

  const remaining = dueToday.length + overdue.length;
  const motivations = [
    'All clear for today! 🎉',
    'Satu lagi! Kamu bisa! 💪',
    `${remaining} tasks to go. Semangat!`,
  ];
  const motivation = isEmpty ? motivations[0] : remaining <= 1 ? motivations[1] : motivations[2];

  return (
    <div className={`${glassCard} p-5 flex flex-col`}>
      <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-indigo-500" />
        Today's Focus
      </h3>

      <div className="flex-1 space-y-1 overflow-auto">
        {overdue.length > 0 && (
          <>
            <p className="text-xs font-semibold text-red-500 uppercase tracking-wider px-3 pt-1">Overdue</p>
            {overdue.map(item => <FocusItem key={item.id} item={item} type="overdue" onComplete={onComplete} />)}
          </>
        )}
        {dueToday.length > 0 && (
          <>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 pt-2">Due Today</p>
            {dueToday.map(item => <FocusItem key={item.id} item={item} type="today" onComplete={onComplete} />)}
          </>
        )}
        {reminders.length > 0 && (
          <>
            <p className="text-xs font-semibold text-orange-400 uppercase tracking-wider px-3 pt-2">Reminders</p>
            {reminders.map(item => <FocusItem key={item.id} item={item} type="reminder" onComplete={onComplete} />)}
          </>
        )}
        {isEmpty && (
          <div className="flex flex-col items-center justify-center py-6 text-gray-400">
            <HiOutlineCheckCircle className="w-10 h-10 mb-2 text-green-400" />
            <p className="text-sm">All clear for today!</p>
          </div>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-gray-100 text-center">
        <p className="text-xs text-gray-500">{motivation}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /var/www/html/agenda_work/frontend && git add src/components/dashboard/TodayFocus.jsx
git commit -m "feat(dashboard): add TodayFocus panel with quick-complete checkboxes"
```

---

### Task 11: Create RecentTasks component

**Files:**
- Create: `frontend/src/components/dashboard/RecentTasks.jsx`

- [ ] **Step 1: Create RecentTasks.jsx**

```jsx
// frontend/src/components/dashboard/RecentTasks.jsx
import { Link } from 'react-router-dom';
import { HiOutlineArrowRight, HiOutlineCheck } from 'react-icons/hi';
import dayjs from 'dayjs';
import { glassCard } from './BentoGrid';

function getDueBadge(endDate) {
  if (!endDate) return null;
  const now = dayjs();
  const due = dayjs(endDate);
  const diff = due.diff(now, 'day');
  if (diff < 0) return { label: `${Math.abs(diff)}d overdue`, cls: 'bg-red-100 text-red-600' };
  if (diff <= 3) return { label: `Due ${due.format('DD MMM')}`, cls: 'bg-amber-100 text-amber-600' };
  return { label: `Due ${due.format('DD MMM')}`, cls: 'bg-green-50 text-green-600' };
}

function getPriorityColor(p) {
  return { P0: 'bg-red-100 text-red-700', P1: 'bg-orange-100 text-orange-700', P2: 'bg-blue-100 text-blue-700', P3: 'bg-gray-100 text-gray-600' }[p] || 'bg-gray-100 text-gray-600';
}

export default function RecentTasks({ tasks, onComplete, loading, error }) {
  if (loading) {
    return (
      <div className={`${glassCard} p-5 animate-pulse`}>
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-4" />
        {[1,2,3].map(i => <div key={i} className="h-14 bg-gray-100 rounded-xl mb-2" />)}
      </div>
    );
  }

  if (error) {
    return <div className={`${glassCard} p-5 text-center text-gray-400 text-sm`}>Gagal memuat tasks.</div>;
  }

  return (
    <div className={`${glassCard} p-5`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Recent Tasks</h3>
        <Link to="/tasks" className="text-xs text-indigo-500 hover:text-indigo-600 flex items-center gap-1">
          View all <HiOutlineArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {tasks.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">Belum ada task.</p>
      ) : (
        <div className="space-y-2">
          {tasks.map(task => {
            const isCompleted = task.status === 'Completed';
            const dueBadge = !isCompleted ? getDueBadge(task.end_date) : null;
            return (
              <div key={task.id} className={`flex items-center gap-3 p-3 rounded-xl hover:bg-white/50 transition-colors ${isCompleted ? 'opacity-60' : ''}`}>
                <button
                  onClick={() => !isCompleted && onComplete(task.id)}
                  disabled={isCompleted}
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    isCompleted ? 'border-green-400 bg-green-400' : 'border-gray-300 hover:border-indigo-500 hover:bg-indigo-50 group'
                  }`}
                >
                  <HiOutlineCheck className={`w-3 h-3 ${isCompleted ? 'text-white' : 'text-transparent group-hover:text-indigo-500'}`} />
                </button>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium truncate ${isCompleted ? 'line-through text-gray-400' : 'text-gray-800'}`}>{task.task}</p>
                  <p className="text-xs text-gray-400 truncate">{task.prefix} — {task.kegiatan}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${getPriorityColor(task.priority)}`}>{task.priority}</span>
                  {dueBadge && <span className={`text-xs px-1.5 py-0.5 rounded ${dueBadge.cls}`}>{dueBadge.label}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /var/www/html/agenda_work/frontend && git add src/components/dashboard/RecentTasks.jsx
git commit -m "feat(dashboard): add RecentTasks with inline complete and due badges"
```

---

### Task 12: Create RecentNotes component

**Files:**
- Create: `frontend/src/components/dashboard/RecentNotes.jsx`

- [ ] **Step 1: Create RecentNotes.jsx**

```jsx
// frontend/src/components/dashboard/RecentNotes.jsx
import { Link } from 'react-router-dom';
import { HiOutlineArrowRight, HiOutlineDocumentText } from 'react-icons/hi';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { glassCard } from './BentoGrid';

dayjs.extend(relativeTime);

export default function RecentNotes({ notes, loading, error }) {
  if (loading) {
    return (
      <div className={`${glassCard} p-5 animate-pulse`}>
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-4" />
        {[1,2].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl mb-2" />)}
      </div>
    );
  }

  if (error) {
    return <div className={`${glassCard} p-5 text-center text-gray-400 text-sm`}>Gagal memuat notes.</div>;
  }

  return (
    <div className={`${glassCard} p-5`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <HiOutlineDocumentText className="w-4 h-4 text-indigo-400" />
          Recent Notes
        </h3>
        <Link to="/notes" className="text-xs text-indigo-500 hover:text-indigo-600 flex items-center gap-1">
          View all <HiOutlineArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {notes.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">Belum ada catatan.</p>
      ) : (
        <div className="space-y-2">
          {notes.map(note => (
            <Link
              key={note.id}
              to="/notes"
              className="block p-3 rounded-xl hover:bg-white/50 transition-colors"
              style={{ borderLeft: `3px solid ${note.color || '#e5e7eb'}` }}
            >
              <p className="text-sm font-medium text-gray-800 truncate">{note.title || 'Untitled'}</p>
              <p className="text-xs text-gray-400 line-clamp-2 mt-0.5">{note.plain_text_preview || ''}</p>
              <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-400">
                {note.folder_name && <span className="text-indigo-400">📁 {note.folder_name}</span>}
                <span>{dayjs(note.updated_at).fromNow()}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /var/www/html/agenda_work/frontend && git add src/components/dashboard/RecentNotes.jsx
git commit -m "feat(dashboard): add RecentNotes with color accent and preview"
```

---

### Task 13: Create ActivityFeed component

**Files:**
- Create: `frontend/src/components/dashboard/ActivityFeed.jsx`

- [ ] **Step 1: Create ActivityFeed.jsx**

```jsx
// frontend/src/components/dashboard/ActivityFeed.jsx
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { HiOutlineCheck, HiOutlinePlus, HiOutlinePencil, HiOutlineBell } from 'react-icons/hi';
import { glassCard } from './BentoGrid';

dayjs.extend(relativeTime);

const ICONS = {
  task_completed: { icon: HiOutlineCheck, color: 'bg-green-100 text-green-600' },
  task_created: { icon: HiOutlinePlus, color: 'bg-blue-100 text-blue-600' },
  note_updated: { icon: HiOutlinePencil, color: 'bg-purple-100 text-purple-600' },
  reminder_due: { icon: HiOutlineBell, color: 'bg-orange-100 text-orange-600' },
};

const LABELS = {
  task_completed: 'Completed task',
  task_created: 'Created task',
  note_updated: 'Updated note',
  reminder_due: 'Reminder',
};

export default function ActivityFeed({ items, loading, error }) {
  if (loading) {
    return (
      <div className={`${glassCard} p-5 animate-pulse`}>
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-4" />
        {[1,2,3,4].map(i => <div key={i} className="flex gap-3 mb-3"><div className="w-8 h-8 bg-gray-100 rounded-full" /><div className="flex-1 h-8 bg-gray-100 rounded" /></div>)}
      </div>
    );
  }

  if (error) {
    return <div className={`${glassCard} p-5 text-center text-gray-400 text-sm`}>Gagal memuat activity.</div>;
  }

  return (
    <div className={`${glassCard} p-5`}>
      <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        Activity
      </h3>

      {items.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">Belum ada aktivitas.</p>
      ) : (
        <div className="space-y-1">
          {items.map((item, idx) => {
            const config = ICONS[item.type] || ICONS.task_created;
            const IconComp = config.icon;
            return (
              <div key={`${item.type}-${item.ref_id}-${idx}`} className="flex items-start gap-3 py-2 px-2 rounded-lg hover:bg-white/50 transition-colors">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${config.color}`}>
                  <IconComp className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-500">{LABELS[item.type] || item.type}</p>
                  <p className="text-sm text-gray-800 truncate">{item.title}</p>
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">{dayjs(item.timestamp).fromNow()}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /var/www/html/agenda_work/frontend && git add src/components/dashboard/ActivityFeed.jsx
git commit -m "feat(dashboard): add ActivityFeed timeline component"
```

---

### Task 14: Create QuickAddBar with mobile FAB

**Files:**
- Create: `frontend/src/components/dashboard/QuickAddBar.jsx`

**Context:** Desktop: full-width bar with 3 buttons. Mobile: FAB bottom-right that fans out. Quick modals for creating task/note/reminder with minimal fields.

- [ ] **Step 1: Create QuickAddBar.jsx**

```jsx
// frontend/src/components/dashboard/QuickAddBar.jsx
import { useState, useRef, useEffect } from 'react';
import { HiOutlinePlus, HiOutlineClipboardList, HiOutlinePencilAlt, HiOutlineBell, HiOutlineX } from 'react-icons/hi';
import { tasksAPI, notesAPI, remindersAPI } from '../../services/api';
import toast from 'react-hot-toast';
import { glassCard } from './BentoGrid';

function QuickModal({ type, onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('P2');
  const [datetime, setDatetime] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      if (type === 'task') {
        await tasksAPI.create({ task: title.trim(), priority, status: 'Pending' });
      } else if (type === 'note') {
        await notesAPI.create({ title: title.trim(), content: '' });
      } else {
        await remindersAPI.create({ title: title.trim(), reminder_datetime: datetime || new Date().toISOString() });
      }
      toast.success(`${type === 'task' ? 'Task' : type === 'note' ? 'Note' : 'Reminder'} dibuat!`);
      onCreated();
      onClose();
    } catch {
      toast.error('Gagal membuat item');
    } finally {
      setSaving(false);
    }
  };

  const labels = { task: 'New Task', note: 'New Note', reminder: 'New Reminder' };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-5 space-y-3 animate-fadeIn"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{labels[type]}</h3>
          <button type="button" onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <HiOutlineX className="w-5 h-5 text-gray-400" />
          </button>
        </div>
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={type === 'task' ? 'Nama task...' : type === 'note' ? 'Judul catatan...' : 'Judul reminder...'}
          className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
        />
        {type === 'task' && (
          <div className="flex gap-2">
            {['P0','P1','P2','P3'].map(p => (
              <button key={p} type="button" onClick={() => setPriority(p)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors ${priority === p ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'border-gray-200 text-gray-500'}`}
              >{p}</button>
            ))}
          </div>
        )}
        {type === 'reminder' && (
          <input
            type="datetime-local"
            value={datetime}
            onChange={e => setDatetime(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          />
        )}
        <button
          type="submit"
          disabled={saving || !title.trim()}
          className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Menyimpan...' : 'Buat'}
        </button>
      </form>
    </div>
  );
}

export default function QuickAddBar({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(null); // 'task' | 'note' | 'reminder' | null

  const actions = [
    { type: 'task', icon: HiOutlineClipboardList, label: 'Task', color: 'hover:bg-blue-50 hover:text-blue-600' },
    { type: 'note', icon: HiOutlinePencilAlt, label: 'Note', color: 'hover:bg-purple-50 hover:text-purple-600' },
    { type: 'reminder', icon: HiOutlineBell, label: 'Reminder', color: 'hover:bg-orange-50 hover:text-orange-600' },
  ];

  return (
    <>
      {/* Desktop bar */}
      <div className={`${glassCard} p-3 hidden sm:flex items-center justify-center gap-3`}>
        {actions.map(a => (
          <button key={a.type} onClick={() => setModal(a.type)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-gray-600 transition-colors ${a.color}`}
          >
            <a.icon className="w-4 h-4" />
            + {a.label}
          </button>
        ))}
      </div>

      {/* Mobile FAB */}
      <div className="sm:hidden fixed bottom-6 right-6 z-40">
        {open && (
          <div className="absolute bottom-14 right-0 flex flex-col gap-2 items-end animate-fadeIn">
            {actions.map(a => (
              <button key={a.type} onClick={() => { setModal(a.type); setOpen(false); }}
                className="flex items-center gap-2 px-4 py-2.5 bg-white rounded-full shadow-lg text-sm font-medium text-gray-700"
              >
                <a.icon className="w-4 h-4" />
                {a.label}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setOpen(!open)}
          className={`w-14 h-14 rounded-full bg-indigo-600 text-white shadow-xl flex items-center justify-center transition-transform ${open ? 'rotate-45' : ''}`}
        >
          <HiOutlinePlus className="w-6 h-6" />
        </button>
      </div>

      {/* Quick create modal */}
      {modal && <QuickModal type={modal} onClose={() => setModal(null)} onCreated={onCreated} />}
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /var/www/html/agenda_work/frontend && git add src/components/dashboard/QuickAddBar.jsx
git commit -m "feat(dashboard): add QuickAddBar with mobile FAB and quick-create modals"
```

---

## Chunk 4: Dashboard Orchestrator + Integration

### Task 15: Rewrite Dashboard.jsx as thin orchestrator

**Files:**
- Modify: `frontend/src/pages/Dashboard.jsx` (full rewrite)

**Context:** Replace all 341 lines with a thin orchestrator that wires useDashboard hook to BentoGrid + components. Admin user stats table preserved in a collapsible section.

- [ ] **Step 1: Backup**

```bash
cp frontend/src/pages/Dashboard.jsx frontend/src/pages/Dashboard.jsx.backup
```

- [ ] **Step 2: Rewrite Dashboard.jsx**

```jsx
// frontend/src/pages/Dashboard.jsx
import { useState } from 'react';
import {
  HiOutlineClipboardList, HiOutlineCheckCircle,
  HiOutlineClock, HiOutlineExclamation,
  HiOutlineUsers, HiOutlineArrowRight, HiOutlineChevronDown,
} from 'react-icons/hi';
import { Link } from 'react-router-dom';
import useDashboard from '../hooks/useDashboard';
import CalendarHeatmap from '../components/CalendarHeatmap';
import BentoGrid, { bentoSpan, glassCard } from '../components/dashboard/BentoGrid';
import WelcomeBanner from '../components/dashboard/WelcomeBanner';
import StatCard from '../components/dashboard/StatCard';
import TodayFocus from '../components/dashboard/TodayFocus';
import RecentTasks from '../components/dashboard/RecentTasks';
import RecentNotes from '../components/dashboard/RecentNotes';
import ActivityFeed from '../components/dashboard/ActivityFeed';
import QuickAddBar from '../components/dashboard/QuickAddBar';
import SkeletonCard from '../components/dashboard/SkeletonCard';

export default function Dashboard() {
  const {
    user, isAdmin,
    stats, todayFocus, recentTasks, recentNotes, activityFeed,
    heatmapData, userStats,
    statsLoading, focusLoading, tasksLoading, notesLoading, activityLoading,
    statsError, focusError, tasksError, notesError, activityError,
    completeTask, refetchAll, refetchFocus,
  } = useDashboard();

  const [showUserStats, setShowUserStats] = useState(false);

  return (
    <div className="space-y-4 animate-fadeIn pb-20 sm:pb-4">
      <BentoGrid>
        {/* Row 1: Welcome Banner */}
        <div className={bentoSpan.full}>
          {statsLoading ? (
            <SkeletonCard lines={2} height={120} />
          ) : (
            <WelcomeBanner user={user} stats={stats} todayFocus={todayFocus} />
          )}
        </div>

        {/* Row 2-3: Stat Cards (3) + TodayFocus (right, spanning 2 rows) + Overdue (row 3 left) */}
        {statsLoading ? (
          <>
            {[1,2,3].map(i => <SkeletonCard key={i} className={bentoSpan.stat} lines={1} />)}
            <SkeletonCard className={bentoSpan.focusTall} lines={4} />
            <SkeletonCard className={bentoSpan.stat} lines={1} />
          </>
        ) : (
          <>
            <div className={bentoSpan.stat}>
              <StatCard title="Total Tasks" value={stats?.total} icon={HiOutlineClipboardList}
                color="bg-blue-500" link="/tasks" trend={stats?.trends?.total_change}
                progressPercent={stats?.completion_rate} />
            </div>
            <div className={bentoSpan.stat}>
              <StatCard title="Completed" value={stats?.completed} icon={HiOutlineCheckCircle}
                color="bg-green-500" link="/tasks" trend={stats?.trends?.completed_change} />
            </div>
            <div className={bentoSpan.stat}>
              <StatCard title="In Progress" value={stats?.in_progress} icon={HiOutlineClock}
                color="bg-amber-500" link="/tasks" trend={stats?.trends?.in_progress_change} />
            </div>
            <div className={bentoSpan.focusTall}>
              <TodayFocus data={todayFocus} onComplete={completeTask}
                loading={focusLoading} error={focusError} onRetry={refetchFocus} />
            </div>
            <div className={bentoSpan.stat}>
              <StatCard title="Overdue" value={stats?.overdue} icon={HiOutlineExclamation}
                color="bg-red-500" link="/tasks" />
            </div>
          </>
        )}

        {/* Row 4: Heatmap + Recent Notes */}
        <div className={bentoSpan.wide}>
          <div className={glassCard + ' p-4'}>
            <CalendarHeatmap data={heatmapData} />
          </div>
        </div>
        <div className={bentoSpan.narrow}>
          <RecentNotes notes={recentNotes} loading={notesLoading} error={notesError} />
        </div>

        {/* Row 5: Recent Tasks + Activity Feed */}
        <div className={bentoSpan.wide}>
          <RecentTasks tasks={recentTasks} onComplete={completeTask}
            loading={tasksLoading} error={tasksError} />
        </div>
        <div className={bentoSpan.narrow}>
          <ActivityFeed items={activityFeed} loading={activityLoading} error={activityError} />
        </div>

        {/* Row 6: Quick Add */}
        <div className={bentoSpan.full}>
          <QuickAddBar onCreated={refetchAll} />
        </div>
      </BentoGrid>

      {/* Admin: User Stats (collapsible) */}
      {isAdmin && userStats.length > 0 && (
        <div className={glassCard}>
          <button
            onClick={() => setShowUserStats(!showUserStats)}
            className="w-full p-4 flex items-center justify-between text-left"
          >
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <HiOutlineUsers className="w-5 h-5 text-purple-500" />
              User Statistics
            </h2>
            <HiOutlineChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${showUserStats ? 'rotate-180' : ''}`} />
          </button>
          {showUserStats && (
            <>
              <div className="overflow-x-auto hidden md:block border-t">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50/50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">User</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">Tasks</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">Completed</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">In Progress</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">Pending</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">High Priority</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">Todos</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">Reminders</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {userStats.map(s => (
                      <tr key={s.user_id} className="hover:bg-gray-50/50">
                        <td className="px-4 py-3 font-medium text-gray-900">{s.username}</td>
                        <td className="px-4 py-3 text-center">{s.total_tasks || 0}</td>
                        <td className="px-4 py-3 text-center"><span className="bg-green-100 text-green-800 text-xs font-medium px-2 py-0.5 rounded">{s.completed || 0}</span></td>
                        <td className="px-4 py-3 text-center"><span className="bg-yellow-100 text-yellow-800 text-xs font-medium px-2 py-0.5 rounded">{s.in_progress || 0}</span></td>
                        <td className="px-4 py-3 text-center"><span className="bg-gray-100 text-gray-800 text-xs font-medium px-2 py-0.5 rounded">{s.pending || 0}</span></td>
                        <td className="px-4 py-3 text-center"><span className="bg-red-100 text-red-800 text-xs font-medium px-2 py-0.5 rounded">{s.high_priority_count || 0}</span></td>
                        <td className="px-4 py-3 text-center">{s.pending_todos || 0}</td>
                        <td className="px-4 py-3 text-center">{s.active_reminders || 0}</td>
                        <td className="px-4 py-3 text-center">{s.total_notes || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="block md:hidden divide-y border-t">
                {userStats.map(s => (
                  <div key={s.user_id} className="p-4 space-y-2">
                    <p className="font-medium text-gray-900">{s.username}</p>
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="bg-gray-50 rounded-lg p-2"><div className="font-bold text-gray-900">{s.total_tasks || 0}</div><div className="text-gray-500">Tasks</div></div>
                      <div className="bg-green-50 rounded-lg p-2"><div className="font-bold text-green-700">{s.completed || 0}</div><div className="text-green-600">Done</div></div>
                      <div className="bg-yellow-50 rounded-lg p-2"><div className="font-bold text-yellow-700">{s.in_progress || 0}</div><div className="text-yellow-600">Progress</div></div>
                      <div className="bg-gray-50 rounded-lg p-2"><div className="font-bold text-gray-700">{s.pending || 0}</div><div className="text-gray-500">Pending</div></div>
                      <div className="bg-red-50 rounded-lg p-2"><div className="font-bold text-red-700">{s.high_priority_count || 0}</div><div className="text-red-600">Priority</div></div>
                      <div className="bg-blue-50 rounded-lg p-2"><div className="font-bold text-blue-700">{s.pending_todos || 0}</div><div className="text-blue-600">Todos</div></div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
cd /var/www/html/agenda_work/frontend && npm run build 2>&1 | tail -5
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Test in browser**

Open the dashboard page. Verify:
- Time-aware greeting shows correctly
- 4 stat cards with trend arrows render
- Today's Focus panel shows overdue/due items
- Heatmap renders in glass card
- Recent Notes show with color accent
- Recent Tasks show with priority and due badges
- Activity feed shows timeline
- Quick add bar visible (desktop) / FAB visible (mobile)
- Admin user stats collapsible accordion works
- Mobile: layout stacks vertically, FAB appears

- [ ] **Step 5: Commit**

```bash
cd /var/www/html/agenda_work/frontend && git add src/pages/Dashboard.jsx
git commit -m "feat(dashboard): rewrite as bento grid orchestrator with glassmorphism"
```

---

### Task 16: Final integration verification

- [ ] **Step 1: Full backend reload**

```bash
pm2 reload pds-backend --update-env
```

- [ ] **Step 2: Verify all endpoints**

```bash
TOKEN=$(curl -s -X POST http://localhost:5000/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"YOUR_PASS"}' | jq -r .token)
echo "=== Stats ===" && curl -s -H "Authorization: Bearer $TOKEN" http://localhost:5000/api/tasks/stats/summary | jq '.data | {total, completion_rate, trends, streak_days}'
echo "=== Focus ===" && curl -s -H "Authorization: Bearer $TOKEN" http://localhost:5000/api/dashboard/today-focus | jq '.data | {due: (.due_today | length), overdue: (.overdue | length), reminders: (.today_reminders | length)}'
echo "=== Notes ===" && curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:5000/api/notes/recent?limit=3" | jq '.data | length'
echo "=== Activity ===" && curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:5000/api/dashboard/activity-feed?limit=5" | jq '.data | length'
```

- [ ] **Step 3: Frontend build check**

```bash
cd /var/www/html/agenda_work/frontend && npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Clean up backups**

```bash
rm -f frontend/src/services/api.js.backup frontend/src/pages/Dashboard.jsx.backup backend/src/routes/task.routes.js.backup backend/src/routes/note.routes.js.backup
```

- [ ] **Step 5: Final commit**

```bash
cd /var/www/html/agenda_work && git add -A
git commit -m "feat(dashboard): complete bento dashboard redesign with glassmorphism UI"
```
