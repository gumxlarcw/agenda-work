/**
 * Notulen AI Routes — REST API + WebSocket handler
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const pool = require('../config/database');
const { verifyToken, addUserFilter } = require('../middleware/auth.middleware');
const notulenService = require('../services/notulen.service');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB max

const CHUNK_SEC = 15;
const OVERLAP_SECONDS = 3;
const OVERLAP_SAMPLES = notulenService.SAMPLE_RATE * notulenService.SAMPLE_WIDTH * OVERLAP_SECONDS;
const MAX_QUEUE = 30; // ~7.5 min buffer — enough to survive 429 rate-limit waits

// ========================================
// REST API endpoints
// ========================================

// List sessions with pagination, search, filter, sort
router.get('/', verifyToken, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const { page, limit, search, status, sort, order, folder_id } = req.query;
    const result = await notulenService.getSessions(req.user.id, isAdmin, {
      page: parseInt(page) || 1,
      limit: Math.min(parseInt(limit) || 10, 50),
      search, status, sort, order, folder_id,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[notulen] List error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch sessions' });
  }
});

// ═══════════════════════════════════════════════════════════════
// NOTULEN FOLDERS — simple per-user folders for organizing sessions.
// Schema lives in migrations/2026-04-17_notulen_folders.sql (folders
// table + folder_id column on notulen_sessions with ON DELETE SET NULL).
// ═══════════════════════════════════════════════════════════════

// GET all folders for current user, with session count per folder
router.get('/folders', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT f.*,
              COALESCE(c.session_count, 0) AS session_count
       FROM notulen_folders f
       LEFT JOIN (
         SELECT folder_id, COUNT(*) AS session_count
         FROM notulen_sessions
         WHERE folder_id IS NOT NULL AND status IN ('recording','completed')
         GROUP BY folder_id
       ) c ON c.folder_id = f.id
       WHERE f.user_id = ?
       ORDER BY f.name ASC`,
      [req.user.id]
    );

    // Also return the count of "unfiled" sessions so the UI can show it next
    // to the "Unfiled" chip without a second round-trip.
    const [[{ unfiled_count }]] = await pool.query(
      `SELECT COUNT(*) AS unfiled_count
       FROM notulen_sessions
       WHERE user_id = ? AND folder_id IS NULL AND status IN ('recording','completed')`,
      [req.user.id]
    );

    res.json({ success: true, data: rows, unfiled_count });
  } catch (err) {
    console.error('[notulen folders] List error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch folders' });
  }
});

// POST create folder
router.post('/folders', verifyToken, async (req, res) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const color = typeof req.body.color === 'string' ? req.body.color.trim() : 'blue';
    if (!name || name.length > 100) {
      return res.status(400).json({ success: false, message: 'Folder name required (max 100 chars)' });
    }
    const [result] = await pool.query(
      'INSERT INTO notulen_folders (user_id, name, color) VALUES (?, ?, ?)',
      [req.user.id, name, color.slice(0, 20)]
    );
    res.status(201).json({ success: true, data: { id: result.insertId, name, color, session_count: 0 } });
  } catch (err) {
    console.error('[notulen folders] Create error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to create folder' });
  }
});

// PUT rename / recolor folder
router.put('/folders/:id', verifyToken, async (req, res) => {
  try {
    const sets = [];
    const params = [];
    if (typeof req.body.name === 'string') {
      const name = req.body.name.trim();
      if (!name || name.length > 100) {
        return res.status(400).json({ success: false, message: 'Folder name required (max 100 chars)' });
      }
      sets.push('name = ?');
      params.push(name);
    }
    if (typeof req.body.color === 'string') {
      sets.push('color = ?');
      params.push(req.body.color.trim().slice(0, 20));
    }
    if (sets.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }
    params.push(req.params.id, req.user.id);
    const [result] = await pool.query(
      `UPDATE notulen_folders SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
      params
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Folder not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[notulen folders] Update error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to update folder' });
  }
});

// DELETE folder — sessions previously in this folder are unfiled via FK ON DELETE SET NULL
router.delete('/folders/:id', verifyToken, async (req, res) => {
  try {
    const [result] = await pool.query(
      'DELETE FROM notulen_folders WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Folder not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[notulen folders] Delete error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to delete folder' });
  }
});

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
}, verifyToken, async (req, res) => {
  const key = String(req.query.qaId || '');
  // Anti-IDOR: stream berisi jawaban — pastikan folder milik user DAN qaId milik folder ini
  try {
    const folder = await notulenService.getFolderOwned(req.params.id, req.user.id);
    if (!folder) return res.status(404).json({ success: false, message: 'Folder tidak ditemukan' });
    const [qaRows] = await pool.query(
      'SELECT id FROM notulen_folder_qa WHERE id = ? AND folder_id = ? AND user_id = ?',
      [key || 0, folder.id, req.user.id]
    );
    if (qaRows.length === 0) return res.status(404).json({ success: false, message: 'Riwayat tidak ditemukan' });
  } catch (err) {
    console.error('[notulen] Folder ask progress error:', err.message);
    return res.status(500).json({ success: false, message: 'Gagal membuka progress' });
  }
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

// Get session detail + segments
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const session = await notulenService.getSession(req.params.id, req.user.id, isAdmin);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    const segments = await notulenService.getSegments(session.id);
    res.json({ success: true, data: { ...session, segments } });
  } catch (err) {
    console.error('[notulen] Get error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch session' });
  }
});

// Progress tracking map: sessionId → { percent, step, done, error, summary }
const summaryProgress = new Map();

// YouTube import progress map: jobId → { percent, step, done, error, sessionId }
const youtubeProgress = new Map();

// Allowed YouTube URL patterns
const YOUTUBE_URL_RE = /^https?:\/\/(www\.)?(youtube\.com\/(watch\?|live\/|shorts\/|embed\/)|youtu\.be\/)/;

// SSE — real-time summary progress stream
// Delivers progress AND the final summary when done (avoids Cloudflare's ~100s HTTP timeout).
// EventSource cannot set headers, so we accept token via query param too.
router.get('/:id/summary/progress', (req, res, next) => {
  if (req.query.token) req.headers.authorization = `Bearer ${req.query.token}`;
  next();
}, verifyToken, (req, res) => {
  const key = String(req.params.id);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  // SSE comment — keeps Cloudflare Tunnel alive without triggering data handlers
  const heartbeat = () => res.write(': heartbeat\n\n');

  send({ percent: 0, step: 'Menunggu...' });

  // Progress poll: send state every 400ms
  const pollInterval = setInterval(() => {
    const prog = summaryProgress.get(key);
    if (prog) {
      send(prog);
      if (prog.done || prog.error) {
        clearInterval(pollInterval);
        clearInterval(hbInterval);
        res.end();
      }
    }
  }, 400);

  // Heartbeat every 20s — prevents Cloudflare from closing idle SSE connections
  const hbInterval = setInterval(heartbeat, 20000);

  req.on('close', () => {
    clearInterval(pollInterval);
    clearInterval(hbInterval);
  });
});

// Generate AI summary — responds IMMEDIATELY, runs job in background.
// Result is delivered via the SSE /progress endpoint to avoid Cloudflare's timeout.
router.post('/:id/summary', verifyToken, async (req, res) => {
  const key = String(req.params.id);
  const isAdmin = req.user.role === 'admin';

  try {
    const session = await notulenService.getSession(req.params.id, req.user.id, isAdmin);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    const segments = await notulenService.getSegments(session.id);
    if (segments.length === 0) return res.status(400).json({ success: false, message: 'No transcript segments' });

    // Respond immediately — client receives result via SSE
    summaryProgress.set(key, { percent: 0, step: 'Memulai...' });
    res.json({ success: true, data: { status: 'processing' } });

    // Run generation in background (non-blocking)
    notulenService.generateSummary(session, segments, (percent, step) => {
      summaryProgress.set(key, { percent, step });
    }).then(async (summary) => {
      await notulenService.saveSummary(session.id, summary);
      summaryProgress.set(key, { percent: 100, step: 'Selesai', done: true, summary });
    }).catch((err) => {
      console.error('[notulen] Summary error:', err.message);
      summaryProgress.set(key, { percent: 0, step: err.message, error: true, done: true });
    }).finally(() => {
      setTimeout(() => summaryProgress.delete(key), 15000);
    });

  } catch (err) {
    console.error('[notulen] Summary error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to start summary generation' });
  }
});

// Export session as txt/md
router.get('/:id/export/:format', verifyToken, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const session = await notulenService.getSession(req.params.id, req.user.id, isAdmin);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    const segments = await notulenService.getSegments(session.id);

    // Always include raw transcript + summary (if available)
    const rawTranscript = segments
      .map(s => {
        const mm = Math.floor(s.timestamp_seconds / 60).toString().padStart(2, '0');
        const ss = Math.floor(s.timestamp_seconds % 60).toString().padStart(2, '0');
        return `[${mm}:${ss}] ${s.text}`;
      })
      .join('\n');

    let content = '';
    if (session.summary) {
      content = session.summary + '\n\n' +
        '═══════════════════════════════════════\n' +
        '         RAW TRANSCRIPT\n' +
        '═══════════════════════════════════════\n\n' +
        rawTranscript;
    } else {
      content = rawTranscript;
    }

    const fmt = req.params.format === 'md' ? 'md' : 'txt';
    const filename = `notulen_${session.judul.replace(/\s+/g, '_')}.${fmt}`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  } catch (err) {
    console.error('[notulen] Export error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to export' });
  }
});

// Upload audio file for transcription
router.post('/upload', verifyToken, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No audio file' });

    const { judul, sub_judul, pencatat, instansi, tanggal } = req.body;
    if (!judul) return res.status(400).json({ success: false, message: 'Judul required' });

    // Create session
    const sessionId = await notulenService.createSession(req.user.id, {
      judul, sub_judul, pencatat: pencatat || req.user.name,
      instansi: instansi || 'BPS Provinsi Maluku Utara',
      tanggal: tanggal || new Date().toISOString().split('T')[0],
    });

    // Send file directly to Groq (supports mp3, mp4, m4a, wav, webm, etc)
    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });
    form.append('model', process.env.GROQ_MODEL || 'whisper-large-v3-turbo');
    form.append('language', 'id');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');

    console.log(`[notulen] Upload: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(1)}MB) for session ${sessionId}`);

    const groqResp = await axios.post(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      form,
      {
        headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        timeout: 120000,
        maxContentLength: 100 * 1024 * 1024,
      }
    );

    const data = groqResp.data;
    const segments = data.segments || [];
    let savedCount = 0;

    for (const seg of segments) {
      const text = (seg.text || '').trim();
      if (text && !notulenService.isHallucination(text)) {
        await notulenService.saveSegment(sessionId, {
          text,
          timestamp_seconds: seg.start || 0,
          segment_start: seg.start || 0,
          segment_end: seg.end || 0,
        });
        savedCount++;
      }
    }

    // If no segments but has text
    if (savedCount === 0 && data.text && data.text.trim()) {
      await notulenService.saveSegment(sessionId, {
        text: data.text.trim(),
        timestamp_seconds: 0, segment_start: 0, segment_end: data.duration || 0,
      });
      savedCount = 1;
    }

    const duration = Math.round(data.duration || 0);
    await notulenService.updateSessionStatus(sessionId, 'completed', duration);

    console.log(`[notulen] Upload OK: ${savedCount} segments, ${duration}s duration`);
    res.json({ success: true, data: { sessionId, segmentCount: savedCount, duration } });

  } catch (err) {
    console.error('[notulen] Upload error:', err.response?.data || err.message);
    res.status(500).json({ success: false, message: 'Gagal memproses file audio: ' + (err.response?.data?.error?.message || err.message) });
  }
});

// Import transcript text
// Public view — NO AUTH required
router.get('/public/:token', async (req, res) => {
  try {
    const session = await notulenService.getSessionByToken(req.params.token);
    if (!session) return res.status(404).json({ success: false, message: 'Notulen tidak ditemukan' });
    const segments = await notulenService.getSegments(session.id);
    res.json({ success: true, data: { ...session, segments } });
  } catch (err) {
    console.error('[notulen] Public view error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal memuat notulen' });
  }
});

// Generate/get share link
router.post('/:id/share', verifyToken, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const token = await notulenService.generateShareToken(req.params.id, req.user.id, isAdmin);
    if (!token) return res.status(404).json({ success: false, message: 'Session not found' });
    res.json({ success: true, data: { token } });
  } catch (err) {
    console.error('[notulen] Share error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal membuat link' });
  }
});

// Revoke share link
router.delete('/:id/share', verifyToken, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    await notulenService.revokeShareToken(req.params.id, req.user.id, isAdmin);
    res.json({ success: true, message: 'Link dihapus' });
  } catch (err) {
    console.error('[notulen] Revoke share error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal menghapus link' });
  }
});

// Ask AI question about transcript
router.post('/:id/ask', verifyToken, async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ success: false, message: 'Pertanyaan diperlukan' });
    const isAdmin = req.user.role === 'admin';
    const session = await notulenService.getSession(req.params.id, req.user.id, isAdmin);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    const segments = await notulenService.getSegments(session.id);
    const answer = await notulenService.askQuestion(session, segments, question);
    res.json({ success: true, data: { answer } });
  } catch (err) {
    console.error('[notulen] Ask error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal menjawab pertanyaan' });
  }
});

router.post('/import-text', verifyToken, async (req, res) => {
  try {
    const { judul, sub_judul, pencatat, instansi, tanggal, text } = req.body;
    if (!judul || !text) return res.status(400).json({ success: false, message: 'Judul dan teks diperlukan' });

    const sessionId = await notulenService.createSession(req.user.id, {
      judul, sub_judul, pencatat: pencatat || req.user.name,
      instansi: instansi || 'BPS Provinsi Maluku Utara',
      tanggal: tanggal || new Date().toISOString().split('T')[0],
    });

    const segments = notulenService.parseTranscriptText(text);
    const segData = segments.map(s => ({
      text: s.text, timestamp_seconds: s.start, segment_start: s.start, segment_end: s.end,
    }));
    await notulenService.saveSegmentsBatch(sessionId, segData);
    await notulenService.updateSessionStatus(sessionId, 'completed');

    console.log(`[notulen] Import text OK: session ${sessionId}, ${segments.length} segments`);
    res.json({ success: true, data: { sessionId, segmentCount: segments.length } });
  } catch (err) {
    console.error('[notulen] Import text error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal import teks' });
  }
});

// Import subtitle file (.srt/.vtt)
router.post('/import-subtitle', verifyToken, upload.single('subtitle'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No subtitle file' });
    const { judul, sub_judul, pencatat, instansi, tanggal } = req.body;
    if (!judul) return res.status(400).json({ success: false, message: 'Judul required' });

    const content = req.file.buffer.toString('utf-8');
    const ext = (req.file.originalname || '').toLowerCase();
    const segments = ext.endsWith('.vtt') ? notulenService.parseVTT(content) : notulenService.parseSRT(content);

    if (segments.length === 0) return res.status(400).json({ success: false, message: 'Tidak ada teks ditemukan di file subtitle' });

    const sessionId = await notulenService.createSession(req.user.id, {
      judul, sub_judul, pencatat: pencatat || req.user.name,
      instansi: instansi || 'BPS Provinsi Maluku Utara',
      tanggal: tanggal || new Date().toISOString().split('T')[0],
    });

    const duration = Math.round(segments[segments.length - 1].end || 0);
    const segData = segments.map(s => ({
      text: s.text, timestamp_seconds: s.start, segment_start: s.start, segment_end: s.end,
    }));
    await notulenService.saveSegmentsBatch(sessionId, segData);
    await notulenService.updateSessionStatus(sessionId, 'completed', duration);

    console.log(`[notulen] Import subtitle OK: session ${sessionId}, ${segments.length} segments, ${duration}s`);
    res.json({ success: true, data: { sessionId, segmentCount: segments.length, duration } });
  } catch (err) {
    console.error('[notulen] Import subtitle error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal import subtitle' });
  }
});

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

// Bulk delete sessions
router.delete('/bulk', verifyToken, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, message: 'IDs required' });
    const isAdmin = req.user.role === 'admin';
    const deleted = await notulenService.bulkDeleteSessions(ids, req.user.id, isAdmin);
    res.json({ success: true, message: `${deleted} sesi dihapus` });
  } catch (err) {
    console.error('[notulen] Bulk delete error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to bulk delete' });
  }
});

// Edit session metadata
router.patch('/:id', verifyToken, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const updated = await notulenService.updateSession(req.params.id, req.user.id, isAdmin, req.body);
    if (!updated) return res.status(404).json({ success: false, message: 'Session not found' });
    res.json({ success: true, message: 'Session updated' });
  } catch (err) {
    console.error('[notulen] Update error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to update session' });
  }
});

// Delete session
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const deleted = await notulenService.deleteSession(req.params.id, req.user.id, isAdmin);
    if (!deleted) return res.status(404).json({ success: false, message: 'Session not found' });
    res.json({ success: true, message: 'Session deleted' });
  } catch (err) {
    console.error('[notulen] Delete error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to delete session' });
  }
});

// Update segment text
router.patch('/:id/segments/:segId', verifyToken, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const session = await notulenService.getSession(req.params.id, req.user.id, isAdmin);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    const text = (req.body.text || '').trim();
    if (!text) return res.status(400).json({ success: false, message: 'Text required' });
    const updated = await notulenService.updateSegment(req.params.segId, session.id, text);
    if (!updated) return res.status(404).json({ success: false, message: 'Segment not found' });
    res.json({ success: true, message: 'Segment updated' });
  } catch (err) {
    console.error('[notulen] Update segment error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to update segment' });
  }
});

// Delete single segment
router.delete('/:id/segments/:segId', verifyToken, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const session = await notulenService.getSession(req.params.id, req.user.id, isAdmin);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    await notulenService.deleteSegment(req.params.segId, session.id);
    res.json({ success: true, message: 'Segment deleted' });
  } catch (err) {
    console.error('[notulen] Delete segment error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to delete segment' });
  }
});

// Import from YouTube — responds immediately, runs in background, progress via SSE
router.post('/import-youtube', verifyToken, async (req, res) => {
    const { url, method, judul, sub_judul, pencatat, instansi, tanggal } = req.body;

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

    res.json({ success: true, data: { jobId } });

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
            if (sessionId) {
                await notulenService.deleteSession(sessionId, req.user.id, req.user.role === 'admin').catch(() => {});
            }
        } finally {
            notulenService.cleanupYoutubeTmp(jobId);
            setTimeout(() => youtubeProgress.delete(jobId), 30000);
        }
    })();
});

// Cancel YouTube import job
router.delete('/youtube/jobs/:jobId', verifyToken, (req, res) => {
    const { jobId } = req.params;
    const killed = notulenService.cancelYoutubeJob(jobId);
    if (!killed) {
        return res.status(404).json({ success: false, message: 'Job tidak ditemukan atau sudah selesai' });
    }
    youtubeProgress.set(jobId, { percent: 0, step: 'Import dibatalkan', error: true, done: true });
    setTimeout(() => youtubeProgress.delete(jobId), 15000);
    res.json({ success: true, message: 'Import dibatalkan' });
});

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

// ========================================
// WebSocket handler
// ========================================

// Per-user active session state
const activeSessions = new Map();

function setupNotulenWebSocket() {
  const wss = new WebSocket.Server({ noServer: true });

  wss.on('connection', async (ws, request) => {
    // Auth: extract token from query
    const url = new URL(request.url, `http://${request.headers.host}`);
    const token = url.searchParams.get('token');
    let user;

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const [rows] = await pool.query('SELECT id, name, role FROM users WHERE id = ?', [decoded.id || decoded.userId]);
      if (!rows.length) throw new Error('User not found');
      user = rows[0];
    } catch (err) {
      console.error('[notulen-ws] Auth failed:', err.message);
      ws.close(4001, 'Unauthorized');
      return;
    }

    console.log(`[notulen-ws] User ${user.name} (${user.id}) connected`);

    let sessionState = null;

    // Ping keepalive
    const pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, 30000);

    ws.on('message', async (data, isBinary) => {
      if (!isBinary) {
        // Text message — JSON command
        try {
          const msg = JSON.parse(data.toString());
          await handleCommand(ws, user, msg);
        } catch (err) {
          console.error('[notulen-ws] Command error:', err.message);
        }
        return;
      }

      // Binary message — audio chunk (PCM from AudioWorklet or webm/mp4 from MediaRecorder)
      if (!sessionState || !sessionState.isRecording) return;

      const audioBuffer = Buffer.from(data);
      sessionState.chunkCounter++;

      // Detect format: PCM Int16 has no magic bytes, webm starts with 0x1A45DFA3, mp4 with ftyp
      const isWebm = audioBuffer.length > 4 && audioBuffer[0] === 0x1A && audioBuffer[1] === 0x45;
      const isMp4 = audioBuffer.length > 8 && audioBuffer.toString('ascii', 4, 8) === 'ftyp';
      const isEncodedAudio = isWebm || isMp4;

      if (isEncodedAudio) {
        // MediaRecorder format — send directly to Groq as file
        const dur = audioBuffer.length / 8000; // rough estimate
        console.log(`[notulen-ws] Chunk #${sessionState.chunkCounter}: ${audioBuffer.length}B (${isWebm ? 'webm' : 'mp4'}) ~${dur.toFixed(0)}s`);
        const chunkElapsed = (Date.now() - sessionState.startTime) / 1000 - CHUNK_SEC;
        if (sessionState.queue.length >= MAX_QUEUE) { sessionState.queue.shift(); console.warn('[notulen-ws] Queue full — dropped oldest'); }
        sessionState.queue.push({ audio: audioBuffer, format: isWebm ? 'webm' : 'mp4', elapsed: chunkElapsed });
        processQueue(ws, sessionState);
        return;
      }

      // PCM Int16 from AudioWorklet
      const pcmBuffer = audioBuffer;
      const dur = pcmBuffer.length / (notulenService.SAMPLE_RATE * notulenService.SAMPLE_WIDTH);
      console.log(`[notulen-ws] Chunk #${sessionState.chunkCounter}: ${pcmBuffer.length}B = ${dur.toFixed(1)}s (PCM)`);

      // Build chunk with overlap
      let fullChunk;
      if (sessionState.overlapBuffer && sessionState.overlapBuffer.length > 0) {
        fullChunk = Buffer.concat([sessionState.overlapBuffer, pcmBuffer]);
      } else {
        fullChunk = pcmBuffer;
      }

      // Save last OVERLAP_SAMPLES bytes for next chunk
      if (pcmBuffer.length > OVERLAP_SAMPLES) {
        sessionState.overlapBuffer = pcmBuffer.subarray(pcmBuffer.length - OVERLAP_SAMPLES);
      } else {
        sessionState.overlapBuffer = pcmBuffer;
      }

      // Queue for processing
      if (sessionState.queue.length >= MAX_QUEUE) {
        sessionState.queue.shift();
        console.warn('[notulen-ws] Queue full — dropped oldest');
      }
      const chunkElapsed = (Date.now() - sessionState.startTime) / 1000 - dur;
      sessionState.queue.push({ pcm: fullChunk, elapsed: chunkElapsed });
      processQueue(ws, sessionState);
    });

    async function handleCommand(ws, user, msg) {
      const cmd = msg.command;

      if (cmd === 'start') {
        // Create DB session
        const sessionId = await notulenService.createSession(user.id, {
          judul: msg.judul || 'Rapat',
          sub_judul: msg.sub_judul || null,
          pencatat: msg.pencatat || user.name,
          instansi: msg.instansi || 'BPS Provinsi Maluku Utara',
          tanggal: msg.tanggal || new Date().toISOString().split('T')[0],
        });

        sessionState = {
          sessionId,
          isRecording: true,
          chunkCounter: 0,
          startTime: Date.now(),
          queue: [],
          processing: false,
          processingStartedAt: null, // watchdog: reset if stuck > 120s
          transcriptionPaused: false,
          overlapBuffer: null,
          prevSegments: null, // for dedup
          lastTimestamp: 0, // monotonic timestamp tracking
        };
        activeSessions.set(user.id, sessionState);

        sendJson(ws, { type: 'status', message: 'recording_started', sessionId });
        console.log(`[notulen-ws] Recording started: session ${sessionId}`);

      } else if (cmd === 'stop') {
        if (sessionState) {
          sessionState.isRecording = false;
          // Force-resume transcription so drainQueue actually processes all buffered chunks
          sessionState.transcriptionPaused = false;
          sendJson(ws, { type: 'status', message: 'transcription_resumed' });
          const duration = Math.round((Date.now() - sessionState.startTime) / 1000);
          // Drain remaining queue — this may take time (Groq calls) but WS stays open
          await drainQueue(ws, sessionState);
          await notulenService.updateSessionStatus(sessionState.sessionId, 'completed', duration);
          activeSessions.delete(user.id);
          console.log(`[notulen-ws] Recording stopped: session ${sessionState.sessionId}, ${duration}s`);
        }
        sendJson(ws, { type: 'status', message: 'recording_stopped' });

      } else if (cmd === 'pause') {
        if (sessionState) sessionState.isRecording = false;
        sendJson(ws, { type: 'status', message: 'recording_paused' });

      } else if (cmd === 'resume') {
        if (sessionState) sessionState.isRecording = true;
        sendJson(ws, { type: 'status', message: 'recording_resumed' });

      } else if (cmd === 'delete_segment') {
        if (sessionState && msg.segment_id != null) {
          await notulenService.deleteSegment(msg.segment_id, sessionState.sessionId);
          sendJson(ws, { type: 'segment_deleted', segment_id: msg.segment_id });
        }

      } else if (cmd === 'ping') {
        sendJson(ws, { type: 'pong' });

      } else if (cmd === 'resume_session') {
        // Attach to an existing completed/recording session — user may have accidentally reloaded
        const resumeId = msg.sessionId;
        if (!resumeId) { sendJson(ws, { type: 'error', message: 'sessionId diperlukan' }); return; }
        const isAdmin = user.role === 'admin';
        const session = await notulenService.getSession(resumeId, user.id, isAdmin);
        if (!session) { sendJson(ws, { type: 'error', message: 'Sesi tidak ditemukan' }); return; }

        // Get last saved segment timestamp so new segments continue monotonically
        const existingSegments = await notulenService.getSegments(resumeId);
        const lastTs = existingSegments.length > 0
          ? existingSegments[existingSegments.length - 1].timestamp_seconds
          : 0;

        await notulenService.updateSessionStatus(resumeId, 'recording');
        sessionState = {
          sessionId: resumeId,
          isRecording: true,
          chunkCounter: 0,
          // Offset startTime so chunkElapsed will produce timestamps continuing from lastTs
          startTime: Date.now() - Math.round(lastTs * 1000),
          queue: [],
          processing: false,
          processingStartedAt: null,
          transcriptionPaused: false,
          overlapBuffer: null,
          prevSegments: null,
          lastTimestamp: lastTs,
        };
        activeSessions.set(user.id, sessionState);
        console.log(`[notulen-ws] Resumed session ${resumeId} for user ${user.name} (lastTs=${lastTs.toFixed(1)}s)`);
        sendJson(ws, { type: 'status', message: 'recording_started', sessionId: resumeId, resumed: true });

      } else if (cmd === 'pause_transcription') {
        if (sessionState) {
          sessionState.transcriptionPaused = true;
          console.log(`[notulen-ws] Transcription paused (${sessionState.queue.length} chunks queued)`);
        }
        sendJson(ws, { type: 'status', message: 'transcription_paused' });

      } else if (cmd === 'resume_transcription') {
        if (sessionState) {
          sessionState.transcriptionPaused = false;
          console.log(`[notulen-ws] Transcription resumed — draining ${sessionState.queue.length} queued chunks`);
          processQueue(ws, sessionState);
        }
        sendJson(ws, { type: 'status', message: 'transcription_resumed' });
      }
    }

    async function processQueue(ws, state) {
      if (state.transcriptionPaused || state.processing || state.queue.length === 0) return;

      // Watchdog: if stuck > 120s, reset and retry (defensive — handles unexpected stuck states)
      if (state.processingStartedAt && (Date.now() - state.processingStartedAt) > 120000) {
        console.warn('[notulen-ws] processQueue watchdog: stuck > 120s, resetting');
        state.processing = false;
        state.processingStartedAt = null;
      }
      if (state.processing) return;

      state.processing = true;
      state.processingStartedAt = Date.now();

      try {
        while (state.queue.length > 0 && !state.transcriptionPaused) {
          const item = state.queue.shift();
          // Notify frontend of remaining queue depth
          sendJson(ws, { type: 'queue_status', queueDepth: state.queue.length, processing: true });
          try {
            let results;

            if (item.format) {
              // Encoded audio (webm/mp4 from MediaRecorder) — send to Groq as file
              results = await transcribeEncodedAudio(item.audio, item.format);
            } else {
              // PCM from AudioWorklet
              results = await notulenService.transcribeGroq(item.pcm);
              results = notulenService.deduplicateSegments(state.prevSegments, results, OVERLAP_SECONDS);
            }

            if (results.length > 0) state.prevSegments = results;

            // Merge micro-segments into coherent sentences
            const merged = notulenService.mergeShortSegments(results);

            // Batch save — enforce monotonic timestamps
            const segData = merged.map(r => {
              const rawTs = item.elapsed + r.start;
              const ts = Math.max(rawTs, state.lastTimestamp + 0.1);
              state.lastTimestamp = ts;
              return { text: r.text, timestamp_seconds: ts, segment_start: r.start, segment_end: r.end };
            });
            const segIds = await notulenService.saveSegmentsBatch(state.sessionId, segData);

            // Send each merged segment to client
            for (let i = 0; i < merged.length; i++) {
              const ts = segData[i].timestamp_seconds;
              const mm = Math.floor(ts / 60).toString().padStart(2, '0');
              const ss = Math.floor(ts % 60).toString().padStart(2, '0');
              sendJson(ws, {
                type: 'transcript',
                text: merged[i].text,
                timestamp: `${mm}:${ss}`,
                segment_id: segIds[i],
              });
              console.log(`[notulen-ws] Sent: [${mm}:${ss}] ${merged[i].text}`);
            }
          } catch (err) {
            console.error('[notulen-ws] Process error:', err.message);
          }
        }
      } finally {
        // Always reset — prevents permanent deadlock regardless of what threw
        state.processing = false;
        state.processingStartedAt = null;
        sendJson(ws, { type: 'queue_status', queueDepth: state.queue.length, processing: false });
      }
    }

    async function transcribeEncodedAudio(audioBuffer, format) {
      const ext = format === 'webm' ? 'webm' : 'mp4';
      const mime = format === 'webm' ? 'audio/webm' : 'audio/mp4';
      const MAX_RETRIES = 4;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const form = new FormData();
        form.append('file', audioBuffer, { filename: `chunk.${ext}`, contentType: mime });
        form.append('model', process.env.GROQ_MODEL || 'whisper-large-v3-turbo');
        form.append('language', 'id');
        form.append('response_format', 'verbose_json');
        form.append('timestamp_granularities[]', 'segment');

        try {
          const resp = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', form, {
            headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
            timeout: 60000,
          });
          const data = resp.data;
          const results = [];
          for (const seg of (data.segments || [])) {
            const t = (seg.text || '').trim();
            if (t && !notulenService.isHallucination(t)) {
              results.push({ text: t, start: seg.start || 0, end: seg.end || 0 });
            }
          }
          if (results.length === 0 && data.text && !notulenService.isHallucination(data.text.trim())) {
            results.push({ text: data.text.trim(), start: 0, end: data.duration || 0 });
          }
          return results;

        } catch (err) {
          const status = err.response?.status;
          if (status === 429) {
            const raw = err.response?.headers?.['retry-after'] || '';
            let waitSec = 60;
            if (/^\d+$/.test(raw)) waitSec = parseInt(raw, 10);

            // Daily limit: retry-after > 1 hour — notify client and give up
            if (waitSec > 3600) {
              sendJson(ws, { type: 'groq_limit', message: 'Batas harian Groq Whisper tercapai. Transkripsi dihentikan sementara.' });
              console.warn('[notulen-ws] Groq daily limit reached');
              return [];
            }

            console.warn(`[notulen-ws] 429 rate limit, waiting ${waitSec + 2}s...`);
            sendJson(ws, { type: 'groq_limit', message: `Rate limit Groq — menunggu ${waitSec + 2}s...` });
            await new Promise(r => setTimeout(r, (waitSec + 2) * 1000));
            // do not increment attempt — retry immediately after wait
            attempt--;
            if (attempt < -5) return []; // safety: max 5 rate-limit waits in a row
          } else {
            console.error(`[notulen-ws] Encoded transcribe attempt ${attempt + 1} failed: ${err.message}`);
            if (attempt < MAX_RETRIES - 1) await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
          }
        }
      }
      return [];
    }

    async function drainQueue(ws, state) {
      if (state.queue.length > 0) {
        console.log(`[notulen-ws] Draining ${state.queue.length} remaining chunks...`);
        await processQueue(ws, state);
      }
    }

    ws.on('close', () => {
      clearInterval(pingTimer);
      if (sessionState && sessionState.isRecording) {
        const duration = Math.round((Date.now() - sessionState.startTime) / 1000);
        notulenService.updateSessionStatus(sessionState.sessionId, 'completed', duration)
          .catch(err => console.error('[notulen-ws] Cleanup error:', err.message));
        activeSessions.delete(user.id);
      }
      console.log(`[notulen-ws] User ${user.name} disconnected`);
    });

    ws.on('error', (err) => {
      console.error(`[notulen-ws] Error: ${err.message}`);
    });
  });

  return wss;
}

function sendJson(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

module.exports = router;
module.exports.setupNotulenWebSocket = setupNotulenWebSocket;
