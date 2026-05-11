# Dashboard Drag & Drop Grid — Design Spec

**Date:** 2026-03-11
**Status:** Approved

## Overview

Add drag-and-drop reordering and resize capability to the dashboard bento grid using `react-grid-layout`. Users can freely arrange and resize dashboard widgets. Layout is auto-saved to the backend.

## Decisions

| Decision | Choice |
|---|---|
| Library | `react-grid-layout` (new dependency) |
| Drag behavior | Drag from anywhere on widget |
| Resize | Corner handle bottom-right (`se`) only |
| Persist | Backend API (`GET/PUT /api/dashboard/layout`) |
| Save trigger | Auto-save, debounced 1 second |
| Reset button | No |
| Fixed widgets | WelcomeBanner (top), QuickAddBar (bottom) |

## Architecture

### Fixed Widgets (outside grid)
- `WelcomeBanner` — always rendered above the grid
- `QuickAddBar` — always rendered below the grid

### Draggable + Resizable Widgets (inside grid)
| Widget ID | Default Position (x,y,w,h) | Min Size |
|---|---|---|
| `stat-0` | 0,0,3,1 | 2x1 |
| `stat-1` | 3,0,3,1 | 2x1 |
| `stat-2` | 6,0,3,1 | 2x1 |
| `stat-3` | 9,0,3,1 | 2x1 |
| `today-focus` | 0,1,4,2 | 3x2 |
| `calendar-heatmap` | 4,1,8,2 | 4x2 |
| `recent-tasks` | 0,3,8,2 | 4x1 |
| `activity-feed` | 8,3,4,2 | 3x1 |
| `recent-notes` | 0,5,12,1 | 4x1 |

### Grid Configuration
- **Columns:** 12 (lg), 2 (sm), 1 (xs)
- **Row height:** ~80px (auto-calculated)
- **Compaction:** vertical
- **Collision:** push down
- **Margin:** [16, 16]

### Responsive Behavior
| Breakpoint | Columns | Drag | Resize |
|---|---|---|---|
| lg (>=1024px) | 12 | Yes | Yes |
| sm (640-1023px) | 2 | Yes | No |
| xs (<640px) | 1 | No | No |

## Data Flow

```
Page Load:
  GET /api/dashboard/layout
    → 200 + saved layout JSON → apply to grid
    → 404 (no saved layout) → use DEFAULT_LAYOUT

User Interaction:
  drag/resize → onLayoutChange(newLayout)
    → setState(newLayout)
    → debounce 1s → PUT /api/dashboard/layout { layouts }
    → toast on error only (silent success)
```

## Backend

### Endpoint: Dashboard Layout
- `GET /api/dashboard/layout` — returns saved layout or 404
- `PUT /api/dashboard/layout` — saves layout JSON

### Storage
New field `dashboard_layout` (JSON/TEXT) on the `users` table, or a new `user_preferences` table if preferred. Contains:

```json
{
  "lg": [
    { "i": "stat-0", "x": 0, "y": 0, "w": 3, "h": 1 },
    { "i": "stat-1", "x": 3, "y": 0, "w": 3, "h": 1 },
    ...
  ],
  "sm": [...],
  "xs": [...]
}
```

### Validation
- Max 20 items in layout array
- Each item must have: `i` (string), `x`, `y`, `w`, `h` (integers >= 0)
- `w` max 12, `h` max 6

## Frontend Changes

### New Files
- `src/hooks/useDashboardLayout.js` — layout state, load/save API, debounce
- CSS imports for react-grid-layout styles

### Modified Files
- `BentoGrid.jsx` — replace CSS grid with `<ResponsiveGridLayout>`
- `Dashboard.jsx` — integrate layout hook, wrap widgets in grid items
- `src/services/api.js` — add layout API methods
- `index.css` — custom resize handle styling (bottom-right corner dot/icon)

### Conflict Handling
react-grid-layout distinguishes click vs drag via movement threshold (~3px). Interactive elements (checkboxes, links) continue to work normally. No drag handle needed.

## Widget Constraints

Each widget defines `minW`, `minH` to prevent unusable sizes:
- StatCards: min 2x1
- TodayFocus: min 3x2
- CalendarHeatmap: min 4x2
- RecentTasks: min 4x1
- ActivityFeed: min 3x1
- RecentNotes: min 4x1

All widgets max width: 12 cols, max height: 6 rows.
