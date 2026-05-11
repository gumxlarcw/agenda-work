# Settings Page Redesign

## Goal
Redesign the Settings page to be consistent with other redesigned pages (Tasks, Notes, Reminders, Timeline, Automation). Integrate password change into Settings. Add theme toggle and dashboard widget visibility preferences.

## Architecture
Two-column layout on desktop (lg:grid-cols-2), single column on mobile. Left column: Profile, Security, Appearance. Right column: WhatsApp Digest. Consistent design patterns: gradient header icon, rounded-xl cards, shadow-sm, animate-fadeIn, pb-20 mobile.

## Sections

### 1. Header
- Gradient icon box (slate `HiOutlineCog`)
- Title: "Pengaturan"
- Subtitle: "Kelola profil, keamanan, dan preferensi"

### 2. Profil Card (left)
- Large avatar initial + name + role badge + tim badge
- Editable: Name (text + save button), Phone (text + save button)
- Read-only: Email (grayed, disabled)
- Uses `authAPI.updateProfile()`

### 3. Keamanan Card (left)
- Collapsible via chevron toggle (default closed, auto-open if `must_change_password`)
- Fields: currentPassword, newPassword, confirmPassword
- Validation: min 6 chars, passwords match
- Uses `authAPI.changePassword()`
- On `must_change_password`: auto-open, cannot collapse, show warning banner

### 4. Tampilan Card (left)
- **Theme**: Light/Dark pill switch
  - Saves to `localStorage('theme')` + `dashboard_layout.theme` in DB
  - Actual dark mode CSS deferred to later phase
- **Dashboard Widget Visibility**: 10 toggle switches
  - Stats: Total Tasks, Selesai, Progress, Overdue
  - Widgets: Fokus Hari Ini, Calendar Heatmap, Kalender Event, Task Terbaru, Activity Feed, Catatan Terbaru
  - Saves to `dashboard_layout.hiddenWidgets` array in DB
  - Uses existing `useDashboardLayout` hook or `authAPI.updateProfile()`

### 5. WhatsApp Digest Card (right, full height)
- Enable toggle + time picker + day chips + reminder levels (single/range groups) + scope grid + lookahead toggle
- Test Digest button at bottom
- Auto-save with debounce (existing behavior preserved)

## Other Changes

### Sidebar (Layout.jsx)
- Remove "Password" NavLink from user section
- Keep: Settings + Logout only

### App.jsx
- Keep `/change-password` route but render `<Navigate to="/settings" replace />`
- Remove ChangePassword lazy import

### Backend
- Add `dashboard_layout` update to `PUT /api/auth/update-profile`
  - Accept optional `dashboard_layout` JSON field
  - Merge with existing JSON (don't overwrite entire object)

### Dashboard Integration
- `useDashboardLayout` hook reads `hiddenWidgets` from `dashboard_layout`
- Hidden widgets are not rendered (not just invisible)

## Files to Modify
- `frontend/src/pages/Settings.jsx` — full rewrite
- `frontend/src/components/Layout.jsx` — remove Password nav link
- `frontend/src/App.jsx` — redirect /change-password to /settings
- `backend/src/routes/auth.routes.js` — add dashboard_layout to update-profile
- `frontend/src/pages/Dashboard.jsx` — read hiddenWidgets, filter widgets
- `frontend/src/hooks/useDashboardLayout.js` (or equivalent) — add hiddenWidgets support
