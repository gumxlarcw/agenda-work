/**
 * Notulen AI Service
 * Handles: Groq Whisper API, audio processing, LLM summary, database CRUD
 */

const axios = require('axios');
const crypto = require('crypto');
const FormData = require('form-data');
const pool = require('../config/database');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execFileAsync = promisify(execFile);
const YTDLP_BIN  = '/home/linuxbrew/.linuxbrew/bin/yt-dlp';
const NODE_BIN   = '/home/linuxbrew/.linuxbrew/bin/node';
// Common yt-dlp flags: use Node.js as JS runtime + avoid bot-detection issues
const YTDLP_BASE = [
    '--js-runtimes', `node:${NODE_BIN}`,
    '--remote-components', 'ejs:github',
    '--sleep-requests', '2',
    '--no-playlist',
];
const FFMPEG_BIN = '/usr/bin/ffmpeg';
const YT_TMP_DIR = path.join(__dirname, '../../tmp/youtube');
const CHUNK_DURATION_SEC = 600; // 10 min per chunk, safe under 25MB Groq limit

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

// Run yt-dlp with real-time download progress via spawn.
// onProgress(percent 0-100, step string) is called on each parsed progress line.
// percentRange: [min, max] maps yt-dlp's 0-100% into a sub-range of the overall job percent.
// downloadRange: maps yt-dlp 0-100% into [dlMin, dlMax] of the job percent
// convertRange:  when [ExtractAudio] fires, animate from convertRange[0] → convertRange[1]-1
function spawnYtdlpWithProgress(args, onProgress, downloadRange = [0, 100], convertRange = null, jobId = null) {
    const [dlMin, dlMax] = downloadRange;
    return new Promise((resolve, reject) => {
        // Write yt-dlp output to a log file — prevents SIGPIPE/"Interrupted by user"
        // when Node.js restarts (pm2 reload) while yt-dlp is still running.
        const logPath = path.join(YT_TMP_DIR, `ytdlp-${Date.now()}.log`);
        const logFd = fs.openSync(logPath, 'w');

        const proc = spawn(YTDLP_BIN, ['--progress', '--newline', '--no-colors', ...args], {
            detached: true,
            stdio: ['ignore', logFd, logFd],
        });
        fs.closeSync(logFd);
        if (jobId) registerYtJob(jobId, proc);

        let lastPos = 0;
        let done = false;
        let inConvert = false;
        let convertPct = convertRange ? convertRange[0] : dlMax;
        let convertTimer = null;

        const startConvertAnim = () => {
            if (!convertRange || convertTimer) return;
            inConvert = true;
            convertTimer = setInterval(() => {
                if (convertPct < convertRange[1] - 1) {
                    convertPct++;
                    onProgress(convertPct, 'Mengonversi audio ke MP3...');
                }
            }, 10000); // +1% every 10 s — covers up to ~(range/1) * 10s
        };

        const parseLines = (text) => {
            for (const line of text.split(/[\n\r]+/)) {
                // "[download]  45.3% of 234.56MiB at 1.23MiB/s ETA 01:23"
                const m = line.match(/\[download\]\s+([\d.]+)%\s+of\s+([\d.]+\S+)\s+at\s+([\d.]+\S+)/);
                if (m) {
                    const mapped = Math.round(dlMin + (parseFloat(m[1]) / 100) * (dlMax - dlMin));
                    onProgress(mapped, `Mengunduh... ${m[1]}% (${m[3]})`);
                    continue;
                }
                // "[ExtractAudio] Destination: ..." — yt-dlp calls ffmpeg to convert
                if (/\[ExtractAudio\]/.test(line)) {
                    if (convertRange) {
                        onProgress(convertRange[0], 'Mengonversi audio ke MP3...');
                        startConvertAnim();
                    }
                }
            }
        };

        // Poll log file every 600ms for new output
        const poll = setInterval(() => {
            if (done) return;
            try {
                const stat = fs.statSync(logPath);
                if (stat.size > lastPos) {
                    const buf = Buffer.alloc(stat.size - lastPos);
                    const fd = fs.openSync(logPath, 'r');
                    fs.readSync(fd, buf, 0, buf.length, lastPos);
                    fs.closeSync(fd);
                    lastPos = stat.size;
                    parseLines(buf.toString());
                }
            } catch (_) {}
        }, 600);

        const cleanup = () => {
            done = true;
            clearInterval(poll);
            if (convertTimer) clearInterval(convertTimer);
            if (jobId) ytJobPids.delete(jobId);
        };

        proc.on('close', (code) => {
            cleanup();
            if (code === 0) {
                try { fs.unlinkSync(logPath); } catch (_) {}
                return resolve();
            }
            let errMsg = '';
            try { errMsg = fs.readFileSync(logPath, 'utf-8').slice(-600); } catch (_) {}
            try { fs.unlinkSync(logPath); } catch (_) {}
            reject(new Error(`yt-dlp exited ${code}: ${errMsg}`));
        });

        proc.on('error', (err) => { cleanup(); reject(err); });

        // Kill after 4 hours — 12 h video at slow speed can take 2+ hours to download + convert
        setTimeout(() => {
            if (!done) {
                proc.kill('SIGTERM');
                cleanup();
                reject(new Error('yt-dlp timeout (4 jam)'));
            }
        }, 4 * 60 * 60 * 1000);
    });
}

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'whisper-large-v3-turbo';
const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const LLM_PROXY_URL = process.env.LLM_PROXY_URL || 'http://localhost:3031/v1';
const LLM_MODEL = process.env.LLM_MODEL || 'claude-sonnet-4-6';

const SAMPLE_RATE = 16000;
const SAMPLE_WIDTH = 2; // 16-bit
const MAX_RETRIES = 2;
const RETRY_DELAY = 1000;

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

// --- Audio Processing ---

function pcmToWav(pcmBuffer) {
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);        // fmt chunk size
  header.writeUInt16LE(1, 20);         // PCM format
  header.writeUInt16LE(1, 22);         // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * SAMPLE_WIDTH, 28); // byte rate
  header.writeUInt16LE(SAMPLE_WIDTH, 32);               // block align
  header.writeUInt16LE(16, 34);        // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmBuffer]);
}

function checkAudioLevel(pcmBuffer) {
  const samples = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length / 2);
  let max = 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > max) max = abs;
    sumSq += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSq / samples.length);
  const db = 20 * Math.log10(rms / 32768 + 1e-10);
  return { max, rms: Math.round(rms), db: Math.round(db * 10) / 10 };
}

function isHallucination(text) {
  const t = text.toLowerCase().trim();
  if (t.length < 3) return true;
  for (const phrase of HALLUCINATION_PHRASES) {
    if (t === phrase || (t.length < 25 && t.includes(phrase))) return true;
  }
  const words = t.split(/\s+/);
  if (words.length >= 3 && new Set(words).size === 1) return true;
  return false;
}

// --- Groq Whisper API ---

async function transcribeGroq(pcmBuffer) {
  const level = checkAudioLevel(pcmBuffer);
  console.log(`[notulen] Audio: max=${level.max}/32768 rms=${level.rms} (${level.db}dB)`);
  if (level.max < 500) {
    console.log('[notulen] Too quiet — skip');
    return [];
  }

  const wavBuffer = pcmToWav(pcmBuffer);
  const duration = pcmBuffer.length / (SAMPLE_RATE * SAMPLE_WIDTH);
  const t0 = Date.now();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const form = new FormData();
      form.append('file', wavBuffer, { filename: 'audio.wav', contentType: 'audio/wav' });
      form.append('model', GROQ_MODEL);
      form.append('language', 'id');
      form.append('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'segment');

      const resp = await axios.post(GROQ_URL, form, {
        headers: { ...form.getHeaders(), Authorization: `Bearer ${GROQ_API_KEY}` },
        timeout: 45000,
        maxContentLength: 50 * 1024 * 1024,
      });

      const data = resp.data;
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const text = (data.text || '').trim();

      if (!text) {
        console.log(`[notulen] No speech ${elapsed}s/${duration.toFixed(0)}s`);
        return [];
      }

      const results = [];
      const segments = data.segments || [];
      if (segments.length > 0) {
        for (const seg of segments) {
          const t = (seg.text || '').trim();
          if (t && !isHallucination(t)) {
            results.push({ text: t, start: seg.start || 0, end: seg.end || 0 });
          }
        }
      } else if (!isHallucination(text)) {
        results.push({ text, start: 0, end: duration });
      }

      console.log(`[notulen] Groq OK ${elapsed}s/${duration.toFixed(0)}s: ${JSON.stringify(results.map(r => r.text))}`);
      return results;

    } catch (err) {
      if (err.response && err.response.status === 429) {
        const retryAfter = parseFloat(err.response.headers['retry-after'] || '1') * 1000;
        console.warn(`[notulen] Rate limited, retry in ${retryAfter}ms (attempt ${attempt + 1})`);
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, retryAfter));
          continue;
        }
      }
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        console.warn(`[notulen] Timeout (attempt ${attempt + 1})`);
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAY));
          continue;
        }
      }
      console.error(`[notulen] Groq error: ${err.message}`);
      return [];
    }
  }
  return [];
}

// --- Overlap Deduplication ---

function deduplicateSegments(prevSegments, newSegments, overlapSeconds) {
  if (!prevSegments || prevSegments.length === 0 || !newSegments || newSegments.length === 0) {
    return newSegments;
  }

  // Check against last 5 segments from previous batch (not just the last one)
  const checkWindow = prevSegments.slice(-5).map(s => s.text.toLowerCase().trim());
  const filtered = [];
  for (const seg of newSegments) {
    const segText = seg.text.toLowerCase().trim();
    // Skip if within overlap zone and similar to any recent previous segment
    if (seg.start < overlapSeconds) {
      let isDup = false;
      for (const prevText of checkWindow) {
        if (textSimilarity(prevText, segText) > 0.6) {
          console.log(`[notulen] Dedup overlap: "${seg.text}"`);
          isDup = true;
          break;
        }
      }
      if (isDup) continue;
    }
    filtered.push(seg);
  }
  return filtered;
}

function textSimilarity(a, b) {
  if (a === b) return 1;
  const wordsA = new Set(a.split(/\s+/));
  const wordsB = new Set(b.split(/\s+/));
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? intersection / union : 0;
}

// --- Merge micro-segments into coherent sentences ---

function mergeShortSegments(segments, minWords = 5) {
  if (!segments || segments.length <= 1) return segments;

  const merged = [];
  let acc = null;

  for (const seg of segments) {
    if (!acc) {
      acc = { ...seg };
      continue;
    }

    // If accumulator is short, merge next segment into it
    if (acc.text.split(/\s+/).length < minWords) {
      acc.text = acc.text + ' ' + seg.text;
      acc.end = seg.end;
      continue;
    }

    // Accumulator is long enough — push it and start new
    merged.push(acc);

    // If current segment is short AND there's more to come, start accumulating
    acc = { ...seg };
  }

  // Push remaining accumulator
  if (acc) merged.push(acc);

  return merged;
}

// --- LLM Summary ---

// ~15k chars ≈ 2.5k words ≈ 30 min of meeting speech (60% active).
// Lowered from 60k: a single full-meeting summary call generates for >120s and
// trips the LLM proxy's upstream ceiling (both tiers 503/502). Smaller chunks
// keep each generation well within budget — the parts are stitched together
// programmatically by generateSummary(). See the X-Long-Request note in llmCall().
const CHUNK_MAX_CHARS = 15000;
const LLM_TIMEOUT = 600000; // 10 minutes per chunk

function segmentsToTranscript(segments) {
  return segments.map(s => {
    const mm = Math.floor(s.timestamp_seconds / 60).toString().padStart(2, '0');
    const ss = Math.floor(s.timestamp_seconds % 60).toString().padStart(2, '0');
    return `[${mm}:${ss}] ${s.text}`;
  }).join('\n');
}

function fmtTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}j${m.toString().padStart(2,'0')}m` : `${m}m`;
}

// Split segments into chunks capped at CHUNK_MAX_CHARS
function splitSegments(segments) {
  const chunks = [];
  let current = [], charCount = 0;
  for (const seg of segments) {
    const len = (seg.text || '').length + 10;
    if (charCount + len > CHUNK_MAX_CHARS && current.length > 0) {
      chunks.push(current);
      current = [seg];
      charCount = len;
    } else {
      current.push(seg);
      charCount += len;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

const SYSTEM_PROMPT = `Kamu adalah notulis profesional yang bertugas membuat notulensi lengkap dan detail dari transkrip rekaman. \
Tugasmu BUKAN meringkas — tugasmu adalah mendokumentasikan semua poin penting, pernyataan, pertanyaan, jawaban, keputusan, dan tindak lanjut secara lengkap. \
Jenis konten bisa beragam: rapat formal, sosialisasi, pelatihan/training, seminar, webinar, wawancara, diskusi kelompok, dll. \
Kenali jenis kontennya dari transkrip dan gunakan format yang paling sesuai. \
Jangan memadatkan informasi — tulis selengkap dan sedetail mungkin.`;

async function llmCall(messages, maxTokens = 16000) {
  const resp = await axios.post(`${LLM_PROXY_URL}/chat/completions`, {
    model: LLM_MODEL,
    messages,
    temperature: 0.3,
    max_tokens: maxTokens,
  }, {
    timeout: LLM_TIMEOUT,
    // Notulensi generation is a long, non-streaming "batched" call. Without this
    // header the LLM proxy uses its snappy 12s budget (meant for chat) and the
    // generation never finishes in time → cascades to a broken fallback → 503.
    // X-Long-Request opts into the proxy's long budget (180s primary / 240s CLI).
    headers: { 'X-Long-Request': '1' },
  });
  return resp.data.choices[0].message.content;
}

// OVERLAP_SEGS: how many segments from the previous chunk to include at the
// start of the next chunk's transcript. This prevents topics from being
// "orphaned" at a hard boundary — the LLM sees both sides of the cut.
const OVERLAP_SEGS = 5;

async function summarizeChunk(session, segments, partInfo, prevSummary) {
  const transcript = segmentsToTranscript(segments);
  const partNote = partInfo
    ? `\n- Bagian: ${partInfo.part} dari ${partInfo.total} (${fmtTime(segments[0].timestamp_seconds)}–${fmtTime(segments[segments.length - 1].timestamp_seconds)})`
    : '';

  // Rolling context block — only included for chunks 2, 3, 4 …
  const contextBlock = prevSummary
    ? `\nKONTEKS DARI BAGIAN SEBELUMNYA:
${prevSummary}

Gunakan konteks di atas untuk memahami kelanjutan topik. Jangan ulangi poin yang sudah tercakup di bagian sebelumnya — fokus pada perkembangan baru di transkrip berikut.\n`
    : '';

  const userPrompt = `Buatkan notulensi lengkap dan detail berdasarkan transkrip berikut.

INFORMASI ACARA:
- Judul: ${session.judul}${session.sub_judul ? `\n- Konteks: ${session.sub_judul}` : ''}
- Tanggal: ${session.tanggal}
- Pencatat: ${session.pencatat}
- Instansi: ${session.instansi}${partNote}
${contextBlock}
TRANSKRIP:
${transcript}

LANGKAH 1 — KENALI JENIS KONTEN:
Baca transkrip dan tentukan jenis kontennya. Bisa lebih dari satu jenis dalam satu sesi:
- RAPAT / DISKUSI FORMAL — ada agenda, keputusan, tindak lanjut
- SOSIALISASI — penyampaian informasi/kebijakan kepada peserta
- PELATIHAN / TRAINING / BIMTEK — ada instruksi, praktik, pembelajaran
- SEMINAR / WEBINAR / KULIAH — ada pemateri, materi terstruktur
- WAWANCARA — ada pewawancara dan narasumber
- DISKUSI UMUM — pertukaran pendapat tanpa agenda formal

LANGKAH 2 — TULIS NOTULENSI LENGKAP:
Gunakan format yang sesuai dengan jenis konten. Panduan per jenis:

▸ RAPAT / DISKUSI FORMAL:
  # [Judul]
  **Tanggal:** ... | **Tempat:** ... | **Pimpinan:** ...
  **Peserta:** (sebutkan nama/jabatan jika ada di transkrip)

  ## Pembukaan
  (apa yang disampaikan di awal)

  ## Pembahasan
  ### Topik 1: [nama topik]
  (uraian lengkap pembahasan — poin per poin)

  ### Topik 2: [nama topik]
  ...

  ## Sesi Tanya Jawab (jika ada)
  **T:** [pertanyaan lengkap]
  **J:** [jawaban lengkap]
  (ulangi untuk setiap pasang T&J)

  ## Kesimpulan & Keputusan
  ## Tindak Lanjut
  | No | Aksi | PIC | Deadline |
  ## Penutup

▸ SOSIALISASI:
  # [Judul]
  **Tanggal:** ... | **Narasumber/Fasilitator:** ...

  ## Latar Belakang / Tujuan Sosialisasi
  ## Materi yang Disampaikan
  ### [Sub-topik 1]
  (uraian lengkap)
  ### [Sub-topik 2]
  ...
  ## Sesi Tanya Jawab
  **T:** [pertanyaan]
  **J:** [jawaban]
  ## Poin Penting & Hal yang Perlu Diperhatikan
  ## Penutup

▸ PELATIHAN / TRAINING / BIMTEK:
  # [Judul]
  **Tanggal:** ... | **Fasilitator/Trainer:** ...

  ## Tujuan Pelatihan
  ## Materi / Sesi
  ### Sesi 1: [judul]
  (uraian materi, instruksi, contoh yang diberikan)
  ### Sesi 2: [judul]
  ...
  ## Sesi Tanya Jawab / Diskusi
  **T:** [pertanyaan]
  **J:** [jawaban]
  ## Praktik / Simulasi (jika ada)
  ## Poin Pembelajaran Kunci
  ## Tindak Lanjut / Pekerjaan Rumah

▸ SEMINAR / WEBINAR / KULIAH:
  # [Judul]
  **Tanggal:** ... | **Pembicara:** ...

  ## Ringkasan Presentasi
  ### [Topik/Slide 1]
  ### [Topik/Slide 2]
  ## Sesi Tanya Jawab
  **T:** [pertanyaan]
  **J:** [jawaban]
  ## Poin-Poin Kunci
  ## Kesimpulan

ATURAN PENULISAN:
- Tulis dalam Bahasa Indonesia
- JANGAN memadatkan — tulis semua poin, pernyataan, dan detail penting
- JIKA ADA TANYA JAWAB: tulis SEMUA pertanyaan dan jawaban, jangan dilewati
- Jika nama peserta/pembicara disebutkan, cantumkan
- Jika ada angka, data, atau kebijakan spesifik, tulis persis
- Jangan mengarang — hanya dari transkrip
- Gunakan format Markdown (heading ##, bold **, tabel, bullet)`;

  return llmCall([{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userPrompt }], 16000);
}

// (Removed combineSummaries() — the multi-part merge is now done programmatically
//  in generateSummary() to keep every LLM call within the proxy's fast/clean
//  primary-tier budget. See the X-Long-Request note in llmCall().)

// Main entry point — supports progress callback for long meetings
async function generateSummary(session, segments, onProgress) {
  const progress = onProgress || (() => {});
  if (!segments || segments.length === 0) return 'Transkrip kosong.';

  const chunks = splitSegments(segments);
  const total = chunks.length;
  console.log(`[notulen] Summary: ${segments.length} segments → ${total} chunk(s)`);

  try {
    if (total === 1) {
      progress(10, 'Membuat ringkasan...');
      const result = await summarizeChunk(session, chunks[0], null, null);
      progress(100, 'Selesai');
      return result;
    }

    // Multiple chunks — rolling context strategy:
    //   • prevSummary  : the previous chunk's summary, so LLM knows what came before
    //   • boundary segs: last OVERLAP_SEGS segments of chunk[i-1] prepended to chunk[i]
    //     so sentences cut at the boundary are seen whole on both sides
    const chunkSummaries = [];
    let prevSummary = null;

    for (let i = 0; i < total; i++) {
      const pct = Math.round(10 + (i / total) * 70);
      const chunkSegs = chunks[i];
      const start = fmtTime(chunkSegs[0].timestamp_seconds);
      const end = fmtTime(chunkSegs[chunkSegs.length - 1].timestamp_seconds);
      progress(pct, `Meringkas bagian ${i + 1}/${total} (${start}–${end})...`);

      // Prepend overlap segments from previous chunk for boundary continuity
      const overlap = i > 0 ? chunks[i - 1].slice(-OVERLAP_SEGS) : [];
      const segsWithOverlap = [...overlap, ...chunkSegs];

      const s = await summarizeChunk(
        session,
        segsWithOverlap,
        { part: i + 1, total },
        prevSummary,       // rolling context: summary of previous chunk
      );
      chunkSummaries.push(s);
      prevSummary = s;     // next chunk will receive this as context
    }

    // Programmatic merge — NOT a final LLM "combine" call. Each chunk summary
    // already uses rolling context (prevSummary) so it doesn't repeat earlier
    // points. Stitching them here avoids one large generation that would exceed
    // the LLM proxy's ~120s primary-tier ceiling and spill to the slower,
    // "talkative" fallback tier (preamble + insight noise). See llmCall().
    progress(95, 'Menggabungkan semua bagian...');
    const final = chunkSummaries.map((s, i) => {
      const segs = chunks[i];
      const start = fmtTime(segs[0].timestamp_seconds);
      const end = fmtTime(segs[segs.length - 1].timestamp_seconds);
      return `## Bagian ${i + 1} (${start}–${end})\n\n${(s || '').trim()}`;
    }).join('\n\n---\n\n');
    progress(100, 'Selesai');
    return final;
  } catch (err) {
    console.error(`[notulen] LLM error: ${err.message}`);
    throw err;
  }
}

// --- Database Operations ---

async function createSession(userId, { judul, sub_judul, pencatat, instansi, tanggal }) {
  const [result] = await pool.query(
    'INSERT INTO notulen_sessions (user_id, judul, sub_judul, pencatat, instansi, tanggal) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, judul, sub_judul || null, pencatat, instansi || 'BPS Provinsi Maluku Utara', tanggal]
  );
  return result.insertId;
}

async function updateSessionStatus(sessionId, status, durationSeconds = null) {
  if (durationSeconds !== null) {
    await pool.query(
      'UPDATE notulen_sessions SET status = ?, duration_seconds = ? WHERE id = ?',
      [status, durationSeconds, sessionId]
    );
  } else {
    await pool.query('UPDATE notulen_sessions SET status = ? WHERE id = ?', [status, sessionId]);
  }
}

async function saveSummary(sessionId, summary) {
  await pool.query('UPDATE notulen_sessions SET summary = ? WHERE id = ?', [summary, sessionId]);
}

async function saveSegment(sessionId, { text, timestamp_seconds, segment_start, segment_end }) {
  const [result] = await pool.query(
    'INSERT INTO notulen_segments (session_id, text, timestamp_seconds, segment_start, segment_end) VALUES (?, ?, ?, ?, ?)',
    [sessionId, text, timestamp_seconds, segment_start, segment_end]
  );
  return result.insertId;
}

async function saveSegmentsBatch(sessionId, segments) {
  if (!segments || segments.length === 0) return [];
  if (segments.length === 1) {
    const id = await saveSegment(sessionId, segments[0]);
    return [id];
  }

  const values = segments.map(s => [sessionId, s.text, s.timestamp_seconds, s.segment_start, s.segment_end]);
  const [result] = await pool.query(
    'INSERT INTO notulen_segments (session_id, text, timestamp_seconds, segment_start, segment_end) VALUES ?',
    [values]
  );
  // Return array of inserted IDs
  const ids = [];
  for (let i = 0; i < segments.length; i++) {
    ids.push(result.insertId + i);
  }
  return ids;
}

async function getSessions(userId, isAdmin, { page = 1, limit = 10, search, status, sort = 'created_at', order = 'desc', folder_id } = {}) {
  const allowedSort = { created_at: 's.created_at', tanggal: 's.tanggal', duration_seconds: 's.duration_seconds', segment_count: 'segment_count' };
  const sortCol = allowedSort[sort] || 's.created_at';
  const sortDir = order === 'asc' ? 'ASC' : 'DESC';
  const offset = (Math.max(1, page) - 1) * limit;

  let where = isAdmin ? '1=1' : 's.user_id = ?';
  const params = isAdmin ? [] : [userId];

  if (search) {
    where += ' AND s.judul LIKE ?';
    params.push(`%${search}%`);
  }
  if (status) {
    const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
    if (statuses.length > 0) {
      where += ` AND s.status IN (${statuses.map(() => '?').join(',')})`;
      params.push(...statuses);
    }
  } else {
    where += " AND s.status IN ('recording','completed')";
  }

  // folder_id can be a positive int (filter to that folder), or the literal
  // string "none" (only sessions with no folder). Anything else → no filter.
  if (folder_id === 'none') {
    where += ' AND s.folder_id IS NULL';
  } else if (folder_id !== undefined && folder_id !== null && folder_id !== '') {
    const fid = parseInt(folder_id);
    if (Number.isInteger(fid) && fid > 0) {
      where += ' AND s.folder_id = ?';
      params.push(fid);
    }
  }

  const joinUser = isAdmin ? 'JOIN users u ON s.user_id = u.id' : '';
  const userCol = isAdmin ? ', u.name as user_name' : '';

  const countSql = `SELECT COUNT(*) as total FROM notulen_sessions s ${joinUser} WHERE ${where}`;
  const [[{ total }]] = await pool.query(countSql, params);

  const dataSql = `SELECT s.*${userCol},
    (SELECT COUNT(*) FROM notulen_segments WHERE session_id = s.id) as segment_count
    FROM notulen_sessions s ${joinUser}
    WHERE ${where}
    ORDER BY ${sortCol} ${sortDir}
    LIMIT ? OFFSET ?`;
  const [rows] = await pool.query(dataSql, [...params, limit, offset]);

  return { data: rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

async function getSession(sessionId, userId, isAdmin) {
  const query = isAdmin
    ? 'SELECT s.*, u.name as user_name FROM notulen_sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ?'
    : 'SELECT * FROM notulen_sessions WHERE id = ? AND user_id = ?';
  const params = isAdmin ? [sessionId] : [sessionId, userId];
  const [rows] = await pool.query(query, params);
  return rows[0] || null;
}

async function getSegments(sessionId) {
  const [rows] = await pool.query(
    'SELECT * FROM notulen_segments WHERE session_id = ? ORDER BY timestamp_seconds ASC',
    [sessionId]
  );
  return rows;
}

async function deleteSession(sessionId, userId, isAdmin) {
  const query = isAdmin
    ? 'DELETE FROM notulen_sessions WHERE id = ?'
    : 'DELETE FROM notulen_sessions WHERE id = ? AND user_id = ?';
  const params = isAdmin ? [sessionId] : [sessionId, userId];
  const [result] = await pool.query(query, params);
  return result.affectedRows > 0;
}

async function updateSegment(segmentId, sessionId, text) {
  const [result] = await pool.query(
    'UPDATE notulen_segments SET text = ? WHERE id = ? AND session_id = ?',
    [text, segmentId, sessionId]
  );
  return result.affectedRows > 0;
}

async function deleteSegment(segmentId, sessionId) {
  const [result] = await pool.query(
    'DELETE FROM notulen_segments WHERE id = ? AND session_id = ?',
    [segmentId, sessionId]
  );
  return result.affectedRows > 0;
}

async function updateSession(sessionId, userId, isAdmin, fields) {
  const allowed = ['judul', 'sub_judul', 'pencatat', 'instansi', 'tanggal', 'status', 'summary', 'folder_id'];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      // Normalize folder_id: null to unfile, positive int to assign.
      if (key === 'folder_id') {
        const v = fields[key];
        if (v === null || v === '' || v === 'none') {
          params.push(null);
        } else {
          const n = parseInt(v);
          params.push(Number.isInteger(n) && n > 0 ? n : null);
        }
      } else {
        params.push(fields[key]);
      }
    }
  }
  if (sets.length === 0) return false;
  const where = isAdmin ? 'id = ?' : 'id = ? AND user_id = ?';
  params.push(sessionId);
  if (!isAdmin) params.push(userId);
  const [result] = await pool.query(`UPDATE notulen_sessions SET ${sets.join(', ')} WHERE ${where}`, params);
  return result.affectedRows > 0;
}

async function bulkDeleteSessions(ids, userId, isAdmin) {
  if (!ids || ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const where = isAdmin
    ? `id IN (${placeholders})`
    : `id IN (${placeholders}) AND user_id = ?`;
  const params = isAdmin ? [...ids] : [...ids, userId];
  // Segments auto-deleted via FK CASCADE or manual
  await pool.query(`DELETE FROM notulen_segments WHERE session_id IN (${placeholders})`, ids);
  const [result] = await pool.query(`DELETE FROM notulen_sessions WHERE ${where}`, params);
  return result.affectedRows;
}

// --- Subtitle Parsers ---

function parseSRT(content) {
  const segments = [];
  const blocks = content.trim().split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;
    const timeMatch = lines[1].match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
    if (!timeMatch) continue;
    const start = +timeMatch[1]*3600 + +timeMatch[2]*60 + +timeMatch[3] + +timeMatch[4]/1000;
    const end = +timeMatch[5]*3600 + +timeMatch[6]*60 + +timeMatch[7] + +timeMatch[8]/1000;
    const text = lines.slice(2).join(' ').replace(/<[^>]+>/g, '').trim();
    if (text) segments.push({ text, start, end });
  }
  return segments;
}

function parseVTT(content) {
  // Remove WEBVTT header and metadata
  const cleaned = content.replace(/^WEBVTT[^\n]*\n/, '').replace(/^NOTE[^\n]*\n(?:[^\n]+\n)*/gm, '');
  return parseSRT(cleaned);
}

function parseTranscriptText(text) {
  // Split by newlines, filter empty, create segments without timestamps
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  const segments = [];
  for (let i = 0; i < lines.length; i++) {
    // Check if line has timestamp prefix like [00:12] or 00:12:34
    const tsMatch = lines[i].match(/^\[?(\d{1,2}):(\d{2})(?::(\d{2}))?\]?\s*(.+)/);
    if (tsMatch) {
      const h = tsMatch[3] ? +tsMatch[1] : 0;
      const m = tsMatch[3] ? +tsMatch[2] : +tsMatch[1];
      const s = tsMatch[3] ? +tsMatch[3] : +tsMatch[2];
      const start = h * 3600 + m * 60 + s;
      segments.push({ text: tsMatch[4].trim(), start, end: start });
    } else {
      segments.push({ text: lines[i], start: 0, end: 0 });
    }
  }
  return segments;
}

// --- Public Sharing ---

async function generateShareToken(sessionId, userId, isAdmin) {
  const session = await getSession(sessionId, userId, isAdmin);
  if (!session) return null;
  if (session.public_token) return session.public_token;
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('UPDATE notulen_sessions SET public_token = ? WHERE id = ?', [token, sessionId]);
  return token;
}

async function revokeShareToken(sessionId, userId, isAdmin) {
  const where = isAdmin ? 'id = ?' : 'id = ? AND user_id = ?';
  const params = isAdmin ? [sessionId] : [sessionId, userId];
  await pool.query(`UPDATE notulen_sessions SET public_token = NULL WHERE ${where}`, params);
}

async function getSessionByToken(token) {
  const [rows] = await pool.query(
    `SELECT s.*, u.name as user_name FROM notulen_sessions s JOIN users u ON s.user_id = u.id WHERE s.public_token = ?`,
    [token]
  );
  return rows[0] || null;
}

// --- AI Q&A ---

async function askQuestion(session, segments, question) {
  const transcript = segments
    .map(s => {
      const mm = Math.floor(s.timestamp_seconds / 60).toString().padStart(2, '0');
      const ss = Math.floor(s.timestamp_seconds % 60).toString().padStart(2, '0');
      return `[${mm}:${ss}] ${s.text}`;
    })
    .join('\n');

  const systemPrompt = `Kamu adalah asisten yang menjawab pertanyaan berdasarkan transkrip dan ringkasan notulen. Jawab dengan akurat berdasarkan data yang tersedia. Jika informasi tidak ada di transkrip, katakan dengan jujur. Jawab dalam Bahasa Indonesia.`;

  const context = `INFORMASI NOTULEN:
- Judul: ${session.judul}${session.sub_judul ? `\n- Konteks: ${session.sub_judul}` : ''}
- Tanggal: ${session.tanggal}
- Pencatat: ${session.pencatat}
- Instansi: ${session.instansi}

${session.summary ? `RINGKASAN:\n${session.summary}\n\n` : ''}TRANSKRIP:\n${transcript}`;

  try {
    const resp = await axios.post(`${LLM_PROXY_URL}/chat/completions`, {
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${context}\n\nPERTANYAAN: ${question}` },
      ],
      temperature: 0.3,
      max_tokens: 4096,
    }, {
      timeout: 120000,
      // Q&A runs over a full transcript — opt into the proxy's long budget so the
      // answer isn't cut off by the default 12s (chat) timeout. See llmCall().
      headers: { 'X-Long-Request': '1' },
    });

    return resp.data.choices[0].message.content;
  } catch (err) {
    console.error(`[notulen] Ask error: ${err.message}`);
    return `Gagal menjawab: ${err.message}`;
  }
}

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

// --- YouTube CC Import ---
// Download subtitle/CC via yt-dlp, parse VTT, return segments array
async function importYoutubeCC(url, jobId, onProgress) {
    const outTemplate = path.join(YT_TMP_DIR, jobId);
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        onProgress(10 + attempt * 5, attempt === 0 ? 'Mengunduh subtitle...' : `Mengunduh subtitle (percobaan ${attempt + 1})...`);

        // Clean up any leftover VTT from previous attempt
        try {
            const stale = fs.readdirSync(YT_TMP_DIR).filter(f => f.startsWith(jobId) && f.endsWith('.vtt'));
            stale.forEach(f => fs.unlinkSync(path.join(YT_TMP_DIR, f)));
        } catch (_) {}

        try {
            await execFileAsync(YTDLP_BIN, [
                ...YTDLP_BASE,
                '--write-auto-sub',
                '--sub-lang', 'id,en',
                '--sub-format', 'vtt',
                '--skip-download',
                '-o', outTemplate,
                url,
            ], { timeout: 120000, maxBuffer: 50 * 1024 * 1024 });

            const files = fs.readdirSync(YT_TMP_DIR).filter(f => f.startsWith(jobId) && f.endsWith('.vtt'));
            if (files.length === 0) throw new Error('NO_VTT');

            const vttContent = fs.readFileSync(path.join(YT_TMP_DIR, files[0]), 'utf-8');
            const segments = parseVTT(vttContent);
            if (segments.length === 0) throw new Error('Subtitle kosong atau tidak dapat dibaca.');

            onProgress(90, 'Menyimpan segmen...');
            return segments;

        } catch (err) {
            const is429 = err.message.includes('429') || err.message.includes('Too Many Requests');
            const noVtt  = err.message === 'NO_VTT';

            if (noVtt && attempt === MAX_RETRIES - 1) {
                throw new Error('Subtitle tidak tersedia untuk video ini. Coba metode Audio.');
            }
            if (attempt === MAX_RETRIES - 1) {
                throw new Error(`Gagal mengunduh subtitle: ${err.message}`);
            }

            // YouTube 429: wait longer before retry
            const waitSec = is429 ? 30 + attempt * 30 : 5;
            console.warn(`[notulen-yt] CC attempt ${attempt + 1} failed (${err.message}), retrying in ${waitSec}s...`);
            onProgress(10 + attempt * 5, `YouTube rate limit, menunggu ${waitSec}s...`);
            await new Promise(r => setTimeout(r, waitSec * 1000));
        }
    }
}

// Split audio file into chunks and transcribe each via Groq Whisper
// splitRange [a, b]: progress during ffmpeg split (animates a → b-1)
// transcribeRange [b, c]: progress during Groq transcription per chunk
async function splitAndTranscribe(audioPath, onProgress, splitRange = [35, 40], transcribeRange = [40, 95]) {
    const chunkDir = audioPath + '_chunks';
    fs.mkdirSync(chunkDir, { recursive: true });

    const chunkPattern = path.join(chunkDir, 'chunk_%03d.mp3');

    // Animate split progress: +1% every 12s so bar keeps moving
    let splitPct = splitRange[0];
    onProgress(splitPct, 'Memecah audio menjadi bagian-bagian...');
    const splitTick = setInterval(() => {
        if (splitPct < splitRange[1] - 1) {
            splitPct++;
            onProgress(splitPct, 'Memecah audio menjadi bagian-bagian...');
        }
    }, 12000);

    try {
        await execFileAsync(FFMPEG_BIN, [
            '-i', audioPath,
            '-f', 'segment',
            '-segment_time', String(CHUNK_DURATION_SEC),
            '-c', 'copy',
            '-reset_timestamps', '1',
            chunkPattern,
        ], { timeout: 30 * 60 * 1000, maxBuffer: 50 * 1024 * 1024 }); // 30 min for large files
    } finally {
        clearInterval(splitTick);
    }

    const chunkFiles = fs.readdirSync(chunkDir)
        .filter(f => f.startsWith('chunk_') && f.endsWith('.mp3'))
        .sort();

    if (chunkFiles.length === 0) throw new Error('Gagal memecah audio.');

    const allSegments = [];
    let timeOffset = 0;
    let skippedChunks = 0;
    const [tMin, tMax] = transcribeRange;

    for (let i = 0; i < chunkFiles.length; i++) {
        const chunkPath = path.join(chunkDir, chunkFiles[i]);
        const percent = tMin + Math.round((i / chunkFiles.length) * (tMax - tMin));
        const durLeft = Math.round(((chunkFiles.length - i) * 45) / 60);
        onProgress(percent, `Transkripsi ${i + 1}/${chunkFiles.length} (±${durLeft} mnt lagi)`);

        let results = [];
        const MAX_CHUNK_RETRIES = 6;

        for (let attempt = 0; attempt < MAX_CHUNK_RETRIES; attempt++) {
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
                    timeout: 180000,
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
                if (results.length === 0 && data.text && !isHallucination(data.text.trim())) {
                    results.push({
                        text: data.text.trim(),
                        timestamp_seconds: timeOffset,
                        segment_start: timeOffset,
                        segment_end: timeOffset + CHUNK_DURATION_SEC,
                    });
                }
                break; // success

            } catch (err) {
                const status = err.response?.status;
                console.error(`[notulen-yt] Chunk ${i + 1} attempt ${attempt + 1} failed: ${err.message}`);

                if (status === 429) {
                    // Parse retry-after (seconds) from Groq headers
                    const raw = err.response?.headers?.['retry-after'] ||
                                err.response?.headers?.['x-ratelimit-reset-requests'] || '';
                    let waitSec = 60;
                    if (/^\d+$/.test(raw)) {
                        waitSec = parseInt(raw, 10);
                    } else if (raw) {
                        // ISO timestamp format
                        const diff = Math.ceil((new Date(raw) - Date.now()) / 1000);
                        if (diff > 0) waitSec = diff;
                    }

                    // Daily limit: retry-after > 1 hour — pointless to keep retrying today
                    if (waitSec > 3600) {
                        const doneMin = Math.round(i * CHUNK_DURATION_SEC / 60);
                        throw new Error(
                            `Batas harian Groq Whisper tercapai setelah ${i} chunk (${doneMin} menit audio). ` +
                            `Upgrade akun Groq atau coba lagi besok.`
                        );
                    }

                    const waitMs = (waitSec + 3) * 1000; // +3s buffer
                    console.log(`[notulen-yt] Rate limited, waiting ${waitSec + 3}s before retry...`);
                    onProgress(percent, `Rate limit Groq — menunggu ${waitSec + 3}s... (chunk ${i + 1}/${chunkFiles.length})`);
                    await new Promise(r => setTimeout(r, waitMs));

                } else if (attempt < MAX_CHUNK_RETRIES - 1) {
                    // Other errors: exponential backoff (3s, 6s, 12s, ...)
                    const delay = 3000 * Math.pow(2, attempt);
                    await new Promise(r => setTimeout(r, delay));
                } else {
                    console.warn(`[notulen-yt] Skipping chunk ${i + 1} after ${MAX_CHUNK_RETRIES} attempts`);
                    skippedChunks++;
                }
            }
        }

        // Pace: 2s delay between chunks to stay under rate limits
        await new Promise(r => setTimeout(r, 2000));

        allSegments.push(...results);
        timeOffset += CHUNK_DURATION_SEC;
    }

    if (skippedChunks > 0) {
        const skippedMin = Math.round(skippedChunks * CHUNK_DURATION_SEC / 60);
        const skippedPct = Math.round((skippedChunks / chunkFiles.length) * 100);
        if (skippedChunks >= Math.ceil(chunkFiles.length / 2)) {
            throw new Error(
                `Transkripsi gagal: ${skippedChunks} dari ${chunkFiles.length} bagian audio tidak dapat diproses ` +
                `(±${skippedMin} menit hilang). Periksa koneksi Groq API atau coba lagi.`
            );
        }
        // Partial skip — warn but continue
        console.warn(`[notulen-yt] ${skippedChunks}/${chunkFiles.length} chunks skipped (${skippedPct}%, ±${skippedMin} min lost)`);
        onProgress(
            transcribeRange[1] - 1,
            `Peringatan: ${skippedChunks} bagian audio dilewati (${skippedPct}%) — hasil mungkin tidak lengkap`
        );
    }

    return allSegments;
}

// --- YouTube Audio Import ---
// Download audio via yt-dlp, split with ffmpeg, transcribe each chunk via Groq
async function importYoutubeAudio(url, jobId, onProgress) {
    const audioPath = path.join(YT_TMP_DIR, `${jobId}.mp3`);

    onProgress(5, 'Memulai unduhan audio...');

    // Download:  5→20%  (real yt-dlp %)
    // Convert:  20→35%  (animated while yt-dlp runs ffmpeg internally)
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

    if (!fs.existsSync(audioPath)) throw new Error('Download audio gagal.');

    // Split: 35→40%  |  Transcribe: 40→95%
    const segments = await splitAndTranscribe(audioPath, onProgress, [35, 40], [40, 95]);

    onProgress(95, 'Menyimpan segmen...');
    return segments;
}

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

module.exports = {
  pcmToWav,
  checkAudioLevel,
  isHallucination,
  transcribeGroq,
  deduplicateSegments,
  mergeShortSegments,
  generateSummary,
  createSession,
  updateSession,
  updateSessionStatus,
  saveSummary,
  saveSegment,
  saveSegmentsBatch,
  getSessions,
  getSession,
  getSegments,
  getSessionByToken,
  deleteSession,
  bulkDeleteSessions,
  updateSegment,
  deleteSegment,
  generateShareToken,
  revokeShareToken,
  askQuestion,
  buildAskBatches,
  ASK_BATCH_MAX_CHARS,
  askFolderQuestion,
  parseSRT,
  parseVTT,
  parseTranscriptText,
  importYoutubeCC,
  importYoutubeAudio,
  cleanupYoutubeTmp,
  cancelYoutubeJob,
  SAMPLE_RATE,
  SAMPLE_WIDTH,
};
