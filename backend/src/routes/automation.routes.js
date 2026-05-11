const express = require('express');
const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const { verifyToken } = require('../middleware/auth.middleware');

const router = express.Router();

// In-memory store for running child processes (keyed by runId)
const runningProcesses = new Map();

// Max concurrent automation runs across all users
const MAX_CONCURRENT_RUNS = parseInt(process.env.MAX_CONCURRENT_RUNS) || 3;

// Max queued runs to prevent unbounded queue growth
const MAX_QUEUE_SIZE = parseInt(process.env.MAX_QUEUE_SIZE) || 10;

// --- Encryption helpers for queue_meta credentials (AES-256-GCM) ---
const QUEUE_ENCRYPTION_KEY_RAW = process.env.QUEUE_ENCRYPTION_KEY || process.env.SESSION_SECRET || 'fallback-key-change-me';
// Derive a 32-byte key using SHA-256
const QUEUE_ENCRYPTION_KEY = crypto.createHash('sha256').update(QUEUE_ENCRYPTION_KEY_RAW).digest();

function encryptCredentials(plaintext) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', QUEUE_ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

function decryptCredentials(ciphertext) {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted format');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    const decipher = crypto.createDecipheriv('aes-256-gcm', QUEUE_ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

// --- Date validation helper ---
function validateYearMonth(year, month) {
    const y = parseInt(year);
    const m = parseInt(month);
    if (!Number.isInteger(y) || y < 2020 || y > 2100) return false;
    if (!Number.isInteger(m) || m < 1 || m > 12) return false;
    return { year: y, month: m };
}

/**
 * Spawn the Python automation process for a given run.
 * Used both by the initial /run endpoint and by the queue processor.
 */
function spawnAutomationProcess(runId, userId, { year, month, dryRun, kipappUsername, kipappPassword }) {
    const scriptPath = path.resolve(__dirname, '../../../automasi/kipapp_db.py');
    const args = [
        scriptPath,
        '--user-id', String(userId),
        '--year', String(year),
        '--month', String(month),
        '--run-id', String(runId),
    ];
    if (dryRun) args.push('--dry-run');

    const pythonPath = path.resolve(__dirname, '../../../automasi/venv/bin/python3');
    const child = spawn(pythonPath, args, {
        cwd: path.resolve(__dirname, '../../../automasi'),
        env: {
            PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
            HOME: process.env.HOME || '/root',
            DB_HOST: process.env.DB_HOST || 'localhost',
            DB_USER: process.env.DB_USER || 'root',
            DB_PASS: process.env.DB_PASSWORD,
            DB_NAME: process.env.DB_NAME || 'agenda_work_db',
            DB_PORT: process.env.DB_PORT || '3306',
            KIPAPP_USERNAME: kipappUsername,
            KIPAPP_PASSWORD: kipappPassword,
        },
    });

    const procEntry = { child, userId, alive: true };
    runningProcesses.set(runId, procEntry);

    child.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
            try { JSON.parse(line); } catch { /* non-JSON log */ }
        }
    });

    child.stderr.on('data', (data) => {
        console.error(`[automation:${runId}] stderr:`, data.toString());
    });

    child.on('close', async (code) => {
        procEntry.alive = false;
        if (code !== 0) {
            try {
                await pool.query(
                    `UPDATE automation_runs SET status = 'failed', error_message = ?, completed_at = NOW()
                     WHERE id = ? AND status NOT IN ('completed', 'cancelled')`,
                    [`Process exited with code ${code}`, runId]
                );
            } catch (e) {
                console.error('Failed to update run status on exit:', e);
            }
        }
        // Clean up OTP file
        const otpFile = `/tmp/kipapp_otp_${runId}`;
        if (fs.existsSync(otpFile)) {
            try { fs.unlinkSync(otpFile); } catch { /* ignore */ }
        }
        // Clean up after 5 minutes
        setTimeout(() => runningProcesses.delete(runId), 300000);

        // Process queue — start next queued run if slot available
        processQueue();
    });

    return child;
}

/**
 * Process the queue: start queued runs if concurrency slots are available.
 */
async function processQueue() {
    try {
        // Count currently active runs
        const [activeRows] = await pool.query(
            `SELECT COUNT(*) as cnt FROM automation_runs WHERE status IN ('pending', 'running', 'waiting_otp')`
        );
        const activeCount = activeRows[0].cnt;

        if (activeCount >= MAX_CONCURRENT_RUNS) return;

        const slotsAvailable = MAX_CONCURRENT_RUNS - activeCount;

        // Get next queued runs (FIFO)
        const [queued] = await pool.query(
            `SELECT ar.*, u.username FROM automation_runs ar
             JOIN users u ON ar.user_id = u.id
             WHERE ar.status = 'queued'
             ORDER BY ar.created_at ASC
             LIMIT ?`,
            [slotsAvailable]
        );

        for (const run of queued) {
            // Atomic claim: only promote if still queued
            const [claimResult] = await pool.query(
                `UPDATE automation_runs SET status = 'pending' WHERE id = ? AND status = 'queued'`,
                [run.id]
            );
            if (claimResult.affectedRows === 0) continue;

            // Read stored credentials from queue_meta (encrypted)
            let meta = {};
            try {
                if (run.queue_meta) {
                    const decrypted = decryptCredentials(run.queue_meta);
                    meta = JSON.parse(decrypted);
                }
            } catch (decErr) {
                console.error(`[Queue] Failed to decrypt queue_meta for run #${run.id}:`, decErr.message);
                meta = {};
            }

            if (!meta.kipappUsername || !meta.kipappPassword) {
                await pool.query(
                    `UPDATE automation_runs SET status = 'failed', error_message = 'Queued credentials missing', completed_at = NOW() WHERE id = ?`,
                    [run.id]
                );
                continue;
            }

            console.log(`[Queue] Starting queued run #${run.id} for ${run.username}`);
            spawnAutomationProcess(run.id, run.user_id, {
                year: run.year,
                month: run.month,
                dryRun: run.run_type === 'dry-run',
                kipappUsername: meta.kipappUsername,
                kipappPassword: meta.kipappPassword,
            });

            // Clear credentials from DB after spawning
            await pool.query('UPDATE automation_runs SET queue_meta = NULL WHERE id = ?', [run.id]);
        }
    } catch (err) {
        console.error('[Queue] Process queue error:', err.message);
    }
}

// Preview tasks for given year/month
router.get('/kipapp/preview', verifyToken, async (req, res) => {
    try {
        const { year, month } = req.query;
        if (!year || !month) {
            return res.status(400).json({ success: false, message: 'year and month required' });
        }
        const validated = validateYearMonth(year, month);
        if (!validated) {
            return res.status(400).json({ success: false, message: 'Invalid year (2020-2100) or month (1-12)' });
        }

        const [rows] = await pool.query(
            `SELECT id, CONCAT(prefix, ' ', kegiatan) as task_name, rencana_kinerja,
                    start_date, end_date, capaian, bukti_dukung
             FROM tasks
             WHERE user_id = ? AND MONTH(start_date) = ? AND YEAR(start_date) = ?
             ORDER BY start_date`,
            [req.user.id, validated.month, validated.year]
        );

        res.json({ success: true, data: rows, total: rows.length });
    } catch (error) {
        console.error('Preview error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Start automation run
router.post('/kipapp/run', verifyToken, async (req, res) => {
    try {
        const { year, month, dryRun, kipappUsername, kipappPassword } = req.body;
        if (!year || !month) {
            return res.status(400).json({ success: false, message: 'year and month required' });
        }
        const validated = validateYearMonth(year, month);
        if (!validated) {
            return res.status(400).json({ success: false, message: 'Invalid year (2020-2100) or month (1-12)' });
        }
        if (!kipappUsername || !kipappPassword) {
            return res.status(400).json({ success: false, message: 'KipApp credentials required' });
        }

        // Check if there's already a running/queued process for this user
        const [activeRuns] = await pool.query(
            `SELECT id FROM automation_runs
             WHERE user_id = ? AND status IN ('pending', 'running', 'waiting_otp', 'queued')
             LIMIT 1`,
            [req.user.id]
        );
        if (activeRuns.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'Kamu sudah memiliki automation yang sedang berjalan atau dalam antrian. Batalkan dulu jika ingin memulai yang baru.',
            });
        }

        // Check global concurrency — how many are actively running?
        const [globalActive] = await pool.query(
            `SELECT COUNT(*) as cnt FROM automation_runs WHERE status IN ('pending', 'running', 'waiting_otp')`
        );
        const activeCount = globalActive[0].cnt;
        const shouldQueue = activeCount >= MAX_CONCURRENT_RUNS;

        // C10: Check queue size cap before allowing queued runs
        if (shouldQueue) {
            const [queueCount] = await pool.query(
                `SELECT COUNT(*) as cnt FROM automation_runs WHERE status = 'queued'`
            );
            if (queueCount[0].cnt >= MAX_QUEUE_SIZE) {
                return res.status(503).json({
                    success: false,
                    message: `Antrian penuh (${MAX_QUEUE_SIZE} menunggu). Coba lagi nanti.`,
                });
            }
        }

        // Encrypt credentials for queued runs (AES-256-GCM, cleared after start)
        const queueMeta = encryptCredentials(JSON.stringify({ kipappUsername, kipappPassword }));

        // Insert run record
        const initialStatus = shouldQueue ? 'queued' : 'pending';
        const [result] = await pool.query(
            `INSERT INTO automation_runs (user_id, run_type, status, year, month, queue_meta)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [req.user.id, dryRun ? 'dry-run' : 'live', initialStatus, validated.year, validated.month, queueMeta]
        );
        const runId = result.insertId;

        if (shouldQueue) {
            // Calculate queue position
            const [queueRows] = await pool.query(
                `SELECT COUNT(*) as pos FROM automation_runs WHERE status = 'queued' AND id < ?`,
                [runId]
            );
            const queuePosition = (queueRows[0].pos || 0) + 1;

            console.log(`[Queue] Run #${runId} queued at position ${queuePosition} (${activeCount}/${MAX_CONCURRENT_RUNS} slots used)`);
            res.json({
                success: true,
                data: {
                    runId,
                    status: 'queued',
                    queuePosition,
                    message: `Server sedang sibuk (${activeCount} automasi berjalan). Kamu berada di antrian posisi #${queuePosition}. Automasi akan dimulai otomatis begitu giliran tiba.`,
                },
            });
        } else {
            // Start immediately
            spawnAutomationProcess(runId, req.user.id, {
                year, month, dryRun, kipappUsername, kipappPassword,
            });

            // Clear queue_meta after spawning (credentials no longer needed in DB)
            await pool.query('UPDATE automation_runs SET queue_meta = NULL WHERE id = ?', [runId]);

            res.json({ success: true, data: { runId, status: 'pending' } });
        }
    } catch (error) {
        console.error('Run error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Submit OTP for a running automation
router.post('/kipapp/otp/:runId', verifyToken, async (req, res) => {
    try {
        const runId = parseInt(req.params.runId);
        const { otp } = req.body;

        if (!otp || otp.length < 4) {
            return res.status(400).json({ success: false, message: 'Valid OTP code required' });
        }

        // Verify ownership
        const [runs] = await pool.query(
            'SELECT * FROM automation_runs WHERE id = ? AND user_id = ?',
            [runId, req.user.id]
        );
        if (runs.length === 0) {
            return res.status(404).json({ success: false, message: 'Run not found' });
        }
        if (runs[0].status !== 'waiting_otp') {
            return res.status(400).json({ success: false, message: 'Run is not waiting for OTP' });
        }

        // Write OTP to temp file for Python process to read
        const otpFile = `/tmp/kipapp_otp_${runId}`;
        await fs.promises.writeFile(otpFile, otp.trim(), { encoding: 'utf8', mode: 0o600 });

        res.json({ success: true, message: 'OTP submitted' });
    } catch (error) {
        console.error('OTP submit error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get run status (SSE stream)
router.get('/kipapp/status/:runId', verifyToken, async (req, res) => {
    const runId = parseInt(req.params.runId);

    // Verify ownership
    const [runs] = await pool.query(
        'SELECT * FROM automation_runs WHERE id = ? AND user_id = ?',
        [runId, req.user.id]
    );
    if (runs.length === 0) {
        return res.status(404).json({ success: false, message: 'Run not found' });
    }

    // SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Poll DB every 2 seconds
    const interval = setInterval(async () => {
        try {
            const [rows] = await pool.query(
                'SELECT * FROM automation_runs WHERE id = ?',
                [runId]
            );
            if (rows.length === 0) {
                clearInterval(interval);
                res.end();
                return;
            }
            const run = rows[0];
            if (run.status === 'queued') {
                const [queueRows] = await pool.query(
                    `SELECT COUNT(*) as pos FROM automation_runs WHERE status = 'queued' AND id < ?`,
                    [run.id]
                );
                run.queue_position = (queueRows[0].pos || 0) + 1;
            }
            delete run.queue_meta;
            sendEvent(run);

            // Close stream when terminal state
            if (['completed', 'failed', 'cancelled'].includes(run.status)) {
                clearInterval(interval);
                clearTimeout(sseTimeout);
                setTimeout(() => res.end(), 1000);
            }
        } catch (err) {
            console.error('SSE poll error:', err);
            // Clear interval and timeout on error to prevent leak
            clearInterval(interval);
            clearTimeout(sseTimeout);
            try { res.end(); } catch { /* already closed */ }
        }
    }, 2000);

    // M2: Max SSE timeout (30 minutes) to prevent indefinite connections
    const SSE_TIMEOUT_MS = 30 * 60 * 1000;
    const sseTimeout = setTimeout(() => {
        sendEvent({ type: 'timeout', message: 'SSE connection timed out after 30 minutes. Please reconnect.' });
        clearInterval(interval);
        res.end();
    }, SSE_TIMEOUT_MS);

    // Send initial state immediately
    sendEvent(runs[0]);

    req.on('close', () => {
        clearInterval(interval);
        clearTimeout(sseTimeout);
    });
});

// Get single run status (JSON polling — more reliable than SSE through Cloudflare)
router.get('/kipapp/run/:runId', verifyToken, async (req, res) => {
    try {
        const runId = parseInt(req.params.runId);
        const [rows] = await pool.query(
            'SELECT * FROM automation_runs WHERE id = ? AND user_id = ?',
            [runId, req.user.id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Run not found' });
        }
        const run = rows[0];
        if (run.status === 'queued') {
            const [queueRows] = await pool.query(
                `SELECT COUNT(*) as pos FROM automation_runs WHERE status = 'queued' AND id < ?`,
                [run.id]
            );
            run.queue_position = (queueRows[0].pos || 0) + 1;
        }
        delete run.queue_meta;
        res.json({ success: true, data: run });
    } catch (error) {
        console.error('Run status error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get active run (for reconnecting after refresh)
router.get('/kipapp/active', verifyToken, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT * FROM automation_runs WHERE user_id = ? AND status IN ('pending', 'running', 'waiting_otp', 'queued') ORDER BY created_at DESC LIMIT 1`,
            [req.user.id]
        );
        if (rows.length > 0 && rows[0].status === 'queued') {
            const [queueRows] = await pool.query(
                `SELECT COUNT(*) as pos FROM automation_runs WHERE status = 'queued' AND id < ?`,
                [rows[0].id]
            );
            rows[0].queue_position = (queueRows[0].pos || 0) + 1;
        }
        // Don't expose queue_meta (contains credentials)
        if (rows.length > 0) delete rows[0].queue_meta;
        res.json({ success: true, data: rows.length > 0 ? rows[0] : null });
    } catch (error) {
        console.error('Active run error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get run history
router.get('/kipapp/history', verifyToken, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const [rows] = await pool.query(
            `SELECT id, user_id, run_type, status, year, month, total_tasks, processed, skipped, failed_tasks, log, error_message, started_at, completed_at, created_at
             FROM automation_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
            [req.user.id, limit]
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('History error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Cancel a running automation
router.post('/kipapp/cancel/:runId', verifyToken, async (req, res) => {
    try {
        const runId = parseInt(req.params.runId);

        // Verify ownership
        const [runs] = await pool.query(
            'SELECT * FROM automation_runs WHERE id = ? AND user_id = ?',
            [runId, req.user.id]
        );
        if (runs.length === 0) {
            return res.status(404).json({ success: false, message: 'Run not found' });
        }
        if (['completed', 'failed', 'cancelled'].includes(runs[0].status)) {
            return res.status(400).json({ success: false, message: 'Run already finished' });
        }

        // Kill child process
        const proc = runningProcesses.get(runId);
        if (proc && proc.alive) {
            proc.child.kill('SIGTERM');
            proc.alive = false;
        }

        await pool.query(
            `UPDATE automation_runs SET status = 'cancelled', completed_at = NOW() WHERE id = ?`,
            [runId]
        );

        res.json({ success: true, message: 'Run cancelled' });
    } catch (error) {
        console.error('Cancel error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
