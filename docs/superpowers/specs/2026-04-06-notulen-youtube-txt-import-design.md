# Design Spec: Notulen AI — Import File .txt & YouTube

**Date:** 2026-04-06  
**Status:** Approved  
**Scope:** Tambah fitur import file .txt dan import dari YouTube (CC atau audio) ke halaman Notulen AI

---

## 1. Ringkasan

Menambahkan dua jalur input baru ke Notulen AI:

1. **Import File .txt** — upload file teks bebas format, dikirim ke endpoint `/import-text` yang sudah ada
2. **Import YouTube** — user memasukkan URL YouTube dan memilih metode secara manual:
   - **Subtitle/CC** — yt-dlp download subtitle, parse VTT → segmen
   - **Download Audio** — yt-dlp download mp3, ffmpeg split per chunk, tiap chunk ke Groq Whisper, hasil digabung dengan offset timestamp

---

## 2. Perubahan Frontend

### 2.1 Tab .txt di ImportTranscriptView

Tambah tab ketiga "File .txt" di samping "Paste Teks" dan "Upload Subtitle".

- User pilih file `.txt` dari perangkat
- Konten file dibaca sebagai string via `FileReader`
- Dikirim ke endpoint `POST /api/notulen/import-text` yang sudah ada (field `text`)
- Format teks bebas — tidak perlu timestamp

### 2.2 Tombol YouTube di Header List View

Tambah tombol "YouTube" di header samping tombol Import/Upload/Rekam:

```jsx
<button onClick={() => setView('youtube')}>
  <HiOutlineVideoCamera /> YouTube
</button>
```

### 2.3 Komponen YouTubeView (baru)

View baru `YouTubeView` di dalam `NotulenAI.jsx`, dipanggil ketika `view === 'youtube'`.

**Form fields:**
- URL Video YouTube (required, validasi regex)
- Metode: radio button `cc` | `audio`
- Judul (required)
- Sub Judul (optional)
- Pencatat (default: nama user)
- Tanggal (default: hari ini)

**State:**
- `url`, `method` (`'cc'` | `'audio'`), metadata fields
- `submitting`, `progress` (0–100), `progressStep` (string)
- `jobId` — UUID dari response awal untuk SSE

**Flow setelah submit:**
1. POST `/api/notulen/import-youtube` → dapat `{ jobId }`
2. Buka SSE ke `/api/notulen/youtube/progress/:jobId`
3. Update progress bar dari event SSE
4. Saat `done: true` → navigasi ke DetailView dengan `sessionId` yang diterima
5. Saat `error: true` → tampilkan pesan error, reset form

**Warning durasi panjang:** Jika backend mengirim `durationSeconds > 7200` (2 jam) di response awal, tampilkan warning sebelum progress dimulai.

---

## 3. Perubahan Backend

### 3.1 Endpoint Baru

#### `POST /api/notulen/import-youtube`

Request body:
```json
{
  "url": "https://youtube.com/watch?v=...",
  "method": "cc" | "audio",
  "judul": "...",
  "sub_judul": "...",
  "pencatat": "...",
  "instansi": "...",
  "tanggal": "YYYY-MM-DD"
}
```

Response (immediate):
```json
{
  "success": true,
  "data": { "jobId": "uuid-...", "durationSeconds": 3600 }
}
```

Background job berjalan async, progress dikirim via SSE.

#### `GET /api/notulen/youtube/progress/:jobId`

SSE stream, event format:
```json
{ "percent": 40, "step": "Memproses chunk 2 dari 5...", "done": false }
{ "percent": 100, "step": "Selesai", "done": true, "sessionId": 42 }
{ "percent": 0, "step": "Video tidak dapat diakses", "error": true, "done": true }
```

### 3.2 Validasi URL

Hanya `youtube.com` dan `youtu.be` yang diterima:
```js
/^https?:\/\/(www\.)?(youtube\.com\/watch\?|youtu\.be\/)/.test(url)
```

### 3.3 Flow CC (Subtitle)

```
yt-dlp --write-auto-sub --sub-lang id,en --sub-format vtt --skip-download -o tmp/youtube/{jobId} URL
→ parse file .vtt menggunakan notulenService.parseVTT() yang sudah ada
→ notulenService.saveSegmentsBatch(sessionId, segments)
→ SSE: done + sessionId
```

Jika file .vtt tidak ditemukan: SSE error "Subtitle tidak tersedia. Coba metode Audio."

### 3.4 Flow Audio

```
yt-dlp -f bestaudio -x --audio-format mp3 -o tmp/youtube/{jobId}.mp3 URL
→ ffmpeg: split per chunk berdasarkan ukuran (target ≤ 24MB)
  ffmpeg -i input.mp3 -f segment -segment_time {chunkDuration} chunk_%03d.mp3
→ untuk tiap chunk:
    Groq Whisper → segments
    offset timestamp += durasi chunk sebelumnya
    retry 1x jika timeout
    skip jika tetap gagal
→ saveSegmentsBatch(sessionId, allSegments)
→ updateSessionStatus(sessionId, 'completed', totalDuration)
→ SSE: done + sessionId
```

Estimasi `chunkDuration` (detik):
```js
const fileSizeMB = fs.statSync(audioPath).size / 1024 / 1024;
const bitrateMbps = fileSizeMB / totalDurationSec;
const chunkDuration = Math.floor(24 / bitrateMbps); // target 24MB per chunk
```

### 3.5 Cleanup

File temp (`tmp/youtube/{jobId}*`) dihapus setelah job selesai — baik sukses maupun gagal — menggunakan `fs.rm()` dengan `{ recursive: true, force: true }`.

### 3.6 Prasyarat & Feature Flag

Di startup server, cek ketersediaan `yt-dlp` dan `ffmpeg`:
```js
const ytdlpAvailable = await checkBinary('yt-dlp');
const ffmpegAvailable = await checkBinary('ffmpeg');
```

Jika tidak tersedia, endpoint `/import-youtube` return 503 dengan pesan jelas. Frontend nonaktifkan tombol YouTube jika `GET /api/health` tidak melaporkan `ytdlp: true`.

---

## 4. Error Handling

| Kondisi | Handling |
|---------|----------|
| URL bukan YouTube | Validasi regex di frontend sebelum submit |
| Video privat / region-blocked | SSE `error: true`, step: "Video tidak dapat diakses" |
| CC tidak tersedia | SSE `error: true`, step: "Subtitle tidak tersedia. Coba metode Audio." |
| Chunk Groq timeout | Retry 1x, jika gagal skip + lanjut chunk berikutnya |
| yt-dlp/ffmpeg tidak ada | HTTP 503, tombol di-disable di frontend |
| Job SSE disconnected | File temp tetap dihapus via `finally` block; sesi tetap dibuat dan dapat ditemukan di list view |

---

## 5. Keamanan

- URL divalidasi di backend (whitelist youtube.com / youtu.be)
- Job ID pakai UUID — tidak bisa ditebak, tidak bisa akses job user lain
- File temp di direktori terisolasi `backend/tmp/youtube/` di luar `uploads/`
- Rate limit menggunakan `apiLimiter` yang sudah ada
- Token via query param untuk SSE (sama dengan pola summary progress yang sudah ada)

---

## 6. File yang Dibuat / Diubah

| File | Aksi |
|------|------|
| `frontend/src/pages/NotulenAI.jsx` | Tambah tab .txt, tambah `YouTubeView`, tambah tombol YouTube |
| `frontend/src/services/api.js` | Tambah `importYoutube()`, `youtubeProgressUrl()` |
| `backend/src/routes/notulen.routes.js` | Tambah endpoint `POST /import-youtube`, `GET /youtube/progress/:jobId` |
| `backend/src/services/notulen.service.js` | Tambah `importYoutubeCC()`, `importYoutubeAudio()`, `splitAudioChunks()` |
| `backend/src/server.js` | Tambah `tmp/youtube/` directory init di startup, extend `/api/health` response dengan `ytdlp` dan `ffmpeg` availability |

---

## 7. Yang Tidak Termasuk Scope

- Deteksi bahasa otomatis (selalu gunakan `id` sebagai prioritas, fallback `en`)
- Preview thumbnail/info video sebelum submit
- Queue antrian jika ada multiple job YouTube bersamaan (tiap request diproses langsung)
- Dukungan platform video selain YouTube
