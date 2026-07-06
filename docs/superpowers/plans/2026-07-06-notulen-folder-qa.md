# Notulen Folder Q&A (Tanya AI per Folder) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Di halaman `/notulen`, user yang berada di dalam sebuah folder dapat bertanya ke AI dan mendapat jawaban yang disusun dari SELURUH transkrip semua sesi di folder itu (map-reduce, tanpa truncation), dengan progress SSE dan riwayat tersimpan di database.

**Architecture:** Backend menambahkan `buildAskBatches` (packing semua transkrip menjadi batch ≤50rb karakter, invarian: setiap segmen masuk tepat satu batch) dan `askFolderQuestion` (map: ekstraksi per batch paralel-3 dengan retry; reduce: sintesis bertingkat menjadi satu jawaban bersitasi). Endpoint meniru pola summary yang sudah terbukti: POST balas langsung → job background → progress via in-memory Map → SSE. Riwayat di tabel baru `notulen_folder_qa`. Frontend: tombol di breadcrumb folder → `FolderAskModal` (chat + progress + riwayat).

**Tech Stack:** Node.js/Express + mysql2 (backend), React + Vite + Tailwind (frontend), LLM via proxy OpenAI-compatible di `LLM_PROXY_URL` (default `http://localhost:3031/v1`), SSE via `EventSource`.

**Spec:** `docs/superpowers/specs/2026-07-06-notulen-folder-qa-design.md` (sudah disetujui user).

## Global Constraints

- **Backup wajib sebelum edit file apa pun:** `cp {file} {file}.backup` (timpa backup lama), dan setelah edit verifikasi dengan `diff {file}.backup {file}`. Ini aturan global user — berlaku untuk SETIAP task yang memodifikasi file.
- **JANGAN memodifikasi malika-llm-proxy** (`/opt/malika-llm-proxy`) — semua solusi di sisi caller.
- Setiap panggilan LLM: header `X-Long-Request: 1`, output dibatasi agar generasi < ~120 detik (pelajaran insiden 503).
- Bahasa UI dan pesan error: Bahasa Indonesia, konsisten dengan yang sudah ada.
- Backend berjalan via pm2 `agenda-backend`; perubahan backend butuh `pm2 restart agenda-backend` sebelum diuji lewat HTTP. Frontend: `agenda-frontend` (vite preview atas `dist/`), build dengan `npm run build`.
- Ada perubahan lain yang belum di-commit di working tree (`notulen.service.js`, `NotulenAI.jsx`) — saat commit, `git add` HANYA file/hunk milik task ini; jangan pernah `git add -A`.
- Tes backend = skrip Node polos (tanpa framework) di `backend/tests/`, dijalankan `node tests/<file>.js` dari folder `backend/`.

---

### Task 1: Migration tabel `notulen_folder_qa`

**Files:**
- Create: `database/migrations/2026-07-06_notulen_folder_qa.sql`

**Interfaces:**
- Produces: tabel `notulen_folder_qa` dengan kolom `id, folder_id, user_id, question, answer, status('processing'|'done'|'error'), error_message, sessions_covered, batch_failed, created_at, answered_at` — dipakai Task 4.

- [ ] **Step 1: Tulis file migration**

```sql
-- 2026-07-06 — Notulen folder Q&A: riwayat "Tanya AI per folder"
-- Rollback: DROP TABLE notulen_folder_qa;

CREATE TABLE IF NOT EXISTS notulen_folder_qa (
    id INT(11) NOT NULL AUTO_INCREMENT,
    folder_id INT(11) NOT NULL,
    user_id INT(11) NOT NULL,
    question TEXT NOT NULL,
    answer MEDIUMTEXT NULL,
    status ENUM('processing','done','error') NOT NULL DEFAULT 'processing',
    error_message VARCHAR(500) NULL,
    sessions_covered INT(11) NULL,
    batch_failed INT(11) NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    answered_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_nfq_folder (folder_id, created_at),
    CONSTRAINT fk_nfq_folder FOREIGN KEY (folder_id) REFERENCES notulen_folders(id) ON DELETE CASCADE,
    CONSTRAINT fk_nfq_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 2: Terapkan migration ke database**

File berisi SATU statement (komentar `--` dibuang dulu):

```bash
cd /var/www/html/agenda_work/backend && node -e "
const fs = require('fs');
const pool = require('./src/config/database');
(async () => {
  const raw = fs.readFileSync('../database/migrations/2026-07-06_notulen_folder_qa.sql', 'utf8');
  const sql = raw.split('\n').filter(l => !l.trim().startsWith('--')).join('\n').trim();
  await pool.query(sql);
  console.log('Migration OK');
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
"
```

Expected: `✅ Database connected successfully` lalu `Migration OK`.

- [ ] **Step 3: Verifikasi struktur tabel**

```bash
cd /var/www/html/agenda_work/backend && node -e "
const pool = require('./src/config/database');
(async () => {
  const [rows] = await pool.query('DESCRIBE notulen_folder_qa');
  console.table(rows.map(r => ({ Field: r.Field, Type: r.Type, Null: r.Null })));
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
"
```

Expected: 11 kolom sesuai Step 1 (id … answered_at).

- [ ] **Step 4: Commit**

```bash
cd /var/www/html/agenda_work && git add database/migrations/2026-07-06_notulen_folder_qa.sql && git commit -m "feat(notulen): migration tabel notulen_folder_qa untuk riwayat Tanya AI folder"
```

---

### Task 2: `buildAskBatches` — packing transkrip folder menjadi batch (TDD)

**Files:**
- Modify: `backend/src/services/notulen.service.js` (tambahkan setelah fungsi `askQuestion`, sebelum komentar `// --- YouTube CC Import ---`; tambahkan juga ke `module.exports`)
- Test: `backend/tests/folder-ask-batching.test.js` (create; buat folder `backend/tests/` jika belum ada)

**Interfaces:**
- Consumes: bentuk segmen DB yang sudah ada: `{ text, timestamp_seconds }`.
- Produces: `buildAskBatches(sessionsWithSegments, maxChars = ASK_BATCH_MAX_CHARS)` → `[{ text: string, sessionIds: number[] }]`. Input: `[{ session: {id, judul, tanggal}, segments: [{text, timestamp_seconds}] }]`. Konstanta `ASK_BATCH_MAX_CHARS = 50000`. Keduanya diekspor dari modul. Dipakai Task 3.

- [ ] **Step 1: Tulis failing test**

Buat `backend/tests/folder-ask-batching.test.js`:

```js
// Tes buildAskBatches — jalankan: node tests/folder-ask-batching.test.js (dari folder backend/)
const assert = require('assert');
const { buildAskBatches } = require('../src/services/notulen.service');

function makeSession(id, judul, nSegs, segLen) {
  const segments = [];
  for (let i = 0; i < nSegs; i++) {
    segments.push({ text: `${judul}-seg${i}-` + 'x'.repeat(segLen), timestamp_seconds: i * 10 });
  }
  return { session: { id, judul, tanggal: '2026-07-01' }, segments };
}

// 1. Dua sesi kecil → satu batch bersama, header per sesi ada
{
  const input = [makeSession(1, 'SesiA', 5, 50), makeSession(2, 'SesiB', 5, 50)];
  const batches = buildAskBatches(input, 10000);
  assert.strictEqual(batches.length, 1, 'dua sesi kecil harus berbagi satu batch');
  assert.ok(batches[0].text.includes('=== SESI: SesiA — 2026-07-01 ==='), 'header SesiA');
  assert.ok(batches[0].text.includes('=== SESI: SesiB — 2026-07-01 ==='), 'header SesiB');
  assert.deepStrictEqual(batches[0].sessionIds, [1, 2]);
}

// 2. Sesi lebih besar dari maxChars → dipecah dengan label (bagian n/m)
{
  const input = [makeSession(1, 'BIG', 40, 500)]; // ±20rb karakter
  const batches = buildAskBatches(input, 6000);
  assert.ok(batches.length >= 3, `sesi besar harus terpecah, dapat ${batches.length}`);
  assert.ok(batches[0].text.includes('(bagian 1/'), 'label bagian ada');
}

// 3. INVARIAN INTI: setiap segmen muncul TEPAT SATU KALI, berurutan
{
  const input = [makeSession(1, 'AA', 7, 800), makeSession(2, 'BB', 30, 700), makeSession(3, 'CC', 2, 100)];
  const batches = buildAskBatches(input, 5000);
  const allTexts = input.flatMap(s => s.segments.map(g => g.text));
  const joined = batches.map(b => b.text).join('\n');
  let pos = 0;
  for (const t of allTexts) {
    const idx = joined.indexOf(t, pos);
    assert.ok(idx >= 0, `segmen hilang/tidak urut: ${t.slice(0, 30)}`);
    pos = idx + t.length;
  }
  for (const t of allTexts) {
    assert.strictEqual(joined.split(t).length - 1, 1, `segmen duplikat: ${t.slice(0, 30)}`);
  }
  for (const b of batches) {
    assert.ok(b.text.length <= 5200, `batch melebihi batas: ${b.text.length}`);
  }
}

// 4. Sesi tanpa segmen dilewati tanpa error
{
  const input = [{ session: { id: 9, judul: 'Kosong', tanggal: '2026-07-01' }, segments: [] }, makeSession(1, 'Isi', 3, 40)];
  const batches = buildAskBatches(input, 10000);
  assert.strictEqual(batches.length, 1);
  assert.deepStrictEqual(batches[0].sessionIds, [1]);
}

console.log('✅ folder-ask-batching: semua tes lulus');
```

- [ ] **Step 2: Jalankan tes — pastikan GAGAL**

```bash
mkdir -p /var/www/html/agenda_work/backend/tests && cd /var/www/html/agenda_work/backend && node tests/folder-ask-batching.test.js
```

Expected: FAIL — `TypeError: buildAskBatches is not a function` (belum diekspor).

- [ ] **Step 3: Backup lalu implementasi**

```bash
cp /var/www/html/agenda_work/backend/src/services/notulen.service.js /var/www/html/agenda_work/backend/src/services/notulen.service.js.backup
```

Tambahkan di `notulen.service.js` setelah fungsi `askQuestion` (sebelum `// --- YouTube CC Import ---`):

```js
// --- Folder Q&A: batching ---
// Mengemas transkrip SEMUA sesi dalam satu folder menjadi batch berukuran aman
// untuk LLM. Invarian: setiap segmen masuk tepat satu batch — tidak ada yang
// dibuang/terpotong (syarat utama fitur "tanya AI per folder").
const ASK_BATCH_MAX_CHARS = 50000;

function fmtTanggalID(tanggal) {
  if (!tanggal) return '';
  if (tanggal instanceof Date) return tanggal.toISOString().slice(0, 10);
  return String(tanggal).slice(0, 10);
}

function buildAskBatches(sessionsWithSegments, maxChars = ASK_BATCH_MAX_CHARS) {
  // 1. Bentuk "unit": sesi kecil utuh, sesi besar dipecah jadi (bagian n/m).
  //    Satu unit tidak pernah dipecah lagi saat packing.
  const units = [];
  for (const { session, segments } of sessionsWithSegments) {
    if (!segments || segments.length === 0) continue;
    const lines = segments.map(s => {
      const mm = Math.floor(s.timestamp_seconds / 60).toString().padStart(2, '0');
      const ss = Math.floor(s.timestamp_seconds % 60).toString().padStart(2, '0');
      return `[${mm}:${ss}] ${s.text}`;
    });
    const headerFor = (part, total) =>
      `=== SESI: ${session.judul} — ${fmtTanggalID(session.tanggal)}${total > 1 ? ` (bagian ${part}/${total})` : ''} ===`;
    const budget = maxChars - headerFor(99, 99).length - 2;

    const parts = [];
    let cur = [], curLen = 0;
    for (const line of lines) {
      if (curLen + line.length + 1 > budget && cur.length > 0) {
        parts.push(cur);
        cur = [];
        curLen = 0;
      }
      cur.push(line);
      curLen += line.length + 1;
    }
    if (cur.length > 0) parts.push(cur);

    parts.forEach((partLines, i) => {
      units.push({
        sessionId: session.id,
        text: `${headerFor(i + 1, parts.length)}\n${partLines.join('\n')}`,
      });
    });
  }

  // 2. Packing: gabungkan unit utuh berurutan ke dalam batch ≤ maxChars.
  const batches = [];
  let bTexts = [], bLen = 0, bIds = [];
  const flush = () => {
    if (bTexts.length === 0) return;
    batches.push({ text: bTexts.join('\n\n'), sessionIds: [...new Set(bIds)] });
    bTexts = []; bLen = 0; bIds = [];
  };
  for (const u of units) {
    if (bLen + u.text.length + 2 > maxChars && bTexts.length > 0) flush();
    bTexts.push(u.text);
    bLen += u.text.length + 2;
    bIds.push(u.sessionId);
  }
  flush();
  return batches;
}
```

Tambahkan ke `module.exports` (di dalam objek yang sudah ada, setelah `askQuestion,`):

```js
  buildAskBatches,
  ASK_BATCH_MAX_CHARS,
```

- [ ] **Step 4: Jalankan tes — pastikan LULUS, lalu diff backup**

```bash
cd /var/www/html/agenda_work/backend && node tests/folder-ask-batching.test.js && diff src/services/notulen.service.js.backup src/services/notulen.service.js
```

Expected: `✅ folder-ask-batching: semua tes lulus`; diff hanya menunjukkan blok baru + 2 baris exports.

- [ ] **Step 5: Commit**

```bash
cd /var/www/html/agenda_work && git add backend/tests/folder-ask-batching.test.js backend/src/services/notulen.service.js && git commit -m "feat(notulen): buildAskBatches — packing transkrip folder tanpa truncation"
```

---

### Task 3: `askFolderQuestion` — map-reduce dengan retry, paralel-3, jawaban parsial berperingatan (TDD)

**Files:**
- Modify: `backend/src/services/notulen.service.js` (setelah blok `buildAskBatches` dari Task 2; tambah export)
- Test: `backend/tests/folder-ask-qa.test.js` (create)

**Interfaces:**
- Consumes: `buildAskBatches(sessionsWithSegments, maxChars)` dan `llmCall(messages, maxTokens)` (sudah ada — sudah mengirim `X-Long-Request: 1`).
- Produces: `askFolderQuestion(folder, sessionsWithSegments, question, onProgress, llm = null)` → `Promise<{ answer: string, batchTotal: number, batchFailed: number, sessionsCovered: number }>`. Param `llm` opsional `(messages, maxTokens) => Promise<string>` untuk dependency injection saat tes; default memakai `llmCall`. `onProgress(percent, step)`. Diekspor dari modul; dipakai Task 4.

- [ ] **Step 1: Tulis failing test (LLM palsu via DI — tanpa jaringan)**

Buat `backend/tests/folder-ask-qa.test.js`:

```js
// Tes askFolderQuestion dengan LLM palsu — jalankan: node tests/folder-ask-qa.test.js (dari backend/)
const assert = require('assert');
const { askFolderQuestion } = require('../src/services/notulen.service');

const folder = { id: 7, name: 'Folder Uji' };
function makeSession(id, judul, nSegs, segLen) {
  const segments = [];
  for (let i = 0; i < nSegs; i++) {
    segments.push({ text: `${judul}-seg${i}-` + 'x'.repeat(segLen), timestamp_seconds: i * 10 });
  }
  return { session: { id, judul, tanggal: '2026-07-01' }, segments };
}
// 3 sesi ±1000 karakter → dengan maxChars default 50000 semuanya = 1 batch,
// jadi tes memakai banyak sesi besar agar multi-batch: 4 sesi × ±30rb = ±3 batch.
const sessions = [1, 2, 3, 4].map(i => makeSession(i, `Sesi${i}`, 40, 700));

(async () => {
  // 1. Alur normal: N panggilan ekstraksi + 1 panggilan final; jawaban dari LLM final
  {
    // PENTING: bedakan jenis panggilan dengan frasa UNIK 'asisten ekstraksi informasi'
    // (kata "ekstraksi" saja juga muncul di system prompt merge & final).
    const isExtract = (msgs) => msgs[0].content.includes('asisten ekstraksi informasi');
    const calls = [];
    const fakeLlm = async (messages, maxTokens) => {
      calls.push({ system: messages[0].content, user: messages[1].content, maxTokens });
      if (isExtract(messages)) {
        return 'Fakta relevan [SesiX — 00:10]';
      }
      return 'JAWABAN FINAL dengan sitasi [Sesi1 — 00:10]';
    };
    const progressLog = [];
    const result = await askFolderQuestion(folder, sessions, 'Apa isi rapat?',
      (p, s) => progressLog.push([p, s]), fakeLlm);

    const extractCalls = calls.filter(c => c.system.includes('asisten ekstraksi informasi'));
    const finalCalls = calls.filter(c => !c.system.includes('asisten ekstraksi informasi'));
    assert.ok(extractCalls.length >= 2, `harus multi-batch, dapat ${extractCalls.length}`);
    assert.strictEqual(finalCalls.length, 1, 'tepat satu panggilan final');
    assert.ok(finalCalls[0].user.includes('Apa isi rapat?'), 'pertanyaan sampai ke final');
    assert.ok(finalCalls[0].user.includes('Folder Uji'), 'nama folder di konteks final');
    assert.strictEqual(result.answer, 'JAWABAN FINAL dengan sitasi [Sesi1 — 00:10]');
    assert.strictEqual(result.batchFailed, 0);
    assert.strictEqual(result.sessionsCovered, 4);
    assert.ok(progressLog.some(([p]) => p === 100), 'progress mencapai 100');
    // Setiap batch (semua segmen) benar-benar terkirim ke LLM ekstraksi
    const sentText = extractCalls.map(c => c.user).join('\n');
    for (const s of sessions) {
      for (const seg of s.segments) {
        assert.ok(sentText.includes(seg.text), `segmen tidak terkirim: ${seg.text.slice(0, 25)}`);
      }
    }
  }

  // 2. Satu batch gagal permanen → jawaban parsial + peringatan ⚠️ + batchFailed=1
  {
    let extractSeq = 0;
    const fakeLlm = async (messages) => {
      if (messages[0].content.includes('asisten ekstraksi informasi')) {
        extractSeq++;
        if (extractSeq === 1) throw new Error('proxy 503'); // hanya panggilan pertama yang gagal
        return 'Fakta relevan [SesiX — 00:10]';
      }
      return 'JAWABAN PARSIAL';
    };
    await askFolderQuestion(folder, sessions, 'Apa isi rapat?', null, fakeLlm);
    // retry 3× untuk batch pertama → extractSeq 1..3 semua throw? Tidak: hanya panggilan
    // pertama yang throw (extractSeq===1), retry ke-2 berhasil. Untuk gagal permanen,
    // gunakan penanda di teks batch — lihat di bawah.
  }

  // 2b. Gagal permanen berdasarkan isi batch (batch pertama selalu gagal)
  {
    const fakeLlm = async (messages) => {
      if (messages[0].content.includes('asisten ekstraksi informasi')) {
        if (messages[1].content.includes('Sesi1-seg0-')) throw new Error('proxy 503');
        return 'Fakta relevan [SesiX — 00:10]';
      }
      return 'JAWABAN PARSIAL';
    };
    const result = await askFolderQuestion(folder, sessions, 'Apa isi rapat?', null, fakeLlm);
    assert.strictEqual(result.batchFailed, 1, 'satu batch gagal');
    assert.ok(result.answer.startsWith('⚠️'), 'ada peringatan parsial di awal jawaban');
    assert.ok(result.answer.includes('bagian transkrip gagal dibaca'), 'kalimat peringatan sesuai spec');
    assert.ok(result.answer.includes('JAWABAN PARSIAL'), 'jawaban tetap disusun');
  }

  // 3. Semua batch "TIDAK ADA INFORMASI RELEVAN" → jawaban jujur, tanpa panggilan final
  {
    const calls = [];
    const fakeLlm = async (messages) => {
      calls.push(messages[0].content);
      return 'TIDAK ADA INFORMASI RELEVAN';
    };
    const result = await askFolderQuestion(folder, sessions, 'Siapa presiden Mars?', null, fakeLlm);
    assert.ok(result.answer.includes('Tidak ditemukan informasi'), 'jawaban jujur');
    assert.ok(calls.every(c => c.includes('asisten ekstraksi informasi')), 'tidak ada panggilan final/reduce');
  }

  // 4. Semua batch gagal → throw (bukan jawaban kosong)
  {
    const fakeLlm = async (messages) => {
      if (messages[0].content.includes('asisten ekstraksi informasi')) throw new Error('proxy mati');
      return 'X';
    };
    let threw = false;
    try { await askFolderQuestion(folder, sessions, 'Apa saja?', null, fakeLlm); }
    catch (err) { threw = true; assert.ok(err.message.includes('Semua batch')); }
    assert.ok(threw, 'harus throw saat semua batch gagal');
  }

  console.log('✅ folder-ask-qa: semua tes lulus');
  process.exit(0);
})().catch(err => { console.error('❌', err.message); process.exit(1); });
```

Catatan untuk implementer: blok tes `2.` di atas sengaja hanya dokumentasi perilaku retry (panggilan gagal sekali lalu retry sukses = TIDAK dihitung gagal); assertion nyatanya di blok `2b`. Retry cepat saat tes: lihat `ASK_RETRY_BASE_MS` di Step 3 — set via env `ASK_RETRY_BASE_MS=1` saat menjalankan tes.

- [ ] **Step 2: Jalankan tes — pastikan GAGAL**

```bash
cd /var/www/html/agenda_work/backend && ASK_RETRY_BASE_MS=1 node tests/folder-ask-qa.test.js
```

Expected: FAIL — `askFolderQuestion is not a function`.

- [ ] **Step 3: Backup lalu implementasi**

```bash
cp /var/www/html/agenda_work/backend/src/services/notulen.service.js /var/www/html/agenda_work/backend/src/services/notulen.service.js.backup
```

Tambahkan setelah blok `buildAskBatches` (Task 2):

```js
// --- Folder Q&A: map-reduce atas SEMUA transkrip dalam satu folder ---
// Map: tiap batch → panggilan ekstraksi (paralel ASK_CONCURRENCY, retry 3×).
// Reduce: hasil ekstraksi digabung (bertingkat bila perlu) → satu jawaban
// bersitasi. Batch yang tetap gagal TIDAK menghentikan job — jawaban parsial
// diberi peringatan eksplisit (keputusan user, lihat spec 2026-07-06).
const ASK_CONCURRENCY = 3;
const ASK_EXTRACT_MAX_TOKENS = 2000;
const ASK_FINAL_MAX_TOKENS = 8000;
const ASK_REDUCE_GROUP_MAX_CHARS = 40000;
const ASK_RETRY_BASE_MS = parseInt(process.env.ASK_RETRY_BASE_MS || '3000');
const NO_INFO_MARKER = 'TIDAK ADA INFORMASI RELEVAN';

const ASK_EXTRACT_SYSTEM = `Kamu adalah asisten ekstraksi informasi. Kamu menerima potongan transkrip dari beberapa sesi rekaman dalam satu folder, plus satu pertanyaan. Tugasmu: kutip dan rangkum SEMUA informasi dari transkrip yang relevan dengan pertanyaan itu.
Aturan:
- Sebutkan sumber setiap informasi dalam format [Judul sesi — MM:SS].
- Jangan menjawab pertanyaannya — hanya kumpulkan bahan mentah yang relevan.
- Jangan mengarang; hanya dari transkrip yang diberikan.
- Jika TIDAK ADA informasi yang relevan sama sekali, balas persis: ${NO_INFO_MARKER}`;

const ASK_MERGE_SYSTEM = `Kamu adalah asisten yang menggabungkan beberapa kumpulan catatan hasil ekstraksi transkrip. Gabungkan TANPA menghilangkan informasi apa pun, pertahankan semua sitasi [Judul sesi — MM:SS], hilangkan hanya duplikat persis.`;

const ASK_FINAL_SYSTEM = `Kamu adalah asisten yang menjawab pertanyaan berdasarkan kumpulan catatan hasil ekstraksi dari transkrip SEMUA sesi dalam satu folder. Jawab lengkap dan terstruktur dalam Bahasa Indonesia, format Markdown, sertakan sitasi [Judul sesi — MM:SS] pada poin-poin penting. Jika catatan tidak memuat jawabannya, katakan dengan jujur. Di akhir jawaban, sebutkan sesi mana saja yang menjadi sumber jawaban.`;

async function llmWithRetry(llm, messages, maxTokens, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await llm(messages, maxTokens);
    } catch (err) {
      lastErr = err;
      if (i < tries - 1) await new Promise(r => setTimeout(r, ASK_RETRY_BASE_MS * Math.pow(3, i)));
    }
  }
  throw lastErr;
}

// Pool sederhana: jalankan worker(item) maksimal `limit` bersamaan.
// Worker yang melempar error menghasilkan { __error } di posisi itu (urutan terjaga).
async function promisePool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i).catch(err => ({ __error: err }));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function askFolderQuestion(folder, sessionsWithSegments, question, onProgress, llm = null) {
  const progress = onProgress || (() => {});
  const callLlm = llm || ((messages, maxTokens) => llmCall(messages, maxTokens));

  progress(2, 'Menyiapkan transkrip...');
  const batches = buildAskBatches(sessionsWithSegments);
  const total = batches.length;
  if (total === 0) throw new Error('Folder tidak memiliki transkrip.');
  console.log(`[notulen] Folder ask: folder=${folder.id} sessions=${sessionsWithSegments.length} batches=${total}`);

  // MAP — ekstraksi per batch, paralel, retry per batch
  let doneCount = 0;
  const mapResults = await promisePool(batches, ASK_CONCURRENCY, async (batch) => {
    try {
      return await llmWithRetry(callLlm, [
        { role: 'system', content: ASK_EXTRACT_SYSTEM },
        { role: 'user', content: `PERTANYAAN: ${question}\n\nTRANSKRIP:\n${batch.text}` },
      ], ASK_EXTRACT_MAX_TOKENS);
    } finally {
      doneCount++;
      progress(5 + Math.round((doneCount / total) * 80), `Membaca transkrip batch ${doneCount}/${total}...`);
    }
  });

  const failed = mapResults.filter(r => r && r.__error).length;
  if (failed === total) throw new Error('Semua batch transkrip gagal diproses. Coba lagi.');
  if (failed > 0) console.warn(`[notulen] Folder ask: ${failed}/${total} batch gagal setelah retry`);

  const relevant = mapResults
    .filter(r => typeof r === 'string')
    .map(r => r.trim())
    .filter(r => r && !r.toUpperCase().includes(NO_INFO_MARKER));

  let answer;
  if (relevant.length === 0) {
    answer = `Tidak ditemukan informasi yang relevan dengan pertanyaan ini di transkrip folder "${folder.name}" (${sessionsWithSegments.length} sesi diperiksa).`;
  } else {
    // REDUCE — gabung bertingkat bila materi ekstraksi terlalu besar untuk satu panggilan
    progress(86, 'Menyusun jawaban...');
    let material = relevant;
    while (material.join('\n\n---\n\n').length > ASK_REDUCE_GROUP_MAX_CHARS && material.length > 1) {
      const groups = [];
      let cur = [], curLen = 0;
      for (const m of material) {
        if (curLen + m.length > ASK_REDUCE_GROUP_MAX_CHARS && cur.length > 0) {
          groups.push(cur); cur = []; curLen = 0;
        }
        cur.push(m); curLen += m.length;
      }
      if (cur.length > 0) groups.push(cur);
      progress(88, `Menggabungkan catatan (${groups.length} kelompok)...`);
      const merged = await promisePool(groups, ASK_CONCURRENCY, (group) =>
        llmWithRetry(callLlm, [
          { role: 'system', content: ASK_MERGE_SYSTEM },
          { role: 'user', content: `PERTANYAAN (untuk konteks relevansi): ${question}\n\nCATATAN:\n${group.join('\n\n---\n\n')}` },
        ], ASK_EXTRACT_MAX_TOKENS));
      // Kegagalan merge = kehilangan materi ekstraksi → JANGAN dibuang diam-diam
      // (janji coverage). llmWithRetry sudah retry 3× — kalau tetap gagal, gagalkan job.
      if (merged.some(r => r && r.__error)) throw new Error('Gagal menggabungkan catatan ekstraksi. Coba lagi.');
      material = merged.map(r => String(r).trim()).filter(Boolean);
      if (material.length === 0) throw new Error('Gagal menggabungkan catatan ekstraksi. Coba lagi.');
    }

    progress(92, 'Menyusun jawaban akhir...');
    const headerInfo = `INFORMASI FOLDER:
- Nama folder: ${folder.name}
- Jumlah sesi: ${sessionsWithSegments.length}
- Daftar sesi: ${sessionsWithSegments.map(s => `${s.session.judul} (${fmtTanggalID(s.session.tanggal)})`).join('; ')}`;
    answer = await llmWithRetry(callLlm, [
      { role: 'system', content: ASK_FINAL_SYSTEM },
      { role: 'user', content: `${headerInfo}\n\nCATATAN HASIL EKSTRAKSI:\n${material.join('\n\n---\n\n')}\n\nPERTANYAAN: ${question}` },
    ], ASK_FINAL_MAX_TOKENS);
  }

  // Peringatan parsial ditambahkan PROGRAMATIK (bukan oleh LLM) — sesuai spec
  if (failed > 0) {
    answer = `⚠️ ${failed} dari ${total} bagian transkrip gagal dibaca — jawaban mungkin tidak lengkap.\n\n${answer}`;
  }

  progress(100, 'Selesai');
  return {
    answer,
    batchTotal: total,
    batchFailed: failed,
    sessionsCovered: sessionsWithSegments.length,
  };
}
```

Tambahkan ke `module.exports` (setelah `ASK_BATCH_MAX_CHARS,`):

```js
  askFolderQuestion,
```

- [ ] **Step 4: Jalankan kedua tes — pastikan LULUS, lalu diff backup**

```bash
cd /var/www/html/agenda_work/backend && ASK_RETRY_BASE_MS=1 node tests/folder-ask-qa.test.js && node tests/folder-ask-batching.test.js && diff src/services/notulen.service.js.backup src/services/notulen.service.js
```

Expected: `✅ folder-ask-qa: semua tes lulus` dan `✅ folder-ask-batching: semua tes lulus`.

- [ ] **Step 5: Commit**

```bash
cd /var/www/html/agenda_work && git add backend/tests/folder-ask-qa.test.js backend/src/services/notulen.service.js && git commit -m "feat(notulen): askFolderQuestion — map-reduce Q&A atas semua transkrip folder"
```

---

### Task 4: Helper DB + 4 endpoint folder Q&A (POST ask, SSE progress, riwayat, hapus)

**Files:**
- Modify: `backend/src/services/notulen.service.js` (helper DB, setelah blok `askFolderQuestion`; tambah exports)
- Modify: `backend/src/routes/notulen.routes.js` (blok route baru setelah `router.delete('/folders/:id', ...)` — sekitar baris 155, SEBELUM `router.get('/:id', ...)`)
- Test: verifikasi langsung via node + curl (lihat Step 3–4)

**Interfaces:**
- Consumes: `askFolderQuestion` (Task 3), tabel `notulen_folder_qa` (Task 1), middleware `verifyToken` (sudah di-import di routes; `req.user` = baris users lengkap, `req.user.id` + `req.user.role`).
- Produces (service exports, dipakai routes):
  - `getFolderOwned(folderId, userId)` → baris folder atau `null`
  - `getFolderSessionsWithSegments(folderId)` → `[{ session: {id, judul, tanggal, ...}, segments: [...] }]` urut tanggal
  - `createFolderQA(folderId, userId, question)` → `qaId`
  - `finishFolderQA(qaId, { answer, sessionsCovered, batchFailed })`
  - `failFolderQA(qaId, message)`
  - `listFolderQA(folderId, userId, liveIds)` → baris QA (max 50, terbaru dulu); baris `processing` yang TIDAK ada di `liveIds` ditandai `error` (orphan pasca-restart)
  - `deleteFolderQA(qaId, folderId, userId)` → boolean
- Produces (HTTP, dipakai Task 5–6): `POST /api/notulen/folders/:id/ask {question}` → `{success, data:{qaId}}` | 400/404/409; `GET /api/notulen/folders/:id/ask/progress?qaId=&token=` → SSE `{percent, step, done?, error?, answer?}`; `GET /api/notulen/folders/:id/qa` → `{success, data:[...]}`; `DELETE /api/notulen/folders/:id/qa/:qaId`.

- [ ] **Step 1: Backup kedua file**

```bash
cp /var/www/html/agenda_work/backend/src/services/notulen.service.js /var/www/html/agenda_work/backend/src/services/notulen.service.js.backup
cp /var/www/html/agenda_work/backend/src/routes/notulen.routes.js /var/www/html/agenda_work/backend/src/routes/notulen.routes.js.backup
```

- [ ] **Step 2: Tambahkan helper DB di service**

Setelah blok `askFolderQuestion`, tambahkan:

```js
// --- Folder Q&A: DB helpers ---

async function getFolderOwned(folderId, userId) {
  const [rows] = await pool.query(
    'SELECT * FROM notulen_folders WHERE id = ? AND user_id = ?',
    [folderId, userId]
  );
  return rows[0] || null;
}

async function getFolderSessionsWithSegments(folderId) {
  const [sessions] = await pool.query(
    `SELECT * FROM notulen_sessions
     WHERE folder_id = ? AND status IN ('recording','completed')
     ORDER BY tanggal ASC, created_at ASC, id ASC`,
    [folderId]
  );
  const result = [];
  for (const session of sessions) {
    const segments = await getSegments(session.id);
    result.push({ session, segments });
  }
  return result;
}

async function createFolderQA(folderId, userId, question) {
  const [r] = await pool.query(
    'INSERT INTO notulen_folder_qa (folder_id, user_id, question) VALUES (?, ?, ?)',
    [folderId, userId, question]
  );
  return r.insertId;
}

async function finishFolderQA(qaId, { answer, sessionsCovered, batchFailed }) {
  await pool.query(
    `UPDATE notulen_folder_qa
     SET answer = ?, status = 'done', sessions_covered = ?, batch_failed = ?, answered_at = NOW()
     WHERE id = ?`,
    [answer, sessionsCovered, batchFailed, qaId]
  );
}

async function failFolderQA(qaId, message) {
  await pool.query(
    `UPDATE notulen_folder_qa SET status = 'error', error_message = ? WHERE id = ?`,
    [String(message || 'Gagal').slice(0, 500), qaId]
  );
}

// liveIds = qaId yang jobnya masih hidup di memori route. Baris 'processing'
// di luar daftar itu adalah orphan (server restart di tengah job) → error.
async function listFolderQA(folderId, userId, liveIds = []) {
  if (liveIds.length > 0) {
    await pool.query(
      `UPDATE notulen_folder_qa SET status = 'error', error_message = 'Terputus (server restart)'
       WHERE folder_id = ? AND status = 'processing' AND id NOT IN (${liveIds.map(() => '?').join(',')})`,
      [folderId, ...liveIds]
    );
  } else {
    await pool.query(
      `UPDATE notulen_folder_qa SET status = 'error', error_message = 'Terputus (server restart)'
       WHERE folder_id = ? AND status = 'processing'`,
      [folderId]
    );
  }
  const [rows] = await pool.query(
    `SELECT * FROM notulen_folder_qa WHERE folder_id = ? AND user_id = ?
     ORDER BY created_at DESC, id DESC LIMIT 50`,
    [folderId, userId]
  );
  return rows;
}

async function deleteFolderQA(qaId, folderId, userId) {
  const [r] = await pool.query(
    'DELETE FROM notulen_folder_qa WHERE id = ? AND folder_id = ? AND user_id = ?',
    [qaId, folderId, userId]
  );
  return r.affectedRows > 0;
}
```

Tambahkan ke `module.exports` (setelah `askFolderQuestion,`):

```js
  getFolderOwned,
  getFolderSessionsWithSegments,
  createFolderQA,
  finishFolderQA,
  failFolderQA,
  listFolderQA,
  deleteFolderQA,
```

- [ ] **Step 3: Tambahkan route di `notulen.routes.js`**

Sisipkan SETELAH blok `router.delete('/folders/:id', ...)` dan SEBELUM `router.get('/:id', ...)` (urutan penting — Express mencocokkan berurutan; `/folders/...` harus menang atas `/:id`):

```js
// ═══════════════════════════════════════════════════════════════
// FOLDER Q&A — "Tanya AI" atas SEMUA transkrip dalam satu folder.
// Map-reduce di notulenService.askFolderQuestion; progress via SSE
// (pola sama dengan /:id/summary). Riwayat di tabel notulen_folder_qa
// (migrations/2026-07-06_notulen_folder_qa.sql).
// ═══════════════════════════════════════════════════════════════
const folderAskProgress = new Map(); // qaId(string) → {percent, step, done?, error?, answer?}

// POST ajukan pertanyaan — balas langsung {qaId}, job jalan di background
router.post('/folders/:id/ask', verifyToken, async (req, res) => {
  try {
    const question = (req.body.question || '').trim();
    if (!question) return res.status(400).json({ success: false, message: 'Pertanyaan diperlukan' });

    const folder = await notulenService.getFolderOwned(req.params.id, req.user.id);
    if (!folder) return res.status(404).json({ success: false, message: 'Folder tidak ditemukan' });

    // Satu pertanyaan aktif per folder — listFolderQA sekaligus membersihkan orphan
    const liveIds = [...folderAskProgress.keys()];
    const existing = await notulenService.listFolderQA(folder.id, req.user.id, liveIds);
    if (existing.some(r => r.status === 'processing')) {
      return res.status(409).json({ success: false, message: 'Masih ada pertanyaan yang sedang diproses di folder ini' });
    }

    const sessions = await notulenService.getFolderSessionsWithSegments(folder.id);
    const segCount = sessions.reduce((n, s) => n + s.segments.length, 0);
    if (segCount === 0) return res.status(400).json({ success: false, message: 'Folder tidak memiliki transkrip' });

    const qaId = await notulenService.createFolderQA(folder.id, req.user.id, question);
    folderAskProgress.set(String(qaId), { percent: 0, step: 'Memulai...' });
    res.json({ success: true, data: { qaId } });

    // Background — hasil dikirim via SSE dan disimpan permanen di DB
    notulenService.askFolderQuestion(folder, sessions, question, (percent, step) => {
      folderAskProgress.set(String(qaId), { percent, step });
    }).then(async ({ answer, sessionsCovered, batchFailed }) => {
      await notulenService.finishFolderQA(qaId, { answer, sessionsCovered, batchFailed });
      folderAskProgress.set(String(qaId), { percent: 100, step: 'Selesai', done: true, answer });
    }).catch(async (err) => {
      console.error('[notulen] Folder ask error:', err.message);
      await notulenService.failFolderQA(qaId, err.message).catch(() => {});
      folderAskProgress.set(String(qaId), { percent: 0, step: err.message, error: true, done: true });
    }).finally(() => {
      setTimeout(() => folderAskProgress.delete(String(qaId)), 15000);
    });
  } catch (err) {
    console.error('[notulen] Folder ask error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal memulai pertanyaan' });
  }
});

// SSE progress — token via query karena EventSource tidak bisa set header
router.get('/folders/:id/ask/progress', (req, res, next) => {
  if (req.query.token) req.headers.authorization = `Bearer ${req.query.token}`;
  next();
}, verifyToken, (req, res) => {
  const key = String(req.query.qaId || '');
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
    const prog = folderAskProgress.get(key);
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
  req.on('close', () => { clearInterval(pollInterval); clearInterval(hbInterval); });
});

// GET riwayat Q&A folder
router.get('/folders/:id/qa', verifyToken, async (req, res) => {
  try {
    const folder = await notulenService.getFolderOwned(req.params.id, req.user.id);
    if (!folder) return res.status(404).json({ success: false, message: 'Folder tidak ditemukan' });
    const rows = await notulenService.listFolderQA(folder.id, req.user.id, [...folderAskProgress.keys()]);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[notulen] Folder QA list error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal memuat riwayat' });
  }
});

// DELETE satu entri riwayat
router.delete('/folders/:id/qa/:qaId', verifyToken, async (req, res) => {
  try {
    const ok = await notulenService.deleteFolderQA(req.params.qaId, req.params.id, req.user.id);
    if (!ok) return res.status(404).json({ success: false, message: 'Riwayat tidak ditemukan' });
    res.json({ success: true, message: 'Riwayat dihapus' });
  } catch (err) {
    console.error('[notulen] Folder QA delete error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal menghapus riwayat' });
  }
});
```

- [ ] **Step 4: Verifikasi helper DB langsung (tanpa HTTP)**

```bash
cd /var/www/html/agenda_work/backend && node -e "
const svc = require('./src/services/notulen.service');
const pool = require('./src/config/database');
(async () => {
  const [[f]] = await pool.query('SELECT * FROM notulen_folders LIMIT 1');
  if (!f) { console.log('SKIP: tidak ada folder'); process.exit(0); }
  // create → finish → list → delete (round-trip penuh)
  const qaId = await svc.createFolderQA(f.id, f.user_id, 'Tes pertanyaan?');
  await svc.finishFolderQA(qaId, { answer: 'Tes jawaban', sessionsCovered: 3, batchFailed: 0 });
  let rows = await svc.listFolderQA(f.id, f.user_id, []);
  const row = rows.find(r => r.id === qaId);
  console.assert(row && row.status === 'done' && row.answer === 'Tes jawaban', 'FAIL: finish/list');
  // orphan: baris processing tanpa liveIds → error
  const qa2 = await svc.createFolderQA(f.id, f.user_id, 'Orphan?');
  rows = await svc.listFolderQA(f.id, f.user_id, []);
  console.assert(rows.find(r => r.id === qa2).status === 'error', 'FAIL: orphan marking');
  // liveIds melindungi job hidup
  const qa3 = await svc.createFolderQA(f.id, f.user_id, 'Live?');
  rows = await svc.listFolderQA(f.id, f.user_id, [String(qa3)]);
  console.assert(rows.find(r => r.id === qa3).status === 'processing', 'FAIL: liveIds protection');
  // cleanup
  for (const id of [qaId, qa2, qa3]) await svc.deleteFolderQA(id, f.id, f.user_id);
  rows = await svc.listFolderQA(f.id, f.user_id, []);
  console.assert(!rows.some(r => [qaId, qa2, qa3].includes(r.id)), 'FAIL: delete');
  console.log('✅ DB helpers OK');
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
"
```

Expected: `✅ DB helpers OK` (tanpa `FAIL:`).

- [ ] **Step 5: Restart backend, smoke test route via curl**

Token uji dibuat dengan payload `{ userId }` (bentuk yang sama dengan login, lihat `auth.routes.js`):

```bash
cd /var/www/html/agenda_work/backend && pm2 restart agenda-backend && sleep 3
TOKEN=$(node -e "
require('dotenv').config();
const jwt = require('jsonwebtoken');
const pool = require('./src/config/database');
(async () => {
  const [[f]] = await pool.query('SELECT user_id FROM notulen_folders LIMIT 1');
  console.log(jwt.sign({ userId: f.user_id }, process.env.JWT_SECRET, { expiresIn: '1h' }));
  process.exit(0);
})();" | tail -1)
PORT=$(grep -E '^PORT=' .env | cut -d= -f2); PORT=${PORT:-5100}
FID=$(node -e "
const pool = require('./src/config/database');
pool.query('SELECT id FROM notulen_folders LIMIT 1').then(([[r]]) => { console.log(r.id); process.exit(0); });" | tail -1)
# Riwayat (200, data array)
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:$PORT/api/notulen/folders/$FID/qa" | head -c 300; echo
# Tanpa pertanyaan → 400
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}' "http://localhost:$PORT/api/notulen/folders/$FID/ask"; echo
# Folder bukan milik user (id 999999) → 404
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:$PORT/api/notulen/folders/999999/qa"; echo
```

Expected: baris 1 `{"success":true,"data":[...]}`; baris 2 `{"success":false,"message":"Pertanyaan diperlukan"}`; baris 3 `{"success":false,"message":"Folder tidak ditemukan"}`.
(Catatan: cek nama var PORT di `backend/.env` — jika tidak ada `PORT=`, lihat `src/server.js` untuk default.)

- [ ] **Step 6: Diff backup kedua file, lalu commit**

```bash
cd /var/www/html/agenda_work/backend && diff src/services/notulen.service.js.backup src/services/notulen.service.js; diff src/routes/notulen.routes.js.backup src/routes/notulen.routes.js
cd /var/www/html/agenda_work && git add backend/src/services/notulen.service.js backend/src/routes/notulen.routes.js && git commit -m "feat(notulen): endpoint folder Q&A — ask + SSE progress + riwayat tersimpan"
```

---

### Task 5: API client frontend (`services/api.js`)

**Files:**
- Modify: `frontend/src/services/api.js` — objek `notulenFoldersAPI` (sekitar baris 366)

**Interfaces:**
- Consumes: endpoint Task 4.
- Produces (dipakai Task 6): `notulenFoldersAPI.ask(id, question)`, `notulenFoldersAPI.askProgressUrl(id, qaId)`, `notulenFoldersAPI.listQA(id)`, `notulenFoldersAPI.deleteQA(id, qaId)`.

- [ ] **Step 1: Backup**

```bash
cp /var/www/html/agenda_work/frontend/src/services/api.js /var/www/html/agenda_work/frontend/src/services/api.js.backup
```

- [ ] **Step 2: Tambahkan 4 method**

Ubah objek yang sudah ada menjadi (4 baris terakhir baru; `askProgressUrl` meniru persis `summaryProgressUrl` — token localStorage `accessToken`, base prod `https://api-agenda.bpsmalut.com/api`):

```js
export const notulenFoldersAPI = {
  list: () => api.get('/notulen/folders'),
  create: (data) => api.post('/notulen/folders', data),
  update: (id, data) => api.put(`/notulen/folders/${id}`, data),
  delete: (id) => api.delete(`/notulen/folders/${id}`),
  ask: (id, question) => api.post(`/notulen/folders/${id}/ask`, { question }),
  askProgressUrl: (id, qaId) => {
    const token = localStorage.getItem('accessToken');
    const base = import.meta.env.PROD ? 'https://api-agenda.bpsmalut.com/api' : '/api';
    return `${base}/notulen/folders/${id}/ask/progress?qaId=${qaId}&token=${encodeURIComponent(token)}`;
  },
  listQA: (id) => api.get(`/notulen/folders/${id}/qa`),
  deleteQA: (id, qaId) => api.delete(`/notulen/folders/${id}/qa/${qaId}`),
};
```

- [ ] **Step 3: Verifikasi build + diff**

```bash
cd /var/www/html/agenda_work/frontend && npm run build 2>&1 | tail -3 && diff src/services/api.js.backup src/services/api.js
```

Expected: `✓ built in ...`; diff hanya 8 baris baru.

- [ ] **Step 4: Commit**

```bash
cd /var/www/html/agenda_work && git add frontend/src/services/api.js && git commit -m "feat(notulen): API client folder Q&A"
```

---

### Task 6: UI — tombol "Tanya AI" di breadcrumb folder + `FolderAskModal`

**Files:**
- Modify: `frontend/src/pages/NotulenAI.jsx`:
  1. Komponen baru `FolderAskModal` — letakkan setelah komponen `FolderTile` (berakhir sekitar baris 234), sebelum `EditModal`.
  2. State `showFolderAsk` — di komponen list utama, dekat state folder (sekitar baris 345-348).
  3. Tombol di blok breadcrumb (baris 631-646) + render modal.

**Interfaces:**
- Consumes: `notulenFoldersAPI.{ask, askProgressUrl, listQA, deleteQA}` (Task 5); helper module-level yang SUDAH ADA di file ini: `renderMarkdown(text)` (baris ~64), `toast`, ikon `HiOutlineChatAlt2`, `HiOutlineTrash`, `HiOutlineX`, `HiOutlineArrowRight`, `HiOutlineRefresh` (semua sudah di-import); hooks `useState, useEffect, useRef, useCallback` (sudah di-import).
- Produces: UI final fitur — tidak dikonsumsi task lain.

- [ ] **Step 1: Backup**

```bash
cp /var/www/html/agenda_work/frontend/src/pages/NotulenAI.jsx /var/www/html/agenda_work/frontend/src/pages/NotulenAI.jsx.backup
```

- [ ] **Step 2: Tambahkan komponen `FolderAskModal`**

Sisipkan setelah komponen `FolderTile` (sebelum `function EditModal`):

```jsx
// Modal "Tanya AI folder" — bertanya atas SEMUA transkrip di satu folder.
// Backend membaca seluruh transkrip bertahap (map-reduce, beberapa menit);
// progress via SSE, riwayat permanen di DB (tabel notulen_folder_qa) sehingga
// aman ditutup/refresh — jawaban tetap muncul di riwayat saat selesai.
function FolderAskModal({ folder, onClose }) {
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [question, setQuestion] = useState('');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressStep, setProgressStep] = useState('');
  const esRef = useRef(null);
  const bottomRef = useRef(null);
  // Ref pemutus siklus dependensi attachProgress ↔ loadHistory
  const loadHistoryRef = useRef(() => {});

  const attachProgress = useCallback((qaId) => {
    setProcessing(true);
    setProgress(0);
    setProgressStep('Memulai...');
    esRef.current?.close();
    const es = new EventSource(notulenFoldersAPI.askProgressUrl(folder.id, qaId));
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        setProgress(d.percent || 0);
        setProgressStep(d.step || '');
        if (d.done) {
          es.close();
          setProcessing(false);
          if (d.error) toast.error('Gagal menjawab: ' + (d.step || ''));
          loadHistoryRef.current();
        }
      } catch {}
    };
    // Jangan matikan processing di onerror — EventSource auto-reconnect,
    // dan hasil tetap aman di DB meski koneksi progress putus.
    es.onerror = () => {};
  }, [folder.id]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await notulenFoldersAPI.listQA(folder.id);
      const rows = res.data.data || [];
      setHistory(rows);
      // Resume: pertanyaan yang masih diproses (mis. setelah refresh) → sambung SSE lagi
      const active = rows.find(r => r.status === 'processing');
      if (active) attachProgress(active.id);
    } catch {
      toast.error('Gagal memuat riwayat');
    } finally {
      setLoadingHistory(false);
    }
  }, [folder.id, attachProgress]);
  loadHistoryRef.current = loadHistory;

  useEffect(() => {
    loadHistory();
    return () => esRef.current?.close();
  }, [loadHistory]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [history, processing]);

  async function handleAsk() {
    const q = question.trim();
    if (!q || processing) return;
    setQuestion('');
    try {
      const res = await notulenFoldersAPI.ask(folder.id, q);
      const qaId = res.data.data.qaId;
      setHistory(prev => [{ id: qaId, question: q, answer: null, status: 'processing', created_at: new Date().toISOString() }, ...prev]);
      attachProgress(qaId);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal mengirim pertanyaan');
      setQuestion(q);
    }
  }

  async function handleDelete(qaId) {
    if (!window.confirm('Hapus tanya-jawab ini?')) return;
    try {
      await notulenFoldersAPI.deleteQA(folder.id, qaId);
      setHistory(prev => prev.filter(r => r.id !== qaId));
    } catch {
      toast.error('Gagal menghapus');
    }
  }

  // history dari API terbaru-dulu; tampilkan kronologis (terlama di atas) ala chat
  const ordered = [...history].reverse();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4 animate-fadeIn" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-2xl w-full h-[85vh] shadow-xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-start gap-3">
          <HiOutlineChatAlt2 className="w-6 h-6 text-primary-500 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-gray-900 truncate">Tanya AI — {folder.name}</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              AI membaca SEMUA transkrip di folder ini ({folder.session_count || 0} sesi) — satu jawaban butuh beberapa menit. Riwayat tersimpan; boleh ditutup saat menunggu.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400" title="Tutup">
            <HiOutlineX className="w-5 h-5" />
          </button>
        </div>

        {/* Riwayat */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loadingHistory ? (
            <div className="text-center text-gray-400 text-sm mt-8 animate-pulse">Memuat riwayat...</div>
          ) : ordered.length === 0 ? (
            <div className="text-center text-gray-400 text-xs mt-8">
              <p>Belum ada pertanyaan untuk folder ini.</p>
              <p className="mt-1">Contoh: "Apa saja keputusan penting dari semua sesi?"</p>
            </div>
          ) : (
            ordered.map(item => (
              <div key={item.id} className="space-y-2">
                <div className="flex justify-end items-start gap-2 group">
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-500 transition-all"
                    title="Hapus tanya-jawab ini"
                  >
                    <HiOutlineTrash className="w-4 h-4" />
                  </button>
                  <div className="max-w-[85%] px-3 py-2 rounded-xl rounded-br-sm text-sm bg-primary-600 text-white leading-relaxed">
                    {item.question}
                  </div>
                </div>
                <div className="flex justify-start">
                  {item.status === 'processing' ? (
                    <div className="bg-gray-100 text-gray-400 px-3 py-2 rounded-xl rounded-bl-sm text-sm animate-pulse">Sedang membaca transkrip...</div>
                  ) : item.status === 'error' ? (
                    <div className="bg-red-50 text-red-600 px-3 py-2 rounded-xl rounded-bl-sm text-xs">
                      Gagal: {item.error_message || 'kesalahan tidak diketahui'}
                    </div>
                  ) : (
                    <div
                      className="max-w-[92%] px-4 py-3 rounded-xl rounded-bl-sm text-sm bg-gray-100 text-gray-700 leading-relaxed overflow-x-auto"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(item.answer || '') }}
                    />
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Progress saat memproses */}
        {processing && (
          <div className="px-5 py-3 border-t border-gray-100 bg-primary-50/50">
            <div className="flex items-center justify-between text-xs text-gray-600 mb-1.5">
              <span className="truncate">{progressStep || 'Memproses...'}</span>
              <span className="font-semibold shrink-0 ml-2">{progress}%</span>
            </div>
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-primary-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {/* Input */}
        <div className="p-3 border-t border-gray-100">
          <div className="flex gap-2">
            <input
              value={question}
              onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk(); } }}
              placeholder={processing ? 'Tunggu jawaban selesai...' : 'Tanya tentang semua transkrip di folder ini...'}
              className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400 outline-none"
              disabled={processing}
            />
            <button
              onClick={handleAsk}
              disabled={processing || !question.trim()}
              className="px-3 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white rounded-xl transition-all"
              title="Kirim pertanyaan"
            >
              {processing ? <HiOutlineRefresh className="w-4 h-4 animate-spin" /> : <HiOutlineArrowRight className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: State + tombol breadcrumb + render modal**

Di komponen list utama, dekat state folder yang sudah ada (`const [openFolderMenuId, setOpenFolderMenuId] = useState(null);`), tambahkan:

```jsx
  const [showFolderAsk, setShowFolderAsk] = useState(false);
```

Ubah blok breadcrumb (baris ~631-646) — tambahkan tombol di ujung kanan baris (`ml-auto`); tombol hanya untuk folder nyata, bukan bucket `'none'`:

```jsx
      {folderFilter !== null && (
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => { setFolderFilter(null); setPage(1); }}
            className="inline-flex items-center gap-1 text-gray-500 hover:text-primary-600 transition-colors"
          >
            <HiOutlineHome className="w-4 h-4" />
            Beranda
          </button>
          <span className="text-gray-300">›</span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-gray-800">
            <HiOutlineFolderOpen className="w-4 h-4 text-primary-500" />
            {folders.find(f => f.id === folderFilter)?.name || 'Folder'}
          </span>
          {typeof folderFilter === 'number' && (
            <button
              onClick={() => setShowFolderAsk(true)}
              className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-xs font-medium transition-all"
              title="Tanya AI tentang semua transkrip di folder ini"
            >
              <HiOutlineChatAlt2 className="w-4 h-4" /> Tanya AI
            </button>
          )}
        </div>
      )}
```

Render modal — letakkan bersama render modal lain di return komponen list (mis. tepat sebelum penutup terluar, dekat pemakaian `EditModal`):

```jsx
      {showFolderAsk && typeof folderFilter === 'number' && (
        <FolderAskModal
          folder={folders.find(f => f.id === folderFilter) || { id: folderFilter, name: 'Folder' }}
          onClose={() => setShowFolderAsk(false)}
        />
      )}
```

- [ ] **Step 4: Build + diff**

```bash
cd /var/www/html/agenda_work/frontend && npm run build 2>&1 | tail -3 && diff src/pages/NotulenAI.jsx.backup src/pages/NotulenAI.jsx | head -40
```

Expected: `✓ built in ...` tanpa error; diff = komponen baru + state + tombol + render modal.

- [ ] **Step 5: Deploy frontend + commit**

```bash
pm2 restart agenda-frontend
cd /var/www/html/agenda_work && git add frontend/src/pages/NotulenAI.jsx && git commit -m "feat(notulen): FolderAskModal — UI Tanya AI per folder dengan progress & riwayat"
```

---

### Task 7: Verifikasi end-to-end (folder uji kecil via HTTP + spot-check folder nyata)

**Files:** tidak ada perubahan kode — verifikasi saja. Skrip sementara di scratchpad, bukan repo.

**Interfaces:**
- Consumes: seluruh hasil Task 1–6, backend sudah di-restart (Task 4 Step 5) dan frontend sudah di-build (Task 6).

- [ ] **Step 1: E2E cepat & murah — folder uji sintetis via HTTP penuh (ask → SSE → riwayat → hapus)**

Buat folder uji + 2 sesi kecil, tanya lewat HTTP, tunggu selesai via polling riwayat, lalu bersihkan:

```bash
cd /var/www/html/agenda_work/backend && node -e "
require('dotenv').config();
const jwt = require('jsonwebtoken');
const axios = require('axios');
const pool = require('./src/config/database');
(async () => {
  const [[u]] = await pool.query('SELECT id FROM users ORDER BY id LIMIT 1');
  const token = jwt.sign({ userId: u.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const PORT = process.env.PORT || 5100;
  const api = axios.create({ baseURL: 'http://localhost:' + PORT + '/api', headers: { Authorization: 'Bearer ' + token } });

  // Folder uji + 2 sesi kecil dengan fakta yang bisa ditanyakan
  const [fr] = await pool.query('INSERT INTO notulen_folders (user_id, name) VALUES (?, ?)', [u.id, 'E2E-TEST-FOLDER']);
  const folderId = fr.insertId;
  const mkSession = async (judul, texts) => {
    const [sr] = await pool.query(
      \"INSERT INTO notulen_sessions (user_id, judul, pencatat, instansi, tanggal, status, folder_id) VALUES (?, ?, 'Tester', 'BPS', '2026-07-06', 'completed', ?)\",
      [u.id, judul, folderId]);
    for (let i = 0; i < texts.length; i++) {
      await pool.query('INSERT INTO notulen_segments (session_id, text, timestamp_seconds, segment_start, segment_end) VALUES (?, ?, ?, ?, ?)',
        [sr.insertId, texts[i], i * 10, i * 10, i * 10 + 9]);
    }
    return sr.insertId;
  };
  const s1 = await mkSession('Rapat Anggaran', ['Rapat dibuka oleh Kepala BPS.', 'Anggaran pelatihan tahun depan disepakati sebesar 250 juta rupiah.', 'Rapat ditutup.']);
  const s2 = await mkSession('Rapat Evaluasi', ['Evaluasi triwulan berjalan baik.', 'Deadline laporan evaluasi adalah 15 Agustus.', 'Sekian.']);

  try {
    const ask = await api.post('/notulen/folders/' + folderId + '/ask', { question: 'Berapa anggaran pelatihan yang disepakati dan kapan deadline laporan evaluasi?' });
    console.log('ask →', JSON.stringify(ask.data));
    const qaId = ask.data.data.qaId;

    // Guard 409 saat masih diproses
    const dup = await api.post('/notulen/folders/' + folderId + '/ask', { question: 'x' }).catch(e => e.response);
    console.log('409 guard →', dup.status, dup.data.message);

    // Poll riwayat sampai selesai (maks 5 menit)
    let row;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const list = await api.get('/notulen/folders/' + folderId + '/qa');
      row = list.data.data.find(r2 => r2.id === qaId);
      process.stdout.write('.');
      if (row.status !== 'processing') break;
    }
    console.log('\nstatus:', row.status, '| sessions_covered:', row.sessions_covered, '| batch_failed:', row.batch_failed);
    console.log('--- JAWABAN ---\n' + (row.answer || row.error_message));
    const ok = row.status === 'done' && /250\s*juta/i.test(row.answer) && /15\s*Agustus/i.test(row.answer);
    console.log(ok ? '✅ E2E LULUS: kedua fakta dari dua sesi berbeda ada di jawaban' : '❌ E2E GAGAL');

    // Hapus riwayat via API
    const del = await api.delete('/notulen/folders/' + folderId + '/qa/' + qaId);
    console.log('delete →', JSON.stringify(del.data));
  } finally {
    // Bersihkan data uji (sesi + folder; segmen ikut terhapus via bulkDelete pattern)
    await pool.query('DELETE FROM notulen_segments WHERE session_id IN (?, ?)', [s1, s2]);
    await pool.query('DELETE FROM notulen_sessions WHERE id IN (?, ?)', [s1, s2]);
    await pool.query('DELETE FROM notulen_folders WHERE id = ?', [folderId]);
    console.log('cleanup OK');
  }
  process.exit(0);
})().catch(e => { console.error('❌', e.response ? e.response.status + ' ' + JSON.stringify(e.response.data) : e.message); process.exit(1); });
"
```

Expected: `ask → {"success":true,...}`, `409 guard → 409 Masih ada pertanyaan...`, status `done`, `✅ E2E LULUS`, `delete → {"success":true,...}`, `cleanup OK`. (Butuh 1 panggilan ekstraksi + 1 final — ±30-60 detik.)

- [ ] **Step 2: Spot-check folder nyata (ISO 9001:2015, 8 sesi, ±1,26 juta karakter)**

Verifikasi skala nyata via service langsung (tanpa HTTP, tanpa menulis riwayat):

```bash
cd /var/www/html/agenda_work/backend && node -e "
const svc = require('./src/services/notulen.service');
const pool = require('./src/config/database');
(async () => {
  const [[f]] = await pool.query(\"SELECT * FROM notulen_folders WHERE name LIKE '%ISO%' LIMIT 1\");
  const sessions = await svc.getFolderSessionsWithSegments(f.id);
  console.log('folder:', f.name, '| sesi:', sessions.length);
  const t0 = Date.now();
  const result = await svc.askFolderQuestion(f, sessions, 'Sebutkan topik-topik utama yang dibahas di seluruh sesi folder ini.', (p, s) => console.log(p + '%', s));
  console.log('=== SELESAI dalam', Math.round((Date.now() - t0) / 1000), 'detik ===');
  console.log('batchTotal:', result.batchTotal, '| batchFailed:', result.batchFailed);
  console.log(result.answer.slice(0, 1500));
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
" 2>&1 | tee /tmp/claude-0/-var-www-html-agenda-work/eb5497c7-25dc-4601-bde5-a7a8ab63af35/scratchpad/folder-ask-iso-test.log
```

Expected: progress naik bertahap (±26 batch), `batchFailed: 0`, jawaban menyebut topik ISO dengan sitasi `[Judul sesi — MM:SS]`, durasi ±4-8 menit. Jika ada batch gagal karena gangguan sesaat → jawaban harus berawalan `⚠️`.

- [ ] **Step 3: Verifikasi UI oleh user**

Minta user membuka `https://agenda.bpsmalut.com/notulen` → masuk folder → tombol "Tanya AI" di breadcrumb → ajukan pertanyaan nyata; konfirmasi progress tampil, jawaban muncul, riwayat bertahan setelah refresh.

- [ ] **Step 4: Commit terakhir (jika ada perbaikan dari verifikasi) + rangkum**

```bash
cd /var/www/html/agenda_work && git status --short && git log --oneline -8
```

Pastikan semua perubahan fitur ini sudah ter-commit (JANGAN ikutkan perubahan pre-existing yang bukan milik task ini).
