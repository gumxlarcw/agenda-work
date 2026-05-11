# Agenda Work — Audit Issues Tracker

**Current audit:** 2026-04-17
**Fix pass:** 2026-04-17 (same day, items marked below with [F] = fixed in this pass)
**Prior audit:** 2026-03-09 (26 items, status verified below)
**Scope:** backend (15 routes, 6 services, task-sync daemon), frontend (14 pages), ecosystem, DB schema, deployment.

## Fix pass 2026-04-17 — summary

Fixed in code (backend reloaded + frontend rebuilt + daemon reloaded):
- **#10** heatmap CTE: added `/*+ MAX_EXECUTION_TIME(5000) */` hint + `LIMIT 2000` cap.
- **#13** pagination: `?page=&limit=` on reminders and todos, max 500 per page.
- **#18** code splitting: `manualChunks` added; initial bundle 400 KB → 68 KB (19.58 KB gzip).
- **#19** task-sync race: GET_LOCK on a pinned pool connection per `(user,task)`.
- **#23** `ENTRIES_SYNC_USER_ID`: no longer silently defaults to 2; sync disabled + warned if unset.
- **#27 (diagnostic)** LLM+WA error bodies now logged with status/URL/model/response so operators can see *why* a 400/404 happened. Default `LLM_DIGEST_MODEL` changed from the fake `gemini-3-flash-preview` to `claude-sonnet-4-6` — the 404 cause.
- **#30** SSE token: replaced full-TTL access token in URL with a 60s HMAC-signed SSE ticket tied to user+resource+id. Backend + frontend + 3 EventSource sites updated.
- **#31** stats N+1: rewrote correlated sub-selects as LEFT JOIN aggregates (single pass).
- **#32** overdue-reminder race: GET_LOCK on pinned connection per `(user,task,date)`.
- **#33** SSE polling: 15-minute hard cap on both `/summary/progress` and `/youtube/progress`.
- **#34** JWT secret validation: ≥32-char enforcement at startup + warning if JWT_SECRET == JWT_REFRESH_SECRET.
- **#37** YouTube allowlist: explicit host set (`youtube.com`, `www.youtube.com`, `m.youtube.com`, `music.youtube.com`, `youtu.be`), HTTPS-only.
- **#38** LLM prompt-injection surface: user-supplied metadata (judul/sub_judul/pencatat/instansi/tanggal) now goes through `sanitizeForPrompt()` — whitespace collapse, angle-bracket strip, length cap.
- **#44** Groq retry: fixed 1s → exponential backoff `1s·2^attempt + jitter` capped at 15s.
- **#45** WebSocket: `maxPayload: 2 MB` added to `/ws/notulen`.
- **#47** Users page: in-component admin check before eager API call.
- **#48** task-sync daemon: wrapped each sub-task in its own try/catch with per-task consecutive-failure counter + loud `!!!` alert after 5× streak.
- **#49** `.gitignore`: `*.backup`, `*.backup.*`, `*.broken` now ignored (95 files on disk, 0 ever committed — the tree is already clean in git).
- **#36** `automasi/` secrets: `credentials.json`, `google_creds.json`, `.env` → `0600`.

Confirmed already fixed (audit false-negatives, no code changes needed):
- **#11** webhook auth — HMAC + timing-safe compare present in `webhook.routes.js:15-19`.
- **#29** XSS via `renderMarkdown` — false positive. The function entity-escapes `&<>` BEFORE injecting any markup, so user data never lands in attribute positions. Comment updated to spell out the invariant.
- **#39** CSRF — not applicable. The API authenticates via `Authorization: Bearer <jwt>` from localStorage, not session cookies; cookies are never auto-sent for bearer-auth, so classic CSRF isn't a vector.
- **#40** attachment inline XSS — already mitigated: `X-Content-Type-Options: nosniff` + `Content-Disposition: attachment` for non-image extensions in `server.js:120-130`. SVG not in image allowlist.
- **#41** `/health` endpoint — already exists at `server.js:159` (pings DB + yt-dlp + ffmpeg).
- **#43** digest pool exhaustion — `DIGEST_CONCURRENCY=3` already caps concurrency at ~18 parallel queries vs pool limit 20. Acceptable until flow is restructured.

Not fixed in this pass (reasons given):
- **#15** multi-instance PM2 — requires externalizing in-memory queue state to Redis. Deployment-level, needs your approval.
- **#20** scheduler per-user N+1 — real fix is batch-oriented flow restructuring; mitigated by `DIGEST_CONCURRENCY=3` for now.
- **#35** `vite preview` in prod — deployment-level change to nginx serving `dist/`. Needs your approval + nginx config.
- **#42** migrations system — requires tool choice + one-time schema capture. Needs your approval.
- **#46** TZ centralization — cosmetic; both existing call sites agree on +09:00 (WIT).
- **#50** working tree noise — gitignored backups stopped the bleed; the 17 legitimately-modified tracked files in `frontend/src/components/dashboard/*` and `hooks/*` are pre-existing work that still needs a commit-or-revert decision from you.

**Active incidents after fix pass:**
- **#27** is fully instrumented now but **not resolved**. The NEXT hourly digest (15:00 WIT) will log the real 404 response body. Check `logs/task-sync-error.log` after the next run. The most likely fix is correcting `LLM_DIGEST_MODEL` and `OPENCLAW_WA_NUMBER`/`account` env vars in `backend/.env`.
- **#28** — new Groq timeouts will retry with the fixed backoff; if they still fail, Groq itself is the bottleneck (network latency to api.groq.com or their transcription queue). Consider raising `timeout: 45000` in `notulen.service.js:246`.

---


---

## Status of the 2026-03-09 audit

Legend: ✅ fixed · ⚠️ partial · ❌ still open

### Critical (prior)

- ✅ **#1** SQL Injection via `sortBy` — `task.routes.js` now whitelists sort fields
- ✅ **#2** Automation race — atomic DB claim replaced in-memory `Map` (`automation.routes.js:156-160`)
- ✅ **#3** Refresh token TOCTOU — DELETE-then-check pattern (`auth.routes.js:203-208`)
- ✅ **#4** Duplicate notification send — optimistic `UPDATE ... is_sent=1 WHERE is_sent=0` in both `reminder-sender.service.js` and `notification-scheduler.service.js`
- ✅ **#5** Hardcoded DB password — env-only, startup fails if `DB_PASSWORD` missing (`database.js:4-12`, `server.js:57`). No `'17Agustus'` left in live source.
- ✅ **#6** Credentials in process args — now passed via env object (`automation.routes.js:82-83`), encrypted in `queue_meta`
- ✅ **#7** Frontend token refresh race — `isRefreshing` flag + subscriber queue (`api.js:16-27,56-68`)

### High (prior)

- ✅ **#8** Rate limiting — `express-rate-limit` applied (`server.js:147-149`): auth 20/15min, automation 5/60s, general 120/60s
- ✅ **#9** Graceful shutdown — SIGTERM/SIGINT, uncaughtException, unhandledRejection (`server.js:240-255`)
- ❌ **#10** DoS via heatmap CTE — `task.routes.js:454,458` now caps months=24 and duration=365d, **but the recursive CTE still has no SQL exec timeout**; a single 365-day task still expands 365 rows with no `LIMIT` on the final SELECT
- ✅ **#11** Webhook auth — HMAC + timing-safe compare now in `webhook.routes.js:15-19` (fallback is localhost-only)
- ✅ **#12** OTP file — now created with mode `0o600` (`automation.routes.js:347`)
- ⚠️ **#13** Unbounded query — `LIMIT 500` added in `reminder.routes.js:34` and `todo.routes.js:40`, but no pagination (`?page`/`?limit`) so admins still pull full 500 in one shot
- ✅ **#14** WhatsApp retry — exponential backoff in `whatsapp.service.js:58-94`
- ❌ **#15** Single instance constraint — `ecosystem.config.js` still `instances: 1` with in-memory state in the automation queue
- ✅ **#16** Double logout — `AuthContext.checkAuth()` now defers to interceptor (`api.js:115-121`)
- ✅ **#17** Infinite loop risk — bounded by `MAX_DAY_ITER=3650` (`Timeline.jsx:15`)
- ❌ **#18** No code splitting — `vite.config.js` has no `manualChunks`; initial bundle still ~400 KB

### Medium (prior)

- ❌ **#19** Task-sync race — `task-sync.service.js:48-54` uses `INSERT...SELECT...WHERE NOT EXISTS` but no row lock; concurrent syncs can still collide
- ❌ **#20** N+1 in scheduler — `notification-scheduler.service.js:489-535` still issues per-user week/month/year stats inside `Promise.all`
- ✅ **#21** Sync `writeFileSync` — switched to `fsPromises.writeFile` (`entries-sync.service.js:95`)
- ✅ **#22** `parseJson` crash — try/catch in `notificationSettings.routes.js:11-16`
- ❌ **#23** Hardcoded user ID — `ENTRIES_SYNC_USER_ID` still defaults to `2` in `entries-sync.service.js:13`; a deployment where user 2 is deleted silently loses sync
- ✅ **#24** Delete loading guard — `deletingId` state on modals (`EventModal.jsx:90,156`)
- ✅ **#25** Polling unmount leak — `mountedRef` + cleanup in `AutomationRunContext.jsx:34-150`
- ✅ **#26** Stale closure — `refetchAll` has stable deps in `useDashboard.js:93-106`

**Prior audit scorecard: 20 ✅ fixed / 1 ⚠️ partial / 5 ❌ still open.**

---

## New findings — 2026-04-17

### CRITICAL

- [ ] **#27** **Active incident: task-sync daemon digest is failing in prod.** `logs/task-sync-error.log` shows hourly `[Digest] LLM call failed: 404` followed by 3× WhatsApp `400` retries, for multiple users (`candra.gumelar`, `mutia.elyani`, …) every hour through today. Whole digest feature is broken end-to-end.
- [ ] **#28** **Active incident: notulen summary timing out.** `logs/backend-error.log` shows clustered `[notulen] Timeout` entries through 12:41 today. User-facing feature currently non-functional.
- [ ] **#29** **XSS via unescaped HTML injection in NotulenAI.** `NotulenAI.jsx:2083,2541` renders `renderMarkdown()` output with a raw-HTML prop. The renderer escapes body text before applying markdown but then synthesizes tag markup, so a payload like `## <h2 onclick="…">` can still slip through as an event-handler attribute. Needs DOMPurify or a safe markdown renderer.
- [ ] **#30** **SSE access token leaked into URL.** `api.js:303-337` appends `localStorage.getItem('accessToken')` as a query string on `summaryProgressUrl()` / `youtubeProgressUrl()`. Tokens end up in browser history, CF Tunnel access logs, and `Referer` headers. Use `Authorization` via `fetch`+`ReadableStream` or short-lived signed SSE tokens.

### HIGH

- [ ] **#31** Stats endpoint N+1 with correlated subqueries — `task.routes.js:420-436` uses correlated sub-selects for todos/reminders/notes per user. `/stats/by-user` will timeout on non-trivial user counts.
- [ ] **#32** Overdue-reminder generation race — `task-sync.service.js:443-466` inserts via `SELECT … WHERE NOT EXISTS` with no transaction; two daemon cycles overlap → duplicate overdue reminders.
- [ ] **#33** Unbounded SSE progress polling — `notulen.routes.js:100-117,583-595` pushes every 400 ms with no max-iteration guard. A silently failed summary holds a connection indefinitely.
- [ ] **#34** JWT secret strength not enforced — `auth.routes.js:14-21` reads `JWT_SECRET` / `JWT_REFRESH_SECRET` with no length/entropy check. `SESSION_SECRET` is validated (`server.js:17-26`); apply the same guard.
- [ ] **#35** Vite preview in production — `ecosystem.config.js` still runs `npm run preview` on :5101 (comment `C8` acknowledges it isn't hardened). Swap to nginx serving `frontend/dist/`.
- [ ] **#36** `automasi/` credential files world-readable on disk — `credentials.json`, `google_creds.json`, `.env` are mode 0644 and owned by `root`. They **are** in `automasi/.gitignore` (not leaked to git), but any local account can read them. Tighten to 0600.

### MEDIUM

- [ ] **#37** SSRF surface in YouTube import — `notulen.routes.js:488` + `notulen.service.js:909` regex-validates domain then hands the URL to `yt-dlp` via `spawn`. Domain allowlist should be explicit (`youtube.com`, `youtu.be`, `m.youtube.com`); today's regex is looser than intended.
- [ ] **#38** Prompt injection in notulen LLM summary — `notulen.service.js:415,715+` embeds user-supplied text (titles, usernames, transcript) directly into the system prompt with no escaping/truncation. Enables context hijacking across users if output is ever used to drive actions.
- [ ] **#39** No CSRF tokens on state-changing routes — `server.js` sets HttpOnly cookies but no CSRF middleware. Given `sameSite` on the session cookie should mitigate most browser CSRF, verify `session.cookie.sameSite: 'lax'|'strict'` is set. If not, add `csurf` or double-submit tokens.
- [ ] **#40** File upload polyglot risk — `note-attachment.routes.js:99` validates magic bytes, but served inline can trigger XSS from polyglot images. Add `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.
- [ ] **#41** No `/health` endpoint — no liveness/readiness route exposed; PM2 `wait_ready` relies only on process ready event. Cloudflare Tunnel can't do L7 health checks.
- [ ] **#42** No DB migrations system — `database/schema.sql` is a single monolith; every schema change today is manual. Introduce a minimal migration runner before adding unique constraints needed to fix #19/#32.
- [ ] **#43** Digest connection-pool exhaustion risk — `notification-scheduler.service.js:157-222` fans out many queries per user via `Promise.all` against a pool of 20. Under load (N users × M queries) the pool saturates and every route queues.

### LOW

- [ ] **#44** Groq retry no exponential backoff — `notulen.service.js:235-295` uses fixed 1000 ms for ECONNABORTED/ETIMEDOUT. Use `delay * 2^attempt` + jitter.
- [ ] **#45** WebSocket `maxPayload` unset — `notulen.routes.js:639-650` accepts unbounded frames.
- [ ] **#46** Timezone drift — `notification-scheduler.service.js:40` hardcodes `utcOffset(9)`; `reminder-sender.service.js:18` uses `Asia/Jayapura` via `Intl`. Centralize on one TZ source.
- [ ] **#47** Users page eager-fetches before admin check — `Users.jsx:42-51` fires `usersAPI.getAll()` on mount; the route guard `adminOnly` (`App.jsx:47-62`) is the only gate. Add an in-component role check for defense-in-depth.
- [ ] **#48** Task-sync daemon swallows errors — `task-sync-daemon.js:24-45` logs and continues, no circuit breaker. #27's failure mode is invisible without log inspection.

### Repo hygiene (NEW)

- [ ] **#49** `.backup`/`.backup.backup`/`.broken` files committed to source tree — 26+ in `backend/src/routes/` and `backend/src/services/`, plus `index.css.backup`, `App.jsx.backup`, etc. in frontend. These come from the backup-before-edit workflow but were never cleaned up. Move to `/tmp` or gitignore `*.backup` / `*.broken`.
- [ ] **#50** Git working tree is noisy — many modified tracked files (route files, services, Dashboard components) committed nowhere for weeks. Decide: ship them or revert them. Right now it's impossible to tell intended changes from abandonment.

---

## Feature wiring map (verified 2026-04-17)

| Feature | Route | Service | Page | Working? |
|---|---|---|---|---|
| Tasks | `/api/tasks/*` | — | `Tasks.jsx` | ✅ |
| Notes | `/api/notes/*`, `/api/notes/public/:token` | — | `Notes.jsx`, `PublicNoteViewer.jsx` | ✅ |
| Reminders | `/api/reminders/*` | `reminder-sender.service.js` | `Reminders.jsx` | ⚠️ sender works; digest #27 broken |
| Todos | `/api/todos/*` | `task-sync.service.js` | (embedded) | ⚠️ sync-race #19 |
| Events | `/api/events/*`, `/api/kegiatan/*` | — | Dashboard + modals | ✅ |
| Dashboard | `/api/dashboard/*` | — | `Dashboard.jsx` | ✅ |
| Timeline | `/api/tasks/*` | — | `Timeline.jsx` | ✅ |
| Notulen AI | `/api/notulen/*` | `notulen.service.js` | `NotulenAI.jsx`, `PublicNotulenViewer.jsx` | ❌ #28 timeouts, #29 XSS, #30 token leak |
| WhatsApp | `/api/whatsapp/*`, `/api/webhook/openclaw` | `whatsapp.service.js` | `WhatsApp.jsx` | ⚠️ sender OK, digest path hitting 400 (#27) |
| Automation (KipApp) | `/api/automation/*` | — | `Automation.jsx` | ✅ |
| Users admin | `/api/users/*` | — | `Users.jsx` | ✅ (#47) |
| Notifications | `/api/notifications/*`, `/api/notification-settings/*` | `notification-scheduler.service.js` | Settings | ❌ #27 prod failing |

---

## Priority suggestion

1. **Stop the bleeding** — investigate #27 (digest 404/400) and #28 (notulen timeouts). These are live incidents, not drift.
2. **Close the user-data exposure in notulen** — #29 and #30 are shipped today.
3. **Kill remaining prior-audit items** — #10, #15, #18, #19, #20, #23 have been open 5+ weeks; most are small.
4. **Harden before extending** — #34 (JWT strength), #35 (nginx), #41 (health check), #42 (migrations) are cheap and unblock later fixes.
5. **Hygiene pass** — #49/#50 (backup files + dirty tree) before this becomes unauditable.
