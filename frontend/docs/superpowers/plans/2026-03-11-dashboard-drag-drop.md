# Dashboard Drag & Drop Grid — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add drag-and-drop reordering and resize to the dashboard bento grid using react-grid-layout, with layout auto-saved to the backend API.

**Architecture:** Replace the CSS Grid `BentoGrid.jsx` with `react-grid-layout`'s `<ResponsiveGridLayout>`. A new `useDashboardLayout` hook manages layout state, loads saved layout from backend on mount, and debounce-saves on every change. WelcomeBanner and QuickAddBar stay outside the grid as fixed elements.

**Tech Stack:** react-grid-layout, React 18, Tailwind CSS, Express.js, MySQL

**Spec:** `docs/superpowers/specs/2026-03-11-dashboard-drag-drop-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `frontend/src/hooks/useDashboardLayout.js` | Layout state, load/save API, debounced auto-save |
| Create | `frontend/src/components/dashboard/defaultLayout.js` | Default grid layout constants + widget min/max sizes |
| Modify | `frontend/src/components/dashboard/BentoGrid.jsx` | Replace CSS grid with ResponsiveGridLayout |
| Modify | `frontend/src/pages/Dashboard.jsx` | Integrate layout hook, restructure widget rendering |
| Modify | `frontend/src/services/api.js:231-234` | Add layout GET/PUT methods to dashboardAPI |
| Modify | `frontend/src/index.css` | Add react-grid-layout styles + resize handle styling |
| Modify | `backend/src/routes/dashboard.routes.js` | Add GET/PUT /api/dashboard/layout endpoints |
| Modify | `database/schema.sql:12-25` | Add dashboard_layout column to users table |

---

## Chunk 1: Backend — Layout API + DB Migration

### Task 1: Add dashboard_layout column to users table

**Files:**
- Modify: `database/schema.sql:12-25`

- [ ] **Step 1: Run ALTER TABLE to add column**

```bash
cd /var/www/html/agenda_work
mysql -u root -p agenda_work -e "ALTER TABLE users ADD COLUMN dashboard_layout JSON DEFAULT NULL AFTER must_change_password;"
```

- [ ] **Step 2: Update schema.sql to reflect the new column**

In `database/schema.sql`, add after `must_change_password`:
```sql
dashboard_layout JSON DEFAULT NULL,
```

- [ ] **Step 3: Verify column exists**

```bash
mysql -u root -p agenda_work -e "DESCRIBE users;"
```
Expected: `dashboard_layout` column of type `json` with default `NULL`.

- [ ] **Step 4: Commit**

```bash
git add database/schema.sql
git commit -m "feat(db): add dashboard_layout JSON column to users table"
```

---

### Task 2: Add GET/PUT /api/dashboard/layout endpoints

**Files:**
- Modify: `backend/src/routes/dashboard.routes.js`

- [ ] **Step 1: Backup the file**

```bash
cp backend/src/routes/dashboard.routes.js backend/src/routes/dashboard.routes.js.backup
```

- [ ] **Step 2: Add GET endpoint before `module.exports`**

Add before line 93 (`module.exports = router;`) in `backend/src/routes/dashboard.routes.js`:

```javascript
// GET /api/dashboard/layout — load saved layout
router.get('/layout', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT dashboard_layout FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!rows.length || !rows[0].dashboard_layout) {
      return res.status(404).json({ success: false, message: 'No saved layout' });
    }
    res.json({ success: true, data: rows[0].dashboard_layout });
  } catch (error) {
    console.error('Get layout error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch layout' });
  }
});

// PUT /api/dashboard/layout — save layout
router.put('/layout', verifyToken, async (req, res) => {
  try {
    const { layouts } = req.body;
    if (!layouts || typeof layouts !== 'object') {
      return res.status(400).json({ success: false, message: 'Invalid layout data' });
    }
    // Validate structure: each breakpoint should be an array of max 20 items
    for (const [bp, items] of Object.entries(layouts)) {
      if (!Array.isArray(items) || items.length > 20) {
        return res.status(400).json({ success: false, message: `Invalid layout for breakpoint ${bp}` });
      }
      for (const item of items) {
        if (!item.i || typeof item.x !== 'number' || typeof item.y !== 'number' ||
            typeof item.w !== 'number' || typeof item.h !== 'number' ||
            item.w > 12 || item.h > 6) {
          return res.status(400).json({ success: false, message: 'Invalid layout item' });
        }
      }
    }
    await pool.query(
      'UPDATE users SET dashboard_layout = ? WHERE id = ?',
      [JSON.stringify(layouts), req.user.id]
    );
    res.json({ success: true, message: 'Layout saved' });
  } catch (error) {
    console.error('Save layout error:', error);
    res.status(500).json({ success: false, message: 'Failed to save layout' });
  }
});
```

- [ ] **Step 3: Verify backend compiles**

```bash
cd /var/www/html/agenda_work && pm2 reload agenda-backend --update-env
pm2 logs agenda-backend --lines 5 --nostream
```
Expected: No errors.

- [ ] **Step 4: Quick test endpoints**

```bash
# Test GET (should 404 — no layout saved yet)
curl -s -H "Authorization: Bearer $(cat /tmp/test-token 2>/dev/null || echo TOKEN)" http://localhost:5100/api/dashboard/layout | head -c 200

# Test PUT
curl -s -X PUT -H "Content-Type: application/json" -H "Authorization: Bearer TOKEN" \
  -d '{"layouts":{"lg":[{"i":"stat-0","x":0,"y":0,"w":3,"h":1}]}}' \
  http://localhost:5100/api/dashboard/layout | head -c 200
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/dashboard.routes.js
git commit -m "feat(api): add GET/PUT /dashboard/layout endpoints for drag-drop grid"
```

---

## Chunk 2: Frontend — Install, Default Layout, Hook

### Task 3: Install react-grid-layout

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install the package**

```bash
cd /var/www/html/agenda_work/frontend && npm install react-grid-layout
```

- [ ] **Step 2: Verify installation**

```bash
grep react-grid-layout frontend/package.json
```
Expected: `"react-grid-layout": "^1.x.x"` in dependencies.

- [ ] **Step 3: Commit**

```bash
cd /var/www/html/agenda_work
git add frontend/package.json frontend/package-lock.json
git commit -m "feat(deps): install react-grid-layout for dashboard drag-drop"
```

---

### Task 4: Create default layout constants

**Files:**
- Create: `frontend/src/components/dashboard/defaultLayout.js`

- [ ] **Step 1: Create the file**

```javascript
// Default grid layouts per breakpoint + widget constraints
// Used as fallback when user has no saved layout

export const GRID_COLS = { lg: 12, md: 12, sm: 2, xs: 1 };
export const GRID_BREAKPOINTS = { lg: 1024, md: 768, sm: 640, xs: 0 };
export const GRID_ROW_HEIGHT = 80;
export const GRID_MARGIN = [16, 16];

// Widget size constraints
export const WIDGET_CONSTRAINTS = {
  'stat-0':          { minW: 2, minH: 1, maxW: 6,  maxH: 2 },
  'stat-1':          { minW: 2, minH: 1, maxW: 6,  maxH: 2 },
  'stat-2':          { minW: 2, minH: 1, maxW: 6,  maxH: 2 },
  'stat-3':          { minW: 2, minH: 1, maxW: 6,  maxH: 2 },
  'today-focus':     { minW: 3, minH: 2, maxW: 12, maxH: 4 },
  'calendar-heatmap':{ minW: 4, minH: 2, maxW: 12, maxH: 4 },
  'recent-tasks':    { minW: 4, minH: 1, maxW: 12, maxH: 4 },
  'activity-feed':   { minW: 3, minH: 1, maxW: 12, maxH: 4 },
  'recent-notes':    { minW: 4, minH: 1, maxW: 12, maxH: 3 },
};

// Default layout for lg (12-column desktop)
const lgLayout = [
  { i: 'stat-0',           x: 0,  y: 0, w: 3,  h: 1 },
  { i: 'stat-1',           x: 3,  y: 0, w: 3,  h: 1 },
  { i: 'stat-2',           x: 6,  y: 0, w: 3,  h: 1 },
  { i: 'stat-3',           x: 9,  y: 0, w: 3,  h: 1 },
  { i: 'today-focus',      x: 0,  y: 1, w: 4,  h: 2 },
  { i: 'calendar-heatmap', x: 4,  y: 1, w: 8,  h: 2 },
  { i: 'recent-tasks',     x: 0,  y: 3, w: 8,  h: 2 },
  { i: 'activity-feed',    x: 8,  y: 3, w: 4,  h: 2 },
  { i: 'recent-notes',     x: 0,  y: 5, w: 12, h: 1 },
];

// Default layout for sm (2-column tablet)
const smLayout = [
  { i: 'stat-0',           x: 0, y: 0, w: 1, h: 1 },
  { i: 'stat-1',           x: 1, y: 0, w: 1, h: 1 },
  { i: 'stat-2',           x: 0, y: 1, w: 1, h: 1 },
  { i: 'stat-3',           x: 1, y: 1, w: 1, h: 1 },
  { i: 'today-focus',      x: 0, y: 2, w: 2, h: 2 },
  { i: 'calendar-heatmap', x: 0, y: 4, w: 2, h: 2 },
  { i: 'recent-tasks',     x: 0, y: 6, w: 2, h: 2 },
  { i: 'activity-feed',    x: 0, y: 8, w: 2, h: 2 },
  { i: 'recent-notes',     x: 0, y: 10, w: 2, h: 1 },
];

// Default layout for xs (1-column mobile) — locked, no drag
const xsLayout = [
  { i: 'stat-0',           x: 0, y: 0,  w: 1, h: 1, static: true },
  { i: 'stat-1',           x: 0, y: 1,  w: 1, h: 1, static: true },
  { i: 'stat-2',           x: 0, y: 2,  w: 1, h: 1, static: true },
  { i: 'stat-3',           x: 0, y: 3,  w: 1, h: 1, static: true },
  { i: 'today-focus',      x: 0, y: 4,  w: 1, h: 2, static: true },
  { i: 'calendar-heatmap', x: 0, y: 6,  w: 1, h: 2, static: true },
  { i: 'recent-tasks',     x: 0, y: 8,  w: 1, h: 2, static: true },
  { i: 'activity-feed',    x: 0, y: 10, w: 1, h: 2, static: true },
  { i: 'recent-notes',     x: 0, y: 12, w: 1, h: 1, static: true },
];

export const DEFAULT_LAYOUTS = { lg: lgLayout, sm: smLayout, xs: xsLayout };
```

- [ ] **Step 2: Commit**

```bash
cd /var/www/html/agenda_work
git add frontend/src/components/dashboard/defaultLayout.js
git commit -m "feat(dashboard): add default grid layout constants"
```

---

### Task 5: Add layout API methods to frontend

**Files:**
- Modify: `frontend/src/services/api.js:231-234`

- [ ] **Step 1: Backup**

```bash
cp frontend/src/services/api.js frontend/src/services/api.js.backup
```

- [ ] **Step 2: Add methods to dashboardAPI**

Replace the existing `dashboardAPI` object (lines 231-234) with:

```javascript
// Dashboard API
export const dashboardAPI = {
  getTodayFocus: () => api.get('/dashboard/today-focus'),
  getActivityFeed: (limit = 10) => api.get('/dashboard/activity-feed', { params: { limit } }),
  getLayout: () => api.get('/dashboard/layout'),
  saveLayout: (layouts) => api.put('/dashboard/layout', { layouts }),
};
```

- [ ] **Step 3: Commit**

```bash
cd /var/www/html/agenda_work
git add frontend/src/services/api.js
git commit -m "feat(api): add dashboard layout GET/PUT to frontend API service"
```

---

### Task 6: Create useDashboardLayout hook

**Files:**
- Create: `frontend/src/hooks/useDashboardLayout.js`

- [ ] **Step 1: Create the hook**

```javascript
import { useState, useEffect, useCallback, useRef } from 'react';
import { dashboardAPI } from '../services/api';
import { DEFAULT_LAYOUTS } from '../components/dashboard/defaultLayout';

export default function useDashboardLayout() {
  const [layouts, setLayouts] = useState(DEFAULT_LAYOUTS);
  const [layoutLoading, setLayoutLoading] = useState(true);
  const saveTimerRef = useRef(null);

  // Load saved layout on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await dashboardAPI.getLayout();
        if (!cancelled && res.data?.data) {
          setLayouts(res.data.data);
        }
      } catch {
        // 404 = no saved layout, use defaults — ignore
      } finally {
        if (!cancelled) setLayoutLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Debounced save to backend
  const saveLayout = useCallback((newLayouts) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await dashboardAPI.saveLayout(newLayouts);
      } catch (err) {
        console.error('Failed to save layout:', err);
      }
    }, 1000);
  }, []);

  // Called by react-grid-layout on every drag/resize
  const onLayoutChange = useCallback((_currentLayout, allLayouts) => {
    setLayouts(allLayouts);
    saveLayout(allLayouts);
  }, [saveLayout]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return { layouts, layoutLoading, onLayoutChange };
}
```

- [ ] **Step 2: Commit**

```bash
cd /var/www/html/agenda_work
git add frontend/src/hooks/useDashboardLayout.js
git commit -m "feat(dashboard): add useDashboardLayout hook with debounced auto-save"
```

---

## Chunk 3: Frontend — BentoGrid + Dashboard Integration + Styles

### Task 7: Rewrite BentoGrid to use ResponsiveGridLayout

**Files:**
- Modify: `frontend/src/components/dashboard/BentoGrid.jsx`

- [ ] **Step 1: Backup**

```bash
cp frontend/src/components/dashboard/BentoGrid.jsx frontend/src/components/dashboard/BentoGrid.jsx.backup
```

- [ ] **Step 2: Rewrite BentoGrid.jsx**

Replace the entire file with:

```jsx
import { Responsive, WidthProvider } from 'react-grid-layout';
import {
  GRID_COLS, GRID_BREAKPOINTS, GRID_ROW_HEIGHT, GRID_MARGIN, WIDGET_CONSTRAINTS,
} from './defaultLayout';

const ResponsiveGridLayout = WidthProvider(Responsive);

export default function BentoGrid({ layouts, onLayoutChange, children }) {
  return (
    <ResponsiveGridLayout
      className="dashboard-grid"
      layouts={layouts}
      breakpoints={GRID_BREAKPOINTS}
      cols={GRID_COLS}
      rowHeight={GRID_ROW_HEIGHT}
      margin={GRID_MARGIN}
      onLayoutChange={onLayoutChange}
      draggableCancel=".no-drag"
      resizeHandles={['se']}
      compactType="vertical"
      useCSSTransforms
    >
      {children}
    </ResponsiveGridLayout>
  );
}

// Apply min/max constraints to a grid item's data-grid
export function getGridItemProps(widgetId) {
  return WIDGET_CONSTRAINTS[widgetId] || {};
}

export const glassCard =
  'bg-white/70 backdrop-blur-xl border border-white/30 rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.06)] transition-all duration-300';
```

- [ ] **Step 3: Commit**

```bash
cd /var/www/html/agenda_work
git add frontend/src/components/dashboard/BentoGrid.jsx
git commit -m "feat(dashboard): rewrite BentoGrid with ResponsiveGridLayout"
```

---

### Task 8: Rewrite Dashboard.jsx to use drag-drop grid

**Files:**
- Modify: `frontend/src/pages/Dashboard.jsx`

- [ ] **Step 1: Backup**

```bash
cp frontend/src/pages/Dashboard.jsx frontend/src/pages/Dashboard.jsx.backup
```

- [ ] **Step 2: Rewrite Dashboard.jsx**

Replace the entire file with:

```jsx
import { useState } from 'react';
import {
  HiOutlineClipboardList, HiOutlineCheckCircle,
  HiOutlineClock, HiOutlineExclamation,
  HiOutlineUsers, HiOutlineChevronDown,
} from 'react-icons/hi';
import useDashboard from '../hooks/useDashboard';
import useDashboardLayout from '../hooks/useDashboardLayout';
import CalendarHeatmap from '../components/CalendarHeatmap';
import BentoGrid, { getGridItemProps, glassCard } from '../components/dashboard/BentoGrid';
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

  const { layouts, layoutLoading, onLayoutChange } = useDashboardLayout();
  const [showUserStats, setShowUserStats] = useState(false);

  if (layoutLoading) {
    return (
      <div className="space-y-4 animate-fadeIn pb-20 sm:pb-4">
        <SkeletonCard lines={2} height={120} />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <SkeletonCard key={i} lines={1} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fadeIn pb-20 sm:pb-4">
      {/* Fixed: Welcome Banner (always top) */}
      {statsLoading ? (
        <SkeletonCard lines={2} height={120} />
      ) : (
        <WelcomeBanner user={user} stats={stats} todayFocus={todayFocus} />
      )}

      {/* Draggable Grid */}
      <BentoGrid layouts={layouts} onLayoutChange={onLayoutChange}>
        <div key="stat-0" {...getGridItemProps('stat-0')}>
          {statsLoading ? <SkeletonCard lines={1} className="h-full" /> : (
            <StatCard title="Total Tasks" value={stats?.total} icon={HiOutlineClipboardList}
              color="bg-blue-500" link="/tasks" trend={stats?.trends?.total_change}
              progressPercent={stats?.completion_rate} />
          )}
        </div>
        <div key="stat-1" {...getGridItemProps('stat-1')}>
          {statsLoading ? <SkeletonCard lines={1} className="h-full" /> : (
            <StatCard title="Completed" value={stats?.completed} icon={HiOutlineCheckCircle}
              color="bg-green-500" link="/tasks" trend={stats?.trends?.completed_change} />
          )}
        </div>
        <div key="stat-2" {...getGridItemProps('stat-2')}>
          {statsLoading ? <SkeletonCard lines={1} className="h-full" /> : (
            <StatCard title="In Progress" value={stats?.in_progress} icon={HiOutlineClock}
              color="bg-amber-500" link="/tasks" trend={stats?.trends?.in_progress_change} />
          )}
        </div>
        <div key="stat-3" {...getGridItemProps('stat-3')}>
          {statsLoading ? <SkeletonCard lines={1} className="h-full" /> : (
            <StatCard title="Overdue" value={stats?.overdue} icon={HiOutlineExclamation}
              color="bg-red-500" link="/tasks" />
          )}
        </div>
        <div key="today-focus" {...getGridItemProps('today-focus')}>
          <TodayFocus data={todayFocus} onComplete={completeTask}
            loading={focusLoading} error={focusError} onRetry={refetchFocus} />
        </div>
        <div key="calendar-heatmap" {...getGridItemProps('calendar-heatmap')}>
          <div className={glassCard + ' p-4 h-full'}>
            <CalendarHeatmap data={heatmapData} />
          </div>
        </div>
        <div key="recent-tasks" {...getGridItemProps('recent-tasks')}>
          <RecentTasks tasks={recentTasks} onComplete={completeTask}
            loading={tasksLoading} error={tasksError} />
        </div>
        <div key="activity-feed" {...getGridItemProps('activity-feed')}>
          <ActivityFeed items={activityFeed} loading={activityLoading} error={activityError} />
        </div>
        <div key="recent-notes" {...getGridItemProps('recent-notes')}>
          <RecentNotes notes={recentNotes} loading={notesLoading} error={notesError} />
        </div>
      </BentoGrid>

      {/* Fixed: Quick Add Bar (always bottom) */}
      <QuickAddBar onCreated={refetchAll} />

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

- [ ] **Step 3: Verify diff**

```bash
diff frontend/src/pages/Dashboard.jsx.backup frontend/src/pages/Dashboard.jsx
```

- [ ] **Step 4: Commit**

```bash
cd /var/www/html/agenda_work
git add frontend/src/pages/Dashboard.jsx
git commit -m "feat(dashboard): integrate drag-drop grid with layout persistence"
```

---

### Task 9: Add react-grid-layout CSS + resize handle styles

**Files:**
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Backup**

```bash
cp frontend/src/index.css frontend/src/index.css.backup
```

- [ ] **Step 2: Add RGL styles after the Tailwind directives (after line 3)**

Add after `@tailwind utilities;` in `frontend/src/index.css`:

```css
/* react-grid-layout core styles */
.react-grid-layout {
  position: relative;
  transition: height 200ms ease;
}
.react-grid-item {
  transition: all 200ms ease;
  transition-property: left, top, width, height;
}
.react-grid-item.cssTransforms {
  transition-property: transform, width, height;
}
.react-grid-item.resizing {
  z-index: 1;
  will-change: width, height;
  opacity: 0.9;
}
.react-grid-item.react-draggable-dragging {
  transition: none;
  z-index: 3;
  will-change: transform;
  opacity: 0.85;
  box-shadow: 0 12px 40px rgba(0,0,0,0.15);
}
.react-grid-placeholder {
  background: rgba(99, 102, 241, 0.15);
  border: 2px dashed rgba(99, 102, 241, 0.4);
  border-radius: 1rem;
  transition: all 200ms ease;
}

/* Resize handle — bottom-right corner dot */
.react-resizable-handle {
  position: absolute;
  width: 20px;
  height: 20px;
  bottom: 4px;
  right: 4px;
  cursor: se-resize;
  z-index: 2;
}
.react-resizable-handle::after {
  content: '';
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 8px;
  height: 8px;
  border-right: 2px solid rgba(0,0,0,0.2);
  border-bottom: 2px solid rgba(0,0,0,0.2);
  border-radius: 0 0 2px 0;
  transition: border-color 200ms;
}
.react-resizable-handle:hover::after {
  border-color: rgba(99, 102, 241, 0.6);
}

/* Make grid items fill height */
.dashboard-grid .react-grid-item > div {
  height: 100%;
}
```

- [ ] **Step 3: Verify diff**

```bash
diff frontend/src/index.css.backup frontend/src/index.css
```

- [ ] **Step 4: Commit**

```bash
cd /var/www/html/agenda_work
git add frontend/src/index.css
git commit -m "feat(dashboard): add react-grid-layout CSS styles and resize handle"
```

---

## Chunk 4: Build & Verify

### Task 10: Build frontend and verify

- [ ] **Step 1: Build**

```bash
cd /var/www/html/agenda_work/frontend && npm run build
```
Expected: Build succeeds with no errors.

- [ ] **Step 2: Restart services**

```bash
pm2 reload agenda-backend --update-env
```

- [ ] **Step 3: Manual smoke test**

Open the dashboard in browser. Verify:
1. Widgets render in the default bento layout
2. Drag a StatCard — other widgets push down
3. Resize a widget from bottom-right corner
4. Refresh the page — layout persists
5. Mobile view — widgets are stacked, not draggable

- [ ] **Step 4: Final commit**

```bash
cd /var/www/html/agenda_work
git add -A
git commit -m "feat(dashboard): drag-and-drop grid with resize and auto-save layout"
```
