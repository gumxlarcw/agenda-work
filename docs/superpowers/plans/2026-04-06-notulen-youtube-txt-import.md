# Notulen AI — Import .txt & YouTube Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambah import file .txt (tab baru di ImportTranscriptView) dan import dari YouTube (pilihan manual CC atau audio dengan auto-split) ke halaman Notulen AI.

**Architecture:** Backend menambah dua service functions (`importYoutubeCC`, `importYoutubeAudio`) dan dua endpoint REST (`POST /import-youtube`, `GET /youtube/progress/:jobId` SSE). Frontend menambah tab `.txt` di view Import yang ada, komponen `YouTubeView` baru, dan tombol YouTube di header list.

**Tech Stack:** Node.js/Express (backend), React/Vite (frontend), yt-dlp (`/home/linuxbrew/.linuxbrew/bin/yt-dlp`), ffmpeg (`/usr/bin/ffmpeg`), Groq Whisper API, SSE untuk progress real-time.

---

## File Map

| File | Aksi | Tanggung Jawab |
|------|------|----------------|
| `backend/src/services/notulen.service.js` | Modify | Tambah `importYoutubeCC()`, `importYoutubeAudio()`, `splitAndTranscribe()` |
| `backend/src/routes/notulen.routes.js` | Modify | Tambah `POST /import-youtube`, `GET /youtube/progress/:jobId` |
| `backend/src/server.js` | Modify | Init `tmp/youtube/` dir, extend `/api/health` dengan ytdlp/ffmpeg status |
| `frontend/src/services/api.js` | Modify | Tambah `notulenAPI.importYoutube()`, `notulenAPI.youtubeProgressUrl()` |
| `frontend/src/pages/NotulenAI.jsx` | Modify | Tambah tab .txt, komponen `YouTubeView`, tombol YouTube di header |

---

## Task 1: Backend — Init tmp dir & extend health endpoint

**Files:**
- Modify: `backend/src/server.js`

- [ ] **Step 1: Backup file**

```bash
cp backend/src/server.js backend/src/server.js.backup
```

- [ ] **Step 2: Tambah fs import dan init tmp dir di startup**

Cari baris `const path = require('path');` (sekitar baris 109), tambah setelahnya:

```js
const fs = require('fs');

// Ensure YouTube tmp directory exists
const YT_TMP_DIR = path.join(__dirname, '../tmp/youtube');
fs.mkdirSync(YT_TMP_DIR, { recursive: true });
```

- [ ] **Step 3: Extend health endpoint dengan ytdlp + ffmpeg check**

Ganti health endpoint yang ada (sekitar baris 142):

```js
// Cek binary availability saat health check
const { execFile } = require('child_process');
function checkBinary(bin) {
    return new Promise((resolve) => {
        execFile(bin, ['--version'], { timeout: 3000 }, (err) => resolve(!err));
    });
}

app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        const [ytdlp, ffmpeg] = await Promise.all([
            checkBinary('/home/linuxbrew/.linuxbrew/bin/yt-dlp'),
            checkBinary('/usr/bin/ffmpeg'),
        ]);
        res.json({ status: 'ok', db: 'ok', ytdlp, ffmpeg, timestamp: new Date().toISOString() });
    } catch (err) {
        res.status(503).json({ status: 'degraded', db: 'error', error: err.message, timestamp: new Date().toISOString() });
    }
});
```

- [ ] **Step 4: Verifikasi diff**

```bash
diff backend/src/server.js.backup backend/src/server.js
```

- [ ] **Step 5: Test health endpoint**

```bash
pm2 reload agenda-backend --update-env
curl -s http://localhost:5100/api/health | python3 -m json.tool
```

Expected output:
```json
{
    "status": "ok",
    "db": "ok",
    "ytdlp": true,
    "ffmpeg": true,
    "timestamp": "..."
}
```

- [ ] **Step 6: Commit**

```bash
cd /var/www/html/agenda_work
git add backend/src/server.js
git commit -m "feat(notulen): init youtube tmp dir + extend health with ytdlp/ffmpeg status"
```

---

## Task 2: Backend — YouTube service functions

**Files:**
- Modify: `backend/src/services/notulen.service.js`

- [ ] **Step 1: Backup file**

```bash
cp backend/src/services/notulen.service.js backend/src/services/notulen.service.js.backup
```

- [ ] **Step 2: Tambah imports di bagian atas file (setelah baris `const pool = ...`)**

```js
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execFileAsync = promisify(execFile);
const YTDLP_BIN = '/home/linuxbrew/.linuxbrew/bin/yt-dlp';
const FFMPEG_BIN = '/usr/bin/ffmpeg';
const YT_TMP_DIR = path.join(__dirname, '../../tmp/youtube');
const CHUNK_DURATION_SEC = 600; // 10 menit per chunk, aman di bawah 25MB limit Groq
```

- [ ] **Step 3: Tambah fungsi `importYoutubeCC` sebelum baris `module.exports`**

```js
// --- YouTube CC Import ---
// Download subtitle/CC via yt-dlp, parse VTT, return segments array
async function importYoutubeCC(url, jobId, onProgress) {
    const outTemplate = path.join(YT_TMP_DIR, jobId);

    onProgress(10, 'Mengunduh subtitle...');

    await execFileAsync(YTDLP_BIN, [
        '--write-auto-sub',
        '--sub-lang', 'id,en',
        '--sub-format', 'vtt',
        '--skip-download',
        '--no-playlist',
        '-o', outTemplate,
        url,
    ], { timeout: 60000 });

    // yt-dlp names file as: {jobId}.id.vtt or {jobId}.en.vtt
    const files = fs.readdirSync(YT_TMP_DIR).filter(f => f.startsWith(jobId) && f.endsWith('.vtt'));
    if (files.length === 0) throw new Error('Subtitle tidak tersedia. Coba metode Audio.');

    const vttContent = fs.readFileSync(path.join(YT_TMP_DIR, files[0]), 'utf-8');
    const segments = parseVTT(vttContent);
    if (segments.length === 0) throw new Error('Subtitle kosong atau tidak dapat dibaca.');

    onProgress(90, 'Menyimpan segmen...');
    return segments;
}
```

- [ ] **Step 4: Tambah fungsi `splitAndTranscribe` (helper audio chunking)**

```js
// Split audio file into chunks and transcribe each via Groq Whisper
// Returns all segments with monotonic timestamp offsets
async function splitAndTranscribe(audioPath, onProgress) {
    const chunkDir = audioPath + '_chunks';
    fs.mkdirSync(chunkDir, { recursive: true });

    const chunkPattern = path.join(chunkDir, 'chunk_%03d.mp3');

    // Split with ffmpeg
    await execFileAsync(FFMPEG_BIN, [
        '-i', audioPath,
        '-f', 'segment',
        '-segment_time', String(CHUNK_DURATION_SEC),
        '-c', 'copy',
        '-reset_timestamps', '1',
        chunkPattern,
    ], { timeout: 120000 });

    const chunkFiles = fs.readdirSync(chunkDir)
        .filter(f => f.startsWith('chunk_') && f.endsWith('.mp3'))
        .sort();

    if (chunkFiles.length === 0) throw new Error('Gagal memecah audio.');

    const allSegments = [];
    let timeOffset = 0;

    for (let i = 0; i < chunkFiles.length; i++) {
        const chunkPath = path.join(chunkDir, chunkFiles[i]);
        const percent = 30 + Math.round((i / chunkFiles.length) * 60);
        onProgress(percent, `Memproses chunk ${i + 1} dari ${chunkFiles.length}...`);

        let results = [];
        // Retry once on failure
        for (let attempt = 0; attempt <= 1; attempt++) {
            try {
                const audioBuffer = fs.readFileSync(chunkPath);
                const form = new FormData();
                form.append('file', audioBuffer, { filename: 'chunk.mp3', contentType: 'audio/mpeg' });
                form.append('model', GROQ_MODEL);
                form.append('language', 'id');
                form.append('response_format', 'verbose_json');
                form.append('timestamp_granularities[]', 'segment');

                const resp = await axios.post(GROQ_URL, form, {
                    headers: { ...form.getHeaders(), Authorization: `Bearer ${GROQ_API_KEY}` },
                    timeout: 120000,
                    maxContentLength: 50 * 1024 * 1024,
                });

                const data = resp.data;
                for (const seg of (data.segments || [])) {
                    const text = (seg.text || '').trim();
                    if (text && !isHallucination(text)) {
                        results.push({
                            text,
                            timestamp_seconds: timeOffset + (seg.start || 0),
                            segment_start: timeOffset + (seg.start || 0),
                            segment_end: timeOffset + (seg.end || 0),
                        });
                    }
                }
                // If no segments but has text fallback
                if (results.length === 0 && data.text && !isHallucination(data.text.trim())) {
                    results.push({
                        text: data.text.trim(),
                        timestamp_seconds: timeOffset,
                        segment_start: timeOffset,
                        segment_end: timeOffset + CHUNK_DURATION_SEC,
                    });
                }
                break; // success — exit retry loop
            } catch (err) {
                console.error(`[notulen-yt] Chunk ${i + 1} attempt ${attempt + 1} failed:`, err.message);
                if (attempt === 1) console.warn(`[notulen-yt] Skipping chunk ${i + 1} after 2 failures`);
            }
        }

        allSegments.push(...results);
        timeOffset += CHUNK_DURATION_SEC;
    }

    return allSegments;
}
```

- [ ] **Step 5: Tambah fungsi `importYoutubeAudio`**

```js
// --- YouTube Audio Import ---
// Download audio via yt-dlp, split with ffmpeg, transcribe each chunk via Groq
async function importYoutubeAudio(url, jobId, onProgress) {
    const audioPath = path.join(YT_TMP_DIR, `${jobId}.mp3`);

    onProgress(5, 'Mengunduh audio...');

    await execFileAsync(YTDLP_BIN, [
        '-f', 'bestaudio/best',
        '-x',
        '--audio-format', 'mp3',
        '--audio-quality', '5',   // medium quality, smaller file
        '--no-playlist',
        '-o', audioPath,
        url,
    ], { timeout: 600000 }); // 10 min max download

    if (!fs.existsSync(audioPath)) throw new Error('Download audio gagal.');

    onProgress(20, 'Memecah audio menjadi bagian-bagian...');

    const segments = await splitAndTranscribe(audioPath, onProgress);

    onProgress(95, 'Menyimpan segmen...');
    return segments;
}
```

- [ ] **Step 6: Tambah cleanup helper**

```js
// Clean up all temp files for a job
function cleanupYoutubeTmp(jobId) {
    try {
        const files = fs.readdirSync(YT_TMP_DIR).filter(f => f.startsWith(jobId));
        for (const f of files) {
            const fp = path.join(YT_TMP_DIR, f);
            const stat = fs.statSync(fp);
            if (stat.isDirectory()) fs.rmSync(fp, { recursive: true, force: true });
            else fs.unlinkSync(fp);
        }
        console.log(`[notulen-yt] Cleaned up tmp files for job ${jobId}`);
    } catch (err) {
        console.error(`[notulen-yt] Cleanup failed for ${jobId}:`, err.message);
    }
}
```

- [ ] **Step 7: Export fungsi baru — tambah di `module.exports`**

Cari baris `module.exports = {` dan tambahkan fungsi baru di dalam objek exports:

```js
  importYoutubeCC,
  importYoutubeAudio,
  cleanupYoutubeTmp,
```

- [ ] **Step 8: Verifikasi syntax**

```bash
cd /var/www/html/agenda_work/backend
node -e "require('./src/services/notulen.service.js'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 9: Commit**

```bash
cd /var/www/html/agenda_work
git add backend/src/services/notulen.service.js
git commit -m "feat(notulen): add importYoutubeCC, importYoutubeAudio, splitAndTranscribe service functions"
```

---

## Task 3: Backend — YouTube route endpoints

**Files:**
- Modify: `backend/src/routes/notulen.routes.js`

- [ ] **Step 1: Backup file**

```bash
cp backend/src/routes/notulen.routes.js backend/src/routes/notulen.routes.js.backup
```

- [ ] **Step 2: Tambah crypto import di bagian atas file**

Cari baris `const express = require('express');`, tambah setelahnya:

```js
const crypto = require('crypto');
```

- [ ] **Step 3: Tambah progress map untuk YouTube jobs**

Cari baris `// Progress tracking map: sessionId → ...` dan tambahkan setelah deklarasi `summaryProgress`:

```js
// YouTube import progress map: jobId → { percent, step, done, error, sessionId }
const youtubeProgress = new Map();

// Allowed YouTube URL patterns
const YOUTUBE_URL_RE = /^https?:\/\/(www\.)?(youtube\.com\/watch\?|youtu\.be\/)/;
```

- [ ] **Step 4: Tambah SSE progress endpoint untuk YouTube**

Tambahkan sebelum bagian `// WebSocket handler`:

```js
// SSE — YouTube import progress stream
router.get('/youtube/progress/:jobId', (req, res, next) => {
    if (req.query.token) req.headers.authorization = `Bearer ${req.query.token}`;
    next();
}, verifyToken, (req, res) => {
    const key = req.params.jobId;
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    const heartbeat = () => res.write(': heartbeat\n\n');

    send({ percent: 0, step: 'Menunggu...' });

    const pollInterval = setInterval(() => {
        const prog = youtubeProgress.get(key);
        if (prog) {
            send(prog);
            if (prog.done || prog.error) {
                clearInterval(pollInterval);
                clearInterval(hbInterval);
                res.end();
            }
        }
    }, 400);

    const hbInterval = setInterval(heartbeat, 20000);

    req.on('close', () => {
        clearInterval(pollInterval);
        clearInterval(hbInterval);
    });
});
```

- [ ] **Step 5: Tambah endpoint POST import-youtube**

Tambahkan sebelum `router.get('/youtube/progress/...')`:

```js
// Import from YouTube — responds immediately, runs in background via SSE
router.post('/import-youtube', verifyToken, async (req, res) => {
    const { url, method, judul, sub_judul, pencatat, instansi, tanggal } = req.body;

    // Validate
    if (!url || !YOUTUBE_URL_RE.test(url)) {
        return res.status(400).json({ success: false, message: 'URL YouTube tidak valid' });
    }
    if (!['cc', 'audio'].includes(method)) {
        return res.status(400).json({ success: false, message: 'Metode harus "cc" atau "audio"' });
    }
    if (!judul || !judul.trim()) {
        return res.status(400).json({ success: false, message: 'Judul wajib diisi' });
    }

    const jobId = crypto.randomUUID();
    youtubeProgress.set(jobId, { percent: 0, step: 'Memulai...' });

    // Respond immediately — client polls via SSE
    res.json({ success: true, data: { jobId } });

    // Run in background
    (async () => {
        let sessionId;
        try {
            sessionId = await notulenService.createSession(req.user.id, {
                judul: judul.trim(),
                sub_judul: sub_judul || null,
                pencatat: pencatat || req.user.name,
                instansi: instansi || 'BPS Provinsi Maluku Utara',
                tanggal: tanggal || new Date().toISOString().split('T')[0],
            });

            const onProgress = (percent, step) => youtubeProgress.set(jobId, { percent, step });

            let segments;
            if (method === 'cc') {
                segments = await notulenService.importYoutubeCC(url, jobId, onProgress);
            } else {
                segments = await notulenService.importYoutubeAudio(url, jobId, onProgress);
            }

            if (segments.length === 0) throw new Error('Tidak ada segmen yang berhasil diproses');

            // Normalize segment shape for saveSegmentsBatch
            const segData = segments.map(s => ({
                text: s.text,
                timestamp_seconds: s.timestamp_seconds ?? s.start ?? 0,
                segment_start: s.segment_start ?? s.start ?? 0,
                segment_end: s.segment_end ?? s.end ?? 0,
            }));

            await notulenService.saveSegmentsBatch(sessionId, segData);

            const totalDuration = Math.round(segData[segData.length - 1].segment_end || 0);
            await notulenService.updateSessionStatus(sessionId, 'completed', totalDuration);

            console.log(`[notulen-yt] Job ${jobId} done: session ${sessionId}, ${segments.length} segments`);
            youtubeProgress.set(jobId, { percent: 100, step: 'Selesai', done: true, sessionId });

        } catch (err) {
            console.error(`[notulen-yt] Job ${jobId} error:`, err.message);
            youtubeProgress.set(jobId, { percent: 0, step: err.message, error: true, done: true });
            // Clean up empty session if created
            if (sessionId) {
                await notulenService.deleteSession(sessionId, req.user.id, req.user.role === 'admin').catch(() => {});
            }
        } finally {
            notulenService.cleanupYoutubeTmp(jobId);
            setTimeout(() => youtubeProgress.delete(jobId), 30000);
        }
    })();
});
```

- [ ] **Step 6: Verifikasi syntax**

```bash
cd /var/www/html/agenda_work/backend
node -e "require('./src/routes/notulen.routes.js'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 7: Reload backend dan test endpoint**

```bash
pm2 reload agenda-backend --update-env
sleep 2
curl -s http://localhost:5100/api/health | python3 -m json.tool
```

Expected: `ytdlp: true`, `ffmpeg: true`

- [ ] **Step 8: Commit**

```bash
cd /var/www/html/agenda_work
git add backend/src/routes/notulen.routes.js
git commit -m "feat(notulen): add POST /import-youtube and SSE /youtube/progress/:jobId endpoints"
```

---

## Task 4: Frontend — API methods untuk YouTube

**Files:**
- Modify: `frontend/src/services/api.js`

- [ ] **Step 1: Backup file**

```bash
cp frontend/src/services/api.js frontend/src/services/api.js.backup
```

- [ ] **Step 2: Tambah methods ke `notulenAPI`**

Cari baris `askQuestion: (id, question) => ...` dan tambahkan setelahnya (sebelum `};`):

```js
  importYoutube: (data) => api.post('/notulen/import-youtube', data, { timeout: 30000 }),
  youtubeProgressUrl: (jobId) => {
    const token = localStorage.getItem('accessToken');
    const base = import.meta.env.PROD ? 'https://api-agenda.bpsmalut.com/api' : '/api';
    return `${base}/notulen/youtube/progress/${jobId}?token=${encodeURIComponent(token)}`;
  },
```

- [ ] **Step 3: Verifikasi build tidak error**

```bash
cd /var/www/html/agenda_work/frontend
npx vite build --mode production 2>&1 | tail -5
```

Expected: `✓ built in ...`

- [ ] **Step 4: Commit**

```bash
cd /var/www/html/agenda_work
git add frontend/src/services/api.js
git commit -m "feat(notulen): add importYoutube and youtubeProgressUrl to notulenAPI"
```

---

## Task 5: Frontend — Tab .txt di ImportTranscriptView

**Files:**
- Modify: `frontend/src/pages/NotulenAI.jsx`

- [ ] **Step 1: Backup file**

```bash
cp frontend/src/pages/NotulenAI.jsx frontend/src/pages/NotulenAI.jsx.backup
```

- [ ] **Step 2: Tambah state untuk tab .txt di `ImportTranscriptView`**

Di dalam fungsi `ImportTranscriptView`, cari deklarasi `const [activeTab, setActiveTab] = useState('paste');` dan pastikan tab options mencakup `'txt'`. Ganti bagian tabs definition:

```jsx
// Ganti baris:
const [activeTab, setActiveTab] = useState('paste');

// Tidak perlu diubah — nilai 'txt' akan ditangani dengan menambah tab baru
```

- [ ] **Step 3: Tambah state file .txt**

Di dalam `ImportTranscriptView`, setelah `const [file, setFile] = useState(null);` tambahkan:

```jsx
const [txtFile, setTxtFile] = useState(null);
```

- [ ] **Step 4: Tambah handler submit .txt**

Setelah fungsi `handleSubtitleSubmit`, tambahkan:

```jsx
async function handleTxtSubmit() {
    if (!judul.trim()) { toast.error('Isi judul'); return; }
    if (!txtFile) { toast.error('Pilih file .txt'); return; }
    setSubmitting(true);
    try {
        const text = await txtFile.text();
        if (!text.trim()) { toast.error('File kosong'); setSubmitting(false); return; }
        const res = await notulenAPI.importText({ judul, sub_judul: subJudul || undefined, pencatat, instansi, tanggal, text });
        toast.success(`Berhasil! ${res.data.data.segmentCount} segmen diimpor`);
        onDone(res.data.data.sessionId);
    } catch (err) {
        toast.error(err.response?.data?.message || 'Gagal import file .txt');
    } finally { setSubmitting(false); }
}
```

- [ ] **Step 5: Tambah tab "File .txt" di daftar tab**

Cari array tab definition:
```jsx
{[
  { key: 'paste', label: 'Paste Teks' },
  { key: 'subtitle', label: 'Upload Subtitle' },
].map(tab => (
```

Ganti menjadi:
```jsx
{[
  { key: 'paste', label: 'Paste Teks' },
  { key: 'subtitle', label: 'Upload Subtitle' },
  { key: 'txt', label: 'File .txt' },
].map(tab => (
```

- [ ] **Step 6: Tambah UI untuk tab 'txt' setelah blok `{activeTab === 'subtitle' && ...}`**

Tambahkan setelah blok `{/* Subtitle Tab */}`:

```jsx
{/* TXT Tab */}
{activeTab === 'txt' && (
  <div>
    <label className="form-label">File Teks (.txt)</label>
    <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-primary-400 transition-colors bg-gray-50/50">
      <HiOutlineDocumentText className="w-8 h-8 text-gray-300 mb-2" />
      <span className="text-sm text-gray-500">{txtFile ? txtFile.name : 'Klik untuk pilih file .txt'}</span>
      {txtFile && <span className="text-xs text-gray-400 mt-1">{(txtFile.size / 1024).toFixed(1)} KB</span>}
      <input type="file" accept=".txt,text/plain" onChange={e => setTxtFile(e.target.files[0])} className="hidden" />
    </label>
    <p className="text-xs text-gray-400 mt-2">Format bebas — teks akan diproses sebagai satu transkrip tanpa timestamp</p>
  </div>
)}
```

- [ ] **Step 7: Update tombol Submit untuk handle tab 'txt'**

Cari tombol submit (bagian `{/* Submit */}`). Ganti isi `onClick` menjadi:

```jsx
onClick={activeTab === 'paste' ? handlePasteSubmit : activeTab === 'subtitle' ? handleSubtitleSubmit : handleTxtSubmit}
```

- [ ] **Step 8: Verifikasi build**

```bash
cd /var/www/html/agenda_work/frontend
npx vite build --mode production 2>&1 | tail -5
```

Expected: `✓ built in ...`

- [ ] **Step 9: Commit**

```bash
cd /var/www/html/agenda_work
git add frontend/src/pages/NotulenAI.jsx
git commit -m "feat(notulen): add .txt file import tab to ImportTranscriptView"
```

---

## Task 6: Frontend — Komponen YouTubeView

**Files:**
- Modify: `frontend/src/pages/NotulenAI.jsx`

- [ ] **Step 1: Tambah icon HiOutlineFilm ke imports**

Cari baris `HiOutlineChatAlt2, HiOutlineLink, HiOutlineArrowRight,` dan tambahkan:

```jsx
HiOutlineFilm,
```

- [ ] **Step 2: Tambah komponen `YouTubeView` setelah fungsi `ImportTranscriptView`**

Cari komentar `// ===================================================` sebelum `function RecordingView` (atau setelah `ImportTranscriptView`), tambahkan komponen baru:

```jsx
// ===================================================
// YouTubeView — import dari YouTube (CC atau audio)
// ===================================================
function YouTubeView({ onBack, user, onDone }) {
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState('audio');
  const [judul, setJudul] = useState('');
  const [subJudul, setSubJudul] = useState('');
  const [pencatat, setPencatat] = useState(user?.name || '');
  const [instansi, setInstansi] = useState('BPS Provinsi Maluku Utara');
  const [tanggal, setTanggal] = useState(new Date().toISOString().split('T')[0]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressStep, setProgressStep] = useState('');
  const [error, setError] = useState('');

  const YOUTUBE_RE = /^https?:\/\/(www\.)?(youtube\.com\/watch\?|youtu\.be\/)/;

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

  return (
    <div className="space-y-4 animate-fadeIn">
      <BackButton onClick={onBack} />

      <div className="bg-white border border-gray-100 rounded-2xl p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-pink-600 flex items-center justify-center shadow-lg shadow-red-200">
            <HiOutlineFilm className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">Import dari YouTube</h2>
            <p className="text-xs text-gray-400 mt-0.5">Ambil transkrip dari subtitle CC atau download audio</p>
          </div>
        </div>

        {/* URL Input */}
        <div>
          <label className="form-label">URL Video YouTube</label>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=..."
            className="form-input font-mono text-sm"
            disabled={submitting}
          />
        </div>

        {/* Method Selection */}
        <div>
          <label className="form-label">Metode Pengambilan Teks</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
            {[
              { value: 'cc', label: 'Subtitle / CC', desc: 'Cepat, gunakan teks yang sudah ada di video', icon: HiOutlineDocumentText },
              { value: 'audio', label: 'Download Audio', desc: 'Akurat, transkripsi ulang via Whisper AI', icon: HiOutlineMicrophone },
            ].map(opt => (
              <label
                key={opt.value}
                className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                  method === opt.value
                    ? 'border-primary-400 bg-primary-50'
                    : 'border-gray-100 hover:border-gray-200'
                }`}
              >
                <input
                  type="radio"
                  value={opt.value}
                  checked={method === opt.value}
                  onChange={() => setMethod(opt.value)}
                  className="mt-0.5 text-primary-600 focus:ring-primary-500"
                  disabled={submitting}
                />
                <div>
                  <p className="text-sm font-semibold text-gray-800">{opt.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Metadata Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="form-label">Judul</label>
            <input value={judul} onChange={e => setJudul(e.target.value)} placeholder="Judul sesi notulen" className="form-input" disabled={submitting} />
          </div>
          <div className="md:col-span-2">
            <label className="form-label">Sub Judul <span className="text-gray-400 font-normal">(opsional)</span></label>
            <input value={subJudul} onChange={e => setSubJudul(e.target.value)} placeholder="Konteks untuk AI ringkasan" className="form-input" disabled={submitting} />
          </div>
          <div>
            <label className="form-label">Pencatat</label>
            <input value={pencatat} onChange={e => setPencatat(e.target.value)} className="form-input" disabled={submitting} />
          </div>
          <div>
            <label className="form-label">Tanggal</label>
            <input type="date" value={tanggal} onChange={e => setTanggal(e.target.value)} className="form-input" disabled={submitting} />
          </div>
        </div>

        {/* Progress */}
        {submitting && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>{progressStep}</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary-500 to-primary-600 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            {method === 'audio' && progress < 20 && (
              <p className="text-xs text-gray-400">Video panjang mungkin memerlukan beberapa menit untuk diunduh dan diproses...</p>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Submit */}
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
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verifikasi build**

```bash
cd /var/www/html/agenda_work/frontend
npx vite build --mode production 2>&1 | tail -5
```

Expected: `✓ built in ...`

- [ ] **Step 4: Commit**

```bash
cd /var/www/html/agenda_work
git add frontend/src/pages/NotulenAI.jsx
git commit -m "feat(notulen): add YouTubeView component with CC/audio method selection and SSE progress"
```

---

## Task 7: Frontend — Wiring routing & tombol YouTube

**Files:**
- Modify: `frontend/src/pages/NotulenAI.jsx`

- [ ] **Step 1: Tambah `'youtube'` ke routing di komponen `NotulenAI`**

Cari baris:
```jsx
if (view === 'import') return <ImportTranscriptView onBack={() => setView('list')} user={user} onDone={(id) => { openSession(id); }} />;
```

Tambahkan setelahnya:
```jsx
if (view === 'youtube') return <YouTubeView onBack={() => setView('list')} user={user} onDone={(id) => { openSession(id); }} />;
```

- [ ] **Step 2: Tambah tombol YouTube di header list view**

Cari blok header buttons (sekitar baris yang ada tombol Import, Upload, Rekam). Tambahkan tombol YouTube sebelum tombol Import:

```jsx
<button
  onClick={() => setView('youtube')}
  className="flex items-center gap-1.5 px-3 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-xl transition-all"
>
  <HiOutlineFilm className="w-4 h-4" />
  <span className="hidden sm:inline">YouTube</span>
</button>
```

- [ ] **Step 3: Build final**

```bash
cd /var/www/html/agenda_work/frontend
npx vite build --mode production 2>&1 | tail -5
```

Expected: `✓ built in ...`

- [ ] **Step 4: Commit**

```bash
cd /var/www/html/agenda_work
git add frontend/src/pages/NotulenAI.jsx
git commit -m "feat(notulen): wire YouTubeView routing and add YouTube button to list header"
```

---

## Task 8: Manual Test & Final Deploy

- [ ] **Step 1: Restart semua services**

```bash
pm2 reload agenda-backend --update-env
```

- [ ] **Step 2: Test import .txt**

1. Buka `https://agenda.bpsmalut.com/notulen`
2. Klik tombol **Import**
3. Pilih tab **File .txt**
4. Buat file test: `echo "Ini adalah teks rapat. Semua peserta hadir. Agenda pertama dibahas." > /tmp/test.txt`
5. Upload file tersebut, isi judul, klik Submit
6. Expected: masuk ke DetailView dengan segmen teks tersebut

- [ ] **Step 3: Test import YouTube CC**

1. Klik tombol **YouTube** di header
2. Masukkan URL YouTube yang punya CC bahasa Indonesia (contoh: video berita TVRI atau ceramah)
3. Pilih metode **Subtitle / CC**
4. Isi judul, klik **Mulai Import**
5. Expected: progress SSE berjalan, selesai → masuk ke DetailView

Jika CC tidak tersedia: expected error message "Subtitle tidak tersedia. Coba metode Audio."

- [ ] **Step 4: Test import YouTube Audio**

1. Klik tombol **YouTube**
2. Masukkan URL video pendek (< 5 menit untuk test cepat)
3. Pilih metode **Download Audio**
4. Isi judul, klik **Mulai Import**
5. Expected: progress bar bergerak (Mengunduh audio → Memproses chunk 1 dari N → Selesai) → masuk DetailView dengan transkrip

- [ ] **Step 5: Verifikasi health endpoint menyertakan ytdlp/ffmpeg**

```bash
curl -s https://api-agenda.bpsmalut.com/api/health | python3 -m json.tool
```

Expected: `"ytdlp": true, "ffmpeg": true`

> **Catatan:** Spec menyebutkan disable tombol YouTube jika binary tidak tersedia. Karena yt-dlp dan ffmpeg sudah terpasang di server ini, fitur ini di-skip. Jika suatu saat perlu: tambahkan `useEffect` di `NotulenAI.jsx` yang panggil `/api/health` dan set state `ytdlpAvailable` untuk kondisional disable tombol.

- [ ] **Step 6: Test error handling**

1. Masukkan URL bukan YouTube (misal `https://google.com`) → expected: toast "URL YouTube tidak valid"
2. Masukkan URL video privat → expected: SSE error message "Video tidak dapat diakses"

- [ ] **Step 6: Commit final**

```bash
cd /var/www/html/agenda_work
git add -A
git status  # pastikan tidak ada file sensitif
git commit -m "feat(notulen): complete YouTube & .txt import feature — manual test passed"
```
