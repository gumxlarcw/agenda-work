# Notulen: Tanya AI per Folder (Folder Q&A) — Design

**Tanggal:** 2026-07-06
**Status:** Disetujui user (mode, UI, arsitektur, kebijakan error)

## Tujuan

Di halaman `/notulen`, saat user berada di dalam sebuah folder, user dapat bertanya ke AI
dan AI menjawab berdasarkan **seluruh transkrip semua sesi di folder tersebut** — dijamin
semua transkrip tercover, tidak ada yang terpotong/terlewat.

## Keputusan produk (sudah dikonfirmasi user)

1. **Mode:** selalu transkrip penuh (map-reduce), bukan ringkasan. Latensi beberapa menit
   per pertanyaan diterima, dengan progress bar.
2. **UI:** tombol "Tanya AI" di baris breadcrumb folder → modal chat.
3. **Riwayat:** disimpan permanen di database per folder.
4. **Batch gagal:** jawab parsial + peringatan eksplisit di awal jawaban
   ("⚠️ X dari Y bagian transkrip gagal dibaca — jawaban mungkin tidak lengkap").

## Konteks & kendala teknis

- Data nyata saat desain: folder "Pelatihan Prakom" = 29 sesi / 2.151.650 karakter transkrip;
  folder "ISO 9001:2015" = 8 sesi / 1.258.497 karakter. Ringkasan tersimpan hanya ada di
  18/29 dan 3/8 sesi → ringkasan TIDAK bisa jadi sumber utama.
- LLM diakses via proxy `malika-llm-proxy` (`LLM_PROXY_URL`, model `LLM_MODEL`).
  Kontrak proxy (pelajaran insiden 503 Juni 2026): setiap panggilan harus memakai header
  `X-Long-Request: 1` dan selesai generate < ~120 detik agar tetap di tier primer yang
  bersih. Proxy TIDAK boleh dimodifikasi — semua solusi di sisi caller.
- Pola yang sudah terbukti di repo dan ditiru: POST balas langsung → job background →
  progress via in-memory Map → SSE endpoint (lihat `/:id/summary` + `/:id/summary/progress`
  di `backend/src/routes/notulen.routes.js`).

## Arsitektur

### Alur map-reduce (backend, `notulen.service.js`)

Fungsi baru `askFolderQuestion(folder, sessions, question, onProgress)`:

1. **Load:** semua sesi folder (status `recording`/`completed`, urut `tanggal` lalu
   `created_at`) + seluruh segmen per sesi (`getSegments`).
2. **Batching (murni programatik, tanpa LLM):**
   - Konstanta `ASK_BATCH_MAX_CHARS = 150000`. (As-built: dinaikkan dari 50000 setelah
     uji skala nyata menyingkap kuota upstream ~100 request/hari — jumlah panggilan per
     pertanyaan adalah kendala utama. Output ekstraksi tetap kecil sehingga input besar
     aman terhadap batas ~120 detik generasi.)
   - Transkrip per sesi = header metadata (`=== SESI: {judul} — {tanggal} ===`) + baris
     `[MM:SS] teks` (pakai `segmentsToTranscript` yang sudah ada).
   - Sesi digabung berurutan ke dalam batch sampai mendekati batas; sesi yang lebih besar
     dari batas dipecah menjadi beberapa batch dengan label `(bagian n/m)` pada header.
   - Invarian: **setiap segmen masuk tepat satu batch** — tidak ada truncation.
3. **Map (ekstraksi):** untuk tiap batch, satu panggilan LLM:
   - System prompt: ekstraktor informasi; kutip sumber `[Judul sesi — MM:SS]`; jika tidak
     ada info relevan jawab literal `TIDAK ADA INFORMASI RELEVAN`.
   - `max_tokens` 3000 (as-built; kompensasi batch lebih besar), `temperature` 0.3
     (mengikuti `llmCall` yang ada), header `X-Long-Request: 1`.
   - **Konkurensi 3** (pool sederhana). Retry per batch 2× dengan backoff (3s, 9s).
   - Batch yang tetap gagal dicatat — tidak menghentikan job, KECUALI ≥4 batch gagal
     beruntun (as-built: **circuit breaker** `ASK_ABORT_AFTER_CONSEC_FAILS = 4`) →
     kegagalan sistemik (mis. kuota harian habis; proxy hanya membalas 503 generik) →
     job dihentikan segera dengan pesan "kemungkinan kuota harian LLM habis".
   - Progress callback per batch selesai: `5% + (selesai/total) × 80%`,
     step `"Membaca transkrip batch {k}/{total}..."`.
4. **Reduce (sintesis):**
   - Buang hasil `TIDAK ADA INFORMASI RELEVAN`.
   - Jika gabungan ekstraksi ≤ 40.000 karakter → satu panggilan final: susun jawaban
     lengkap Bahasa Indonesia, sitasi sesi, sebutkan sesi mana saja yang memuat info.
   - Jika lebih besar → gabung bertingkat: kelompokkan ≤40rb karakter, panggilan merge
     per kelompok, lalu panggilan final atas hasil merge.
   - Jika ada batch gagal → jawaban diawali baris peringatan
     `⚠️ {x} dari {y} bagian transkrip gagal dibaca — jawaban mungkin tidak lengkap.`
     (ditambahkan programatik, bukan oleh LLM).
   - Jika SEMUA batch tidak relevan → jawaban jujur "tidak ditemukan di transkrip folder ini".
   - Progress 85→95% saat reduce, 100% selesai.
5. **Return:** `{ answer, batchTotal, batchFailed, sessionsCovered }`.

### Database

Migration `database/migrations/2026-07-06_notulen_folder_qa.sql`:

```sql
CREATE TABLE notulen_folder_qa (
  id INT AUTO_INCREMENT PRIMARY KEY,
  folder_id INT NOT NULL,
  user_id INT NOT NULL,
  question TEXT NOT NULL,
  answer MEDIUMTEXT NULL,
  status ENUM('processing','done','error') NOT NULL DEFAULT 'processing',
  error_message VARCHAR(500) NULL,
  sessions_covered INT NULL,
  batch_failed INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  answered_at TIMESTAMP NULL,
  CONSTRAINT fk_nfq_folder FOREIGN KEY (folder_id)
    REFERENCES notulen_folders(id) ON DELETE CASCADE,
  CONSTRAINT fk_nfq_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_nfq_folder (folder_id, created_at)
);
```

### Endpoint (di `notulen.routes.js`, SEBELUM route `/:id` agar tidak tertelan param route)

| Method | Path | Fungsi |
|---|---|---|
| POST | `/notulen/folders/:id/ask` | Validasi folder milik `req.user` + ada sesi + tidak ada QA `processing` aktif (409). Insert baris QA, balas langsung `{qaId}`, jalankan job background. |
| GET | `/notulen/folders/:id/ask/progress?qaId=&token=` | SSE progress — pola identik `/:id/summary/progress` (auth token via query, heartbeat 20s, poll Map 400ms, kirim `done`/`error` lalu tutup). |
| GET | `/notulen/folders/:id/qa` | Riwayat QA folder (limit 50, terbaru dulu). Baris `processing` yang tidak ada di Map progress (server pernah restart) → di-UPDATE jadi `error` "terputus". |
| DELETE | `/notulen/folders/:id/qa/:qaId` | Hapus satu entri riwayat (scoped folder+user). |

Progress in-memory: `const folderAskProgress = new Map()` keyed `qaId`, dibersihkan
15 detik setelah selesai (pola sama dengan `summaryProgress`).

Saat job selesai: `UPDATE notulen_folder_qa SET answer=?, status='done', sessions_covered=?,
batch_failed=?, answered_at=NOW() WHERE id=?` — hasil tetap tersimpan meski user sudah
menutup browser. Saat gagal total: `status='error', error_message=?`.

### Frontend (`NotulenAI.jsx` + `services/api.js`)

- `services/api.js` — tambah ke `notulenFoldersAPI`:
  `ask(folderId, question)`, `askProgressUrl(folderId, qaId)`, `listQA(folderId)`,
  `deleteQA(folderId, qaId)`.
- Baris breadcrumb folder (saat `folderFilter` = id folder): tombol **"🤖 Tanya AI"**.
- Komponen baru `FolderAskModal` (mengikuti gaya `EditModal` + panel Tanya AI di detail sesi):
  - Saat dibuka: muat riwayat (`listQA`) → render list Q&A (jawaban markdown via renderer
    yang sudah dipakai panel Tanya AI sesi), tombol hapus per entri.
  - Input pertanyaan + tombol Kirim. Submit → `ask()` → simpan `qaId` → buka
    `EventSource` ke `askProgressUrl` → tampilkan progress bar + teks step.
  - Event `done` → tampilkan jawaban, refresh riwayat. Event `error` → toast + tandai entri.
  - Jika saat dibuka ada QA `processing` milik user (dari riwayat), langsung sambung ke
    SSE-nya (resume setelah refresh).
  - Input dinonaktifkan selama ada pertanyaan yang diproses (selaras dengan guard 409).

## Error handling (ringkasan kebijakan)

| Kondisi | Perilaku |
|---|---|
| Batch gagal setelah 2× retry | Lanjut; jawaban parsial + peringatan ⚠️ programatik di awal jawaban; `batch_failed` disimpan. |
| Reduce/final call gagal | Retry 2×; jika tetap gagal → `status='error'`, progress `error:true`, riwayat menampilkan pesan gagal. |
| Folder kosong / tanpa segmen | 400 "Folder tidak memiliki transkrip". |
| QA lain masih `processing` di folder yang sama | 409 "Masih ada pertanyaan yang sedang diproses". |
| Server restart di tengah job | Baris `processing` yatim ditandai `error` saat riwayat dimuat berikutnya. |
| SSE putus (Cloudflare) | Heartbeat 20s; client `EventSource` auto-reconnect; hasil tetap aman di DB. |

## Testing & verifikasi

1. **Unit (tanpa LLM):** fungsi batching — segmen sintetis multi-sesi → assert semua segmen
   terdistribusi tepat satu kali, batas ukuran dihormati, label bagian benar.
2. **Integrasi langsung (pola verifikasi fix 503):** `require` service dari node REPL,
   panggil `askFolderQuestion` untuk folder ISO (8 sesi) dengan pertanyaan nyata →
   amati progress log, jawaban utuh, sitasi masuk akal.
3. **End-to-end:** via UI di folder kecil; cek riwayat tersimpan, refresh di tengah proses
   (resume SSE), guard 409, hapus entri.
4. Deploy: `pm2 restart agenda-backend` + build frontend sesuai alur deploy yang berlaku.

## Di luar cakupan (YAGNI)

- Streaming jawaban token-per-token (proxy melakukan buffering — tidak berguna).
- Embedding/RAG, pra-indeks intisari (ditolak — melanggar "semua tercover").
- Q&A lintas-folder atau folder bersarang.
- Modifikasi malika-llm-proxy.
