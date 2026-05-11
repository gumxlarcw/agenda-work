const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { verifyToken } = require('../middleware/auth.middleware');

const router = express.Router();

const VALID_TYPES = ['daily', 'weekly', 'monthly', 'yearly'];
const VALID_LEVELS = ['H-7', 'H-3', 'H-2', 'H-1', 'Hari-H', 'Overdue', 'Dimulai', 'Sedang-Berlangsung', 'Berakhir'];

function parseJson(val, fallback = []) {
    if (typeof val === 'string') {
        try { return JSON.parse(val); } catch { return fallback; }
    }
    return val ?? fallback;
}

// Get current user's notification settings
router.get('/', verifyToken, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM user_notification_settings WHERE user_id = ?',
            [req.user.id]
        );

        if (rows.length === 0) {
            return res.json({
                success: true,
                data: {
                    user_id: req.user.id,
                    is_active: false,
                    notification_time: '07:00:00',
                    notification_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
                    notification_types: ['daily'],
                    reminder_levels: ['H-1', 'Hari-H'],
                    scope_lookahead: 1,
                    last_sent_at: null,
                }
            });
        }

        const settings = rows[0];
        settings.notification_days = parseJson(settings.notification_days);
        settings.notification_types = parseJson(settings.notification_types);
        settings.reminder_levels = parseJson(settings.reminder_levels);

        res.json({ success: true, data: settings });
    } catch (error) {
        console.error('Get notification settings error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch notification settings' });
    }
});

// Upsert notification settings
router.put('/', verifyToken, [
    body('is_active').isBoolean().withMessage('is_active must be boolean'),
    body('notification_time').matches(/^\d{2}:\d{2}$/).withMessage('notification_time must be HH:mm format'),
    body('notification_days').isArray({ min: 1 }).withMessage('notification_days must be a non-empty array'),
    body('notification_types').isArray({ min: 1 }).withMessage('notification_types must be a non-empty array'),
    body('reminder_levels').isArray({ min: 1 }).withMessage('reminder_levels must be a non-empty array'),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { is_active, notification_time, notification_days, notification_types, reminder_levels, scope_lookahead } = req.body;

        // Validate notification_days: must be valid day names
        const VALID_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        if (!notification_days.every(d => typeof d === 'string' && VALID_DAYS.includes(d))) {
            return res.status(400).json({ success: false, message: 'Invalid notification_days value. Must be day names (Sunday-Saturday).' });
        }

        if (!notification_types.every(t => VALID_TYPES.includes(t))) {
            return res.status(400).json({ success: false, message: 'Invalid notification type value' });
        }
        if (!reminder_levels.every(l => VALID_LEVELS.includes(l))) {
            return res.status(400).json({ success: false, message: 'Invalid reminder level value' });
        }

        const lookahead = scope_lookahead === true || scope_lookahead === 1 ? 1 : 0;

        // Check phone_number if enabling
        if (is_active) {
            const [users] = await pool.query('SELECT phone_number FROM users WHERE id = ?', [req.user.id]);
            if (!users[0]?.phone_number) {
                return res.status(400).json({
                    success: false,
                    message: 'Set your phone number before enabling notifications'
                });
            }
        }

        const timeValue = notification_time + ':00';
        const daysJson = JSON.stringify(notification_days);
        const typesJson = JSON.stringify(notification_types);
        const levelsJson = JSON.stringify(reminder_levels);

        await pool.query(
            `INSERT INTO user_notification_settings
                (user_id, is_active, notification_time, notification_days, notification_types, reminder_levels, scope_lookahead)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                is_active = VALUES(is_active),
                notification_time = VALUES(notification_time),
                notification_days = VALUES(notification_days),
                notification_types = VALUES(notification_types),
                reminder_levels = VALUES(reminder_levels),
                scope_lookahead = VALUES(scope_lookahead)`,
            [req.user.id, is_active, timeValue, daysJson, typesJson, levelsJson, lookahead]
        );

        const [updated] = await pool.query(
            'SELECT * FROM user_notification_settings WHERE user_id = ?',
            [req.user.id]
        );

        const settings = updated[0];
        settings.notification_days = parseJson(settings.notification_days);
        settings.notification_types = parseJson(settings.notification_types);
        settings.reminder_levels = parseJson(settings.reminder_levels);

        // Re-sync reminders in background when settings change
        const taskSyncService = require('../services/task-sync.service');
        taskSyncService.resyncAllRemindersForUser(req.user.id).catch(err =>
            console.error('Reminder resync error:', err.message)
        );

        res.json({ success: true, message: 'Notification settings saved', data: settings });
    } catch (error) {
        console.error('Update notification settings error:', error);
        res.status(500).json({ success: false, message: 'Failed to update notification settings' });
    }
});

// Send test digest to current user (uses same LLM pipeline)
router.post('/test', verifyToken, async (req, res) => {
    try {
        const [users] = await pool.query('SELECT phone_number, username FROM users WHERE id = ?', [req.user.id]);
        if (!users[0]?.phone_number) {
            return res.status(400).json({ success: false, message: 'Set your phone number first' });
        }

        const [settingsRows] = await pool.query(
            'SELECT * FROM user_notification_settings WHERE user_id = ?',
            [req.user.id]
        );

        // Build a mock setting object for the digest sender
        const dayjs = require('dayjs');
        const utc = require('dayjs/plugin/utc');
        dayjs.extend(utc);
        const now = dayjs().utcOffset(9);

        const setting = settingsRows.length > 0 ? {
            ...settingsRows[0],
            username: users[0].username,
            phone_number: users[0].phone_number,
            last_sent_at: null, // bypass duplicate guard
        } : {
            user_id: req.user.id,
            username: users[0].username,
            phone_number: users[0].phone_number,
            notification_types: '["daily"]',
            reminder_levels: '["H-1","Hari-H"]',
            last_sent_at: null,
        };

        // Import and call the digest sender directly
        const { sendUnifiedDigest } = require('../services/notification-scheduler.service');
        await sendUnifiedDigest(setting, now);

        res.json({ success: true, message: 'Test digest sent! Check your WhatsApp.' });
    } catch (error) {
        console.error('Test digest error:', error);
        res.status(500).json({ success: false, message: 'Failed to send: ' + error.message });
    }
});

module.exports = router;
