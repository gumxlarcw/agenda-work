# Notulen AI — Bug Fixes & Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 9 identified bugs and UX gaps across the Notulen AI feature — covering silent data loss, bad transcripts, broken sharing, missing form fields, frozen progress bars, and missing API endpoints.

**Architecture:** All fixes are additive or surgical edits to three files: the service layer (`notulen.service.js`), the route layer (`notulen.routes.js`), and the single-file frontend (`NotulenAI.jsx`). No schema changes required. Backend tasks are grouped first so the new API surface is stable before frontend calls it.

**Tech Stack:** Node.js/Express backend, React + Tailwind frontend, Groq Whisper API, MySQL, SSE (EventSource), WebSocket.

---

## Files Modified

| File | Changes |
|---|---|
| `backend/src/services/notulen.service.js` | Fix silent chunk skip; expand hallucination list; remove dead variable |
| `backend/src/routes/notulen.routes.js` | Add `PATCH /bulk-archive` endpoint; add `DELETE /youtube/jobs/:jobId` cancel endpoint |
| `frontend/src/services/api.js` | Add `bulkArchive` (update), `cancelYoutubeJob` methods |
| `frontend/src/pages/NotulenAI.jsx` | Add `instansi` to YouTubeView; fix upload progress; fix share URL; add SSE retry; add bulk archive UI |

---

## Task 1: Expand hallucination filter + remove dead variable

**Files:**
- Modify: `backend/src/services/notulen.service.js:142-192` (HALLUCINATION_PHRASES + mergeShortSegments)

These are two tiny independent edits in the same function area — batched into one commit.

- [ ] **Step 1: Backup the file**

```bash
cp backend/src/services/notulen.service.js backend/src/services/notulen.service.js.backup
```

- [ ] **Step 2: Expand `HALLUCINATION_PHRASES` array**

In `notulen.service.js`, replace lines 142–146:

```js
// OLD:
const HALLUCINATION_PHRASES = [
  'terima kasih kerana menonton', 'terima kasih telah menonton',
  'subscribe', 'like and subscribe', 'thank you for watching',
  'thanks for watching', 'jangan lupa subscribe', 'terima kasih.',
];
```

```js
// NEW:
const HALLUCINATION_PHRASES = [
  // Indonesian YouTube closings
  'terima kasih kerana menonton', 'terima kasih telah menonton',
  'jangan lupa subscribe', 'jangan lupa like dan subscribe',
  'like dan subscribe', 'subscribe sekarang',
  // English YouTube closings
  'subscribe', 'like and subscribe', 'thank you for watching',
  'thanks for watching', 'see you in the next video',
  'see you next time', 'don\'t forget to subscribe',
  'hit the like button', 'like, comment, and subscribe',
  // Short noise
  'terima kasih.', 'thank you.', 'bye.', 'bye bye.',
  'oke.', 'oke terima kasih.',
  // Whisper filler/ambient tags
  '[music]', '[musik]', '[applause]', '[tepuk tangan]',
  '[laughter]', '[tawa]', '[noise]', '[kebisingan]',
  '[silence]', '[inaudible]', '[tidak terdengar]',
  '...', '. . .', '…',
];
```

- [ ] **Step 3: Remove dead `wordCount` variable in `mergeShortSegments`**

In `notulen.service.js`, find the `mergeShortSegments` function (around line 311). Replace the loop body opening:

```js
// OLD — line ~317:
  for (const seg of segments) {
    const wordCount = seg.text.split(/\s+/).length;

    if (!acc) {
```

```js
// NEW — remove the unused wordCount line:
  for (const seg of segments) {
    if (!acc) {
```

- [ ] **Step 4: Verify with diff**

```bash
diff backend/src/services/notulen.service.js.backup backend/src/services/notulen.service.js
```

Expected output: shows expanded HALLUCINATION_PHRASES array and removal of `const wordCount = ...` line. No other changes.

- [ ] **Step 5: Smoke test — node syntax check**

```bash
node --check backend/src/services/notulen.service.js && echo "OK"
```

Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/notulen.service.js
git commit -m "fix(notulen): expand hallucination phrases + remove dead wordCount variable"
```

---

## Task 2: Fix silent chunk skip in `splitAndTranscribe`

**Files:**
- Modify: `backend/src/services/notulen.service.js` (inside `splitAndTranscribe`, around line 1050–1065)

Currently when a chunk exhausts all 6 retries, it just logs a warning and pushes empty results. The user has no idea part of their audio was skipped.

- [ ] **Step 1: Backup**

```bash
cp backend/src/services/notulen.service.js backend/src/services/notulen.service.js.backup
```

- [ ] **Step 2: Track skipped chunks and throw if majority failed**

In `splitAndTranscribe`, find the section just after the inner retry loop (around line 1054–1065). Replace:

```js
// OLD:
            } else {
                console.warn(`[notulen-yt] Skipping chunk ${i + 1} after ${MAX_CHUNK_RETRIES} attempts`);
            }
```

```js
// NEW:
            } else {
                console.warn(`[notulen-yt] Skipping chunk ${i + 1} after ${MAX_CHUNK_RETRIES} attempts`);
                skippedChunks++;
            }
```

Then find the variable declarations just before the `for` loop over `chunkFiles` (around line 968). Add a `skippedChunks` counter:

```js
// OLD (line ~968):
    const allSegments = [];
    let timeOffset = 0;
```

```js
// NEW:
    const allSegments = [];
    let timeOffset = 0;
    let skippedChunks = 0;
```

Then at the very end of `splitAndTranscribe`, just before `return allSegments;` (around line 1067), add the threshold check:

```js
// OLD:
    return allSegments;
}
```

```js
// NEW:
    if (skippedChunks > 0) {
        const skippedMin = Math.round(skippedChunks * CHUNK_DURATION_SEC / 60);
        const skippedPct = Math.round((skippedChunks / chunkFiles.length) * 100);
        if (skippedChunks >= Math.ceil(chunkFiles.length / 2)) {
            throw new Error(
                `Transkripsi gagal: ${skippedChunks} dari ${chunkFiles.length} bagian audio tidak dapat diproses ` +
                `(±${skippedMin} menit hilang). Periksa koneksi Groq API atau coba lagi.`
            );
        }
        // Partial skip — warn but continue (results are still useful)
        console.warn(`[notulen-yt] ${skippedChunks}/${chunkFiles.length} chunks skipped (${skippedPct}%, ±${skippedMin} min lost)`);
        onProgress(
            transcribeRange[1] - 1,
            `Peringatan: ${skippedChunks} bagian audio dilewati (${skippedPct}%) — hasil mungkin tidak lengkap`
        );
    }

    return allSegments;
}
```

- [ ] **Step 3: Verify diff**

```bash
diff backend/src/services/notulen.service.js.backup backend/src/services/notulen.service.js
```

Expected: shows `skippedChunks` variable + threshold check. Nothing else changed.

- [ ] **Step 4: Syntax check**

```bash
node --check backend/src/services/notulen.service.js && echo "OK"
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/notulen.service.js
git commit -m "fix(notulen): report skipped chunks in splitAndTranscribe, throw if majority fail"
```

---

## Task 3: Add `PATCH /notulen/bulk-archive` endpoint

**Files:**
- Modify: `backend/src/routes/notulen.routes.js` (add route near the existing `DELETE /bulk`)

The frontend currently makes N individual `PATCH /:id` calls to archive N sessions. This adds one batch endpoint to match the existing `DELETE /bulk` pattern.

- [ ] **Step 1: Backup**

```bash
cp backend/src/routes/notulen.routes.js backend/src/routes/notulen.routes.js.backup
```

- [ ] **Step 2: Add the bulk-archive route**

In `notulen.routes.js`, find the existing `DELETE /bulk` route (around line 378):

```js
// Find this block:
// Bulk delete sessions
router.delete('/bulk', verifyToken, async (req, res) => {
```

Add the new route **immediately before** it:

```js
// Bulk archive sessions
router.patch('/bulk-archive', verifyToken, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0)
      return res.status(400).json({ success: false, message: 'IDs required' });
    const isAdmin = req.user.role === 'admin';
    const placeholders = ids.map(() => '?').join(',');
    const where = isAdmin
      ? `id IN (${placeholders})`
      : `id IN (${placeholders}) AND user_id = ?`;
    const params = isAdmin ? [...ids] : [...ids, req.user.id];
    const [result] = await pool.query(
      `UPDATE notulen_sessions SET status = 'archived' WHERE ${where}`,
      params
    );
    res.json({ success: true, message: `${result.affectedRows} sesi diarsipkan` });
  } catch (err) {
    console.error('[notulen] Bulk archive error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to bulk archive' });
  }
});

```

- [ ] **Step 3: Verify diff**

```bash
diff backend/src/routes/notulen.routes.js.backup backend/src/routes/notulen.routes.js
```

Expected: only the new `router.patch('/bulk-archive', ...)` block added.

- [ ] **Step 4: Syntax check**

```bash
node --check backend/src/routes/notulen.routes.js && echo "OK"
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/notulen.routes.js
git commit -m "feat(notulen): add PATCH /bulk-archive endpoint for batch session archiving"
```

---

## Task 4: Add `DELETE /notulen/youtube/jobs/:jobId` cancel endpoint

**Files:**
- Modify: `backend/src/routes/notulen.routes.js`
- Modify: `backend/src/services/notulen.service.js` (add `cancelYoutubeJob` / PID tracking)

The yt-dlp process spawned by `importYoutubeAudio` has no way to be stopped from the outside. This adds PID tracking and a cancel endpoint.

- [ ] **Step 1: Backup both files**

```bash
cp backend/src/services/notulen.service.js backend/src/services/notulen.service.js.backup
cp backend/src/routes/notulen.routes.js backend/src/routes/notulen.routes.js.backup
```

- [ ] **Step 2: Add job PID tracking to `notulen.service.js`**

In `notulen.service.js`, near the top (after the `YT_TMP_DIR` declaration, around line 27), add a job PID registry:

```js
// Job registry: jobId → child process (for cancellation)
const ytJobPids = new Map();

function registerYtJob(jobId, proc) { ytJobPids.set(jobId, proc); }
function cancelYoutubeJob(jobId) {
    const proc = ytJobPids.get(jobId);
    if (!proc) return false;
    try { proc.kill('SIGTERM'); } catch (_) {}
    ytJobPids.delete(jobId);
    return true;
}
```

- [ ] **Step 3: Register the process inside `spawnYtdlpWithProgress`**

In `notulen.service.js`, inside `spawnYtdlpWithProgress`, find the line where `proc` is created (around line 42):

```js
// OLD:
        const proc = spawn(YTDLP_BIN, ['--progress', '--newline', '--no-colors', ...args], {
            detached: true,
            stdio: ['ignore', logFd, logFd],
        });
        fs.closeSync(logFd);
```

```js
// NEW — add the third argument to receive jobId from callers:
// (Note: spawnYtdlpWithProgress signature gets a new optional 4th param)
```

Actually, the cleanest approach is to register the PID in `importYoutubeAudio` since that's where the jobId is known. Change `spawnYtdlpWithProgress` to return the proc so the caller can register it.

Replace the `return new Promise(...)` line inside `spawnYtdlpWithProgress` with:

```js
// Replace: return new Promise((resolve, reject) => {
// With: the same promise but expose proc via the returned promise's _proc property
function spawnYtdlpWithProgress(args, onProgress, downloadRange = [0, 100], convertRange = null) {
    // ... existing code unchanged up to proc creation ...
    const promise = new Promise((resolve, reject) => {
        // ... (all existing code unchanged inside here) ...
    });
    return promise;
}
```

The simplest change is: after `fs.closeSync(logFd);`, add:

```js
        // Expose process so caller can register for cancellation
        promise._proc = proc;
```

But Promises don't work that way cleanly. **Simpler approach**: pass `jobId` into the function and register inside:

In `spawnYtdlpWithProgress`, add `jobId = null` as the 5th parameter:

```js
// OLD signature:
function spawnYtdlpWithProgress(args, onProgress, downloadRange = [0, 100], convertRange = null) {
```

```js
// NEW signature:
function spawnYtdlpWithProgress(args, onProgress, downloadRange = [0, 100], convertRange = null, jobId = null) {
```

And immediately after `fs.closeSync(logFd);`:

```js
        fs.closeSync(logFd);
        if (jobId) registerYtJob(jobId, proc);
```

And in the `cleanup` function inside `spawnYtdlpWithProgress`, add cleanup:

```js
        const cleanup = () => {
            done = true;
            clearInterval(poll);
            if (convertTimer) clearInterval(convertTimer);
            if (jobId) ytJobPids.delete(jobId); // de-register when done
        };
```

- [ ] **Step 4: Pass `jobId` from `importYoutubeAudio`**

In `notulen.service.js`, inside `importYoutubeAudio` (around line 1079), update the `spawnYtdlpWithProgress` call to pass `jobId`:

```js
// OLD:
    await spawnYtdlpWithProgress([
        ...YTDLP_BASE,
        '-f', 'bestaudio/best',
        '-x',
        '--audio-format', 'mp3',
        '--audio-quality', '5',
        '--newline',
        '-o', audioPath,
        url,
    ], onProgress, [5, 20], [20, 35]);
```

```js
// NEW:
    await spawnYtdlpWithProgress([
        ...YTDLP_BASE,
        '-f', 'bestaudio/best',
        '-x',
        '--audio-format', 'mp3',
        '--audio-quality', '5',
        '--newline',
        '-o', audioPath,
        url,
    ], onProgress, [5, 20], [20, 35], jobId);
```

- [ ] **Step 5: Export `cancelYoutubeJob` from service**

In `notulen.service.js`, find the `module.exports` block at the bottom. Add:

```js
  cancelYoutubeJob,
```

- [ ] **Step 6: Add the cancel route to `notulen.routes.js`**

In `notulen.routes.js`, find the SSE YouTube progress route (around line 518). Add this **immediately before** it:

```js
// Cancel YouTube import job
router.delete('/youtube/jobs/:jobId', verifyToken, (req, res) => {
    const { jobId } = req.params;
    const killed = notulenService.cancelYoutubeJob(jobId);
    if (!killed) {
        return res.status(404).json({ success: false, message: 'Job tidak ditemukan atau sudah selesai' });
    }
    // Mark progress as cancelled so SSE clients get final state
    youtubeProgress.set(jobId, { percent: 0, step: 'Import dibatalkan', error: true, done: true });
    setTimeout(() => youtubeProgress.delete(jobId), 15000);
    res.json({ success: true, message: 'Import dibatalkan' });
});

```

- [ ] **Step 7: Verify diff and syntax**

```bash
diff backend/src/services/notulen.service.js.backup backend/src/services/notulen.service.js
diff backend/src/routes/notulen.routes.js.backup backend/src/routes/notulen.routes.js
node --check backend/src/services/notulen.service.js && echo "service OK"
node --check backend/src/routes/notulen.routes.js && echo "routes OK"
```

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/notulen.service.js backend/src/routes/notulen.routes.js
git commit -m "feat(notulen): add YouTube job cancellation endpoint + PID tracking"
```

---

## Task 5: Update `api.js` — add `bulkArchive` and `cancelYoutubeJob`

**Files:**
- Modify: `frontend/src/services/api.js`

- [ ] **Step 1: Backup**

```bash
cp frontend/src/services/api.js frontend/src/services/api.js.backup
```

- [ ] **Step 2: Update `notulenAPI` object**

In `api.js`, find the `notulenAPI` object (around line 293). Add two new methods:

After `bulkDelete`:
```js
// OLD (line ~298):
  bulkDelete: (ids) => api.delete('/notulen/bulk', { data: { ids } }),
```

```js
// NEW:
  bulkDelete: (ids) => api.delete('/notulen/bulk', { data: { ids } }),
  bulkArchive: (ids) => api.patch('/notulen/bulk-archive', { ids }),
  cancelYoutubeJob: (jobId) => api.delete(`/notulen/youtube/jobs/${jobId}`),
```

- [ ] **Step 3: Verify diff**

```bash
diff frontend/src/services/api.js.backup frontend/src/services/api.js
```

Expected: only `bulkArchive` and `cancelYoutubeJob` lines added.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/api.js
git commit -m "feat(notulen): add bulkArchive and cancelYoutubeJob to notulenAPI"
```

---

## Task 6: Fix share URL hardcoded domain

**Files:**
- Modify: `frontend/src/pages/NotulenAI.jsx:2133`

One-line fix. The share URL uses a hardcoded `https://agenda.bpsmalut.com` — wrong in dev/staging.

- [ ] **Step 1: Backup**

```bash
cp frontend/src/pages/NotulenAI.jsx frontend/src/pages/NotulenAI.jsx.backup
```

- [ ] **Step 2: Fix the hardcoded URL**

In `NotulenAI.jsx`, find line 2133 inside `generateShareLink`:

```js
// OLD:
      const url = `https://agenda.bpsmalut.com/notulen/shared/${token}`;
```

```js
// NEW:
      const url = `${window.location.origin}/notulen/shared/${token}`;
```

- [ ] **Step 3: Verify diff**

```bash
diff frontend/src/pages/NotulenAI.jsx.backup frontend/src/pages/NotulenAI.jsx
```

Expected: exactly one line changed.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/NotulenAI.jsx
git commit -m "fix(notulen): use window.location.origin for share URL instead of hardcoded domain"
```

---

## Task 7: Add `instansi` field to `YouTubeView`

**Files:**
- Modify: `frontend/src/pages/NotulenAI.jsx` (inside `YouTubeView` component, around lines 710–866)

`ImportTranscriptView` already has this field. `YouTubeView` has the state variable `instansi` but no form input — users are silently stuck with the default value.

- [ ] **Step 1: Add the `instansi` input field in `YouTubeView`**

In `NotulenAI.jsx`, inside `YouTubeView`'s `return`, find the grid with Pencatat and Tanggal fields (around line 834–842):

```jsx
// OLD:
          <div>
            <label className="form-label">Pencatat</label>
            <input value={pencatat} onChange={e => setPencatat(e.target.value)} className="form-input" disabled={submitting} />
          </div>
          <div>
            <label className="form-label">Tanggal</label>
            <input type="date" value={tanggal} onChange={e => setTanggal(e.target.value)} className="form-input" disabled={submitting} />
          </div>
```

```jsx
// NEW — add instansi field between pencatat and tanggal:
          <div>
            <label className="form-label">Pencatat</label>
            <input value={pencatat} onChange={e => setPencatat(e.target.value)} className="form-input" disabled={submitting} />
          </div>
          <div>
            <label className="form-label">Instansi</label>
            <input value={instansi} onChange={e => setInstansi(e.target.value)} className="form-input" disabled={submitting} />
          </div>
          <div>
            <label className="form-label">Tanggal</label>
            <input type="date" value={tanggal} onChange={e => setTanggal(e.target.value)} className="form-input" disabled={submitting} />
          </div>
```

The `instansi` state variable already exists at line 716: `const [instansi, setInstansi] = useState('BPS Provinsi Maluku Utara');` — no new state needed.

- [ ] **Step 2: Verify diff**

```bash
diff frontend/src/pages/NotulenAI.jsx.backup frontend/src/pages/NotulenAI.jsx
```

Expected: only the new `instansi` input block added.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/NotulenAI.jsx
git commit -m "fix(notulen): add missing instansi field to YouTubeView form"
```

---

## Task 8: Fix upload progress UX (frozen at 50%)

**Files:**
- Modify: `frontend/src/pages/NotulenAI.jsx` (inside `UploadView`, around lines 1073–1140)

Currently: 0–50% during HTTP upload, then **frozen** at 50% for ~30s during Groq transcription, then jumps to 100%.

Fix: animate from 50% toward 95% (simulated) during the Groq phase, so the bar keeps moving.

- [ ] **Step 1: Add simulated progress during Groq phase**

In `NotulenAI.jsx`, inside `UploadView`, replace `handleUpload`:

```js
// OLD (lines ~1060–1091):
  async function handleUpload() {
    if (!judul.trim()) { toast.error('Isi judul'); return; }
    if (!file) { toast.error('Pilih file audio'); return; }
    if (file.size > 25 * 1024 * 1024) { toast.error(`File terlalu besar (${(file.size / 1024 / 1024).toFixed(1)}MB). Maks 25MB.`); return; }

    const formData = new FormData();
    formData.append('audio', file);
    formData.append('judul', judul);
    if (subJudul) formData.append('sub_judul', subJudul);
    formData.append('pencatat', pencatat);
    formData.append('instansi', instansi);
    formData.append('tanggal', tanggal);

    setUploading(true);
    setProgress(0);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await notulenAPI.uploadAudio(formData, (e) => {
        if (e.total) setProgress(Math.round((e.loaded / e.total) * 50));
      }, controller.signal);
      setProgress(100);
      toast.success(`Berhasil! ${res.data.data.segmentCount} segmen, ${formatDuration(res.data.data.duration)}`);
      setTimeout(() => onDone(res.data.data.sessionId), 500);
    } catch (err) {
      if (err.name === 'CanceledError' || controller.signal.aborted) {
        toast('Upload dibatalkan');
      } else {
        toast.error(err.response?.data?.message || 'Gagal upload');
      }
    } finally { setUploading(false); abortRef.current = null; }
  }
```

```js
// NEW:
  async function handleUpload() {
    if (!judul.trim()) { toast.error('Isi judul'); return; }
    if (!file) { toast.error('Pilih file audio'); return; }
    if (file.size > 25 * 1024 * 1024) { toast.error(`File terlalu besar (${(file.size / 1024 / 1024).toFixed(1)}MB). Maks 25MB.`); return; }

    const formData = new FormData();
    formData.append('audio', file);
    formData.append('judul', judul);
    if (subJudul) formData.append('sub_judul', subJudul);
    formData.append('pencatat', pencatat);
    formData.append('instansi', instansi);
    formData.append('tanggal', tanggal);

    setUploading(true);
    setProgress(0);
    const controller = new AbortController();
    abortRef.current = controller;

    // Simulated transcription progress: after upload finishes (50%),
    // animate bar from 50 → 94 over ~60s so it doesn't look frozen.
    let simTimer = null;
    const startSimProgress = (currentPct) => {
      let pct = currentPct;
      simTimer = setInterval(() => {
        pct = Math.min(94, pct + 1);
        setProgress(pct);
      }, 1500); // +1% every 1.5s → reaches 94% in ~66s
    };

    try {
      const res = await notulenAPI.uploadAudio(formData, (e) => {
        if (e.total) {
          const uploadPct = Math.round((e.loaded / e.total) * 50);
          setProgress(uploadPct);
          // Upload finished (100% upload = 50% overall) → start sim
          if (e.loaded >= e.total && !simTimer) startSimProgress(50);
        }
      }, controller.signal);

      clearInterval(simTimer);
      setProgress(100);
      toast.success(`Berhasil! ${res.data.data.segmentCount} segmen, ${formatDuration(res.data.data.duration)}`);
      setTimeout(() => onDone(res.data.data.sessionId), 500);
    } catch (err) {
      clearInterval(simTimer);
      if (err.name === 'CanceledError' || controller.signal.aborted) {
        toast('Upload dibatalkan');
      } else {
        toast.error(err.response?.data?.message || 'Gagal upload');
      }
    } finally { setUploading(false); abortRef.current = null; }
  }
```

- [ ] **Step 2: Update the progress bar label to show "Mentranskrip" phase**

In `UploadView`'s return JSX, find the uploading label (around line 1149):

```jsx
// OLD:
            {uploading
              ? <><HiOutlineRefresh className="w-5 h-5 animate-spin" /> {progress < 50 ? 'Mengupload...' : 'Mentranskrip...'}</>
```

```jsx
// NEW — add percentage hint when transcribing:
            {uploading
              ? <><HiOutlineRefresh className="w-5 h-5 animate-spin" /> {progress < 50 ? `Mengupload... ${Math.round(progress * 2)}%` : `Mentranskrip... ${progress}%`}</>
```

- [ ] **Step 3: Verify diff**

```bash
diff frontend/src/pages/NotulenAI.jsx.backup frontend/src/pages/NotulenAI.jsx
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/NotulenAI.jsx
git commit -m "fix(notulen): animate upload progress through Groq transcription phase (50→94%)"
```

---

## Task 9: YouTube SSE retry on disconnect + cancel button

**Files:**
- Modify: `frontend/src/pages/NotulenAI.jsx` (inside `YouTubeView`, around lines 725–765)

When the SSE connection drops mid-job (network hiccup), the UI shows an error and sets `submitting = false`. But the backend job is still running! This fix:
1. Retries the SSE up to 4 times before giving up.
2. Adds a **Cancel** button visible while `submitting` is true — calls the new cancel endpoint.

- [ ] **Step 1: Replace `handleSubmit` in `YouTubeView` with SSE retry logic**

In `NotulenAI.jsx`, inside `YouTubeView`, replace the entire `handleSubmit` function (lines ~725–765):

```js
// OLD:
  async function handleSubmit() {
    if (!YOUTUBE_RE.test(url)) { toast.error('URL YouTube tidak valid'); return; }
    if (!judul.trim()) { toast.error('Isi judul terlebih dahulu'); return; }

    setSubmitting(true);
    setProgress(0);
    setProgressStep('Memulai...');
    setError('');

    let es;
    try {
      const res = await notulenAPI.importYoutube({ url, method, judul, sub_judul: subJudul || undefined, pencatat, instansi, tanggal });
      const { jobId } = res.data.data;

      es = new EventSource(notulenAPI.youtubeProgressUrl(jobId));
      es.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          setProgress(d.percent || 0);
          setProgressStep(d.step || '');
          if (d.done && !d.error) {
            es.close();
            toast.success('Import YouTube selesai!');
            onDone(d.sessionId);
          } else if (d.error) {
            es.close();
            setError(d.step || 'Terjadi kesalahan');
            setSubmitting(false);
          }
        } catch {}
      };
      es.onerror = () => {
        es.close();
        setError('Koneksi progress terputus');
        setSubmitting(false);
      };
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal memulai import');
      setSubmitting(false);
    }
  }
```

```js
// NEW:
  const jobIdRef = useRef(null); // store jobId so cancel button can use it

  async function handleSubmit() {
    if (!YOUTUBE_RE.test(url)) { toast.error('URL YouTube tidak valid'); return; }
    if (!judul.trim()) { toast.error('Isi judul terlebih dahulu'); return; }

    setSubmitting(true);
    setProgress(0);
    setProgressStep('Memulai...');
    setError('');
    jobIdRef.current = null;

    let jobId;
    try {
      const res = await notulenAPI.importYoutube({ url, method, judul, sub_judul: subJudul || undefined, pencatat, instansi, tanggal });
      jobId = res.data.data.jobId;
      jobIdRef.current = jobId;
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal memulai import');
      setSubmitting(false);
      return;
    }

    // Connect SSE with up to 4 reconnection attempts on error
    const MAX_SSE_RETRIES = 4;
    let sseAttempt = 0;

    const connectSSE = () => {
      const es = new EventSource(notulenAPI.youtubeProgressUrl(jobId));

      es.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          setProgress(d.percent || 0);
          setProgressStep(d.step || '');
          if (d.done && !d.error) {
            es.close();
            jobIdRef.current = null;
            toast.success('Import YouTube selesai!');
            onDone(d.sessionId);
          } else if (d.error) {
            es.close();
            jobIdRef.current = null;
            setError(d.step || 'Terjadi kesalahan');
            setSubmitting(false);
          }
        } catch {}
      };

      es.onerror = () => {
        es.close();
        sseAttempt++;
        if (sseAttempt < MAX_SSE_RETRIES) {
          // Exponential backoff: 2s, 4s, 8s
          const delay = 2000 * Math.pow(2, sseAttempt - 1);
          setProgressStep(`Koneksi terputus, menyambung ulang (${sseAttempt}/${MAX_SSE_RETRIES})...`);
          setTimeout(connectSSE, delay);
        } else {
          setError(`Koneksi progress terputus setelah ${MAX_SSE_RETRIES} percobaan. Import mungkin masih berjalan di server.`);
          setSubmitting(false);
          jobIdRef.current = null;
        }
      };
    };

    connectSSE();
  }

  async function handleCancel() {
    const jobId = jobIdRef.current;
    if (!jobId) return;
    try {
      await notulenAPI.cancelYoutubeJob(jobId);
      toast('Import dibatalkan');
    } catch { /* ignore — SSE onerror will handle UI update */ }
    jobIdRef.current = null;
    setSubmitting(false);
    setError('');
    setProgress(0);
    setProgressStep('');
  }
```

- [ ] **Step 2: Add Cancel button in `YouTubeView` JSX**

In `NotulenAI.jsx`, inside `YouTubeView`'s return, find the submit button (around line 854):

```jsx
// OLD:
        <button
          onClick={handleSubmit}
          disabled={submitting || !url || !judul.trim()}
          className="w-full btn btn-primary flex items-center justify-center gap-2"
        >
          {submitting
            ? <><HiOutlineRefresh className="w-4 h-4 animate-spin" /> Memproses...</>
            : <><HiOutlineFilm className="w-4 h-4" /> Mulai Import</>
          }
        </button>
```

```jsx
// NEW — replace with button group:
        <div className="flex gap-2">
          <button
            onClick={handleSubmit}
            disabled={submitting || !url || !judul.trim()}
            className="flex-1 btn btn-primary flex items-center justify-center gap-2"
          >
            {submitting
              ? <><HiOutlineRefresh className="w-4 h-4 animate-spin" /> Memproses...</>
              : <><HiOutlineFilm className="w-4 h-4" /> Mulai Import</>
            }
          </button>
          {submitting && (
            <button
              onClick={handleCancel}
              className="px-4 py-2 bg-gray-100 hover:bg-red-50 hover:text-red-600 text-gray-600 text-sm font-semibold rounded-xl border border-gray-200 transition-all"
            >
              Batal
            </button>
          )}
        </div>
```

- [ ] **Step 3: Add `jobIdRef` to `YouTubeView` state declarations**

The `jobIdRef` is declared inside `handleSubmit` in the new code above — but it must be at component scope. Find the existing state declarations inside `YouTubeView` (around line 711):

```js
// OLD:
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState('audio');
```

```js
// NEW — add useRef import is already at the top of the file; just add the ref:
  const jobIdRef = useRef(null);
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState('audio');
```

And remove the `const jobIdRef = useRef(null);` line from inside `handleSubmit` (since it's now at component scope).

- [ ] **Step 4: Verify diff**

```bash
diff frontend/src/pages/NotulenAI.jsx.backup frontend/src/pages/NotulenAI.jsx
```

Expected: `jobIdRef`, new `handleSubmit`, `handleCancel`, and Cancel button JSX — no other changes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/NotulenAI.jsx
git commit -m "feat(notulen): YouTube SSE retry on disconnect + cancel import button"
```

---

## Task 10: Update bulk archive UI to use new endpoint

**Files:**
- Modify: `frontend/src/pages/NotulenAI.jsx` (main `NotulenAI` component, `bulkArchive` function, around line 317)

Replace the N-parallel-PATCH loop with a single call to the new `bulkArchive` endpoint.

- [ ] **Step 1: Replace `bulkArchive` function**

In `NotulenAI.jsx`, find the `bulkArchive` function (around line 317):

```js
// OLD:
  const bulkArchive = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    try {
      await Promise.all(ids.map(id => notulenAPI.updateSession(id, { status: 'archived' })));
      toast.success(`${ids.length} sesi diarsipkan`);
      setSelected(new Set());
      loadSessions(page);
    } catch { toast.error('Gagal mengarsipkan'); }
  };
```

```js
// NEW:
  const bulkArchive = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    try {
      await notulenAPI.bulkArchive(ids);
      toast.success(`${ids.length} sesi diarsipkan`);
      setSelected(new Set());
      loadSessions(page);
    } catch { toast.error('Gagal mengarsipkan'); }
  };
```

- [ ] **Step 2: Verify diff**

```bash
diff frontend/src/pages/NotulenAI.jsx.backup frontend/src/pages/NotulenAI.jsx
```

Expected: only the `Promise.all` replaced by `notulenAPI.bulkArchive(ids)`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/NotulenAI.jsx
git commit -m "fix(notulen): use single bulkArchive API call instead of N parallel PATCH requests"
```

---

## Task 11: Reload backend + smoke test

- [ ] **Step 1: Reload backend**

```bash
pm2 reload pds-backend --update-env
```

Wait for `ready` in output (~5s).

- [ ] **Step 2: Check backend health**

```bash
curl -s http://localhost:5000/api/notulen -H "Authorization: Bearer $(cat /tmp/test-token.txt 2>/dev/null || echo '')" | head -c 200
```

Expected: a JSON response (either auth error `401` or a sessions list `{success:true,...}`). Not a `500` or `ECONNREFUSED`.

- [ ] **Step 3: Test `PATCH /bulk-archive` exists**

```bash
curl -s -X PATCH http://localhost:5000/api/notulen/bulk-archive \
  -H "Content-Type: application/json" \
  -d '{"ids":[]}' | head -c 200
```

Expected: `{"success":false,"message":"IDs required"}` (400, not 404).

- [ ] **Step 4: Test `DELETE /youtube/jobs/nonexistent` exists**

```bash
curl -s -X DELETE http://localhost:5000/api/notulen/youtube/jobs/fake-job-id | head -c 200
```

Expected: `{"success":false,"message":"Job tidak ditemukan atau sudah selesai"}` or `401` (auth required). Not `404 Cannot DELETE`.

- [ ] **Step 5: Commit (no code changes — just checkpoint)**

If all checks pass, tag this as stable:

```bash
git tag notulen-fixes-backend-stable
```

---

## Task 12: Build frontend + final verification

- [ ] **Step 1: Build frontend**

```bash
cd /var/www/html/agenda_work/frontend && npm run build 2>&1 | tail -20
```

Expected: `✓ built in Xs` with no errors. Warnings about unused variables are acceptable.

- [ ] **Step 2: Verify all changed files are committed**

```bash
git status
```

Expected: clean working tree (or only `.backup` files untracked).

- [ ] **Step 3: Clean up backup files**

```bash
rm -f backend/src/services/notulen.service.js.backup \
      backend/src/routes/notulen.routes.js.backup \
      frontend/src/services/api.js.backup \
      frontend/src/pages/NotulenAI.jsx.backup
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git status  # verify only backup deletions staged
git commit -m "chore: remove .backup files after notulen AI fixes"
```

---

## Summary of all fixes

| # | Fix | Files | Task |
|---|---|---|---|
| 1 | Expand hallucination phrases + remove dead variable | `notulen.service.js` | Task 1 |
| 2 | Report/throw on skipped audio chunks | `notulen.service.js` | Task 2 |
| 3 | Add `PATCH /bulk-archive` endpoint | `notulen.routes.js` | Task 3 |
| 4 | Add `DELETE /youtube/jobs/:jobId` cancel endpoint | `notulen.routes.js`, `notulen.service.js` | Task 4 |
| 5 | Add `bulkArchive` + `cancelYoutubeJob` to API client | `api.js` | Task 5 |
| 6 | Fix hardcoded share URL | `NotulenAI.jsx` | Task 6 |
| 7 | Add `instansi` field to YouTubeView | `NotulenAI.jsx` | Task 7 |
| 8 | Animate upload progress through Groq phase | `NotulenAI.jsx` | Task 8 |
| 9 | YouTube SSE retry on disconnect + cancel button | `NotulenAI.jsx` | Task 9 |
| 10 | Use single `bulkArchive` call in UI | `NotulenAI.jsx` | Task 10 |
