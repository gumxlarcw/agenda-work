# Notes Module — Restoration & Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore 8 missing backend endpoints (sharing, public-share, lock, counts, bulk positions) and instrument 14 activity-log trigger points so the frontend's existing UI works end-to-end against the production schema that already holds 88 activity rows, 3 public-share rows, and 12 per-user layout rows.

**Architecture:** Selective restore from `note.routes.js.backup` (Apr 1 fat version) into the current `note.routes.js`, preserving post-Apr-1 hardening. New thin services (`activityLog.service.js`, `statusDiff.service.js`) keep instrumentation DRY. Database migration is additive and idempotent.

**Tech Stack:** Node 20 / Express / mysql2 / express-validator (backend); React 18 / TipTap / @dnd-kit / axios (frontend). MySQL 10.x (MariaDB).

**Spec:** `docs/superpowers/specs/2026-04-27-notes-restoration-and-hardening-design.md`

**Working dir:** `/var/www/html/agenda_work` (current branch: `feat/chat-proxy-routing` — implementation should branch off as `feat/notes-restoration`)

---

## Pre-flight

- [ ] **Step 1: Confirm dev server is reachable**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5000/api/health 2>&1 || echo "backend not running"`
Expected: `200` (or start it with `cd backend && npm run dev` in a separate terminal first)

- [ ] **Step 2: Confirm DB credentials and connectivity**

Run: `cd backend && DB_PW=$(grep '^DB_PASSWORD=' .env | cut -d= -f2-) && mysql -uroot -p"$DB_PW" agenda_work_db -e "SELECT COUNT(*) FROM notes;"`
Expected: numeric count, no auth error

- [ ] **Step 3: Create implementation branch**

```bash
cd /var/www/html/agenda_work
git checkout -b feat/notes-restoration
git status
```

Expected: on `feat/notes-restoration`, working tree shows the existing modified files from current state (these are unrelated to this work — leave them alone).

---

### Task 0: Archive legacy backup files

**Why:** `backend/src/routes/note.routes.js.backup` (81 KB, dated 2026-04-01) holds the source-of-truth code we'll port from. CLAUDE.md mandates `cp file file.backup` before edits, which would overwrite this file. Move legacy backups out of `routes/` so the `.backup` slot is free for normal workflow.

**Files:**
- Move: `backend/src/routes/note.routes.js.backup` → `docs/legacy-routes/note.routes.js.2026-04-01-fat.legacy`
- Move: `backend/src/routes/note.routes.js.backup_preconn` → `docs/legacy-routes/note.routes.js.2026-04-20-preconn.legacy`
- Move: `backend/src/routes/note.routes.js.broken` → `docs/legacy-routes/note.routes.js.2026-04-01-broken.legacy`
- Move: `backend/src/routes/note-folder.routes.js.backup` → `docs/legacy-routes/note-folder.routes.js.2026-03-31.legacy`
- Move: `backend/src/routes/note.routes.js.backup2` → `docs/legacy-routes/note.routes.js.backup2.legacy` (if exists)

- [ ] **Step 1: Create archive directory**

```bash
mkdir -p docs/legacy-routes
```

- [ ] **Step 2: Move legacy files**

```bash
cd backend/src/routes
git mv note.routes.js.backup           ../../../docs/legacy-routes/note.routes.js.2026-04-01-fat.legacy
git mv note.routes.js.backup_preconn   ../../../docs/legacy-routes/note.routes.js.2026-04-20-preconn.legacy
git mv note.routes.js.broken           ../../../docs/legacy-routes/note.routes.js.2026-04-01-broken.legacy
git mv note-folder.routes.js.backup    ../../../docs/legacy-routes/note-folder.routes.js.2026-03-31.legacy
[ -f note.routes.js.backup2 ] && git mv note.routes.js.backup2 ../../../docs/legacy-routes/note.routes.js.backup2.legacy
cd ../../..
```

(`git mv` because they were `??` in `git status` initially but may have been added; if `git mv` errors with "did not match any file", use plain `mv` then `git add`.)

- [ ] **Step 3: Verify**

```bash
ls docs/legacy-routes/
ls backend/src/routes/note*.js* | grep -v "\.legacy$"
```

Expected:
- `docs/legacy-routes/` contains the moved files
- `backend/src/routes/` contains only the live files (no `.backup`, `.broken`, `.backup_preconn`)

- [ ] **Step 4: Commit**

```bash
git add docs/legacy-routes/ backend/src/routes/
git commit -m "chore: archive legacy note route backups to docs/legacy-routes

Frees up the .backup slot per CLAUDE.md convention. The 2026-04-01-fat
file is the source for restoring missing endpoints in subsequent commits."
```

---

### Task 1: Database migration

**Files:**
- Create: `backend/scripts/migrations/2026-04-27-notes-restoration.sql`
- Create: `backend/scripts/migrations/2026-04-27-notes-restoration.down.sql`

- [ ] **Step 1: Create migrations dir**

```bash
mkdir -p backend/scripts/migrations
```

- [ ] **Step 2: Write up migration**

Create `backend/scripts/migrations/2026-04-27-notes-restoration.sql`:

```sql
-- 2026-04-27 — Notes module restoration
-- Additive, idempotent. See docs/superpowers/specs/2026-04-27-notes-restoration-and-hardening-design.md

-- 1. Expand note_activity_log.action enum from 7 to 18 values.
ALTER TABLE note_activity_log
  MODIFY action ENUM(
    'created','edited','title_edited','content_edited',
    'folder_moved','tag_changed','color_changed',
    'pinned','unpinned','archived','unarchived',
    'shared','share_revoked',
    'public_link_created','public_link_revoked',
    'status_changed','connection_added','connection_removed'
  ) NOT NULL;

-- 2. Add expires_at to public shares (NULL = never expires).
ALTER TABLE note_public_shares
  ADD COLUMN expires_at TIMESTAMP NULL DEFAULT NULL AFTER is_active;

-- 3. Performance indexes (MySQL 8 / MariaDB 10.5+ supports IF NOT EXISTS on ADD INDEX).
ALTER TABLE note_activity_log
  ADD INDEX IF NOT EXISTS idx_activity_note_time (note_id, created_at DESC);

ALTER TABLE note_public_shares
  ADD INDEX IF NOT EXISTS idx_public_share_token_active (share_token, is_active);
```

- [ ] **Step 3: Write down migration**

Create `backend/scripts/migrations/2026-04-27-notes-restoration.down.sql`:

```sql
-- Rollback for 2026-04-27-notes-restoration.sql
-- WARNING: coerces any new enum values to 'edited' before shrinking.

UPDATE note_activity_log
  SET action = 'edited'
  WHERE action NOT IN ('created','edited','shared','archived','unarchived','pinned','unpinned');

ALTER TABLE note_activity_log
  MODIFY action ENUM('created','edited','shared','archived','unarchived','pinned','unpinned') NOT NULL;

ALTER TABLE note_public_shares
  DROP COLUMN expires_at;

ALTER TABLE note_activity_log     DROP INDEX idx_activity_note_time;
ALTER TABLE note_public_shares    DROP INDEX idx_public_share_token_active;
```

- [ ] **Step 4: Apply migration to dev DB**

```bash
cd /var/www/html/agenda_work/backend
DB_PW=$(grep '^DB_PASSWORD=' .env | cut -d= -f2-)
mysql -uroot -p"$DB_PW" agenda_work_db < scripts/migrations/2026-04-27-notes-restoration.sql
```

Expected: no errors. (If `IF NOT EXISTS` fails on older MariaDB, drop the clause and let the duplicate-index error fall through; or guard with information_schema lookup.)

- [ ] **Step 5: Verify migration**

```bash
mysql -uroot -p"$DB_PW" agenda_work_db -e "
  SHOW COLUMNS FROM note_activity_log LIKE 'action';
  SHOW COLUMNS FROM note_public_shares LIKE 'expires_at';
  SHOW INDEX FROM note_activity_log WHERE Key_name='idx_activity_note_time';
"
```

Expected:
- `action` enum lists all 18 values
- `expires_at` column exists, type `timestamp`, nullable
- Index `idx_activity_note_time` exists

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/migrations/
git commit -m "feat(db): notes restoration migration — expand activity enum + public-share expires_at"
```

---

### Task 2: Activity log helper service

**Files:**
- Create: `backend/src/services/notes/activityLog.service.js`

- [ ] **Step 1: Create services subdir**

```bash
mkdir -p backend/src/services/notes
```

- [ ] **Step 2: Write helper**

Create `backend/src/services/notes/activityLog.service.js`:

```js
const pool = require('../../config/database');

/**
 * Insert an activity-log row. Failures are logged but never thrown — instrumentation
 * must never break a user's actual write.
 *
 * @param {number} noteId
 * @param {number} userId
 * @param {string} action  - one of the enum values in note_activity_log.action
 * @param {object|null} details - optional structured payload (will be JSON-stringified)
 */
async function logNoteActivity(noteId, userId, action, details = null) {
  const detailsJson = details === null || details === undefined ? null : JSON.stringify(details);
  try {
    await pool.query(
      'INSERT INTO note_activity_log (note_id, user_id, action, details) VALUES (?, ?, ?, ?)',
      [noteId, userId, action, detailsJson]
    );
  } catch (err) {
    console.error('logNoteActivity failed:', { noteId, userId, action, message: err.message });
  }
}

/**
 * Fetch the last N activity entries for a note, joined with user names.
 */
async function getRecentActivity(noteId, limit = 20) {
  const [rows] = await pool.query(
    `SELECT nal.id, nal.action, nal.details, nal.created_at,
            COALESCE(u.name, u.username) AS user_name, nal.user_id
     FROM note_activity_log nal
     JOIN users u ON nal.user_id = u.id
     WHERE nal.note_id = ?
     ORDER BY nal.created_at DESC
     LIMIT ?`,
    [noteId, limit]
  );
  return rows;
}

module.exports = { logNoteActivity, getRecentActivity };
```

- [ ] **Step 3: Smoke test the helper**

```bash
cd backend
node -e "
const { logNoteActivity, getRecentActivity } = require('./src/services/notes/activityLog.service');
(async () => {
  const noteId = 1;  // pick any existing note id; adjust if needed
  const userId = 1;
  await logNoteActivity(noteId, userId, 'edited', { test: true });
  const rows = await getRecentActivity(noteId, 5);
  console.log('latest 5:', rows);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
"
```

Expected: prints array of rows including the just-inserted `edited` row with `details: '{"test":true}'`.

- [ ] **Step 4: Clean up the smoke-test row**

```bash
mysql -uroot -p"$DB_PW" agenda_work_db -e "
  DELETE FROM note_activity_log WHERE JSON_EXTRACT(details, '\$.test') = true;
"
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/notes/activityLog.service.js
git commit -m "feat(notes): add activity log helper service"
```

---

### Task 3: StatusCell diff helper service

**Files:**
- Create: `backend/src/services/notes/statusDiff.service.js`

- [ ] **Step 1: Write helper**

Create `backend/src/services/notes/statusDiff.service.js`:

```js
/**
 * Walk a ProseMirror JSON tree and collect every statusCell node, keyed by its
 * coordinates within the document (table_index/row_index/col_index). Returns
 * a Map<key, { status, label }>.
 */
function indexStatusCells(json) {
  const map = new Map();
  if (!json) return map;

  let tableIdx = -1;
  const walk = (node, path = []) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'table') tableIdx++;
    if (node.type === 'tableRow' || node.type === 'tableHeader' || node.type === 'tableCell') {
      // pass through; rows/cells track their own positions via parent walk
    }
    if (node.type === 'statusCell') {
      const key = `${tableIdx}:${path.join('-')}`;
      const status = node.attrs?.status ?? 'empty';
      const label = node.attrs?.label || extractFirstText(node) || `Cell ${path.join('-')}`;
      map.set(key, { status, label });
    }
    if (node.content && Array.isArray(node.content)) {
      node.content.forEach((child, idx) => walk(child, [...path, idx]));
    }
  };
  walk(json);
  return map;
}

function extractFirstText(node) {
  if (!node) return '';
  if (typeof node.text === 'string') return node.text;
  if (Array.isArray(node.content)) {
    for (const c of node.content) {
      const t = extractFirstText(c);
      if (t) return t;
    }
  }
  return '';
}

/**
 * Diff two ProseMirror JSON trees. Returns an array of changed statusCell entries.
 * Only emits cells whose status changed (additions and deletions are also captured).
 *
 * Example return: [{ cell_label: 'Q1', from: 'progress', to: 'complete' }]
 */
function diffStatusCells(oldJson, newJson) {
  const oldMap = indexStatusCells(oldJson);
  const newMap = indexStatusCells(newJson);
  const changes = [];
  for (const [key, newVal] of newMap) {
    const oldVal = oldMap.get(key);
    if (!oldVal) {
      if (newVal.status && newVal.status !== 'empty') {
        changes.push({ cell_label: newVal.label, from: null, to: newVal.status });
      }
    } else if (oldVal.status !== newVal.status) {
      changes.push({ cell_label: newVal.label, from: oldVal.status, to: newVal.status });
    }
  }
  for (const [key, oldVal] of oldMap) {
    if (!newMap.has(key) && oldVal.status && oldVal.status !== 'empty') {
      changes.push({ cell_label: oldVal.label, from: oldVal.status, to: null });
    }
  }
  return changes;
}

module.exports = { diffStatusCells, indexStatusCells };
```

- [ ] **Step 2: Smoke test**

```bash
cd backend
node -e "
const { diffStatusCells } = require('./src/services/notes/statusDiff.service');
const old = { type: 'doc', content: [{ type: 'table', content: [
  { type: 'tableRow', content: [{ type: 'statusCell', attrs: { status: 'progress', label: 'Q1' } }] }
]}]};
const cur = { type: 'doc', content: [{ type: 'table', content: [
  { type: 'tableRow', content: [{ type: 'statusCell', attrs: { status: 'complete', label: 'Q1' } }] }
]}]};
console.log(JSON.stringify(diffStatusCells(old, cur), null, 2));
"
```

Expected:
```json
[{"cell_label": "Q1", "from": "progress", "to": "complete"}]
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/notes/statusDiff.service.js
git commit -m "feat(notes): add ProseMirror statusCell diff helper"
```

---

### Task 4: Restore `GET /api/notes/shareable-users` and `GET /api/notes/counts`

**Files:**
- Modify: `backend/src/routes/note.routes.js` (add two new routes near the top after existing `/recent`)
- Reference: `docs/legacy-routes/note.routes.js.2026-04-01-fat.legacy:324` and `:364`

- [ ] **Step 1: Backup current file (per CLAUDE.md)**

```bash
cp backend/src/routes/note.routes.js backend/src/routes/note.routes.js.backup
```

- [ ] **Step 2: Read current head of file to find insertion point**

Run: `head -60 backend/src/routes/note.routes.js`
Look for the line that registers `router.get('/recent', ...)`. The new routes will go BEFORE `/recent`.

- [ ] **Step 3: Insert two new routes**

Open `backend/src/routes/note.routes.js`. Find:

```js
router.get('/recent', verifyToken, addUserFilter, async (req, res) => {
```

Insert these two handlers immediately above that line:

```js
// GET /api/notes/shareable-users — list users for ShareModal (excludes self)
router.get('/shareable-users', verifyToken, async (req, res) => {
    try {
        const [users] = await pool.query(
            `SELECT id, username, COALESCE(name, username) AS name
             FROM users
             WHERE id != ? AND (is_active IS NULL OR is_active = 1)
             ORDER BY name ASC`,
            [req.user.id]
        );
        res.json({ success: true, data: users });
    } catch (error) {
        console.error('Get shareable users error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch users' });
    }
});

// GET /api/notes/counts — sidebar filter counts
router.get('/counts', verifyToken, addUserFilter, async (req, res) => {
    try {
        const targetUserId = req.userFilter || req.user.id;
        const [[all]]      = await pool.query('SELECT COUNT(*) AS c FROM notes WHERE user_id = ? AND is_archived = 0', [targetUserId]);
        const [[mine]]     = await pool.query('SELECT COUNT(*) AS c FROM notes WHERE user_id = ? AND is_archived = 0', [targetUserId]);
        const [[pinned]]   = await pool.query('SELECT COUNT(*) AS c FROM notes WHERE user_id = ? AND is_archived = 0 AND is_pinned = 1', [targetUserId]);
        const [[archived]] = await pool.query('SELECT COUNT(*) AS c FROM notes WHERE user_id = ? AND is_archived = 1', [targetUserId]);
        const [[shared]]   = await pool.query(
            `SELECT COUNT(*) AS c FROM notes
             WHERE is_archived = 0 AND user_id != ? AND JSON_CONTAINS(shared_with, JSON_ARRAY(?))`,
            [targetUserId, targetUserId]
        );
        res.json({
            success: true,
            data: { all: all.c, mine: mine.c, pinned: pinned.c, archived: archived.c, shared: shared.c },
        });
    } catch (error) {
        console.error('Get note counts error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch counts' });
    }
});

```

- [ ] **Step 4: Verify diff**

```bash
diff backend/src/routes/note.routes.js.backup backend/src/routes/note.routes.js
```

Expected: only additions (the two new handlers), no deletions.

- [ ] **Step 5: Restart backend (or rely on nodemon) and smoke test**

Get a JWT (you should already have one from being logged in to the live app; copy from browser devtools → Application → Cookies/LocalStorage, or use a known-good token).

```bash
TOKEN="paste-your-jwt-here"
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:5000/api/notes/shareable-users | head -c 500
echo
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:5000/api/notes/counts | head -c 500
```

Expected: JSON `{success:true, data:[...]}` for shareable-users; `{success:true, data:{all,mine,pinned,archived,shared}}` for counts.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/note.routes.js
git commit -m "feat(notes): restore shareable-users and counts endpoints"
```

---

### Task 5: Restore public-share endpoints

**Files:**
- Modify: `backend/src/routes/note.routes.js` (insert 5 endpoints before `/connections/list`)
- Reference: `docs/legacy-routes/note.routes.js.2026-04-01-fat.legacy:637–760`

- [ ] **Step 1: Backup**

```bash
cp backend/src/routes/note.routes.js backend/src/routes/note.routes.js.backup
```

- [ ] **Step 2: Add `crypto` import at top of file**

If not already imported, add to the top of `note.routes.js`:

```js
const crypto = require('crypto');
```

(Place it after the existing `require` lines.)

- [ ] **Step 3: Insert public-share routes**

Find the line registering `router.get('/connections/list', ...)`. Insert this block immediately above it:

```js
// POST /api/notes/public-share — create or revive a public share link
router.post('/public-share', verifyToken, [
    body('share_type').isIn(['note', 'folder']),
    body('note_id').optional({ nullable: true }).isInt(),
    body('folder_id').optional({ nullable: true }).isInt(),
    body('expires_at').optional({ nullable: true }).isISO8601(),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

        const userId = req.user.id;
        const { share_type, note_id, folder_id, expires_at = null } = req.body;

        // Ownership check
        if (share_type === 'note') {
            if (!note_id) return res.status(400).json({ success: false, message: 'note_id required' });
            const [[note]] = await pool.query('SELECT id FROM notes WHERE id = ? AND user_id = ?', [note_id, userId]);
            if (!note) return res.status(404).json({ success: false, message: 'Note not found' });
        } else {
            if (!folder_id) return res.status(400).json({ success: false, message: 'folder_id required' });
            const [[folder]] = await pool.query('SELECT id FROM note_folders WHERE id = ? AND user_id = ?', [folder_id, userId]);
            if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });
        }

        // If an active share already exists, return it (idempotent)
        const checkCol = share_type === 'note' ? 'note_id' : 'folder_id';
        const checkVal = share_type === 'note' ? note_id : folder_id;
        const [[existing]] = await pool.query(
            `SELECT * FROM note_public_shares WHERE share_type = ? AND ${checkCol} = ? AND user_id = ?`,
            [share_type, checkVal, userId]
        );
        if (existing) {
            if (!existing.is_active) {
                await pool.query('UPDATE note_public_shares SET is_active = 1, expires_at = ? WHERE id = ?', [expires_at, existing.id]);
            }
            return res.json({ success: true, data: { ...existing, is_active: 1, expires_at } });
        }

        const token = crypto.randomBytes(24).toString('hex');
        const [result] = await pool.query(
            `INSERT INTO note_public_shares (share_token, share_type, note_id, folder_id, user_id, expires_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [token, share_type, note_id || null, folder_id || null, userId, expires_at]
        );
        const [[share]] = await pool.query('SELECT * FROM note_public_shares WHERE id = ?', [result.insertId]);
        res.json({ success: true, data: share });
    } catch (error) {
        console.error('Create public share error:', error);
        res.status(500).json({ success: false, message: 'Failed to create public share' });
    }
});

// GET /api/notes/public-share/list — all my shares with item names
router.get('/public-share/list', verifyToken, async (req, res) => {
    try {
        const [shares] = await pool.query(
            `SELECT nps.*,
                    CASE WHEN nps.share_type = 'note'
                         THEN (SELECT title FROM notes WHERE id = nps.note_id)
                         ELSE (SELECT name  FROM note_folders WHERE id = nps.folder_id)
                    END AS item_name
             FROM note_public_shares nps
             WHERE nps.user_id = ?
             ORDER BY nps.created_at DESC`,
            [req.user.id]
        );
        res.json({ success: true, data: shares });
    } catch (error) {
        console.error('List public shares error:', error);
        res.status(500).json({ success: false, message: 'Failed to list shares' });
    }
});

// PUT /api/notes/public-share/:id/toggle — toggle active flag
router.put('/public-share/:id/toggle', verifyToken, async (req, res) => {
    try {
        const [[share]] = await pool.query(
            'SELECT * FROM note_public_shares WHERE id = ? AND user_id = ?',
            [req.params.id, req.user.id]
        );
        if (!share) return res.status(404).json({ success: false, message: 'Share not found' });
        const newActive = share.is_active ? 0 : 1;
        await pool.query('UPDATE note_public_shares SET is_active = ? WHERE id = ?', [newActive, share.id]);
        res.json({ success: true, data: { ...share, is_active: newActive } });
    } catch (error) {
        console.error('Toggle public share error:', error);
        res.status(500).json({ success: false, message: 'Failed to toggle share' });
    }
});

// DELETE /api/notes/public-share/:id — revoke a public share
router.delete('/public-share/:id', verifyToken, async (req, res) => {
    try {
        const [result] = await pool.query(
            'DELETE FROM note_public_shares WHERE id = ? AND user_id = ?',
            [req.params.id, req.user.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Share not found' });
        res.json({ success: true });
    } catch (error) {
        console.error('Delete public share error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete share' });
    }
});

// GET /api/notes/public/:token — UNAUTHENTICATED public viewer endpoint
router.get('/public/:token', async (req, res) => {
    try {
        const [[share]] = await pool.query(
            'SELECT * FROM note_public_shares WHERE share_token = ? AND is_active = 1',
            [req.params.token]
        );
        if (!share) return res.status(404).json({ success: false, message: 'Share not found or inactive' });
        if (share.expires_at && new Date(share.expires_at) < new Date()) {
            return res.status(410).json({ success: false, message: 'Share link has expired' });
        }

        await pool.query('UPDATE note_public_shares SET view_count = view_count + 1 WHERE id = ?', [share.id]);

        if (share.share_type === 'note') {
            const [[note]] = await pool.query(
                `SELECT id, title, content, content_json, color, created_at, updated_at
                 FROM notes WHERE id = ?`,
                [share.note_id]
            );
            if (!note) return res.status(404).json({ success: false, message: 'Note not found' });
            const [tags] = await pool.query(
                `SELECT t.* FROM note_tags t JOIN note_tag_map ntm ON t.id = ntm.tag_id WHERE ntm.note_id = ?`,
                [note.id]
            );
            return res.json({ success: true, data: { type: 'note', share, note: { ...note, tags } } });
        } else {
            const [[folder]] = await pool.query(
                'SELECT id, name, color FROM note_folders WHERE id = ?',
                [share.folder_id]
            );
            if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });
            const [notes] = await pool.query(
                `SELECT id, title, content, content_json, color, position_x, position_y, card_width, card_height,
                        is_pinned, created_at, updated_at
                 FROM notes WHERE folder_id = ? AND is_archived = 0
                 ORDER BY is_pinned DESC, sort_order ASC, created_at DESC`,
                [share.folder_id]
            );
            return res.json({ success: true, data: { type: 'folder', share, folder, notes } });
        }
    } catch (error) {
        console.error('Get public share error:', error);
        res.status(500).json({ success: false, message: 'Failed to load share' });
    }
});

```

- [ ] **Step 4: Verify diff**

```bash
diff backend/src/routes/note.routes.js.backup backend/src/routes/note.routes.js | head -40
```

Expected: only additions.

- [ ] **Step 5: Smoke test**

```bash
TOKEN="..."
NOTE_ID="..."  # any note_id you own

# Create
RESP=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"share_type\":\"note\",\"note_id\":$NOTE_ID}" \
  http://localhost:5000/api/notes/public-share)
echo "$RESP"
TOKEN_PUB=$(echo "$RESP" | grep -oE '"share_token":"[^"]+"' | cut -d'"' -f4)

# Public view (no auth)
curl -s "http://localhost:5000/api/notes/public/$TOKEN_PUB" | head -c 500
echo

# List
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:5000/api/notes/public-share/list | head -c 500
```

Expected: create returns the share row; public viewer returns the note + tags; list returns the share with `item_name`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/note.routes.js
git commit -m "feat(notes): restore public-share suite (5 endpoints) with TTL support"
```

---

### Task 6: Restore lock/unlock and enhance `GET /api/notes/:id`

**Files:**
- Modify: `backend/src/routes/note.routes.js` (replace `GET /:id` body, add lock/unlock routes)
- Reference: `docs/legacy-routes/note.routes.js.2026-04-01-fat.legacy:991–1137`

- [ ] **Step 1: Backup**

```bash
cp backend/src/routes/note.routes.js backend/src/routes/note.routes.js.backup
```

- [ ] **Step 2: Add helper import at top of file**

After existing `require` lines:

```js
const { getRecentActivity } = require('../services/notes/activityLog.service');
```

- [ ] **Step 3: Replace `GET /:id` handler**

Locate `router.get('/:id', verifyToken, addUserFilter, async (req, res) => {` (around line 194 of current file). Replace its entire body so the response includes `activity_log`, `editing_by_user`, `user_role`, and auto-expires stale locks. The new body:

```js
router.get('/:id', verifyToken, addUserFilter, async (req, res) => {
    try {
        const noteId = req.params.id;
        const targetUserId = req.userFilter || req.user.id;

        const [notes] = await pool.query(
            `SELECT n.* FROM notes n
             WHERE n.id = ? AND (
               n.user_id = ?
               OR JSON_CONTAINS(n.shared_with, JSON_ARRAY(?))
               OR EXISTS (
                 SELECT 1 FROM note_folder_shares fs
                 WHERE fs.folder_id = n.folder_id AND fs.shared_with_user_id = ?
               )
             )`,
            [noteId, targetUserId, targetUserId, targetUserId]
        );
        if (notes.length === 0) return res.status(404).json({ success: false, message: 'Note not found' });
        const note = notes[0];

        const [tags] = await pool.query(
            'SELECT t.* FROM note_tags t JOIN note_tag_map m ON t.id = m.tag_id WHERE m.note_id = ?',
            [noteId]
        );
        const [attachments] = await pool.query('SELECT * FROM note_attachments WHERE note_id = ?', [noteId]);

        note.tags = tags;
        note.attachments = attachments;
        note.activity_log = await getRecentActivity(noteId, 20);

        // Auto-expire stale lock (5 min TTL)
        if (note.editing_by && note.editing_since) {
            const elapsed = Date.now() - new Date(note.editing_since).getTime();
            if (elapsed > 5 * 60 * 1000) {
                await pool.query('UPDATE notes SET editing_by = NULL, editing_since = NULL WHERE id = ?', [noteId]);
                note.editing_by = null;
                note.editing_since = null;
            }
        }
        if (note.editing_by) {
            const [[editor]] = await pool.query('SELECT id, name, username FROM users WHERE id = ?', [note.editing_by]);
            note.editing_by_user = editor ? { id: editor.id, name: editor.name || editor.username } : null;
        } else {
            note.editing_by_user = null;
        }

        // Resolve user_role
        if (note.user_id === req.user.id) {
            note.user_role = 'owner';
        } else {
            const roles = typeof note.shared_roles === 'string'
                ? JSON.parse(note.shared_roles || '{}')
                : (note.shared_roles || {});
            note.user_role = roles[req.user.id] || 'viewer';
        }

        res.json({ success: true, data: note });
    } catch (error) {
        console.error('Get note error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch note' });
    }
});
```

- [ ] **Step 4: Add lock/unlock routes**

After the `GET /:id` handler, add:

```js
// PATCH /api/notes/:id/lock — acquire 5-minute editing lock
router.patch('/:id/lock', verifyToken, async (req, res) => {
    try {
        const noteId = req.params.id;
        const userId = req.user.id;

        const [notes] = await pool.query(
            `SELECT id, user_id, shared_with, shared_roles, editing_by, editing_since
             FROM notes
             WHERE id = ? AND (user_id = ? OR JSON_CONTAINS(shared_with, JSON_ARRAY(?)))`,
            [noteId, userId, userId]
        );
        if (notes.length === 0) return res.status(404).json({ success: false, message: 'Note not found' });
        const note = notes[0];

        // Editor permission check
        if (note.user_id !== userId) {
            const roles = typeof note.shared_roles === 'string'
                ? JSON.parse(note.shared_roles || '{}')
                : (note.shared_roles || {});
            if (roles[userId] !== 'editor') {
                return res.status(403).json({ success: false, message: 'Viewer cannot edit this note' });
            }
        }

        // Active foreign lock?
        if (note.editing_by && note.editing_by !== userId) {
            const elapsed = Date.now() - new Date(note.editing_since).getTime();
            if (elapsed < 5 * 60 * 1000 && !req.body.force) {
                const [[editor]] = await pool.query('SELECT name, username FROM users WHERE id = ?', [note.editing_by]);
                const editorName = editor?.name || editor?.username || 'Someone';
                return res.status(409).json({
                    success: false,
                    message: `Sedang diedit oleh ${editorName}`,
                    editing_by_user: { id: note.editing_by, name: editorName },
                });
            }
        }

        await pool.query('UPDATE notes SET editing_by = ?, editing_since = NOW() WHERE id = ?', [userId, noteId]);
        res.json({ success: true, message: 'Lock acquired' });
    } catch (error) {
        console.error('Lock note error:', error);
        res.status(500).json({ success: false, message: 'Failed to acquire lock' });
    }
});

// PATCH /api/notes/:id/unlock — release editing lock (owner or holder)
router.patch('/:id/unlock', verifyToken, async (req, res) => {
    try {
        const noteId = req.params.id;
        const [notes] = await pool.query('SELECT editing_by, user_id FROM notes WHERE id = ?', [noteId]);
        if (notes.length === 0) return res.status(404).json({ success: false, message: 'Note not found' });
        if (notes[0].editing_by === req.user.id || notes[0].user_id === req.user.id) {
            await pool.query('UPDATE notes SET editing_by = NULL, editing_since = NULL WHERE id = ?', [noteId]);
        }
        res.json({ success: true, message: 'Lock released' });
    } catch (error) {
        console.error('Unlock note error:', error);
        res.status(500).json({ success: false, message: 'Failed to release lock' });
    }
});
```

- [ ] **Step 5: Diff and smoke test**

```bash
diff backend/src/routes/note.routes.js.backup backend/src/routes/note.routes.js | wc -l

TOKEN="..."
NOTE_ID="..."
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:5000/api/notes/$NOTE_ID" | head -c 800
echo
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{}' "http://localhost:5000/api/notes/$NOTE_ID/lock"
echo
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" "http://localhost:5000/api/notes/$NOTE_ID/unlock"
```

Expected:
- GET response now contains `activity_log: [...]`, `editing_by_user`, `user_role`
- Lock returns `{success:true, message:"Lock acquired"}`; second lock from a different user returns 409
- Unlock returns success

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/note.routes.js
git commit -m "feat(notes): restore edit-lock + enrich GET /:id with activity/role"
```

---

### Task 7: Restore `PUT /api/notes/positions/bulk`

**Files:**
- Modify: `backend/src/routes/note.routes.js` (insert before existing `PATCH /:id/position`)
- Reference: `docs/legacy-routes/note.routes.js.2026-04-01-fat.legacy:1217`

- [ ] **Step 1: Backup**

```bash
cp backend/src/routes/note.routes.js backend/src/routes/note.routes.js.backup
```

- [ ] **Step 2: Insert bulk-position handler**

Find `router.patch('/:id/position', verifyToken, ...)` (around line 678 of current file). Insert this above it:

```js
// PUT /api/notes/positions/bulk — per-user canvas layout (note_user_state)
router.put('/positions/bulk', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { positions = {}, widths = {}, heights = {} } = req.body || {};
        const ids = Object.keys(positions);
        if (ids.length === 0) return res.json({ success: true, updated: 0 });

        // Verify the user has access to each note (owns or shared-with) before upserting their state
        const [accessible] = await pool.query(
            `SELECT id FROM notes
             WHERE id IN (?) AND (
                user_id = ? OR JSON_CONTAINS(shared_with, JSON_ARRAY(?))
                OR EXISTS (
                  SELECT 1 FROM note_folder_shares fs
                  WHERE fs.folder_id = notes.folder_id AND fs.shared_with_user_id = ?
                )
             )`,
            [ids, userId, userId, userId]
        );
        const allowed = new Set(accessible.map(r => String(r.id)));

        let updated = 0;
        for (const noteId of ids) {
            if (!allowed.has(String(noteId))) continue;
            const pos = positions[noteId] || {};
            const w = widths[noteId];
            const h = heights[noteId];
            await pool.query(
                `INSERT INTO note_user_state (note_id, user_id, position_x, position_y, card_width, card_height)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE position_x=VALUES(position_x), position_y=VALUES(position_y),
                                         card_width=VALUES(card_width), card_height=VALUES(card_height)`,
                [noteId, userId, pos.x ?? null, pos.y ?? null, w ?? null, h ?? null]
            );
            updated++;
        }
        res.json({ success: true, updated });
    } catch (error) {
        console.error('Bulk position update error:', error);
        res.status(500).json({ success: false, message: 'Failed to update positions' });
    }
});
```

- [ ] **Step 3: Verify `note_user_state` has the unique key**

```bash
mysql -uroot -p"$DB_PW" agenda_work_db -e "SHOW INDEXES FROM note_user_state;"
```

If no `UNIQUE (note_id, user_id)` index exists, add it (the `ON DUPLICATE KEY UPDATE` requires it):

```bash
mysql -uroot -p"$DB_PW" agenda_work_db -e "
  ALTER TABLE note_user_state ADD UNIQUE KEY uniq_note_user (note_id, user_id);
" 2>&1 | grep -v Warning
```

If it errors with "Duplicate entry", first dedupe:

```sql
DELETE n1 FROM note_user_state n1
JOIN note_user_state n2 ON n1.note_id = n2.note_id AND n1.user_id = n2.user_id AND n1.id < n2.id;
```

Append the dedupe + index ADD to `2026-04-27-notes-restoration.sql` so the migration is reproducible:

```sql
-- 4. Ensure note_user_state has unique (note_id, user_id) for upsert.
DELETE n1 FROM note_user_state n1
JOIN note_user_state n2 ON n1.note_id = n2.note_id AND n1.user_id = n2.user_id AND n1.id < n2.id;
ALTER TABLE note_user_state ADD UNIQUE KEY IF NOT EXISTS uniq_note_user (note_id, user_id);
```

- [ ] **Step 4: Smoke test**

```bash
TOKEN="..."
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"positions":{"1":{"x":100,"y":200}},"widths":{"1":300},"heights":{"1":150}}' \
  http://localhost:5000/api/notes/positions/bulk
```

Expected: `{"success":true,"updated":1}` (assuming note 1 exists and is yours).

```bash
mysql -uroot -p"$DB_PW" agenda_work_db -e "SELECT * FROM note_user_state WHERE note_id=1 AND user_id=<your_user_id>;"
```

Expected: row reflects new x=100, y=200, w=300, h=150.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/note.routes.js backend/scripts/migrations/2026-04-27-notes-restoration.sql
git commit -m "feat(notes): restore positions/bulk endpoint (per-user canvas layout)"
```

---

### Task 8: Activity instrumentation — POST `/` and PATCH `/:id/archive`

**Files:**
- Modify: `backend/src/routes/note.routes.js` (handlers around line 233 and 406 of current file)

- [ ] **Step 1: Backup**

```bash
cp backend/src/routes/note.routes.js backend/src/routes/note.routes.js.backup
```

- [ ] **Step 2: Add activity import**

If not already imported (Task 6 may have done it):

```js
const { logNoteActivity, getRecentActivity } = require('../services/notes/activityLog.service');
```

- [ ] **Step 3: Instrument POST `/`**

In `router.post('/', ...)` (around line 233), the existing handler already has variables `userId` (owner, accounts for admin impersonation, line 254) and `result.insertId` (new note id, line 286). Find the line `const [newNote] = await pool.query('SELECT * FROM notes WHERE id = ?', [result.insertId]);` (line 297). Insert this immediately before it:

```js
await logNoteActivity(result.insertId, userId, 'created');
```

- [ ] **Step 4: Instrument PATCH `/:id/archive`**

In `router.patch('/:id/archive', ...)` (line 406), the existing handler computes `newArchived` (line 422) and runs the `UPDATE` (line 423). Insert this immediately after the `UPDATE` line:

```js
await logNoteActivity(noteId, req.user.id, newArchived ? 'archived' : 'unarchived');
```

- [ ] **Step 5: Smoke test**

```bash
TOKEN="..."
# Create
RESP=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"smoke-test-activity"}' http://localhost:5000/api/notes)
NEW_ID=$(echo "$RESP" | grep -oE '"id":[0-9]+' | head -1 | cut -d: -f2)
echo "Created note $NEW_ID"

# Archive
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" "http://localhost:5000/api/notes/$NEW_ID/archive"
echo

# Verify activity
mysql -uroot -p"$DB_PW" agenda_work_db -e "
  SELECT action, created_at FROM note_activity_log
  WHERE note_id=$NEW_ID ORDER BY created_at DESC;
"
```

Expected: rows for `archived` and `created`.

- [ ] **Step 6: Cleanup smoke test note**

```bash
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "http://localhost:5000/api/notes/$NEW_ID"
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/note.routes.js
git commit -m "feat(notes): activity log writes for create + archive"
```

---

### Task 9: Activity instrumentation — PUT `/:id` (the diff-heavy one)

**Files:**
- Modify: `backend/src/routes/note.routes.js` (handler around line 306 of current file)

- [ ] **Step 1: Backup**

```bash
cp backend/src/routes/note.routes.js backend/src/routes/note.routes.js.backup
```

- [ ] **Step 2: Add diff helper import**

```js
const { diffStatusCells } = require('../services/notes/statusDiff.service');
```

- [ ] **Step 3: Read current PUT `/:id` handler**

Run: `sed -n '300,410p' backend/src/routes/note.routes.js` to see it in context. Identify:
- The line that fetches the existing note (often `SELECT * FROM notes WHERE id = ?`) — call its result `oldNote`.
- The line that runs `UPDATE notes SET ...`.
- The line that re-syncs tags via `note_tag_map` (DELETE then INSERT).

- [ ] **Step 4: Capture old values BEFORE the update**

Just after fetching `oldNote`, add (if not already present):

```js
const prevTitle    = oldNote.title;
const prevContent  = oldNote.content_json;
const prevFolderId = oldNote.folder_id;
const prevColor    = oldNote.color;
const prevPinned   = !!oldNote.is_pinned;

// Old tag names
const [prevTagRows] = await pool.query(
  `SELECT t.id, t.name FROM note_tags t
   JOIN note_tag_map m ON t.id = m.tag_id
   WHERE m.note_id = ?`,
  [noteId]
);
const prevTagNames = prevTagRows.map(r => r.name);
```

- [ ] **Step 5: Compute and write activity entries AFTER the update**

Just before `res.json(...)`, add:

```js
const userId = req.user.id;

// Title change
if (typeof req.body.title === 'string' && req.body.title !== prevTitle) {
    await logNoteActivity(noteId, userId, 'title_edited', { from: prevTitle, to: req.body.title });
}

// Content change (one entry per save)
if (req.body.content_json !== undefined) {
    const newContent = typeof req.body.content_json === 'string'
        ? req.body.content_json
        : JSON.stringify(req.body.content_json);
    if (newContent !== (prevContent || '')) {
        await logNoteActivity(noteId, userId, 'content_edited');
    }
    // StatusCell changes (parsed)
    try {
        const oldJson = prevContent ? JSON.parse(prevContent) : null;
        const newJson = typeof req.body.content_json === 'object'
            ? req.body.content_json
            : (req.body.content_json ? JSON.parse(req.body.content_json) : null);
        const cellChanges = diffStatusCells(oldJson, newJson);
        for (const change of cellChanges) {
            await logNoteActivity(noteId, userId, 'status_changed', change);
        }
    } catch (e) {
        console.error('statusDiff parse error:', e.message);
    }
}

// Folder change
if (req.body.folder_id !== undefined && Number(req.body.folder_id || 0) !== Number(prevFolderId || 0)) {
    const [[fromF]] = prevFolderId
        ? await pool.query('SELECT name FROM note_folders WHERE id = ?', [prevFolderId])
        : [[null]];
    const [[toF]] = req.body.folder_id
        ? await pool.query('SELECT name FROM note_folders WHERE id = ?', [req.body.folder_id])
        : [[null]];
    await logNoteActivity(noteId, userId, 'folder_moved', {
        from_id: prevFolderId, from_name: fromF?.name || null,
        to_id: req.body.folder_id || null, to_name: toF?.name || null,
    });
}

// Color change
if (req.body.color !== undefined && req.body.color !== prevColor) {
    await logNoteActivity(noteId, userId, 'color_changed', { from: prevColor, to: req.body.color });
}

// Pin change
if (req.body.is_pinned !== undefined && Boolean(req.body.is_pinned) !== prevPinned) {
    await logNoteActivity(noteId, userId, req.body.is_pinned ? 'pinned' : 'unpinned');
}

// Tag changes
if (Array.isArray(req.body.tag_ids)) {
    const [newTagRows] = await pool.query(
        `SELECT t.id, t.name FROM note_tags t
         JOIN note_tag_map m ON t.id = m.tag_id
         WHERE m.note_id = ?`,
        [noteId]
    );
    const newTagNames = newTagRows.map(r => r.name);
    const added   = newTagNames.filter(n => !prevTagNames.includes(n));
    const removed = prevTagNames.filter(n => !newTagNames.includes(n));
    if (added.length > 0 || removed.length > 0) {
        await logNoteActivity(noteId, userId, 'tag_changed', { added, removed });
    }
}
```

- [ ] **Step 6: Smoke test**

```bash
TOKEN="..."
NOTE_ID="..."  # one you own

# Change title
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"renamed-by-test"}' "http://localhost:5000/api/notes/$NOTE_ID"

# Change color
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"color":"#ff0000"}' "http://localhost:5000/api/notes/$NOTE_ID"

# Verify
mysql -uroot -p"$DB_PW" agenda_work_db -e "
  SELECT action, details, created_at
  FROM note_activity_log WHERE note_id=$NOTE_ID
  ORDER BY created_at DESC LIMIT 5;
"
```

Expected: rows for `color_changed` and `title_edited` with the right `details` JSON.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/note.routes.js
git commit -m "feat(notes): activity log writes for PUT /:id (title, content, folder, color, pin, tags, status)"
```

---

### Task 10: Activity instrumentation — share + connections + public-share

**Files:**
- Modify: `backend/src/routes/note.routes.js` (handlers: `PATCH /:id/share`, `POST /connections`, `DELETE /connections/:id`, `POST /public-share`, `DELETE /public-share/:id`)

- [ ] **Step 1: Backup**

```bash
cp backend/src/routes/note.routes.js backend/src/routes/note.routes.js.backup
```

- [ ] **Step 2: Instrument PATCH `/:id/share` AND wire up roles persistence**

The current handler (line 438) accepts `user_ids` but **ignores `req.body.roles`** even though the frontend sends it. Fix that gap while instrumenting.

In the handler, the variables already in scope are: `noteId`, `validUserIds` (the new sanitized list), `existing` (only has `id, user_id` — does NOT have `shared_with`).

**a)** First, **change the existing SELECT (line 464) to also fetch `shared_with`** so we can compute the diff:

Replace:
```js
let checkQuery = 'SELECT id, user_id FROM notes WHERE id = ?';
```
with:
```js
let checkQuery = 'SELECT id, user_id, shared_with FROM notes WHERE id = ?';
```

**b)** **Replace the existing `UPDATE notes SET shared_with = ?` (lines 483–486)** to also write `shared_roles`:

Replace:
```js
await pool.query(
    'UPDATE notes SET shared_with = ? WHERE id = ?',
    [JSON.stringify(validUserIds), noteId]
);
```
with:
```js
const rolesPayload = (req.body.roles && typeof req.body.roles === 'object') ? req.body.roles : {};
await pool.query(
    'UPDATE notes SET shared_with = ?, shared_roles = ? WHERE id = ?',
    [JSON.stringify(validUserIds), JSON.stringify(rolesPayload), noteId]
);
```

**c)** **Add activity-log writes** immediately after that UPDATE:

```js
// Diff old vs new for activity log
const prevShared = existing[0].shared_with
    ? (typeof existing[0].shared_with === 'string'
        ? JSON.parse(existing[0].shared_with || '[]')
        : (existing[0].shared_with || []))
    : [];
const addedIds   = validUserIds.filter(uid => !prevShared.includes(uid));
const removedIds = prevShared.filter(uid => !validUserIds.includes(uid));

if (addedIds.length > 0 || removedIds.length > 0) {
    const allRelevant = [...addedIds, ...removedIds, 0];  // 0 keeps IN clause non-empty
    const [users] = await pool.query(
        'SELECT id, COALESCE(name, username) AS name FROM users WHERE id IN (?)',
        [allRelevant]
    );
    const nameById = Object.fromEntries(users.map(u => [u.id, u.name]));
    const addedNamed   = addedIds.map(id => ({ id, name: nameById[id] || `User #${id}` }));
    const removedNamed = removedIds.map(id => ({ id, name: nameById[id] || `User #${id}` }));

    if (addedNamed.length > 0) {
        await logNoteActivity(noteId, req.user.id, 'shared', { added: addedNamed, roles: rolesPayload });
    }
    if (removedNamed.length > 0) {
        await logNoteActivity(noteId, req.user.id, 'share_revoked', { removed: removedNamed });
    }
}
```

- [ ] **Step 3: Instrument POST `/connections`**

After the `INSERT INTO note_connections ...` line, add:

```js
const [[targetNote]] = await pool.query('SELECT title FROM notes WHERE id = ?', [target_note_id]);
await logNoteActivity(source_note_id, req.user.id, 'connection_added', {
    other_note_id: target_note_id,
    other_title: targetNote?.title || `Note #${target_note_id}`,
});
```

(Use the variable names already in scope from the existing handler — likely `source_note_id` and `target_note_id` from `req.body`.)

- [ ] **Step 4: Instrument DELETE `/connections/:id`**

Before deleting, fetch the connection row to know the source/target note. Just before `DELETE`:

```js
const [[connRow]] = await pool.query(
    'SELECT source_note_id, target_note_id FROM note_connections WHERE id = ? AND user_id = ?',
    [req.params.id, req.user.id]
);
```

Then after the DELETE succeeds:

```js
if (connRow) {
    const [[targetNote]] = await pool.query('SELECT title FROM notes WHERE id = ?', [connRow.target_note_id]);
    await logNoteActivity(connRow.source_note_id, req.user.id, 'connection_removed', {
        other_note_id: connRow.target_note_id,
        other_title: targetNote?.title || `Note #${connRow.target_note_id}`,
    });
}
```

- [ ] **Step 5: Instrument POST `/public-share` (created)**

After the share is created (or an inactive existing one is reactivated), add:

```js
if (share_type === 'note' && note_id) {
    await logNoteActivity(note_id, userId, 'public_link_created', { token_tail: token.slice(-4) });
}
// (Folder-level shares don't have a single note to log against; skip.)
```

- [ ] **Step 6: Instrument DELETE `/public-share/:id`**

Before delete, fetch the share to know note_id and token tail:

```js
const [[shareRow]] = await pool.query(
    'SELECT * FROM note_public_shares WHERE id = ? AND user_id = ?',
    [req.params.id, req.user.id]
);
// ... existing DELETE ...
if (shareRow && shareRow.share_type === 'note' && shareRow.note_id) {
    await logNoteActivity(shareRow.note_id, req.user.id, 'public_link_revoked', {
        token_tail: shareRow.share_token.slice(-4),
    });
}
```

- [ ] **Step 7: Smoke test all four**

```bash
TOKEN="..."
NOTE_ID="..."
OTHER_USER_ID="..."

# Share
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"user_ids\":[$OTHER_USER_ID],\"roles\":{\"$OTHER_USER_ID\":\"viewer\"}}" \
  "http://localhost:5000/api/notes/$NOTE_ID/share"

# Unshare
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"user_ids":[],"roles":{}}' "http://localhost:5000/api/notes/$NOTE_ID/share"

mysql -uroot -p"$DB_PW" agenda_work_db -e "
  SELECT action, details FROM note_activity_log WHERE note_id=$NOTE_ID ORDER BY id DESC LIMIT 5;
"
```

Expected: `share_revoked` and `shared` rows in the log with named users in `details`.

- [ ] **Step 8: Commit**

```bash
git add backend/src/routes/note.routes.js
git commit -m "feat(notes): activity log writes for share, connections, public-share"
```

---

### Task 11: Frontend — extend `ACTION_LABELS` and `ChangeDetail`

**Files:**
- Modify: `frontend/src/components/notes/NoteEditorModal.jsx` (around line 26 for labels, line 37 for ChangeDetail)
- Modify: `frontend/src/pages/PublicNoteViewer.jsx` (similar locations — find by searching for `ACTION_LABELS` and `ChangeDetail`)

- [ ] **Step 1: Backup both files**

```bash
cp frontend/src/components/notes/NoteEditorModal.jsx frontend/src/components/notes/NoteEditorModal.jsx.backup
cp frontend/src/pages/PublicNoteViewer.jsx frontend/src/pages/PublicNoteViewer.jsx.backup
```

- [ ] **Step 2: Read current `ACTION_LABELS` definition**

```bash
grep -n "ACTION_LABELS" frontend/src/components/notes/NoteEditorModal.jsx
```

Note the line range of the current dict.

- [ ] **Step 3: Replace `ACTION_LABELS` with the full 18-key dict**

In `frontend/src/components/notes/NoteEditorModal.jsx`, replace the existing `ACTION_LABELS` object with:

```js
const ACTION_LABELS = {
  created: 'membuat catatan',
  edited: 'mengedit',
  title_edited: 'mengubah judul',
  content_edited: 'mengubah isi',
  folder_moved: 'memindahkan folder',
  tag_changed: 'mengubah tag',
  color_changed: 'mengubah warna',
  pinned: 'mem-pin',
  unpinned: 'meng-unpin',
  archived: 'mengarsipkan',
  unarchived: 'mengembalikan dari arsip',
  shared: 'membagikan',
  share_revoked: 'menghapus akses',
  public_link_created: 'membuat tautan publik',
  public_link_revoked: 'mencabut tautan publik',
  status_changed: 'mengubah status',
  connection_added: 'menghubungkan catatan',
  connection_removed: 'memutus koneksi',
};
```

Repeat the same change in `frontend/src/pages/PublicNoteViewer.jsx`.

- [ ] **Step 4: Extend `ChangeDetail` renderer**

In `NoteEditorModal.jsx`, find `function ChangeDetail({ d })`. Read its current body — it likely handles `d.type === 'tags'` and a generic case. Replace with this richer version that handles every shape we now emit:

```jsx
function ChangeDetail({ d }) {
  if (!d || typeof d !== 'object') return null;

  // tags: { added: string[], removed: string[] }
  if (Array.isArray(d.added) || Array.isArray(d.removed)) {
    return (
      <div>
        {d.added?.length > 0 && (
          <div className="text-green-600">+ {d.added.map(x => typeof x === 'object' ? x.name : x).join(', ')}</div>
        )}
        {d.removed?.length > 0 && (
          <div className="text-red-400">− {d.removed.map(x => typeof x === 'object' ? x.name : x).join(', ')}</div>
        )}
      </div>
    );
  }

  // folder: { from_id, from_name, to_id, to_name }
  if ('from_name' in d || 'to_name' in d) {
    return (
      <div>
        <span className="text-gray-500">{d.from_name || '—'}</span>
        <span className="mx-1">→</span>
        <span className="text-gray-700">{d.to_name || '—'}</span>
      </div>
    );
  }

  // status cell: { cell_label, from, to }
  if ('cell_label' in d) {
    return (
      <div>
        <span className="font-medium">{d.cell_label}</span>:
        <span className="text-gray-500 ml-1">{d.from || '—'}</span>
        <span className="mx-1">→</span>
        <span className="text-gray-700">{d.to || '—'}</span>
      </div>
    );
  }

  // connection: { other_note_id, other_title }
  if ('other_title' in d) {
    return <div className="text-gray-600">↔ {d.other_title}</div>;
  }

  // public link: { token_tail }
  if ('token_tail' in d) {
    return <div className="text-gray-500">…{d.token_tail}</div>;
  }

  // generic from/to (title, color, etc.)
  if ('from' in d && 'to' in d) {
    return (
      <div>
        <span className="text-gray-500">{String(d.from ?? '—')}</span>
        <span className="mx-1">→</span>
        <span className="text-gray-700">{String(d.to ?? '—')}</span>
      </div>
    );
  }

  return null;
}
```

Apply the same change in `PublicNoteViewer.jsx` (search for the existing `function ChangeDetail`).

- [ ] **Step 5: Build and smoke test**

```bash
cd frontend && npm run build 2>&1 | tail -20
```

Expected: clean build (no syntax errors).

Then in a browser at `https://agenda.bpsmalut.com/notes` (or local dev URL), open any note's editor → confirm activity sidebar shows the new event types correctly.

- [ ] **Step 6: Diff and commit**

```bash
diff frontend/src/components/notes/NoteEditorModal.jsx.backup frontend/src/components/notes/NoteEditorModal.jsx | head -40
diff frontend/src/pages/PublicNoteViewer.jsx.backup frontend/src/pages/PublicNoteViewer.jsx | head -40

git add frontend/src/components/notes/NoteEditorModal.jsx frontend/src/pages/PublicNoteViewer.jsx
git commit -m "feat(notes): extend activity labels and ChangeDetail renderer for new event shapes"
```

---

### Task 12: Frontend — public-link TTL dropdown

**Files:**
- Modify: `frontend/src/components/notes/PublicLinkModal.jsx`

- [ ] **Step 1: Backup**

```bash
cp frontend/src/components/notes/PublicLinkModal.jsx frontend/src/components/notes/PublicLinkModal.jsx.backup
```

- [ ] **Step 2: Read current modal structure**

```bash
sed -n '1,80p' frontend/src/components/notes/PublicLinkModal.jsx
```

Identify the form section with the "Generate" / "Buat tautan" button.

- [ ] **Step 3: Add TTL state and dropdown**

Near the top of the component (after other `useState` calls), add:

```jsx
const [ttl, setTtl] = useState('never');  // never | 7d | 30d | 90d
```

In the JSX, just above the "Generate" button, add:

```jsx
<div className="flex items-center gap-2 mb-3">
  <label className="text-xs text-gray-500">Berlaku</label>
  <select
    value={ttl}
    onChange={(e) => setTtl(e.target.value)}
    className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
  >
    <option value="never">Tanpa batas waktu</option>
    <option value="7d">7 hari</option>
    <option value="30d">30 hari</option>
    <option value="90d">90 hari</option>
  </select>
</div>
```

In the `handleGenerate` (or equivalent) function, compute `expires_at` from `ttl`:

```js
const expires_at = ttl === 'never'
  ? null
  : new Date(Date.now() + ({ '7d': 7, '30d': 30, '90d': 90 }[ttl]) * 24 * 60 * 60 * 1000).toISOString();
```

Then include it in the POST body:

```js
await notePublicShareAPI.create({ share_type, note_id, folder_id, expires_at });
```

(Adjust `share_type/note_id/folder_id` to match how the existing call already passes them.)

- [ ] **Step 4: Show expiry in the link list (if list is rendered in same modal)**

If the list of existing shares is rendered inside this modal, add a small badge showing `Berlaku hingga {date}` when `share.expires_at` is non-null:

```jsx
{share.expires_at && (
  <span className="text-[10px] text-amber-600 ml-2">
    Berlaku hingga {new Date(share.expires_at).toLocaleDateString('id-ID')}
  </span>
)}
```

- [ ] **Step 5: Build and browser-smoke**

```bash
cd frontend && npm run build 2>&1 | tail -10
```

Open the public-link modal on a note → choose "30 hari" → generate → confirm the badge appears next to the new entry; copy URL → open in incognito → loads → wait or manually update DB to set `expires_at < NOW()` → reload → 410 GONE.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/notes/PublicLinkModal.jsx
git commit -m "feat(notes): public-link TTL dropdown (never/7d/30d/90d)"
```

---

### Task 13: End-to-end acceptance verification

**Files:** None (verification only)

This task runs through Phase 1's acceptance criteria from the spec section 9. Each step is a manual or scripted check that maps to one criterion.

- [ ] **Step 1: Sidebar counts populated**

Open `/notes` → confirm sidebar filter labels show actual counts (e.g., "Pinned · 3", "Archived · 5", "Shared · 1"), not 0.

- [ ] **Step 2: ShareModal lists users**

Open any owned note → click Share → confirm the list of users loads (not empty, not error). Pick one → save. Refresh editor → activity log shows `membagikan` entry.

- [ ] **Step 3: Activity log entries for all 18 events**

Manually trigger each event type once on a test note. Then run:

```bash
mysql -uroot -p"$DB_PW" agenda_work_db -e "
  SELECT action, COUNT(*) FROM note_activity_log
  WHERE note_id=<TEST_NOTE_ID>
  GROUP BY action ORDER BY action;
"
```

Expected: at least one row per action you've exercised (you don't need all 18 in one go — covering the most user-facing 10 is enough for sign-off).

- [ ] **Step 4: Public link with expiry**

Generate a public link with TTL = 7 days → open in incognito → counter increments. Then:

```bash
mysql -uroot -p"$DB_PW" agenda_work_db -e "
  UPDATE note_public_shares SET expires_at = '2020-01-01' WHERE share_token = '<token>';
"
```

Reload the public viewer URL → expect 410 GONE.

- [ ] **Step 5: Edit-lock flow**

In one browser tab as user A, open a note. In a second browser (different user B with editor permission), open the same note → confirm the amber "Sedang diedit oleh A" badge appears. Click "Force Takeover" as B → confirm B can now edit. Open dev console in tab A → next save attempt should… (current behavior: just save; per the spec, real conflict resolution is out of scope — pessimistic warning only).

- [ ] **Step 6: Bulk position persists per user**

As user A, open `/notes`, drag several cards to new positions. Refresh page → positions should persist. Now log in as user B (with shared access to same notes) → drag cards → user A's layout should NOT change. Verify:

```bash
mysql -uroot -p"$DB_PW" agenda_work_db -e "
  SELECT user_id, note_id, position_x, position_y FROM note_user_state
  WHERE note_id IN (<a_few_ids>);
"
```

Expected: separate rows per user.

- [ ] **Step 7: Migration applied successfully**

```bash
mysql -uroot -p"$DB_PW" agenda_work_db -e "
  SHOW COLUMNS FROM note_activity_log LIKE 'action';
  SHOW COLUMNS FROM note_public_shares LIKE 'expires_at';
"
```

Expected: 18-value enum, expires_at column.

- [ ] **Step 8: No regressions**

Manually exercise the existing flows: create/edit/delete a note, switch folders/tags, archive/unarchive, search, create/delete folder, drag-to-move, zoom, connect notes. None should newly break.

- [ ] **Step 9: Final commit if any docs were updated**

Update `docs/superpowers/specs/2026-04-27-notes-restoration-and-hardening-design.md` with a "Phase 1 completed YYYY-MM-DD" note at the top, and commit:

```bash
git add docs/superpowers/specs/
git commit -m "docs: mark notes restoration Phase 1 complete"
```

---

## Phase-1 done. What's next?

This plan covers Phase 1 only (per the spec's 3-phase decomposition). Phase 2 (backend hardening — N+1 fix, folder-share role enforcement, admin impersonation audit, tag validation) and Phase 3 (frontend cleanup — backup-file hygiene, dead-code removal, virtualization, error boundaries, accessibility, activity-log pagination) each need their own spec + plan.

When you're ready for Phase 2, brainstorm again from the existing spec section 4 — it should produce a tighter spec since the audit groundwork is already done.

---

## Cross-references

- **Spec:** `docs/superpowers/specs/2026-04-27-notes-restoration-and-hardening-design.md`
- **Source for restored handlers:** `docs/legacy-routes/note.routes.js.2026-04-01-fat.legacy`
- **Initial audit:** in conversation history (commits `8e4da7c` and earlier on this branch)
- **Production tables (already exist):** `note_activity_log` (88 rows), `note_public_shares` (3), `note_user_state` (12), `notes.editing_by/editing_since`
