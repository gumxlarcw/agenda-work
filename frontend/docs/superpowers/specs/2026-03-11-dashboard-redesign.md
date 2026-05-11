# Dashboard Bento Redesign — Design Spec

## Goal
Full redesign of Dashboard.jsx from simple stat display to a modern bento-grid dashboard with glassmorphism, real-time focus panel, trend indicators, activity feed, and cross-module quick actions.

## Decisions
- **Scope:** All 7 components (A-G) covering 6 improvement areas
- **Backend:** New endpoints allowed (4 new/extended)
- **Style:** Major redesign — bento grid, glassmorphism, micro-animations
- **Responsive:** Equal priority desktop + mobile
- **Language:** Bilingual — labels English, descriptions/greetings Bahasa Indonesia

## Key Conventions
- Tasks table uses `end_date` (not `due_date`) — backend aliases to `due_date` in API response
- Notes `content` column stores plain text; `content_json` stores TipTap JSON — preview derived via `SUBSTRING(content, 1, 100)`
- Notes folder name: JOIN `note_folders` ON `notes.folder_id = note_folders.id`
- Task completion uses PUT `/api/tasks/:id` (existing `tasksAPI.update`), not PATCH
- CalendarHeatmap: reuse existing component, wrap in glass-card styling
- Stat card #4 intentionally changed from "High Priority" → "Overdue" (more actionable)
- Trends: compare current snapshot totals vs snapshot 7 days ago (e.g., 24 tasks now vs 21 tasks 7 days ago = +3)
- Streak: consecutive calendar days (including weekends) with ≥1 task status changed to 'Completed'. Resets to 0 on a day with no completions.
- Activity feed timestamps: tasks use `updated_at`, notes use `updated_at`, reminders use `reminder_datetime`
- ProgressRing is part of WelcomeBanner component (single component spanning full row, ring positioned right)

---

## Architecture

### Backend — 4 Endpoints

**1. `GET /api/dashboard/today-focus`**
Returns due-today tasks, overdue tasks, and today's reminders.
DB column `end_date` aliased as `due_date` in response.
```json
{
  "due_today": [{ "id", "task", "priority", "status", "due_date", "kegiatan" }],
  "overdue": [{ "id", "task", "priority", "due_date", "days_overdue" }],
  "today_reminders": [{ "id", "title", "reminder_datetime" }]
}
```

**2. `GET /api/tasks/stats` — extend existing**
Add trends (vs 7 days ago), completion_rate, overdue count, streak.
```json
{
  "total": 24, "completed": 18, "in_progress": 4, "overdue": 2,
  "completion_rate": 75,
  "trends": {
    "total_change": 3, "completed_change": 5,
    "in_progress_change": -1, "overdue_change": 0
  },
  "streak_days": 4
}
```

**3. `GET /api/notes/recent?limit=3`**
`plain_text_preview` = `SUBSTRING(notes.content, 1, 100)`. `folder_name` via LEFT JOIN `note_folders` ON `notes.folder_id = note_folders.id`.
```json
[{ "id", "title", "plain_text_preview", "updated_at", "color", "folder_name" }]
```

**4. `GET /api/dashboard/activity-feed?limit=10`**
Union query from tasks + notes + reminders, sorted by timestamp desc.
```json
[{
  "type": "task_completed|note_created|reminder_triggered|task_created",
  "title": "Completed: Laporan Bulanan",
  "timestamp": "2026-03-11T08:30:00",
  "meta": { "task_id": 5 }
}]
```

### Frontend — Component Structure

```
Dashboard.jsx (~80 lines, orchestrator)
├── hooks/useDashboard.js           — fetch all data, per-section loading/error states
├── components/dashboard/
│   ├── BentoGrid.jsx               — responsive CSS grid layout wrapper
│   ├── WelcomeBanner.jsx           — time-aware greeting + progress ring (integrated) + streak
│   ├── StatCard.jsx                — glassmorphism card + trend arrow + count-up
│   ├── TodayFocus.jsx              — due today + overdue + quick checkboxes
│   ├── RecentTasks.jsx             — task list + inline checkbox + due warning
│   ├── RecentNotes.jsx             — note preview cards with color accent
│   ├── ActivityFeed.jsx            — cross-module timeline
│   ├── QuickAddBar.jsx             — quick-create buttons (desktop bar / mobile FAB)
│   └── CalendarHeatmap             — reuse existing, wrapped in glass-card
```

### useDashboard Hook Return Shape
```js
{
  // Data
  stats, todayFocus, recentTasks, recentNotes, activityFeed,
  heatmapData, userStats,
  // Per-section loading
  statsLoading, focusLoading, tasksLoading, notesLoading, activityLoading,
  // Per-section error (null or Error)
  statsError, focusError, tasksError, notesError, activityError,
  // Actions
  completeTask, refetchAll, refetchFocus,
  // Meta
  isAdmin
}
```

---

## Layout

### Desktop (≥1024px) — 12 column bento grid

```
┌─────────── col 1-8 ──────────┬──── col 9-12 ────┐
│  WelcomeBanner                │  ProgressRing     │ row 1
├───── 3col ─┬── 3col ─┬─ 3col─┼───────────────────┤
│ Total ↑3   │ Done ↑5 │InProg │  Today's Focus    │ row 2
├────────────┼─────────┼───────┤  (spans 2 rows)   │
│ Overdue    │         │       │                    │ row 3
├────────────┴─────────┴───────┼───────────────────┤
│  Calendar Heatmap             │  Recent Notes     │ row 4
├───────────────────────────────┼───────────────────┤
│  Recent Tasks                 │  Activity Feed    │ row 5
├───────────────────────────────┴───────────────────┤
│  QuickAddBar                                      │ row 6
└───────────────────────────────────────────────────┘
```

### Tablet (768-1023px) — 8 column
Welcome + ring inline. Stats 2x2. Focus/notes/activity stack in right column.

### Mobile (<768px) — single column
All sections stack vertically. Stats 2x2 grid. QuickAdd becomes FAB bottom-right.

### CSS Grid
```css
.bento { display: grid; gap: 16px; grid-template-columns: repeat(12, 1fr); }
.glass-card {
  background: rgba(255,255,255,0.7);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.3);
  border-radius: 16px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.06);
}
```

---

## Components Detail

### A. WelcomeBanner
- Time-aware: 05-11 Pagi, 11-15 Siang, 15-18 Sore, 18-05 Malam
- Animated gradient background (purple→indigo)
- SVG progress ring: animated 0%→actual on mount
- Streak counter: "🔥 4-day streak!"
- Dynamic nudge: "3 tasks due today" / "All clear! 🎉" / "2 overdue items!"

### B. StatCard
- 4 cards: Total Tasks, Completed, In Progress, Overdue
- Glassmorphism style with colored icon glow
- Trend arrow: ↑green / ↓red / →gray + delta number
- Count-up animation on mount
- Mini progress bar on Total card (completion rate)
- Hover: scale(1.02) + enhanced glow

### C. TodayFocus
- 3 sections: Overdue (red accent), Due Today, Reminders
- Quick checkbox: PUT `/api/tasks/:id` via existing `tasksAPI.update` → optimistic update
- Overdue items: red left border, "3d overdue" badge
- Motivational footer: dynamic based on remaining
- Empty: "All clear for today! 🎉"

### D. RecentTasks
- Inline checkbox to complete
- Due date badge: green (>3d), yellow (1-3d), red (overdue)
- Completed: muted/strikethrough style
- ~~Subtask progress bar~~ (removed — no subtask system exists)
- Max 5 items, "View all →" link

### E. RecentNotes
- Mini cards with note color as left border
- 2-line plain_text preview
- Folder name + relative time
- Max 3 items, "View all →" link

### F. ActivityFeed
- Timeline style: icon + title + relative time
- Icons: ✅ task_completed, ➕ task_created, 📝 note_created, 🔔 reminder_triggered
- Max 10 items
- Relative time via dayjs fromNow

### G. QuickAddBar
- Desktop: sticky bottom row, 3 buttons [+ Task] [+ Note] [+ Reminder]
- Mobile: FAB bottom-right, tap to fan out upward
- Quick modals: minimal form → toast success → refetch

---

## Admin-Only Section
- User Stats table stays, wrapped in collapsible accordion below main grid
- Desktop: full table. Mobile: card layout (existing pattern preserved)

## Error Handling
- Each section independent — one failing API doesn't break others
- Skeleton loading per section (not full-page spinner)
- Retry button on failed sections

## Performance
- Parallel API calls via Promise.allSettled
- useDashboard hook manages all state
- BroadcastChannel cross-tab sync (existing pattern preserved)
- Lazy: QuickAdd modals via conditional rendering (simple, not React.lazy)

## API Service Updates
Add to `frontend/src/services/api.js`:
- `dashboardAPI.getTodayFocus()` → GET `/dashboard/today-focus`
- `dashboardAPI.getActivityFeed(limit)` → GET `/dashboard/activity-feed?limit=N`
- `notesAPI.getRecent(limit)` → GET `/notes/recent?limit=N`
- Extend existing `tasksAPI.getStats()` — response shape changes, no new method needed
