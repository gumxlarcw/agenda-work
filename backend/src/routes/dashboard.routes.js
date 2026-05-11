const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { verifyToken, addUserFilter } = require('../middleware/auth.middleware');

// Widget IDs and breakpoint keys known by the frontend. The PUT /layout
// endpoint rejects anything outside these allowlists so garbage can't be
// stored in users.dashboard_layout.
const KNOWN_WIDGET_IDS = new Set([
  'stat-0', 'stat-1', 'stat-2', 'stat-3',
  'today-focus', 'calendar-heatmap', 'event-calendar',
  'recent-tasks', 'activity-feed', 'recent-notes',
]);
const KNOWN_BREAKPOINTS = new Set(['lg', 'md', 'sm', 'xs', 'xxs']);

// Parse an ISO date string (YYYY-MM-DD) — returns null on anything else.
// Used by /today-focus so the client can send the user's local-timezone
// "today" instead of relying on MySQL's CURDATE() (server tz).
const parseISODate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
};

// GET /api/dashboard/today-focus?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/today-focus', verifyToken, addUserFilter, async (req, res) => {
  try {
    const userFilter = req.userFilter;
    const userClause = userFilter ? 'AND user_id = ?' : '';
    const userParam = userFilter ? [userFilter.user_id] : [];

    // Prefer client-supplied date range so the "today" boundary matches the
    // user's timezone (the server runs UTC but users are in WIT). Fall back
    // to server's CURDATE() if no valid params are sent.
    const start = parseISODate(req.query.start);
    const end = parseISODate(req.query.end);
    const todayExpr = start && end ? '?' : 'CURDATE()';
    const dayParams = start && end ? [start] : [];
    const endParams = start && end ? [end] : [];

    const [dueToday, overdue, todayReminders] = await Promise.all([
      pool.query(
        `SELECT id, task, priority, status, end_date as due_date, kegiatan
         FROM tasks
         WHERE DATE(end_date) = ${todayExpr}
         AND status NOT IN ('Completed', 'Cancelled')
         ${userClause}
         ORDER BY FIELD(priority, 'P0', 'P1', 'P2', 'P3')`,
        [...dayParams, ...userParam]
      ),
      pool.query(
        `SELECT id, task, priority, end_date as due_date,
         DATEDIFF(${todayExpr}, end_date) as days_overdue
         FROM tasks
         WHERE end_date < ${todayExpr}
         AND status NOT IN ('Completed', 'Cancelled')
         ${userClause}
         ORDER BY end_date ASC`,
        [...dayParams, ...dayParams, ...userParam]
      ),
      pool.query(
        `SELECT id, title, reminder_datetime
         FROM reminders
         WHERE DATE(reminder_datetime) = ${todayExpr}
         AND is_active = TRUE AND is_completed = FALSE
         ${userClause}
         ORDER BY reminder_datetime ASC`,
        [...endParams, ...userParam]
      ),
    ]);

    res.json({
      success: true,
      data: {
        due_today: dueToday[0],
        overdue: overdue[0],
        today_reminders: todayReminders[0],
      }
    });
  } catch (error) {
    console.error('Today focus error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch today focus' });
  }
});

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
        FROM reminders
        WHERE is_active = TRUE AND reminder_datetime <= NOW() ${userClause}
        ORDER BY reminder_datetime DESC LIMIT ?)
       UNION ALL
       (SELECT 'event_created' as type, title, created_at as timestamp,
        id as ref_id, 'event' as ref_type
        FROM events WHERE 1=1 ${userClause}
        ORDER BY created_at DESC LIMIT ?)
       ORDER BY timestamp DESC LIMIT ?`,
      [
        ...userParam, limit,
        ...userParam, limit,
        ...userParam, limit,
        ...userParam, limit,
        ...userParam, limit,
        limit,
      ]
    );

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Activity feed error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch activity feed' });
  }
});

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

    // mysql2 returns JSON columns as a string under text-protocol queries, so
    // parse defensively. Also strip widget IDs and breakpoints that the
    // current frontend doesn't know about, otherwise stale entries from a
    // previous version of the dashboard pollute react-grid-layout's state.
    const raw = rows[0].dashboard_layout;
    let layout;
    try {
      layout = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (err) {
      console.error('Malformed dashboard_layout in DB for user', req.user.id, err);
      return res.status(404).json({ success: false, message: 'No saved layout' });
    }

    const cleaned = {};
    let totalItems = 0;
    for (const [bp, items] of Object.entries(layout || {})) {
      if (!KNOWN_BREAKPOINTS.has(bp) || !Array.isArray(items)) continue;
      const kept = items.filter(item => item && typeof item.i === 'string' && KNOWN_WIDGET_IDS.has(item.i));
      if (kept.length > 0) {
        cleaned[bp] = kept;
        totalItems += kept.length;
      }
    }

    // If nothing usable survived cleanup, fall through to 404 so the
    // frontend applies DEFAULT_LAYOUTS instead of a skeleton layout.
    if (totalItems === 0) {
      return res.status(404).json({ success: false, message: 'No saved layout' });
    }

    res.json({ success: true, data: cleaned });
  } catch (error) {
    console.error('Get layout error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch layout' });
  }
});

// PUT /api/dashboard/layout — save layout
router.put('/layout', verifyToken, async (req, res) => {
  try {
    let layouts = req.body.layouts || req.body;
    if (!layouts || typeof layouts !== 'object' || Array.isArray(layouts)) {
      return res.status(400).json({ success: false, message: 'Invalid layout data' });
    }

    // Only keep known breakpoints with array values.
    const validEntries = Object.entries(layouts).filter(
      ([k, v]) => KNOWN_BREAKPOINTS.has(k) && Array.isArray(v)
    );
    if (validEntries.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid layout data' });
    }

    const sanitized = {};
    for (const [bp, items] of validEntries) {
      if (items.length > KNOWN_WIDGET_IDS.size) {
        return res.status(400).json({ success: false, message: `Too many items for breakpoint ${bp}` });
      }
      const cleaned = [];
      for (const item of items) {
        if (!item || typeof item.i !== 'string' || !KNOWN_WIDGET_IDS.has(item.i)) continue;
        cleaned.push({
          i: item.i,
          x: Number.isFinite(+item.x) ? +item.x : 0,
          y: Number.isFinite(+item.y) ? +item.y : 0,
          w: Math.min(Math.max(Number.isFinite(+item.w) ? +item.w : 1, 1), 12),
          h: Math.min(Math.max(Number.isFinite(+item.h) ? +item.h : 1, 1), 20),
          ...(item.static ? { static: true } : {}),
        });
      }
      sanitized[bp] = cleaned;
    }

    await pool.query(
      'UPDATE users SET dashboard_layout = ? WHERE id = ?',
      [JSON.stringify(sanitized), req.user.id]
    );
    res.json({ success: true, message: 'Layout saved' });
  } catch (error) {
    console.error('Save layout error:', error);
    res.status(500).json({ success: false, message: 'Failed to save layout' });
  }
});

module.exports = router;
