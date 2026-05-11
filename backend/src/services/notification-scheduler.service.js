/**
 * Unified Notification Scheduler
 * Consolidates ALL agenda data into a single daily digest via LLM.
 *
 * Flow:
 *  1. At user's notification_time, gather ALL context:
 *     - Tasks (active, overdue, upcoming deadlines)
 *     - Kegiatan (ongoing, upcoming)
 *     - Events (ongoing, upcoming)
 *     - Todos (pending)
 *     - Custom reminders (due today)
 *  2. Filter items by user's reminder_levels (H-3, H-2, H-1, Hari-H, Berakhir)
 *  3. Send structured data to LLM (gemini-flash via malika-llm-proxy)
 *  4. LLM produces ONE comprehensive WA message
 *  5. Send via WhatsApp, mark custom reminders as sent
 */

const pool = require('../config/database');
const whatsappService = require('./whatsapp.service');
const axios = require('axios');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);

const LLM_PROXY_URL = process.env.LLM_PROXY_URL || 'http://localhost:3031';
// #27: the previous default 'gemini-3-flash-preview' is not a valid model name on any
// known provider and was the likely root cause of hourly 404s. Default to the model
// documented in ../../../MEMORY.md; override with LLM_DIGEST_MODEL env var.
const LLM_MODEL = process.env.LLM_DIGEST_MODEL || 'claude-sonnet-4-6';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HARI_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

let _isRunning = false;

/**
 * Main entry — called every 60 seconds by daemon
 */
async function checkAndSendNotifications() {
    if (_isRunning) return;
    _isRunning = true;
    try {
        const now = dayjs().utcOffset(9); // WIT (UTC+9)
        const currentTime = now.format('HH:mm');
        const currentDay = DAY_NAMES[now.day()];

        const [settings] = await pool.query(
            `SELECT uns.*, u.phone_number, u.username
             FROM user_notification_settings uns
             JOIN users u ON uns.user_id = u.id
             WHERE uns.is_active = 1
               AND u.phone_number IS NOT NULL
               AND TIME_FORMAT(uns.notification_time, '%H:%i') = ?`,
            [currentTime]
        );

        // Filter by day, then process in parallel batches (max 3 concurrent)
        const DIGEST_CONCURRENCY = parseInt(process.env.DIGEST_CONCURRENCY) || 3;
        const eligibleSettings = settings.filter(setting => {
            let days = setting.notification_days;
            if (typeof days === 'string') { try { days = JSON.parse(days); } catch { return false; } }
            return Array.isArray(days) && days.includes(currentDay);
        });

        // Process in batches of DIGEST_CONCURRENCY
        for (let i = 0; i < eligibleSettings.length; i += DIGEST_CONCURRENCY) {
            const batch = eligibleSettings.slice(i, i + DIGEST_CONCURRENCY);
            await Promise.allSettled(batch.map(async (setting) => {
                // Atomic claim: UPDATE last_sent_at before sending to prevent duplicate sends
                const [claimResult] = await pool.query(
                    `UPDATE user_notification_settings
                     SET last_sent_at = NOW()
                     WHERE user_id = ?
                       AND (last_sent_at IS NULL OR last_sent_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE))`,
                    [setting.user_id]
                );
                if (claimResult.affectedRows === 0) return; // already sent within 30 min

                try {
                    await sendUnifiedDigest(setting, now);
                } catch (err) {
                    console.error(`[Digest] Error for ${setting.username}:`, err.message);
                }
            }));
        }
    } catch (error) {
        console.error('[Digest] Check error:', error.message);
    } finally {
        _isRunning = false;
    }
}

/**
 * Gather all context and send unified digest to one user
 */
async function sendUnifiedDigest(setting, now) {
    const userId = setting.user_id;
    const username = setting.username;
    const todayStr = now.format('YYYY-MM-DD');

    let levels = setting.reminder_levels;
    if (typeof levels === 'string') levels = JSON.parse(levels);
    if (!Array.isArray(levels) || levels.length === 0) levels = ['H-1', 'Hari-H'];

    let types = setting.notification_types;
    if (typeof types === 'string') types = JSON.parse(types);
    if (!Array.isArray(types) || types.length === 0) types = ['daily'];

    const scopeLookahead = setting.scope_lookahead !== undefined ? Number(setting.scope_lookahead) : 1;

    // --- Gather ALL data ---
    const context = await gatherContext(userId, username, todayStr, now, levels, types, scopeLookahead);

    // Skip if nothing to report
    if (context.isEmpty) {
        console.log(`[Digest] No items for ${username}, skipping`);
        return;
    }

    // --- Send to LLM ---
    const message = await generateDigestViaLLM(username, todayStr, now, context);

    if (!message) {
        console.error(`[Digest] LLM returned empty for ${username}`);
        return;
    }

    // --- Send WA ---
    const result = await whatsappService.sendMessage(setting.phone_number, message);

    if (result.success) {
        // Mark custom reminders as sent
        if (context.customReminders.length > 0) {
            const ids = context.customReminders.map(r => r.id);
            await pool.query('UPDATE reminders SET is_sent = 1, updated_at = NOW() WHERE id IN (?)', [ids]);
        }

        // Auto-complete all system reminders due today or earlier for this user
        // (they've been included in the digest, so mark as done)
        await pool.query(
            `UPDATE reminders SET is_completed = 1, is_sent = 1, updated_at = NOW()
             WHERE user_id = ? AND source_type != 'custom'
               AND DATE(reminder_datetime) <= CURDATE()
               AND is_completed = 0`,
            [userId]
        );

        // Update last_sent_at
        await pool.query('UPDATE user_notification_settings SET last_sent_at = NOW() WHERE user_id = ?', [userId]);

        console.log(`[Digest] Sent to ${username} (${setting.phone_number})`);
    } else {
        console.error(`[Digest] WA send failed for ${username}:`, result.error);
    }
}

/**
 * Gather all agenda context for a user
 */
async function gatherContext(userId, username, todayStr, now, levels, types, scopeLookahead = 1) {
    // Compute date offsets for reminder_levels
    const datesToCheck = new Set();
    const levelDays = { 'H-3': 3, 'H-2': 2, 'H-1': 1, 'Hari-H': 0 };

    for (const level of levels) {
        if (levelDays[level] !== undefined) {
            datesToCheck.add(now.add(levelDays[level], 'day').format('YYYY-MM-DD'));
        }
    }
    const checkBerakhir = levels.includes('Berakhir');

    // === Parallel data fetch — all independent queries at once ===
    const [
        [allTasks],
        [allKegiatan],
        [allEvents],
        [allPendingTodos],
        [customReminders],
        [totalTasksRow],
        [completedTodayRow],
    ] = await Promise.all([
        pool.query(
            `SELECT id, task, prefix, kegiatan, rencana_kinerja, priority, status, start_date, end_date, notes
             FROM tasks WHERE user_id = ? AND status NOT IN ('Completed', 'Cancelled')
             ORDER BY priority ASC, end_date ASC`,
            [userId]
        ),
        pool.query(
            `SELECT e.id, e.title, e.start_date, e.end_date, e.description, u.username as creator
             FROM events e JOIN users u ON e.user_id = u.id
             WHERE e.end_date >= ?
             ORDER BY e.start_date ASC`,
            [todayStr]
        ),
        pool.query(
            `SELECT id, title, start_date, end_date, description, category
             FROM events WHERE user_id = ? AND end_date >= ?
             ORDER BY start_date ASC`,
            [userId, todayStr]
        ),
        pool.query(
            `SELECT id, title, priority, due_date FROM todos
             WHERE user_id = ? AND is_completed = 0
             ORDER BY FIELD(priority, 'High', 'Medium', 'Low'), due_date ASC
             LIMIT 20`,
            [userId]
        ),
        pool.query(
            `SELECT id, title, description, reminder_datetime, repeat_type
             FROM reminders
             WHERE user_id = ? AND is_active = 1 AND is_completed = 0 AND is_sent = 0
               AND DATE(reminder_datetime) = ?
               AND title NOT LIKE '[Task #%' AND title NOT LIKE '[Event #%' AND title NOT LIKE '[Kegiatan #%'
             ORDER BY reminder_datetime ASC`,
            [userId, todayStr]
        ),
        pool.query(
            `SELECT COUNT(*) as total FROM tasks WHERE user_id = ? AND status NOT IN ('Completed','Cancelled')`,
            [userId]
        ),
        pool.query(
            `SELECT COUNT(*) as total FROM tasks WHERE user_id = ? AND status = 'Completed' AND DATE(updated_at) = ?`,
            [userId, todayStr]
        ),
    ]);

    const overdueTasks = [];
    const upcomingTaskStart = [];   // task starting on matched dates
    const upcomingTaskDeadline = []; // task deadline on matched dates
    const activeTasks = [];

    for (const t of allTasks) {
        const endStr = t.end_date ? dayjs(t.end_date).format('YYYY-MM-DD') : null;
        const startStr = t.start_date ? dayjs(t.start_date).format('YYYY-MM-DD') : null;

        // Overdue: end_date < today
        if (endStr && endStr < todayStr) {
            const daysOverdue = now.diff(dayjs(t.end_date), 'day');
            overdueTasks.push({ ...t, daysOverdue });
            continue;
        }

        let matched = false;
        let inDeadline = false;
        // Check if start_date or end_date matches any reminder level date
        for (const checkDate of datesToCheck) {
            const daysUntil = dayjs(checkDate).diff(now.startOf('day'), 'day');
            if (endStr === checkDate) {
                upcomingTaskDeadline.push({ ...t, daysUntil, label: daysUntil === 0 ? 'Hari ini' : `H-${daysUntil}` });
                matched = true;
                inDeadline = true;
            }
            // Only show in "mulai" if NOT already in deadline (avoid same-day duplicate)
            if (startStr === checkDate && !inDeadline) {
                upcomingTaskStart.push({ ...t, daysUntil, label: daysUntil === 0 ? 'Hari ini' : `H-${daysUntil}` });
                matched = true;
            }
        }

        if (!matched) {
            activeTasks.push(t);
        }
    }

    // === KEGIATAN (data already fetched in parallel) ===
    const upcomingKegiatan = [];
    const ongoingKegiatan = [];
    const endingKegiatan = [];

    for (const k of allKegiatan) {
        const startStr = dayjs(k.start_date).format('YYYY-MM-DD');
        const endStr = dayjs(k.end_date).format('YYYY-MM-DD');

        // Berakhir check
        if (checkBerakhir) {
            const tomorrow = now.add(1, 'day').format('YYYY-MM-DD');
            if (endStr === todayStr) {
                endingKegiatan.push({ ...k, endLabel: 'Hari terakhir' });
            } else if (endStr === tomorrow) {
                endingKegiatan.push({ ...k, endLabel: 'Berakhir besok' });
            }
        }

        // Start date matches reminder level
        let matched = false;
        for (const checkDate of datesToCheck) {
            const daysUntil = dayjs(checkDate).diff(now.startOf('day'), 'day');
            if (startStr === checkDate) {
                upcomingKegiatan.push({ ...k, daysUntil, label: daysUntil === 0 ? 'Mulai hari ini' : `H-${daysUntil} mulai` });
                matched = true;
                break;
            }
        }

        // Currently ongoing (started but not ended)
        if (!matched && startStr <= todayStr && endStr >= todayStr) {
            ongoingKegiatan.push(k);
        }
    }

    // === EVENTS (data already fetched in parallel) ===
    const upcomingEvents = [];
    const ongoingEvents = [];
    const endingEvents = [];

    for (const e of allEvents) {
        const startStr = dayjs(e.start_date).format('YYYY-MM-DD');
        const endStr = dayjs(e.end_date).format('YYYY-MM-DD');

        if (checkBerakhir) {
            const tomorrow = now.add(1, 'day').format('YYYY-MM-DD');
            if (endStr === todayStr) {
                endingEvents.push({ ...e, endLabel: 'Hari terakhir' });
            } else if (endStr === tomorrow) {
                endingEvents.push({ ...e, endLabel: 'Berakhir besok' });
            }
        }

        let matched = false;
        for (const checkDate of datesToCheck) {
            const daysUntil = dayjs(checkDate).diff(now.startOf('day'), 'day');
            if (startStr === checkDate) {
                upcomingEvents.push({ ...e, daysUntil, label: daysUntil === 0 ? 'Hari ini' : `H-${daysUntil}` });
                matched = true;
                break;
            }
        }

        if (!matched && startStr <= todayStr && endStr >= todayStr) {
            ongoingEvents.push(e);
        }
    }

    // === TODOS (data already fetched in parallel) ===
    const shownTaskIds = new Set();
    for (const t of [...overdueTasks, ...upcomingTaskDeadline, ...upcomingTaskStart]) {
        shownTaskIds.add(t.id);
    }

    // Filter out todos whose task is already shown in another section
    const pendingTodos = allPendingTodos.filter(t => {
        const match = t.title.match(/^\[Task #(\d+)\]/);
        if (match && shownTaskIds.has(parseInt(match[1]))) return false;
        return true;
    }).slice(0, 5);

    // === CUSTOM REMINDERS (data already fetched in parallel) ===

    // === TIMELINE — calendar-based view with scope_lookahead ===
    // scopeLookahead: 0 = current period only, 1 = current + next period
    let timelineEnd = todayStr;
    let timelineScopeLabel = null;

    const curBulan = BULAN_ID[now.month()];

    if (types.includes('yearly')) {
        if (scopeLookahead) {
            timelineEnd = now.add(1, 'year').endOf('year').format('YYYY-MM-DD');
            timelineScopeLabel = `tahun ${now.year()} + ${now.year() + 1}`;
        } else {
            timelineEnd = now.endOf('year').format('YYYY-MM-DD');
            timelineScopeLabel = `tahun ${now.year()}`;
        }
    } else if (types.includes('monthly')) {
        // Full calendar months: bulan aktif + bulan depan (jika lookahead)
        const nextMonth = now.add(1, 'month');
        const nextBulan = BULAN_ID[nextMonth.month()];
        if (scopeLookahead) {
            timelineEnd = nextMonth.endOf('month').format('YYYY-MM-DD');
            timelineScopeLabel = `${curBulan} + ${nextBulan} ${nextMonth.year()}`;
        } else {
            timelineEnd = now.endOf('month').format('YYYY-MM-DD');
            timelineScopeLabel = `${curBulan} ${now.year()}`;
        }
    } else if (types.includes('weekly')) {
        if (scopeLookahead) {
            timelineEnd = now.add(1, 'week').endOf('week').format('YYYY-MM-DD');
            timelineScopeLabel = 'minggu ini + minggu depan';
        } else {
            timelineEnd = now.endOf('week').format('YYYY-MM-DD');
            timelineScopeLabel = 'minggu ini';
        }
    } else if (types.includes('daily')) {
        if (scopeLookahead) {
            timelineEnd = now.add(1, 'day').format('YYYY-MM-DD');
            timelineScopeLabel = 'hari ini + besok';
        } else {
            timelineEnd = todayStr;
            timelineScopeLabel = 'hari ini';
        }
    }

    // Collect IDs already shown in alert sections to avoid duplication
    const alertTaskIds = new Set([
        ...overdueTasks, ...upcomingTaskDeadline, ...upcomingTaskStart, ...activeTasks
    ].map(t => t.id));
    const alertKegiatanIds = new Set([
        ...upcomingKegiatan, ...ongoingKegiatan, ...endingKegiatan
    ].map(k => k.id));
    const alertEventIds = new Set([
        ...upcomingEvents, ...ongoingEvents, ...endingEvents
    ].map(e => e.id));

    const timeline = [];

    if (timelineEnd > todayStr) {
        // Parallel fetch all timeline data
        const [[timelineTasks], [timelineKegiatan], [timelineEvents]] = await Promise.all([
            pool.query(
                `SELECT id, task, priority, status, start_date, end_date
                 FROM tasks WHERE user_id = ? AND status NOT IN ('Completed','Cancelled')
                   AND (start_date > ? OR end_date > ?) AND start_date <= ?
                 ORDER BY start_date ASC LIMIT 10`,
                [userId, todayStr, todayStr, timelineEnd]
            ),
            pool.query(
                `SELECT k.id, k.title, k.start_date, k.end_date
                 FROM events k
                 WHERE k.end_date >= ? AND k.start_date <= ?
                 ORDER BY k.start_date ASC LIMIT 15`,
                [todayStr, timelineEnd]
            ),
            pool.query(
                `SELECT id, title, start_date, end_date, category, description
                 FROM events WHERE user_id = ? AND end_date >= ? AND start_date <= ?
                 ORDER BY start_date ASC LIMIT 15`,
                [userId, todayStr, timelineEnd]
            ),
        ]);

        // Collect user's own event IDs to avoid duplicating them as 'kegiatan'
        const userEventTimelineIds = new Set(timelineEvents.map(e => e.id));

        for (const t of timelineTasks) {
            if (alertTaskIds.has(t.id)) continue;
            timeline.push({
                type: 'task',
                title: t.task,
                priority: t.priority,
                tanggal: dayjs(t.start_date).format('DD MMM'),
                deadline: t.end_date ? dayjs(t.end_date).format('DD MMM') : null,
                _sortDate: dayjs(t.start_date).format('YYYY-MM-DD'),
            });
        }

        for (const k of timelineKegiatan) {
            if (alertKegiatanIds.has(k.id)) continue;
            // Skip if this event belongs to the user — it will be shown as 'event' below
            if (userEventTimelineIds.has(k.id)) continue;
            const isSameDay = dayjs(k.start_date).isSame(k.end_date, 'day');
            timeline.push({
                type: 'kegiatan',
                title: k.title,
                tanggal: isSameDay
                    ? dayjs(k.start_date).format('DD MMM')
                    : `${dayjs(k.start_date).format('DD MMM')} - ${dayjs(k.end_date).format('DD MMM')}`,
                _sortDate: dayjs(k.start_date).format('YYYY-MM-DD'),
            });
        }

        for (const e of timelineEvents) {
            if (alertEventIds.has(e.id)) continue;
            const isSameDay = dayjs(e.start_date).isSame(e.end_date, 'day');
            timeline.push({
                type: 'event',
                title: e.title,
                category: e.category || null,
                description: e.description || null,
                tanggal: isSameDay
                    ? dayjs(e.start_date).format('DD MMM')
                    : `${dayjs(e.start_date).format('DD MMM')} - ${dayjs(e.end_date).format('DD MMM')}`,
                _sortDate: dayjs(e.start_date).format('YYYY-MM-DD'),
            });
        }

        // Sort timeline chronologically by start_date
        timeline.sort((a, b) => a._sortDate.localeCompare(b._sortDate));
    }

    // === SUMMARY stats (data already fetched in parallel) ===

    // === SCOPE summary stats (calendar-based, parallelized) ===
    const scopeStats = {};
    const scopeQueries = [];

    if (types.includes('weekly')) {
        const wStart = now.startOf('week').format('YYYY-MM-DD');
        const wEnd = scopeLookahead
            ? now.add(1, 'week').endOf('week').format('YYYY-MM-DD')
            : now.endOf('week').format('YYYY-MM-DD');
        scopeQueries.push(
            Promise.all([
                pool.query(`SELECT COUNT(*) as total, SUM(status='Completed') as selesai FROM tasks WHERE user_id = ? AND ((start_date <= ? AND end_date >= ?) OR (start_date BETWEEN ? AND ?))`, [userId, wEnd, wStart, wStart, wEnd]),
                pool.query(`SELECT COUNT(*) as total FROM events WHERE (start_date <= ? AND end_date >= ?) OR (start_date BETWEEN ? AND ?)`, [wEnd, wStart, wStart, wEnd]),
            ]).then(([[wTasks], [wKegiatan]]) => {
                scopeStats.minggu = {
                    periode: `${dayjs(wStart).format('DD MMM')} - ${dayjs(wEnd).format('DD MMM')}`,
                    label: scopeLookahead ? 'Minggu ini + depan' : 'Minggu ini',
                    task_total: wTasks[0].total,
                    task_selesai: parseInt(wTasks[0].selesai) || 0,
                    kegiatan: wKegiatan[0].total,
                };
            })
        );
    }

    if (types.includes('monthly')) {
        const mStart = now.startOf('month').format('YYYY-MM-DD');
        const nextMonth = now.add(1, 'month');
        const mEnd = scopeLookahead
            ? nextMonth.endOf('month').format('YYYY-MM-DD')
            : now.endOf('month').format('YYYY-MM-DD');
        const nextBulan = BULAN_ID[nextMonth.month()];
        scopeQueries.push(
            Promise.all([
                pool.query(`SELECT COUNT(*) as total, SUM(status='Completed') as selesai FROM tasks WHERE user_id = ? AND ((start_date <= ? AND end_date >= ?) OR (start_date BETWEEN ? AND ?))`, [userId, mEnd, mStart, mStart, mEnd]),
                pool.query(`SELECT COUNT(*) as total FROM events WHERE (start_date <= ? AND end_date >= ?) OR (start_date BETWEEN ? AND ?)`, [mEnd, mStart, mStart, mEnd]),
            ]).then(([[mTasks], [mKegiatan]]) => {
                scopeStats.bulan = {
                    periode: scopeLookahead ? `${curBulan} + ${nextBulan} ${nextMonth.year()}` : `${curBulan} ${now.year()}`,
                    label: scopeLookahead ? `${curBulan} + ${nextBulan}` : curBulan,
                    task_total: mTasks[0].total,
                    task_selesai: parseInt(mTasks[0].selesai) || 0,
                    kegiatan: mKegiatan[0].total,
                };
            })
        );
    }

    if (types.includes('yearly')) {
        const yStart = now.startOf('year').format('YYYY-MM-DD');
        const yEnd = scopeLookahead
            ? now.add(1, 'year').endOf('year').format('YYYY-MM-DD')
            : now.endOf('year').format('YYYY-MM-DD');
        scopeQueries.push(
            Promise.all([
                pool.query(`SELECT COUNT(*) as total, SUM(status='Completed') as selesai FROM tasks WHERE user_id = ? AND ((start_date <= ? AND end_date >= ?) OR (start_date BETWEEN ? AND ?))`, [userId, yEnd, yStart, yStart, yEnd]),
                pool.query(`SELECT COUNT(*) as total FROM events WHERE (start_date <= ? AND end_date >= ?) OR (start_date BETWEEN ? AND ?)`, [yEnd, yStart, yStart, yEnd]),
            ]).then(([[yTasks], [yKegiatan]]) => {
                scopeStats.tahun = {
                    periode: scopeLookahead ? `${now.year()} - ${now.year() + 1}` : `${now.year()}`,
                    label: scopeLookahead ? 'Tahun ini + depan' : 'Tahun ini',
                    task_total: yTasks[0].total,
                    task_selesai: parseInt(yTasks[0].selesai) || 0,
                    kegiatan: yKegiatan[0].total,
                };
            })
        );
    }

    if (scopeQueries.length > 0) await Promise.all(scopeQueries);

    const isEmpty = overdueTasks.length === 0
        && upcomingTaskStart.length === 0
        && upcomingTaskDeadline.length === 0
        && upcomingKegiatan.length === 0
        && ongoingKegiatan.length === 0
        && endingKegiatan.length === 0
        && upcomingEvents.length === 0
        && ongoingEvents.length === 0
        && endingEvents.length === 0
        && pendingTodos.length === 0
        && customReminders.length === 0
        && activeTasks.length === 0
        && timeline.length === 0;

    return {
        overdueTasks,
        upcomingTaskStart,
        upcomingTaskDeadline,
        activeTasks,
        upcomingKegiatan,
        ongoingKegiatan,
        endingKegiatan,
        upcomingEvents,
        ongoingEvents,
        endingEvents,
        pendingTodos,
        customReminders,
        timeline,
        timelineScope: timelineScopeLabel,
        scopeStats,
        stats: {
            totalActive: totalTasksRow[0].total,
            completedToday: completedTodayRow[0].total,
            overdueCount: overdueTasks.length,
        },
        isEmpty,
    };
}

/**
 * Send context to LLM and get formatted WA message
 */
async function generateDigestViaLLM(username, todayStr, now, ctx) {
    const hari = HARI_ID[now.day()];
    const tanggal = `${now.date()} ${BULAN_ID[now.month()]} ${now.year()}`;

    // Build structured data for LLM
    const data = {};

    if (ctx.overdueTasks.length > 0) {
        data.task_overdue = ctx.overdueTasks.map(t => ({
            task: t.task,
            priority: t.priority,
            status: t.status,
            deadline: dayjs(t.end_date).format('DD MMM YYYY'),
            overdue_hari: t.daysOverdue,
        }));
    }

    if (ctx.upcomingTaskDeadline.length > 0) {
        data.task_deadline = ctx.upcomingTaskDeadline.map(t => ({
            task: t.task,
            priority: t.priority,
            label: t.label,
            deadline: dayjs(t.end_date).format('DD MMM YYYY'),
        }));
    }

    if (ctx.upcomingTaskStart.length > 0) {
        data.task_mulai = ctx.upcomingTaskStart.map(t => ({
            task: t.task,
            priority: t.priority,
            label: t.label,
            start: dayjs(t.start_date).format('DD MMM YYYY'),
        }));
    }

    if (ctx.upcomingKegiatan.length > 0) {
        data.kegiatan_mendatang = ctx.upcomingKegiatan.map(k => ({
            title: k.title,
            label: k.label,
            periode: `${dayjs(k.start_date).format('DD MMM')} - ${dayjs(k.end_date).format('DD MMM YYYY')}`,
        }));
    }

    if (ctx.ongoingKegiatan.length > 0) {
        data.kegiatan_berjalan = ctx.ongoingKegiatan.map(k => ({
            title: k.title,
            periode: `${dayjs(k.start_date).format('DD MMM')} - ${dayjs(k.end_date).format('DD MMM YYYY')}`,
        }));
    }

    if (ctx.endingKegiatan.length > 0) {
        data.kegiatan_berakhir = ctx.endingKegiatan.map(k => ({
            title: k.title,
            label: k.endLabel,
        }));
    }

    if (ctx.upcomingEvents.length > 0) {
        data.event_mendatang = ctx.upcomingEvents.map(e => ({
            title: e.title,
            label: e.label,
            tanggal: dayjs(e.start_date).format('DD MMM YYYY'),
        }));
    }

    if (ctx.ongoingEvents.length > 0) {
        data.event_berjalan = ctx.ongoingEvents.map(e => ({
            title: e.title,
            periode: `${dayjs(e.start_date).format('DD MMM')} - ${dayjs(e.end_date).format('DD MMM YYYY')}`,
        }));
    }

    if (ctx.endingEvents.length > 0) {
        data.event_berakhir = ctx.endingEvents.map(e => ({
            title: e.title,
            label: e.endLabel,
        }));
    }

    if (ctx.pendingTodos.length > 0) {
        data.todos_pending = ctx.pendingTodos.map(t => ({
            title: t.title.replace(/^\[Task #\d+\]\s*/, ''),
            priority: t.priority,
            due: t.due_date ? dayjs(t.due_date).format('DD MMM') : null,
        }));
    }

    if (ctx.customReminders.length > 0) {
        data.pengingat_custom = ctx.customReminders.map(r => ({
            title: r.title,
            deskripsi: r.description,
            jam: dayjs(r.reminder_datetime).format('HH:mm'),
        }));
    }

    if (ctx.activeTasks.length > 0) {
        data.task_aktif_lain = ctx.activeTasks.map(t => ({
            task: t.task,
            priority: t.priority,
            status: t.status,
            deadline: t.end_date ? dayjs(t.end_date).format('DD MMM') : null,
        }));
    }

    if (ctx.timeline.length > 0) {
        data.timeline_mendatang = {
            scope: ctx.timelineScope,
            items: ctx.timeline.map(({ _sortDate, ...item }) => ({
                jenis: item.type,
                judul: item.title,
                tanggal: item.tanggal,
                ...(item.priority ? { priority: item.priority } : {}),
                ...(item.deadline ? { deadline: item.deadline } : {}),
            })),
        };
    }

    data.ringkasan = ctx.stats;

    if (Object.keys(ctx.scopeStats).length > 0) {
        data.ringkasan_scope = ctx.scopeStats;
    }

    const systemPrompt = `Kamu adalah asisten notifikasi WhatsApp "Agenda Work" untuk pegawai BPS.
Tugasmu: format data JSON menjadi SATU pesan WhatsApp ringkas.

ATURAN KETAT:
- HANYA tampilkan data yang ada di JSON. DILARANG menambah, mengarang, atau memindahkan item antar kategori.
- Setiap key di JSON adalah kategori terpisah (task_overdue, task_deadline, task_mulai, kegiatan_mendatang, kegiatan_berjalan, kegiatan_berakhir, event_mendatang, todos_pending, dll). JANGAN campurkan.
- Jika suatu key tidak ada di JSON, JANGAN buat section-nya.
- Task dan kegiatan adalah entitas BERBEDA. Task = tugas pribadi user. Kegiatan = kegiatan kantor bersama.

Format output:
- Format WhatsApp: *bold*, _italic_ (BUKAN markdown #heading)
- Bahasa Indonesia semi-formal, ramah
- Header: baris pertama "*AGENDA WORK*" (bold), baris kedua "_Hari, Tanggal_" (italic), lalu divider "━━━━━━━━━━━━━━━━━━" — TIDAK ada divider di awal, langsung teks
- Sapaan nama user setelah divider header
- Urutan section: overdue > deadline > mulai > kegiatan > event > todo > pengingat > timeline_mendatang > ringkasan_scope > ringkasan
- Untuk timeline_mendatang: tampilkan sebagai daftar kronologis singkat dengan tanggal, kelompokkan per tanggal jika perlu
- Untuk ringkasan_scope (minggu_ini/bulan_ini): tampilkan sebagai progress bar singkat (misal: "7/9 task selesai, 3 kegiatan")
- Untuk overdue, tekankan jumlah hari terlambat
- Akhiri dengan kalimat motivasi singkat (1 kalimat)
- Maksimal 1500 karakter
- Output teks WA saja, bukan JSON`;

    const userPrompt = `Nama user: ${username}
Hari: ${hari}, ${tanggal}

Data agenda:
${JSON.stringify(data, null, 2)}`;

    try {
        const response = await axios.post(`${LLM_PROXY_URL}/v1/chat/completions`, {
            model: LLM_MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            max_tokens: 2048,
            temperature: 0.4,
        }, { timeout: 30000 });

        const content = response.data?.choices?.[0]?.message?.content;
        if (!content) {
            console.error('[Digest] LLM returned no content');
            return buildFallbackMessage(username, hari, tanggal, ctx);
        }

        return content.trim();
    } catch (err) {
        // #27: a bare err.message hides the root cause. Log the LLM proxy URL,
        // the model name, and the response body so operators can see at a glance
        // whether this is a bad env var (wrong model name → 404), a DNS issue,
        // or a proxy-side bug.
        const status = err.response?.status;
        const bodySnippet = JSON.stringify(err.response?.data || {}).slice(0, 500);
        console.error(`[Digest] LLM call failed: ${err.message} [url=${LLM_PROXY_URL} model=${LLM_MODEL} status=${status} body=${bodySnippet}]`);
        return buildFallbackMessage(username, hari, tanggal, ctx);
    }
}

/**
 * Fallback: static format if LLM is unavailable
 */
function buildFallbackMessage(username, hari, tanggal, ctx) {
    const lines = [];
    lines.push('*AGENDA WORK*');
    lines.push(`_${hari}, ${tanggal}_`);
    lines.push('━━━━━━━━━━━━━━━━━━');
    lines.push('');
    lines.push(`Halo *${username}*!`);
    lines.push('');

    if (ctx.overdueTasks.length > 0) {
        lines.push('*OVERDUE:*');
        ctx.overdueTasks.forEach(t => {
            lines.push(`  - [${t.priority}] ${t.task} (${t.daysOverdue} hari terlambat)`);
        });
        lines.push('');
    }

    if (ctx.upcomingTaskDeadline.length > 0) {
        lines.push('*DEADLINE:*');
        ctx.upcomingTaskDeadline.forEach(t => {
            lines.push(`  - [${t.priority}] ${t.task} (${t.label})`);
        });
        lines.push('');
    }

    if (ctx.upcomingTaskStart.length > 0) {
        lines.push('*TASK DIMULAI:*');
        ctx.upcomingTaskStart.forEach(t => {
            lines.push(`  - [${t.priority}] ${t.task} (${t.label})`);
        });
        lines.push('');
    }

    // Merge kegiatan + events, deduplicate by id (both from same events table)
    const seenAgendaIds = new Set();
    const allAgenda = [];
    const addAgenda = (item, labelOverride) => {
        if (seenAgendaIds.has(item.id)) return;
        seenAgendaIds.add(item.id);
        const start = item.start_date ? dayjs(item.start_date).format('DD MMM') : null;
        const end = item.end_date ? dayjs(item.end_date).format('DD MMM') : null;
        const rentang = start && end && start !== end ? `${start} - ${end}` : (start || '');
        allAgenda.push({ ...item, label: labelOverride || item.label, rentang });
    };
    [...ctx.upcomingKegiatan, ...ctx.ongoingKegiatan.map(k => ({ ...k, label: 'Sedang berjalan' })), ...ctx.endingKegiatan.map(k => ({ ...k, label: k.endLabel }))].forEach(k => addAgenda(k));
    [...ctx.upcomingEvents, ...ctx.ongoingEvents.map(e => ({ ...e, label: 'Berlangsung' }))].forEach(e => addAgenda(e));

    if (allAgenda.length > 0) {
        lines.push('*KEGIATAN & EVENT:*');
        allAgenda.forEach(item => {
            const rentangStr = item.rentang ? ` (${item.rentang})` : '';
            const categoryTag = item.category ? ` [${item.category}]` : '';
            lines.push(`  - ${item.title}${categoryTag}${rentangStr} — ${item.label}`);
        });
        lines.push('');
    }

    if (ctx.customReminders.length > 0) {
        lines.push('*PENGINGAT:*');
        ctx.customReminders.forEach(r => {
            lines.push(`  - ${r.title}`);
        });
        lines.push('');
    }

    if (ctx.pendingTodos.length > 0) {
        lines.push(`*TODO:* ${ctx.pendingTodos.length} item belum selesai`);
        lines.push('');
    }

    if (ctx.timeline.length > 0) {
        lines.push(`*MENDATANG (${ctx.timelineScope}):*`);
        // Group by tanggal (date range string), preserve chronological order
        const timelineGroups = new Map();
        ctx.timeline.forEach(item => {
            if (!timelineGroups.has(item.tanggal)) timelineGroups.set(item.tanggal, []);
            timelineGroups.get(item.tanggal).push(item);
        });
        // Helper: only show description if it adds info beyond the title
        const usefulDesc = (title, description) => {
            if (!description) return null;
            const t = title.trim().toLowerCase();
            const d = description.trim().toLowerCase();
            if (d === t || t.includes(d) || d.includes(t)) return null;
            return description.length > 70 ? description.substring(0, 70) + '...' : description;
        };

        timelineGroups.forEach((items, tanggal) => {
            const icon = items.some(i => i.type === 'event') ? '📅' : items.some(i => i.type === 'kegiatan') ? '📋' : '📌';
            if (items.length === 1) {
                const item = items[0];
                const categoryTag = item.category ? ` [${item.category}]` : '';
                lines.push(`  ${icon} *${tanggal}* — ${item.title}${categoryTag}`);
                const desc = usefulDesc(item.title, item.description);
                if (desc) lines.push(`     _${desc}_`);
            } else {
                lines.push(`  ${icon} *${tanggal}*`);
                items.forEach(item => {
                    const categoryTag = item.category ? ` [${item.category}]` : '';
                    lines.push(`     • ${item.title}${categoryTag}`);
                    const desc = usefulDesc(item.title, item.description);
                    if (desc) lines.push(`       _${desc}_`);
                });
            }
        });
        lines.push('');
    }

    lines.push('━━━━━━━━━━━━━━━━━━');
    lines.push(`Total: ${ctx.stats.totalActive} task aktif | ${ctx.stats.overdueCount} overdue`);
    lines.push('Semangat! 💪');

    return lines.join('\n');
}

/**
 * Process recurring custom reminders — advance to next date after sent
 * Called periodically by daemon
 */
async function processRecurringReminders() {
    try {
        const [reminders] = await pool.query(`
            SELECT id, reminder_datetime, repeat_type
            FROM reminders
            WHERE is_sent = 1 AND repeat_type != 'None'
              AND is_active = 1 AND is_completed = 0
              AND title NOT LIKE '[Task #%' AND title NOT LIKE '[Event #%' AND title NOT LIKE '[Kegiatan #%'
        `);

        for (const r of reminders) {
            const current = new Date(r.reminder_datetime);
            let next;

            switch (r.repeat_type) {
                case 'Daily': next = new Date(current); next.setDate(next.getDate() + 1); break;
                case 'Weekly': next = new Date(current); next.setDate(next.getDate() + 7); break;
                case 'Monthly': next = new Date(current); next.setMonth(next.getMonth() + 1); break;
                case 'Yearly': next = new Date(current); next.setFullYear(next.getFullYear() + 1); break;
                default: continue;
            }

            const nextStr = next.toISOString().slice(0, 19).replace('T', ' ');
            await pool.query('UPDATE reminders SET reminder_datetime = ?, is_sent = 0, updated_at = NOW() WHERE id = ?', [nextStr, r.id]);
            console.log(`[Digest] Recurring reminder #${r.id} rescheduled to ${nextStr}`);
        }
    } catch (error) {
        console.error('[Digest] Recurring reminder error:', error.message);
    }
}

module.exports = { checkAndSendNotifications, processRecurringReminders, sendUnifiedDigest };
