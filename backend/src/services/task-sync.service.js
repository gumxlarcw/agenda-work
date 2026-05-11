/**
 * Task Sync Service
 * - Syncs incomplete tasks to todos
 * - Generates reminder records from tasks & events based on user notification settings
 * - Duration-aware: different reminder strategies for 1-day, multi-day, and long-running items
 * - Reminders are visual checklist items, auto-completed after digest is sent
 * - Overdue tasks re-generate reminders daily until completed
 */

const pool = require('../config/database');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const isoWeek = require('dayjs/plugin/isoWeek');
dayjs.extend(utc);
dayjs.extend(isoWeek);

const LEVEL_DAYS = { 'H-7': 7, 'H-3': 3, 'H-1': 1, 'Hari-H': 0 };
const WEEKLY_CHECKPOINT_THRESHOLD = 7; // days — items longer than this get weekly checkpoints

class TaskSyncService {

    // ─── TASK → TODO SYNC (unchanged) ──────────────────────────

    async syncAllTasks() {
        try {
            console.log(`[TaskSync] Starting task sync...`);
            const [tasks] = await pool.query(`
                SELECT t.*, u.username, u.phone_number
                FROM tasks t JOIN users u ON t.user_id = u.id
                WHERE t.status NOT IN ('Completed', 'Cancelled')
            `);
            for (const task of tasks) await this.syncTaskToTodo(task);
            await this.syncCompletedTasks();
            await this.cleanupOrphanTodos();
            console.log(`[TaskSync] Synced ${tasks.length} incomplete tasks`);
            return { success: true, synced: tasks.length };
        } catch (error) {
            console.error('[TaskSync] Error:', error.message);
            return { success: false, error: error.message };
        }
    }

    async syncTaskToTodo(task) {
        // #19: Serialize check-and-insert per (user, task) via GET_LOCK held on ONE
        // pinned connection. Without this, two concurrent sync callers (daemon loop
        // + webhook) can both pass the NOT EXISTS check and insert duplicate todos.
        // GET_LOCK is session-scoped, so we MUST use the same connection for the lock,
        // the INSERT, and the release.
        const lockName = `tasksync:${task.user_id}:${task.id}`;
        let conn;
        try {
            conn = await pool.getConnection();
            const [[lockRow]] = await conn.query('SELECT GET_LOCK(?, 5) AS got', [lockName]);
            if (!lockRow || lockRow.got !== 1) {
                console.warn(`[TaskSync] Could not acquire lock ${lockName}, skipping`);
                return;
            }
            try {
                const todoTitle = `[Task #${task.id}] ${task.task}`;
                const priority = this.mapTaskPriorityToTodo(task.priority);
                await conn.query(
                    `INSERT INTO todos (user_id, title, priority, due_date, is_completed)
                     SELECT ?, ?, ?, ?, FALSE FROM DUAL
                     WHERE NOT EXISTS (
                         SELECT 1 FROM todos WHERE user_id = ? AND title LIKE ? AND is_completed = FALSE
                     )`,
                    [task.user_id, todoTitle, priority, task.end_date || null, task.user_id, `[Task #${task.id}]%`]
                );
            } finally {
                await conn.query('SELECT RELEASE_LOCK(?)', [lockName]);
            }
        } catch (error) {
            console.error(`[TaskSync] Todo sync error task #${task.id}:`, error.message);
        } finally {
            if (conn) conn.release();
        }
    }

    async syncCompletedTasks() {
        try {
            const [completedTasks] = await pool.query(`
                SELECT id, user_id FROM tasks
                WHERE status = 'Completed' AND updated_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
            `);
            for (const task of completedTasks) {
                await pool.query(
                    'UPDATE todos SET is_completed = TRUE WHERE user_id = ? AND title LIKE ? AND is_completed = FALSE',
                    [task.user_id, `[Task #${task.id}]%`]
                );
                await pool.query(
                    `UPDATE reminders SET is_completed = TRUE WHERE source_type = 'task' AND source_id = ? AND is_completed = FALSE`,
                    [task.id]
                );
            }
        } catch (error) {
            console.error('[TaskSync] Completed sync error:', error.message);
        }
    }

    mapTaskPriorityToTodo(p) {
        return (p === 'P0' || p === 'P1') ? 'High' : p === 'P2' ? 'Medium' : 'Low';
    }

    async cleanupOrphanTodos() {
        try {
            await pool.query(`
                UPDATE todos t SET t.is_completed = 1
                WHERE t.title REGEXP '^\\\\[Task #[0-9]+\\\\]' AND t.is_completed = 0
                  AND NOT EXISTS (
                      SELECT 1 FROM tasks tk
                      WHERE tk.id = CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(t.title, '#', -1), ']', 1) AS UNSIGNED)
                        AND tk.status NOT IN ('Completed', 'Cancelled')
                  )
            `);
            await pool.query(`
                UPDATE reminders SET is_completed = 1
                WHERE source_type = 'task' AND is_completed = 0
                  AND NOT EXISTS (SELECT 1 FROM tasks WHERE id = reminders.source_id AND status NOT IN ('Completed', 'Cancelled'))
            `);
            await pool.query(`
                UPDATE reminders SET is_completed = 1
                WHERE source_type = 'event' AND is_completed = 0
                  AND NOT EXISTS (SELECT 1 FROM events WHERE id = reminders.source_id AND end_date >= CURDATE())
            `);
        } catch (error) {
            console.error('[TaskSync] Orphan cleanup error:', error.message);
        }
    }

    async syncNewTask(taskId) {
        try {
            const [tasks] = await pool.query(
                'SELECT t.*, u.username FROM tasks t JOIN users u ON t.user_id = u.id WHERE t.id = ?', [taskId]
            );
            if (tasks.length > 0 && !['Completed', 'Cancelled'].includes(tasks[0].status)) {
                await this.syncTaskToTodo(tasks[0]);
                await this.syncTaskReminders(taskId);
            }
        } catch (error) {
            console.error(`[TaskSync] syncNewTask #${taskId}:`, error.message);
        }
    }

    async handleTaskCompleted(taskId) {
        try {
            const [tasks] = await pool.query('SELECT user_id FROM tasks WHERE id = ?', [taskId]);
            if (tasks.length > 0) {
                await pool.query('UPDATE todos SET is_completed = TRUE WHERE user_id = ? AND title LIKE ?',
                    [tasks[0].user_id, `[Task #${taskId}]%`]);
                await pool.query(`UPDATE reminders SET is_completed = TRUE WHERE source_type = 'task' AND source_id = ? AND is_completed = FALSE`, [taskId]);
            }
        } catch (error) {
            console.error(`[TaskSync] handleTaskCompleted #${taskId}:`, error.message);
        }
    }

    // ─── DURATION-AWARE REMINDER GENERATION ──────────────────────────

    /**
     * Core: build reminder list for a date-range item, duration-aware.
     *
     * Logic:
     *   1-day item:
     *     - H-3, H-2, H-1 before start (per user levels)
     *     - Hari-H on start_date
     *
     *   Multi-day (2-7 days):
     *     - H-3, H-2, H-1 before start (per levels)
     *     - "Dimulai hari ini" on start_date
     *     - "Hari terakhir" on end_date (if Berakhir enabled)
     *     - NO mid-range reminders (too short)
     *
     *   Long-running (>7 days):
     *     - H-3, H-2, H-1 before start (per levels)
     *     - "Dimulai hari ini" on start_date
     *     - "Sedang berjalan - minggu ke-N" every Monday within range
     *     - "Berakhir besok" on end_date - 1 (if Berakhir enabled)
     *     - "Hari terakhir" on end_date (if Berakhir enabled)
     *
     *   Currently ongoing (start < today <= end):
     *     - "Sedang berjalan (hari ke-X dari Y)" for TODAY
     *     - Future weekly checkpoints still apply
     *     - Future "Berakhir" still applies
     *
     * @param {object} opts
     * @param {string} opts.prefix       - e.g. "[Task #24]" or "[Kegiatan #8]"
     * @param {string} opts.name         - item title
     * @param {string} opts.description  - description text
     * @param {dayjs}  opts.startDate
     * @param {dayjs}  opts.endDate
     * @param {number} opts.userId
     * @param {string} opts.sourceType   - 'task' | 'kegiatan' | 'event'
     * @param {number} opts.sourceId
     * @param {array}  opts.levels       - ['H-3','H-1','Hari-H','Berakhir']
     * @param {string} opts.notifTime    - 'HH:mm:ss'
     * @param {dayjs}  opts.now          - today (start of day, WIT)
     * @returns {array} reminder objects ready to insert
     */
    /**
     * Duration-aware reminder builder.
     *
     * Single-day items use levels: H-7, H-3, H-1, Hari-H, Overdue
     * Multi-day items use levels:  Dimulai, Sedang-Berlangsung, Berakhir
     */
    _buildReminders(opts) {
        const { prefix, name, description, startDate, endDate, userId, sourceType, sourceId, levels, notifTime, now } = opts;
        const reminders = [];
        const duration = endDate.diff(startDate, 'day') + 1; // inclusive
        const isSingleDay = duration <= 1;
        const isLong = duration > WEEKLY_CHECKPOINT_THRESHOLD;

        const addReminder = (date, label, desc) => {
            if (date.isBefore(now)) return; // skip past dates
            reminders.push({
                user_id: userId,
                title: `${prefix} ${label}: ${name}`,
                description: desc || description,
                datetime: `${date.format('YYYY-MM-DD')} ${notifTime}`,
                source_type: sourceType,
                source_id: sourceId,
            });
        };

        if (isSingleDay) {
            // ─── SINGLE DATE MODE ─────────────────────────
            // Pre-date countdown: H-7, H-3, H-1
            for (const level of levels) {
                if (LEVEL_DAYS[level] === undefined || level === 'Hari-H') continue;
                const reminderDate = startDate.subtract(LEVEL_DAYS[level], 'day');
                addReminder(reminderDate, level, description);
            }
            // On the day itself
            if (levels.includes('Hari-H')) {
                addReminder(startDate, 'Hari ini', description);
            }
        } else {
            // ─── DATE RANGE MODE ──────────────────────────
            // Start date
            if (levels.includes('Dimulai')) {
                addReminder(startDate, 'Dimulai hari ini',
                    `${startDate.format('DD MMM')} - ${endDate.format('DD MMM YYYY')} (${duration} hari)`);
            }

            // Ongoing / currently running
            if (levels.includes('Sedang-Berlangsung')) {
                if (startDate.isBefore(now) && (endDate.isAfter(now) || endDate.isSame(now, 'day'))) {
                    const dayNum = now.diff(startDate, 'day') + 1;
                    addReminder(now, `Sedang berjalan (hari ke-${dayNum} dari ${duration})`,
                        `${startDate.format('DD MMM')} - ${endDate.format('DD MMM YYYY')}`);
                }
                // Weekly checkpoints for long items
                if (isLong) {
                    let checkpoint = startDate.add(1, 'day');
                    while (checkpoint.day() !== 1) checkpoint = checkpoint.add(1, 'day');
                    let weekNum = 1;
                    while (checkpoint.isBefore(endDate)) {
                        weekNum++;
                        if (!checkpoint.isSame(startDate, 'day')) {
                            addReminder(checkpoint, `Sedang berjalan - minggu ke-${weekNum}`,
                                `${startDate.format('DD MMM')} - ${endDate.format('DD MMM YYYY')}`);
                        }
                        checkpoint = checkpoint.add(7, 'day');
                    }
                }
            }

            // End date
            if (levels.includes('Berakhir')) {
                const h1End = endDate.subtract(1, 'day');
                if (!h1End.isSame(startDate, 'day')) {
                    addReminder(h1End, 'Berakhir besok', `Hari terakhir: ${endDate.format('DD MMM YYYY')}`);
                }
                addReminder(endDate, 'Hari terakhir', 'Berakhir hari ini');
            }
        }

        return reminders;
    }

    /**
     * Insert reminders with dedup (same source + same date + not completed = skip)
     */
    async _insertReminders(reminders, sourceType, sourceId) {
        for (const r of reminders) {
            await pool.query(
                `INSERT INTO reminders (user_id, source_type, source_id, title, description, reminder_datetime, repeat_type, is_active, is_completed, is_sent)
                 SELECT ?, ?, ?, ?, ?, ?, 'None', 1, 0, 0 FROM DUAL
                 WHERE NOT EXISTS (
                     SELECT 1 FROM reminders
                     WHERE source_type = ? AND source_id = ? AND user_id = ?
                       AND DATE(reminder_datetime) = DATE(?) AND is_completed = 0
                 )`,
                [r.user_id, r.source_type, r.source_id, r.title, r.description, r.datetime,
                 r.source_type, r.source_id, r.user_id, r.datetime]
            );
        }
    }

    // ─── TASK REMINDERS ──────────────────────────

    async syncTaskReminders(taskId) {
        try {
            const [tasks] = await pool.query(
                'SELECT id, user_id, task, start_date, end_date, priority FROM tasks WHERE id = ?', [taskId]
            );
            if (!tasks.length) return;
            const task = tasks[0];
            if (!task.start_date && !task.end_date) return;

            const settings = await this._getUserSettings(task.user_id);
            if (!settings) return;

            // Delete old unsent reminders
            await pool.query(
                `DELETE FROM reminders WHERE source_type = 'task' AND source_id = ? AND is_sent = 0 AND is_completed = 0`, [taskId]
            );

            const now = dayjs().utcOffset(9).startOf('day');
            const levels = this._parseLevels(settings.reminder_levels);
            const notifTime = settings.notification_time || '07:00:00';
            const startDate = dayjs(task.start_date || task.end_date);
            const endDate = dayjs(task.end_date || task.start_date);

            const reminders = this._buildReminders({
                prefix: `[Task #${task.id}]`,
                name: task.task,
                description: `Priority: ${task.priority} | ${startDate.format('DD MMM')} - ${endDate.format('DD MMM YYYY')}`,
                startDate, endDate,
                userId: task.user_id,
                sourceType: 'task',
                sourceId: task.id,
                levels, notifTime, now,
            });

            // Overdue: deadline passed, task not done (only if Overdue level enabled)
            if (levels.includes('Overdue') && endDate.isBefore(now)) {
                const daysOverdue = now.diff(endDate, 'day');
                reminders.push({
                    user_id: task.user_id,
                    title: `[Task #${task.id}] Overdue (${daysOverdue} hari): ${task.task}`,
                    description: `Priority: ${task.priority} | Deadline: ${endDate.format('DD MMM YYYY')}`,
                    datetime: `${now.format('YYYY-MM-DD')} ${notifTime}`,
                    source_type: 'task',
                    source_id: task.id,
                });
            }

            await this._insertReminders(reminders, 'task', taskId);

            if (reminders.length > 0) {
                console.log(`[TaskSync] Generated ${reminders.length} reminders for task #${taskId}`);
            }
        } catch (error) {
            console.error(`[TaskSync] syncTaskReminders #${taskId}:`, error.message);
        }
    }

    // ─── EVENT REMINDERS (team-scoped) ──────────────────────────

    async syncEventReminders(eventId) {
        try {
            const [rows] = await pool.query(
                'SELECT e.id, e.title, e.start_date, e.end_date, e.user_id, u.tim as creator_tim FROM events e JOIN users u ON e.user_id = u.id WHERE e.id = ?', [eventId]
            );
            if (!rows.length) return;
            const ev = rows[0];

            const now = dayjs().utcOffset(9).startOf('day');
            const endDate = dayjs(ev.end_date);
            if (endDate.isBefore(now)) return;

            // Delete old unsent
            await pool.query(
                `DELETE FROM reminders WHERE source_type = 'event' AND source_id = ? AND is_sent = 0 AND is_completed = 0`, [eventId]
            );

            // Team-scoped: only notify users in the same team
            // Solo-ist creators → only the creator gets reminders
            let settingsQuery, settingsParams;
            if (ev.creator_tim === 'Solo-ist') {
                settingsQuery = `SELECT uns.* FROM user_notification_settings uns WHERE uns.user_id = ? AND uns.is_active = 1`;
                settingsParams = [ev.user_id];
            } else {
                settingsQuery = `SELECT uns.* FROM user_notification_settings uns
                 JOIN users u ON uns.user_id = u.id WHERE uns.is_active = 1 AND u.tim = ?`;
                settingsParams = [ev.creator_tim];
            }
            const [allSettings] = await pool.query(settingsQuery, settingsParams);

            const startDate = dayjs(ev.start_date);

            for (const settings of allSettings) {
                const levels = this._parseLevels(settings.reminder_levels);
                const notifTime = settings.notification_time || '07:00:00';

                const reminders = this._buildReminders({
                    prefix: `[Event #${ev.id}]`,
                    name: ev.title,
                    description: `${startDate.format('DD MMM')} - ${endDate.format('DD MMM YYYY')}`,
                    startDate, endDate,
                    userId: settings.user_id,
                    sourceType: 'event',
                    sourceId: ev.id,
                    levels, notifTime, now,
                });

                await this._insertReminders(reminders, 'event', eventId);
            }

            console.log(`[TaskSync] Generated event reminders for #${eventId}`);
        } catch (error) {
            console.error(`[TaskSync] syncEventReminders #${eventId}:`, error.message);
        }
    }

    // ─── DELETE HELPERS ──────────────────────────

    async deleteTaskReminders(taskId) {
        await pool.query(`DELETE FROM reminders WHERE source_type = 'task' AND source_id = ? AND is_sent = 0 AND is_completed = 0`, [taskId]);
    }
    async deleteEventReminders(eventId) {
        await pool.query(`DELETE FROM reminders WHERE source_type = 'event' AND source_id = ? AND is_sent = 0 AND is_completed = 0`, [eventId]);
    }

    // ─── RESYNC ALL (when user changes settings) ──────────────────────────

    async resyncAllRemindersForUser(userId) {
        try {
            await pool.query(
                `DELETE FROM reminders WHERE user_id = ? AND source_type != 'custom' AND is_sent = 0 AND is_completed = 0`, [userId]
            );

            const [tasks] = await pool.query(
                `SELECT id FROM tasks WHERE user_id = ? AND status NOT IN ('Completed', 'Cancelled')`, [userId]
            );
            for (const t of tasks) await this.syncTaskReminders(t.id);

            const [events] = await pool.query(
                `SELECT id FROM events WHERE end_date >= CURDATE()`
            );
            for (const e of events) await this.syncEventReminders(e.id);

            console.log(`[TaskSync] Re-synced all reminders for user #${userId}`);
        } catch (error) {
            console.error(`[TaskSync] resyncAllRemindersForUser #${userId}:`, error.message);
        }
    }

    // ─── DAILY OVERDUE ──────────────────────────

    async generateOverdueReminders() {
        try {
            const now = dayjs().utcOffset(9).startOf('day');
            const todayStr = now.format('YYYY-MM-DD');

            const [overdueTasks] = await pool.query(`
                SELECT t.id, t.user_id, t.task, t.priority, t.end_date
                FROM tasks t
                JOIN user_notification_settings uns ON t.user_id = uns.user_id AND uns.is_active = 1
                WHERE t.status NOT IN ('Completed', 'Cancelled') AND t.end_date < CURDATE()
            `);

            for (const task of overdueTasks) {
                const settings = await this._getUserSettings(task.user_id);
                if (!settings) continue;
                const levels = this._parseLevels(settings.reminder_levels);
                if (!levels.includes('Overdue')) continue; // skip if user disabled Overdue level
                const notifTime = settings.notification_time || '07:00:00';
                const daysOverdue = now.diff(dayjs(task.end_date), 'day');

                // #32: serialize per-task overdue check+insert via GET_LOCK on a
                // pinned connection. Two concurrent daemon ticks could otherwise
                // both pass the NOT EXISTS and insert duplicate overdue reminders.
                const lockName = `overdue:${task.user_id}:${task.id}:${todayStr}`;
                let conn;
                try {
                    conn = await pool.getConnection();
                    const [[lockRow]] = await conn.query('SELECT GET_LOCK(?, 5) AS got', [lockName]);
                    if (!lockRow || lockRow.got !== 1) continue;
                    try {
                        await conn.query(
                            `INSERT INTO reminders (user_id, source_type, source_id, title, description, reminder_datetime, repeat_type, is_active, is_completed, is_sent)
                             SELECT ?, 'task', ?, ?, ?, ?, 'None', 1, 0, 0 FROM DUAL
                             WHERE NOT EXISTS (
                                 SELECT 1 FROM reminders
                                 WHERE source_type = 'task' AND source_id = ? AND user_id = ?
                                   AND DATE(reminder_datetime) = ? AND is_completed = 0
                             )`,
                            [task.user_id, task.id,
                             `[Task #${task.id}] Overdue (${daysOverdue} hari): ${task.task}`,
                             `Priority: ${task.priority} | Deadline: ${dayjs(task.end_date).format('DD MMM YYYY')}`,
                             `${todayStr} ${notifTime}`,
                             task.id, task.user_id, todayStr]
                        );
                    } finally {
                        await conn.query('SELECT RELEASE_LOCK(?)', [lockName]);
                    }
                } finally {
                    if (conn) conn.release();
                }
            }

            if (overdueTasks.length > 0) {
                console.log(`[TaskSync] Generated overdue reminders for ${overdueTasks.length} tasks`);
            }
        } catch (error) {
            console.error('[TaskSync] generateOverdueReminders:', error.message);
        }
    }

    // ─── HELPERS ──────────────────────────

    async _getUserSettings(userId) {
        const [rows] = await pool.query(
            'SELECT * FROM user_notification_settings WHERE user_id = ? AND is_active = 1', [userId]
        );
        return rows.length ? rows[0] : null;
    }

    _parseLevels(levels) {
        if (!levels) return ['H-1', 'Hari-H'];
        if (typeof levels === 'string') {
            try { return JSON.parse(levels); } catch { return ['H-1', 'Hari-H']; }
        }
        return Array.isArray(levels) ? levels : ['H-1', 'Hari-H'];
    }
}

module.exports = new TaskSyncService();
