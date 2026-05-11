const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { verifyToken, addUserFilter } = require('../middleware/auth.middleware');

const router = express.Router();

const VALID_REPEAT_TYPES = ['None', 'Daily', 'Weekly', 'Monthly', 'Yearly'];

// Get all reminders
router.get('/', verifyToken, addUserFilter, async (req, res) => {
    try {
        // Admin gets all reminders with username, users get only their reminders
        let query_sql = req.user.role === 'admin' && !req.userFilter
            ? 'SELECT r.*, u.username FROM reminders r JOIN users u ON r.user_id = u.id'
            : 'SELECT * FROM reminders';
        const params = [];
        const conditions = [];

        if (req.userFilter) {
            conditions.push('user_id = ?');
            params.push(req.userFilter.user_id);
        }

        // Filter by active/completed if specified
        if (req.query.active === 'true') {
            conditions.push('is_active = TRUE AND is_completed = FALSE');
        }

        if (conditions.length > 0) {
            query_sql += ' WHERE ' + conditions.join(' AND ');
        }

        // #13: page/limit pagination. Keep LIMIT 500 as the hard ceiling for a single page
        // so admins with large tables can't blow up the response.
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 500);
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const offset = (page - 1) * limit;
        query_sql += ' ORDER BY reminder_datetime ASC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const [reminders] = await pool.query(query_sql, params);

        res.json({
            success: true,
            data: reminders,
            pagination: { page, limit }
        });
    } catch (error) {
        console.error('Get reminders error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch reminders'
        });
    }
});

// Get upcoming reminders (next 24 hours)
router.get('/upcoming', verifyToken, addUserFilter, async (req, res) => {
    try {
        let query_sql = `
            SELECT * FROM reminders 
            WHERE reminder_datetime BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 24 HOUR)
            AND is_active = TRUE AND is_completed = FALSE
        `;
        const params = [];

        if (req.userFilter) {
            query_sql += ' AND user_id = ?';
            params.push(req.userFilter.user_id);
        }

        query_sql += ' ORDER BY reminder_datetime ASC';

        const [reminders] = await pool.query(query_sql, params);

        res.json({
            success: true,
            data: reminders
        });
    } catch (error) {
        console.error('Get upcoming reminders error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch upcoming reminders'
        });
    }
});

// Get single reminder
router.get('/:id', verifyToken, addUserFilter, async (req, res) => {
    try {
        let query_sql = 'SELECT * FROM reminders WHERE id = ?';
        const params = [req.params.id];

        if (req.userFilter) {
            query_sql += ' AND user_id = ?';
            params.push(req.userFilter.user_id);
        }

        const [reminders] = await pool.query(query_sql, params);

        if (reminders.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Reminder not found'
            });
        }

        res.json({
            success: true,
            data: reminders[0]
        });
    } catch (error) {
        console.error('Get reminder error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch reminder'
        });
    }
});

// Create reminder
router.post('/', verifyToken, [
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('description').optional().trim(),
    body('reminder_datetime').isISO8601().withMessage('Valid datetime required'),
    body('repeat_type').optional().isIn(VALID_REPEAT_TYPES),
    body('is_active').optional().isBoolean()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { title, description, reminder_datetime, repeat_type, is_active } = req.body;
        const userId = req.user.role === 'admin' && req.body.user_id 
            ? req.body.user_id 
            : req.user.id;

        const [result] = await pool.query(
            'INSERT INTO reminders (user_id, title, description, reminder_datetime, repeat_type, is_active) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, title, description || null, reminder_datetime, repeat_type || 'None', is_active !== false]
        );

        const [newReminder] = await pool.query('SELECT * FROM reminders WHERE id = ?', [result.insertId]);

        res.status(201).json({
            success: true,
            message: 'Reminder created successfully',
            data: newReminder[0]
        });
    } catch (error) {
        console.error('Create reminder error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create reminder'
        });
    }
});

// Update reminder
router.put('/:id', verifyToken, addUserFilter, [
    body('title').optional().trim().notEmpty(),
    body('description').optional().trim(),
    body('reminder_datetime').optional().isISO8601(),
    body('repeat_type').optional().isIn(VALID_REPEAT_TYPES),
    body('is_active').optional().isBoolean(),
    body('is_completed').optional().isBoolean()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const reminderId = req.params.id;

        // Check ownership
        let checkQuery = 'SELECT id FROM reminders WHERE id = ?';
        const checkParams = [reminderId];
        if (req.userFilter) {
            checkQuery += ' AND user_id = ?';
            checkParams.push(req.userFilter.user_id);
        }

        const [existing] = await pool.query(checkQuery, checkParams);
        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Reminder not found'
            });
        }

        const allowedFields = ['title', 'description', 'reminder_datetime', 'repeat_type', 'is_active', 'is_completed'];
        const updates = [];
        const values = [];

        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updates.push(`${field} = ?`);
                values.push(req.body[field]);
            }
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No fields to update'
            });
        }

        values.push(reminderId);
        await pool.query(`UPDATE reminders SET ${updates.join(', ')} WHERE id = ?`, values);

        const [updatedReminder] = await pool.query('SELECT * FROM reminders WHERE id = ?', [reminderId]);

        res.json({
            success: true,
            message: 'Reminder updated successfully',
            data: updatedReminder[0]
        });
    } catch (error) {
        console.error('Update reminder error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update reminder'
        });
    }
});

// Mark reminder as completed (only custom reminders can be manually completed)
router.patch('/:id/complete', verifyToken, addUserFilter, async (req, res) => {
    try {
        const reminderId = req.params.id;

        let updateQuery = `UPDATE reminders SET is_completed = TRUE WHERE id = ? AND source_type = 'custom'`;
        const params = [reminderId];

        if (req.userFilter) {
            updateQuery += ' AND user_id = ?';
            params.push(req.userFilter.user_id);
        }

        const [result] = await pool.query(updateQuery, params);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Reminder not found or is system-generated'
            });
        }

        res.json({
            success: true,
            message: 'Reminder marked as completed'
        });
    } catch (error) {
        console.error('Complete reminder error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to complete reminder'
        });
    }
});

// Delete reminder
router.delete('/:id', verifyToken, addUserFilter, async (req, res) => {
    try {
        const reminderId = req.params.id;

        let deleteQuery = 'DELETE FROM reminders WHERE id = ?';
        const params = [reminderId];

        if (req.userFilter) {
            deleteQuery += ' AND user_id = ?';
            params.push(req.userFilter.user_id);
        }

        const [result] = await pool.query(deleteQuery, params);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Reminder not found'
            });
        }

        res.json({
            success: true,
            message: 'Reminder deleted successfully'
        });
    } catch (error) {
        console.error('Delete reminder error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete reminder'
        });
    }
});

module.exports = router;
