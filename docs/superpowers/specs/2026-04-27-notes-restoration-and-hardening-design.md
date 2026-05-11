# Notes Module — Restoration & Hardening Design

**Status:** Approved (brainstorming → spec)
**Date:** 2026-04-27
**Author:** wisnucandragumelar@gmail.com (via Claude)
**Branch base:** `feat/chat-proxy-routing` (current) — implementation branch TBD

---

## 1. Context

A feature audit of `https://agenda.bpsmalut.com/notes` (see prior conversation in this branch) revealed that the Notes module's frontend calls **8+ backend endpoints that no longer exist**. Symptoms:

- Sharing dialog can't list users (`GET /notes/shareable-users` → 404)
- Activity log sidebar always shows "Belum ada aktivitas" (backend never writes events; UI is correct, store is empty)
- Public-link generation appears to work but persists nothing (3 stale rows in `note_public_shares` from prior code)
- Edit-lock UI (`Diedit oleh ...` badge, force-takeover button) never lights up
- Sidebar filter counts (`getCounts`) silently zero
- Drag-to-move bulk position save fails silently

Investigation showed the production database **already contains all required tables**:

| Table | Rows in prod | Purpose |
|---|---|---|
| `note_activity_log` | 88 | History of note actions (event log) |
| `note_public_shares` | 3 | Public share tokens for notes/folders |
| `note_user_state` | 12 | Per-user canvas position + archive flag |
| `notes.editing_by` / `editing_since` | n/a | Pessimistic edit-lock columns |

The backend code that read/wrote these tables is preserved at `backend/src/routes/note.routes.js.backup` (1,848 LOC, dated 2026-04-01). The current `note.routes.js` (816 LOC, 2026-04-22) is a stripped-down version that lost ~1,000 lines of route handlers during a revert. The frontend was never updated to match the revert.

**Goal:** Reconnect the frontend to the existing schema by selectively restoring backend handlers, expanding the activity-log instrumentation to a comprehensive event set, and folding the audit's hardening + cleanup findings into Phases 2 and 3.

---

## 2. Approach: selective restore + fix (Approach B from brainstorm)

Three approaches were considered:

| | Effort | Quality | Risk |
|---|---|---|---|
| **A. Pure revert** (`cp .backup current`) | 5 min | Low — re-introduces audit-flagged bugs | Med — undoes post-Apr-1 fixes |
| **B. Selective restore + fix** ✅ | ~2 days | High | Low — contracts on both ends already match |
| **C. Rewrite from spec** | ~5 days | Highest | Med — frontend contract drift risk |

**B is chosen** because the database schema, frontend contracts, and most route logic already exist and align. The work is to port the missing handlers from `.backup` into the current file (preserving its newer hardening), add activity-log instrumentation across all relevant write paths, and run an additive schema migration to expand the action enum.

---

## 3. Phase 1 — Restoration & sharing/activity (this spec's focus)

### 3.1 Schema migration (`backend/scripts/migrations/2026-04-27-notes-restoration.sql`)

All migrations are additive and idempotent. No data loss.

```sql
-- Expand activity log enum to 18 values for comprehensive event tracking.
-- Existing 7 values preserved.
ALTER TABLE note_activity_log
  MODIFY action ENUM(
    'created','edited','title_edited','content_edited',
    'folder_moved','tag_changed','color_changed',
    'pinned','unpinned','archived','unarchived',
    'shared','share_revoked',
    'public_link_created','public_link_revoked',
    'status_changed','connection_added','connection_removed'
  ) NOT NULL;

-- Optional public-link TTL (NULL = never expires; default behavior for existing rows).
ALTER TABLE note_public_shares
  ADD COLUMN expires_at TIMESTAMP NULL DEFAULT NULL AFTER is_active;

-- Performance indexes (skip if already present).
ALTER TABLE note_activity_log
  ADD INDEX IF NOT EXISTS idx_activity_note_time (note_id, created_at DESC);

ALTER TABLE note_public_shares
  ADD INDEX IF NOT EXISTS idx_public_share_token_active (share_token, is_active);
```

**Rollback:** Each `ALTER TABLE` has a documented inverse in `migrations/rollback/2026-04-27-notes-restoration.down.sql` — but rollback is unsafe if any row uses a new enum value, so the rollback SQL also runs `UPDATE note_activity_log SET action='edited' WHERE action NOT IN (<old 7>)`.

### 3.2 Backend route restoration

All ports go from `note.routes.js.backup` (line numbers below) into the current `note.routes.js` while preserving its post-Apr-1 hardening (rate-limit middleware, M3 helmet config, etc.).

| Endpoint | From .backup | Behavior |
|---|---|---|
| `GET /api/notes/shareable-users` | L324 | Returns users excluding self for ShareModal |
| `GET /api/notes/counts` | L364 | `{all, mine, pinned, archived, shared}` for sidebar |
| `POST /api/notes/public-share` | L637 | Returns existing active row if present, else inserts |
| `GET /api/notes/public-share/list` | L693 | Joins note title or folder name as `item_name` |
| `PUT /api/notes/public-share/:id/toggle` | L712 | Flips `is_active` |
| `DELETE /api/notes/public-share/:id` | L725 | Hard delete |
| `GET /api/notes/public/:token` | L737 | Unauthenticated; **adds `expires_at` check**; bumps `view_count` |
| `PATCH /api/notes/:id/lock` | L1068 | 5-min TTL on `editing_since`; `force` body flag for takeover |
| `PATCH /api/notes/:id/unlock` | L1121 | Owner or current holder may release |
| `PUT /api/notes/positions/bulk` | L1217 | Per-user via `note_user_state` upsert |

Plus modify the existing `GET /api/notes/:id` (current L194) to return:

```js
{
  ...noteFields, tags: [...], attachments: [...], connections: [...],
  activity_log: [/* last 20 from note_activity_log, ordered DESC, with user_name resolved */],
  editing_by, editing_since, editing_by_user: { id, name } | null,
  user_role: 'owner' | 'editor' | 'viewer'
}
```

— and **auto-expire stale locks on read** (clear `editing_by`/`editing_since` if `now - editing_since > 5min`).

### 3.3 Activity-log instrumentation

Add `INSERT INTO note_activity_log (note_id, user_id, action, details)` calls at these points:

| Trigger | Location | Action | `details` |
|---|---|---|---|
| Note created | POST `/` (L233 current) | `created` | `null` |
| Title changed (PUT) | PUT `/:id` (L306 current) | `title_edited` | `{from, to}` |
| Content changed | PUT `/:id` | `content_edited` | `null` (one entry per save) |
| Folder changed | PUT `/:id` | `folder_moved` | `{from_id, from_name, to_id, to_name}` |
| Tags changed | PUT `/:id` | `tag_changed` | `{added: ['name1', ...], removed: ['name2', ...]}` (names only — matches existing `ChangeDetail` renderer which does `.join(', ')`) |
| Color changed | PUT `/:id` | `color_changed` | `{from, to}` |
| Pin toggled | PUT `/:id` | `pinned` / `unpinned` | `null` |
| Archive toggled | PATCH `/:id/archive` | `archived` / `unarchived` | `null` |
| Share users changed | PATCH `/:id/share` | `shared` / `share_revoked` | `{added, removed, roles}` |
| Public link created | POST `/public-share` | `public_link_created` | `{token_tail: token.slice(-4)}` |
| Public link revoked | DELETE `/public-share/:id` | `public_link_revoked` | `{token_tail}` |
| StatusCell changed | PUT `/:id` (server-side diff of `content_json`) | `status_changed` | `{cell_label, from, to}` |
| Connection added | POST `/connections` | `connection_added` | `{other_note_id, other_title}` |
| Connection removed | DELETE `/connections/:id` | `connection_removed` | `{other_note_id, other_title}` |

**`status_changed` detection:** A small helper `diffStatusCells(oldJson, newJson)` walks both ProseMirror trees, indexes `statusCell` nodes by their parent table cell coordinates, and emits one entry per cell whose `attrs.status` differs. Coalesced into a single multi-detail log row per save. Added to `backend/src/services/notes/activityLog.service.js` (new module).

**Implementation pattern** — single helper used by all writers:

```js
// backend/src/services/notes/activityLog.service.js
async function logNoteActivity(noteId, userId, action, details = null) {
  const detailsJson = details === null ? null : JSON.stringify(details);
  try {
    await pool.query(
      'INSERT INTO note_activity_log (note_id, user_id, action, details) VALUES (?, ?, ?, ?)',
      [noteId, userId, action, detailsJson]
    );
  } catch (e) {
    // Activity logging must never break the user's actual write.
    console.error('logNoteActivity failed:', { noteId, action, error: e.message });
  }
}
```

Failures are logged but never bubble up — instrumentation is fire-and-forget so a logging bug can never block a user's edit.

### 3.4 Frontend changes (Phase 1)

Minimal — the frontend already speaks the right shape. Only:

1. **Extend `ACTION_LABELS` dict** in `frontend/src/components/notes/NoteEditorModal.jsx` and `frontend/src/pages/PublicNoteViewer.jsx` to cover the 18 enum values:

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
2. **Extend `ChangeDetail`** component (same file) to render the new `details` shapes: `from/to` for title/color, `from_id/from_name/to_id/to_name` for folder, `added/removed/roles` for share, `cell_label/from/to` for status, `other_note_id/other_title` for connection.
3. **Public-link TTL UI** in `PublicLinkModal.jsx`: dropdown with `Tidak ada batas waktu` (default), `7 hari`, `30 hari`, `90 hari`. Store as `expires_at = NULL | now()+Xd` in the POST.
4. **No frontend code is removed in Phase 1.** Cleanup is Phase 3.

### 3.5 Public-link TTL semantics

- Default `expires_at = NULL` (never expires) — chosen to avoid surprising users whose links stop working.
- `GET /public/:token` rejects if `is_active = 0` OR `(expires_at IS NOT NULL AND expires_at < NOW())`.
- UI shows `Berlaku hingga {date}` only if `expires_at` is set; otherwise no badge.

---

## 4. Phase 2 — Backend hardening (deferred)

Targets findings from the audit that are not blocking Phase 1.

1. **N+1 elimination** on `GET /notes/:id` — replace 4 sequential queries (note, tags, attachments, connections) with a single query using `JSON_ARRAYAGG` or 2 well-indexed JOINs.
2. **Folder-share role enforcement** — currently `note_folder_shares.role` is stored but never read. Add role checks to: list-folders (filter), folder updates, note updates inside shared folders, share revocation.
3. **Admin impersonation audit** — when admin uses `user_id` field in `POST /api/notes`, write a `note_activity_log` entry plus a row in a new `admin_audit` table (defined in a separate spec) recording `impersonated_user_id`, `admin_user_id`, `action`, `payload`.
4. **Tag ownership validation** — `validateTagOwnership()` (note.routes.js:32) currently silently filters non-owned IDs; should reject with 400 `INVALID_TAG_IDS`.
5. **Index review** on `notes.shared_with` — `JSON_CONTAINS` is non-indexable. If `EXPLAIN` shows full-scan past 10k notes, migrate to junction table `note_shares (note_id, user_id, role)`.

Each item gets its own implementation plan; out of scope here.

---

## 5. Phase 3 — Frontend polish & cleanup (deferred)

1. **Backup file hygiene** — delete `note.routes.js.backup`, `.backup_preconn`, `.backup2`, `.broken` and equivalents for note-folder/Notes.jsx/PublicNoteViewer.jsx after Phase 1 verified working in production. Per CLAUDE.md, only one `.backup` per file is permitted.
2. **Dead code removal** — `viewMode = 'grid'` constant in `Notes.jsx:54` and any list-view branches; unused `notesAPI.checklistToTask` (or wire UI to call it from a checklist item context menu).
3. **Canvas virtualization** — when `notes.length > 50`, only render `DraggableNoteCard`s within the visible viewport (computed from `panOffset` + canvas wrapper rect). Use a simple bounding-box check, not a windowing library.
4. **Error boundary** around `NoteEditorModal` — generic fallback with "Gagal memuat editor. Coba muat ulang halaman." and a `Reload` button.
5. **Accessibility** — add `aria-label` to all icon-only buttons (audit found ~1 in 6,000 LOC).
6. **Activity-log pagination** — `GET /api/notes/:id/activity?before=<id>&limit=50`. UI loads more on scroll.

---

## 6. Risk & rollback

| Risk | Likelihood | Mitigation |
|---|---|---|
| Migration ALTER fails on table with new enum values mid-deploy | Low | All values are additive; old code keeps working with subset |
| Restored route handler shadows existing route ordering | Low | `PATCH /reorder` and `PUT /positions/bulk` registered before `/:id` routes; verify with grep after edit |
| Frontend `ACTION_LABELS` missing a new action → renders raw enum string | Low | Acceptable — degrades gracefully; not a crash |
| Public-share viewer leaks private notes if `is_active` check skipped | High impact, low likelihood | `GET /public/:token` is the only public endpoint; it always checks `is_active = 1 AND (expires_at IS NULL OR expires_at > NOW())` — covered by integration test |
| Activity-log insert failure blocks user's write | Med | Helper is `try/catch` wrapped, never throws |
| Lock acquired but never released (process crash) | Low | 5-min TTL + auto-expire on read; force-takeover button always available to owner |

**Rollback plan:** Phase 1 is a single commit per concern (one for migration, one per restored endpoint group, one for instrumentation). To undo, `git revert` the relevant commit + run `migrations/rollback/2026-04-27-notes-restoration.down.sql`. Production data persists; the rollback enum is a superset of the prior enum with a `WHERE` clause to coerce new actions to `'edited'` before shrinking.

---

## 7. Testing strategy

**Unit tests** (`backend/tests/unit/notes/`):
- `logNoteActivity.test.js` — happy path + DB error swallowed
- `diffStatusCells.test.js` — empty trees, identical trees, single change, multiple cells, nested tables
- `expiresAt.test.js` — NULL never expires, future passes, past rejects

**Integration tests** (`backend/tests/integration/notes/`):
- `share-flow.test.js` — list shareable users → share → activity log entry → unshare → activity log entry
- `public-share.test.js` — create → fetch as guest → view_count++ → toggle off → 404 → re-toggle → 200 → set expires_at → wait → 410 GONE
- `lock-flow.test.js` — A locks → B reads (sees lock + force button) → B without force → 409 → B with force → 200, A's lock displaced
- `activity-log.test.js` — every event type triggers correct row; `details` shape verified

**Manual smoke** before Phase 1 ships:
1. Open `/notes` as user A → sidebar counts non-zero
2. Drag a note → release → reload page → position persisted
3. Share a note with user B → user B sees in "Shared" filter; activity log shows `shared` entry
4. Generate public link → open in incognito → counter increments → revoke → 404
5. Open same note in two browser tabs → second tab shows lock badge → click force takeover → first tab shows lock badge

---

## 8. Out of scope (this spec)

- Real-time collaborative editing (CRDT/yjs) — lock is pessimistic only
- Activity log retention/pruning policy — defer until table grows past 1M rows
- Export note (PDF/Markdown) — separate feature
- Notes search relevance tuning — backend already does FULLTEXT, audit didn't flag
- Mobile-specific touch gestures on canvas
- WebSocket/SSE push for activity log live updates — polled on note open is sufficient

---

## 9. Acceptance criteria for Phase 1

- ✅ All 8 missing endpoints return 2xx with the expected payload shape
- ✅ Sidebar filter counts populated on /notes load
- ✅ ShareModal lists users; sharing creates a `shared` activity-log entry visible in the sidebar
- ✅ Activity sidebar shows entries for created, edited, share, pin, archive, color, folder, tag, public-link, status, connection
- ✅ Public link generates, viewer page loads in incognito, counter increments, expires_at honored
- ✅ Edit-lock badge appears in second tab; force-takeover works; 5-min TTL self-clears
- ✅ Drag-to-move bulk position save persists per-user (verified via second user account)
- ✅ All migrations applied successfully on production schema
- ✅ Integration tests passing
- ✅ No regression in existing 191 backend tests

---

## 10. Open follow-ups (not blockers)

- Move `note_activity_log` reads behind a permissions check (currently anyone with note read access sees full log — fine for now since it's their own activity, but with sharing, a viewer can see the owner's color changes etc. Acceptable per Q5 answer)
- Consider compressing `details` JSON for large `tag_changed` / `status_changed` payloads
- Background job to prune `note_public_shares` rows where `expires_at < NOW() - 30d` (cleanup, not urgent)
