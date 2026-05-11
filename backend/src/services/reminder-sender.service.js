/**
 * Reminder Sender Service
 * Sends due reminders via WhatsApp through OpenClaw
 * Groups reminders by user and type, sends summary bubbles
 */

const pool = require('../config/database');
const whatsappService = require('./whatsapp.service');

// Indonesian date formatter
function formatDateID(date) {
    return new Date(date).toLocaleDateString('id-ID', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    });
}

function todayStr() {
    return formatDateID(new Date());
}

class ReminderSenderService {

    constructor() {
        this._isRunning = false;
    }

    /**
     * Check and send all due reminders — grouped by user, then by type
     */
    async checkAndSendReminders() {
        if (this._isRunning) return { success: true, sent: 0, failed: 0, skipped: 'already running' };
        this._isRunning = true;
        try {
            const now = new Date();
            console.log(`[${now.toISOString()}] Checking for due reminders...`);

            const [reminders] = await pool.query(`
                SELECT r.*, u.username, u.phone_number
                FROM reminders r
                JOIN users u ON r.user_id = u.id
                WHERE r.reminder_datetime <= NOW()
                  AND r.is_sent = 0
                  AND r.is_active = 1
                  AND r.is_completed = 0
                ORDER BY r.reminder_datetime ASC
            `);

            console.log(`[${now.toISOString()}] Found ${reminders.length} due reminders`);
            if (reminders.length === 0) return { success: true, sent: 0, failed: 0 };

            // Group by user
            const byUser = {};
            for (const r of reminders) {
                if (!byUser[r.user_id]) {
                    byUser[r.user_id] = { username: r.username, phone_number: r.phone_number, reminders: [] };
                }
                byUser[r.user_id].reminders.push(r);
            }

            let sentCount = 0;
            let failedCount = 0;

            // Process users in concurrent batches (max 3 at a time)
            const SEND_CONCURRENCY = parseInt(process.env.REMINDER_SEND_CONCURRENCY) || 3;
            const userIds = Object.keys(byUser);

            for (let i = 0; i < userIds.length; i += SEND_CONCURRENCY) {
                const batch = userIds.slice(i, i + SEND_CONCURRENCY);
                const results = await Promise.allSettled(batch.map(async (userId) => {
                    const { username, phone_number, reminders: userReminders } = byUser[userId];
                    let userSent = 0;
                    let userFailed = 0;

                    if (!phone_number) {
                        console.log(`Warning: No phone number for user ${username}, skipping ${userReminders.length} reminders`);
                        return { sent: 0, failed: userReminders.length };
                    }

                    // Categorize
                    const taskReminders = userReminders.filter(r => r.title.includes('[Task #'));
                    const eventReminders = userReminders.filter(r => r.title.includes('[Event #') || r.title.includes('[Kegiatan #'));
                    const otherReminders = userReminders.filter(r =>
                        !r.title.includes('[Task #') && !r.title.includes('[Event #') && !r.title.includes('[Kegiatan #')
                    );

                    const bubbles = [];
                    if (taskReminders.length > 0) {
                        bubbles.push({ type: 'task', items: taskReminders, message: this.formatTaskSummary(username, taskReminders) });
                    }
                    if (eventReminders.length > 0) {
                        bubbles.push({ type: 'event', items: eventReminders, message: this.formatEventSummary(username, eventReminders) });
                    }
                    if (otherReminders.length > 0) {
                        bubbles.push({ type: 'other', items: otherReminders, message: this.formatOtherSummary(username, otherReminders) });
                    }

                    for (const bubble of bubbles) {
                        const ids = bubble.items.map(r => r.id);
                        // Optimistic claim: mark as sent BEFORE sending to prevent duplicate sends
                        const [claimResult] = await pool.query(
                            `UPDATE reminders SET is_sent = 1, updated_at = NOW() WHERE id IN (?) AND is_sent = 0`,
                            [ids]
                        );
                        if (claimResult.affectedRows === 0) continue; // already claimed by another cycle

                        const success = await this.sendMessage(phone_number, bubble.message);
                        if (success) {
                            userSent += claimResult.affectedRows;
                            console.log(`Reminder bubble [${bubble.type}] sent to ${username} (${claimResult.affectedRows} items)`);
                        } else {
                            // Revert claim on send failure so next cycle retries
                            await pool.query(
                                `UPDATE reminders SET is_sent = 0, updated_at = NOW() WHERE id IN (?)`,
                                [ids]
                            );
                            userFailed += bubble.items.length;
                        }
                        if (bubbles.length > 1) await new Promise(res => setTimeout(res, 1500));
                    }
                    return { sent: userSent, failed: userFailed };
                }));

                for (const result of results) {
                    if (result.status === 'fulfilled') {
                        sentCount += result.value.sent;
                        failedCount += result.value.failed;
                    } else {
                        console.error('Reminder batch error:', result.reason);
                    }
                }
            }

            console.log(`[${now.toISOString()}] Sent: ${sentCount}, Failed: ${failedCount}`);
            return { success: true, sent: sentCount, failed: failedCount };

        } catch (error) {
            console.error('Reminder check error:', error);
            return { success: false, error: error.message };
        } finally {
            this._isRunning = false;
        }
    }

    /**
     * Send a message via centralized WhatsApp service (with retry)
     */
    async sendMessage(phone_number, message) {
        const result = await whatsappService.sendMessage(phone_number, message);
        return result.success;
    }

    // ─── FORMAT HELPERS ──────────────────────────

    /**
     * Format a section with items
     */
    formatSection(emoji, label, items, extractFn) {
        if (items.length === 0) return [];
        const lines = [];
        lines.push(`${emoji} *${label}*`);
        items.forEach((r, i) => {
            const name = extractFn(r.title);
            lines.push(`    ${i + 1}. ${name}`);
        });
        lines.push('');
        return lines;
    }

    /**
     * Format Task summary bubble
     */
    formatTaskSummary(username, reminders) {
        const lines = [];
        lines.push('━━━━━━━━━━━━━━━━━━');
        lines.push('*PENGINGAT TASK*');
        lines.push(`_${todayStr()}_`);
        lines.push('━━━━━━━━━━━━━━━━━━');
        lines.push('');
        lines.push(`Halo *${username}*!`);
        lines.push('');

        const extract = (t) => this.extractTaskName(t);

        // Group by urgency — most urgent first
        lines.push(...this.formatSection('🔴', 'DEADLINE HARI INI', reminders.filter(r => r.title.includes('DEADLINE HARI INI')), extract));
        lines.push(...this.formatSection('🟠', 'Deadline Besok', reminders.filter(r => r.title.includes('H-1 Deadline')), extract));
        lines.push(...this.formatSection('🟡', 'Deadline 3 Hari Lagi', reminders.filter(r => r.title.includes('H-3 Deadline')), extract));
        lines.push(...this.formatSection('🟢', 'Dimulai Hari Ini', reminders.filter(r => r.title.includes('Hari Mulai:')), extract));
        lines.push(...this.formatSection('📅', 'Dimulai Besok', reminders.filter(r => r.title.includes('H-1 Mulai:')), extract));
        lines.push(...this.formatSection('📋', 'Dimulai 3 Hari Lagi', reminders.filter(r => r.title.includes('H-3 Mulai:')), extract));
        lines.push(...this.formatSection('🔄', 'Belum Selesai', reminders.filter(r => r.title.includes('Belum selesai:')), extract));

        lines.push('━━━━━━━━━━━━━━━━━━');
        lines.push(`📊 Total: *${reminders.length}* pengingat`);
        lines.push('💪 Semangat! Jangan lupa ya!');

        return lines.join('\n');
    }

    /**
     * Format Kegiatan summary bubble
     */
    formatKegiatanSummary(username, reminders) {
        const lines = [];
        lines.push('━━━━━━━━━━━━━━━━━━');
        lines.push('*PENGINGAT KEGIATAN*');
        lines.push(`_${todayStr()}_`);
        lines.push('━━━━━━━━━━━━━━━━━━');
        lines.push('');
        lines.push(`Halo *${username}*!`);
        lines.push('');

        const extract = (t) => this.extractItemName(t);

        lines.push(...this.formatSection('🟢', 'Dimulai Hari Ini', reminders.filter(r => r.title.includes('Hari Ini:')), extract));
        lines.push(...this.formatSection('🏁', 'Hari Terakhir', reminders.filter(r => r.title.includes('Hari Terakhir:')), extract));
        lines.push(...this.formatSection('📅', 'Dimulai Besok', reminders.filter(r => r.title.includes('H-1:') && !r.title.includes('Berakhir')), extract));
        lines.push(...this.formatSection('⏳', 'Berakhir Besok', reminders.filter(r => r.title.includes('H-1 Berakhir:')), extract));
        lines.push(...this.formatSection('📋', 'H-3', reminders.filter(r => r.title.includes('H-3:')), extract));

        lines.push('━━━━━━━━━━━━━━━━━━');
        lines.push(`📊 Total: *${reminders.length}* pengingat`);

        return lines.join('\n');
    }

    /**
     * Format Event summary bubble
     */
    formatEventSummary(username, reminders) {
        const lines = [];
        lines.push('━━━━━━━━━━━━━━━━━━');
        lines.push('*PENGINGAT EVENT*');
        lines.push(`_${todayStr()}_`);
        lines.push('━━━━━━━━━━━━━━━━━━');
        lines.push('');
        lines.push(`Halo *${username}*!`);
        lines.push('');

        const extract = (t) => this.extractItemName(t);

        lines.push(...this.formatSection('🟢', 'Hari Ini', reminders.filter(r => r.title.includes('Hari Ini:')), extract));
        lines.push(...this.formatSection('🏁', 'Hari Terakhir', reminders.filter(r => r.title.includes('Hari Terakhir:')), extract));
        lines.push(...this.formatSection('📅', 'Besok', reminders.filter(r => r.title.includes('H-1:') && !r.title.includes('Berakhir')), extract));
        lines.push(...this.formatSection('⏳', 'Berakhir Besok', reminders.filter(r => r.title.includes('H-1 Berakhir:')), extract));
        lines.push(...this.formatSection('📋', 'H-3', reminders.filter(r => r.title.includes('H-3:')), extract));

        lines.push('━━━━━━━━━━━━━━━━━━');
        lines.push(`📊 Total: *${reminders.length}* pengingat`);

        return lines.join('\n');
    }

    /**
     * Format other/generic reminders
     */
    formatOtherSummary(username, reminders) {
        const lines = [];
        lines.push('━━━━━━━━━━━━━━━━━━');
        lines.push('*PENGINGAT*');
        lines.push(`_${todayStr()}_`);
        lines.push('━━━━━━━━━━━━━━━━━━');
        lines.push('');
        lines.push(`Halo *${username}*!`);
        lines.push('');
        reminders.forEach((r, i) => {
            lines.push(`${i + 1}. *${r.title}*`);
            if (r.description) lines.push(`   _${r.description}_`);
        });
        lines.push('');
        lines.push('━━━━━━━━━━━━━━━━━━');
        lines.push(`📊 Total: *${reminders.length}* pengingat`);
        return lines.join('\n');
    }

    // ─── EXTRACTORS ──────────────────────────

    /**
     * Extract task name: "[Task #24] 🔴 DEADLINE HARI INI: Name" -> "Name"
     */
    extractTaskName(title) {
        // Match after the last colon following the prefix
        const match = title.match(/\[Task #\d+\][^:]+:\s*(.+)/);
        return match ? match[1].trim() : title;
    }

    /**
     * Extract item name: "[Kegiatan #8] 🎯 Hari Ini: Name" -> "Name"
     */
    extractItemName(title) {
        const match = title.match(/\[\w+ #\d+\][^:]+:\s*(.+)/);
        return match ? match[1].trim() : title;
    }

    // ─── RECURRING & LIFECYCLE ──────────────────────────

    /**
     * Handle recurring reminders - advance to next occurrence
     */
    async processRecurringReminders() {
        try {
            const [reminders] = await pool.query(`
                SELECT r.*, uns.notification_days
                FROM reminders r
                LEFT JOIN user_notification_settings uns ON r.user_id = uns.user_id
                WHERE r.is_sent = 1
                  AND r.repeat_type != 'None'
                  AND r.is_active = 1
                  AND r.is_completed = 0
            `);

            for (const reminder of reminders) {
                // Check if related task still needs reminding
                if (reminder.title.includes('[Task #')) {
                    const match = reminder.title.match(/\[Task #(\d+)\]/);
                    if (match) {
                        const [task] = await pool.query('SELECT status FROM tasks WHERE id = ?', [match[1]]);
                        if (!task.length || ['Completed', 'Cancelled'].includes(task[0].status)) {
                            await pool.query('UPDATE reminders SET is_completed = TRUE WHERE id = ?', [reminder.id]);
                            continue;
                        }
                    }
                }

                let nextDate = this.calculateNextDate(reminder);

                // Adjust to allowed notification_days if set
                if (nextDate && reminder.notification_days) {
                    const days = typeof reminder.notification_days === 'string'
                        ? JSON.parse(reminder.notification_days) : reminder.notification_days;
                    nextDate = this.adjustToAllowedDay(nextDate, days);
                }

                if (nextDate) {
                    await pool.query(
                        'UPDATE reminders SET reminder_datetime = ?, is_sent = 0, updated_at = NOW() WHERE id = ?',
                        [nextDate, reminder.id]
                    );
                    console.log(`Recurring reminder #${reminder.id} rescheduled to ${nextDate}`);
                }
            }

        } catch (error) {
            console.error('Recurring reminder error:', error);
        }
    }

    adjustToAllowedDay(dateStr, allowedDays) {
        if (!allowedDays || allowedDays.length === 0) return dateStr;
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const date = new Date(dateStr);
        for (let i = 0; i < 7; i++) {
            const dayName = dayNames[date.getDay()];
            if (allowedDays.includes(dayName)) {
                return date.toISOString().slice(0, 19).replace('T', ' ');
            }
            date.setDate(date.getDate() + 1);
        }
        return dateStr;
    }

    calculateNextDate(reminder) {
        const current = new Date(reminder.reminder_datetime);

        switch (reminder.repeat_type) {
            case 'Daily':
                current.setDate(current.getDate() + 1);
                break;
            case 'Weekly':
                current.setDate(current.getDate() + 7);
                break;
            case 'Monthly':
                current.setMonth(current.getMonth() + 1);
                break;
            case 'Yearly':
                current.setFullYear(current.getFullYear() + 1);
                break;
            default:
                return null;
        }

        return current.toISOString().slice(0, 19).replace('T', ' ');
    }
}

module.exports = new ReminderSenderService();
