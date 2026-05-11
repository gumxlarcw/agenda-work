const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { verifyToken, addUserFilter } = require('../middleware/auth.middleware');

const taskSyncService = require('../services/task-sync.service');

const router = express.Router();

// Build team-based WHERE condition for event visibility
function buildTeamFilter(user, conditions, params) {
    if (user.role === 'admin') {
        // Admin sees all
    } else if (user.tim === 'Solo-ist') {
        conditions.push('e.user_id = ?');
        params.push(user.id);
    } else {
        conditions.push('e.user_id IN (SELECT id FROM users WHERE tim = ?)');
        params.push(user.tim);
    }
}

// Get all events (team-scoped, with optional year/month filters)
router.get('/', verifyToken, async (req, res) => {
    try {
        let query_sql = 'SELECT e.*, u.username as creator_username, u.name as creator_name FROM events e JOIN users u ON e.user_id = u.id';
        const params = [];
        const conditions = [];

        // Team-based filtering
        buildTeamFilter(req.user, conditions, params);

        if (req.query.year) {
            const year = parseInt(req.query.year);
            conditions.push('(YEAR(e.start_date) = ? OR YEAR(e.end_date) = ?)');
            params.push(year, year);
        }

        if (req.query.month) {
            const month = parseInt(req.query.month);
            conditions.push('(MONTH(e.start_date) = ? OR MONTH(e.end_date) = ?)');
            params.push(month, month);
        }

        if (conditions.length > 0) {
            query_sql += ` WHERE ${conditions.join(' AND ')}`;
        }

        query_sql += ' ORDER BY e.start_date ASC LIMIT 500';

        const [rows] = await pool.query(query_sql, params);

        res.json({
            success: true,
            data: rows
        });
    } catch (error) {
        console.error('Get events error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch events'
        });
    }
});

// Get distinct categories (team-scoped, same visibility rules as GET /)
router.get('/categories', verifyToken, async (req, res) => {
    try {
        const conditions = ["e.category IS NOT NULL", "e.category != ''"];
        const params = [];
        buildTeamFilter(req.user, conditions, params);

        const [rows] = await pool.query(
            `SELECT DISTINCT e.category FROM events e WHERE ${conditions.join(' AND ')} ORDER BY e.category`,
            params
        );
        res.json({ success: true, data: rows.map(r => r.category) });
    } catch (error) {
        console.error('Get categories error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch categories' });
    }
});

// Get single event (team-scoped)
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const conditions = ['e.id = ?'];
        const params = [req.params.id];
        buildTeamFilter(req.user, conditions, params);

        const [rows] = await pool.query(
            `SELECT e.*, u.username as creator_username, u.name as creator_name FROM events e JOIN users u ON e.user_id = u.id WHERE ${conditions.join(' AND ')}`,
            params
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Event not found'
            });
        }

        res.json({
            success: true,
            data: rows[0]
        });
    } catch (error) {
        console.error('Get event error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch event'
        });
    }
});

// Create event
router.post('/', verifyToken, [
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('start_date').notEmpty().isISO8601().withMessage('Valid start date is required'),
    body('end_date').notEmpty().isISO8601().withMessage('Valid end date is required'),
    body('description').optional().trim(),
    body('category').optional().trim(),
    body('color').optional().trim(),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { title, start_date, end_date, description, category, color } = req.body;

        const userId = req.user.role === 'admin' && req.body.user_id
            ? req.body.user_id
            : req.user.id;

        const [result] = await pool.query(
            `INSERT INTO events (user_id, title, start_date, end_date, description, category, color)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userId, title, start_date, end_date,
             description || null, category || null, color || '#10b981']
        );

        // Auto-create reminders for team members
        await taskSyncService.syncEventReminders(result.insertId);

        // Create in-app notifications for team members (fire-and-forget)
        const creatorName = req.user.name || req.user.username;
        const creatorTim = req.user.tim;
        if (creatorTim && creatorTim !== 'Solo-ist') {
          pool.query(
            `INSERT INTO notifications (user_id, type, title, message, ref_type, ref_id, from_user_id)
             SELECT id, 'event_created', ?, ?, 'event', ?, ?
             FROM users WHERE tim = ? AND id != ?`,
            [`${creatorName} membuat event baru`, title, result.insertId, req.user.id, creatorTim, req.user.id]
          ).catch(err => console.error('Event notification insert error:', err.message));
        }

        const [newRow] = await pool.query('SELECT * FROM events WHERE id = ?', [result.insertId]);

        res.status(201).json({
            success: true,
            message: 'Event created successfully',
            data: newRow[0]
        });
    } catch (error) {
        console.error('Create event error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create event'
        });
    }
});

// Update event
router.put('/:id', verifyToken, addUserFilter, [
    body('title').optional().trim().notEmpty(),
    body('start_date').optional().isISO8601(),
    body('end_date').optional().isISO8601(),
    body('description').optional().trim(),
    body('category').optional().trim(),
    body('color').optional().trim(),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const eventId = req.params.id;

        let checkQuery = 'SELECT id FROM events WHERE id = ?';
        const checkParams = [eventId];
        if (req.userFilter) {
            checkQuery += ' AND user_id = ?';
            checkParams.push(req.userFilter.user_id);
        }

        const [existing] = await pool.query(checkQuery, checkParams);
        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Event not found'
            });
        }

        const allowedFields = ['title', 'start_date', 'end_date', 'description', 'category', 'color'];
        const updates = [];
        const values = [];

        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updates.push(`${field} = ?`);
                values.push(req.body[field] || null);
            }
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No fields to update'
            });
        }

        values.push(eventId);
        await pool.query(`UPDATE events SET ${updates.join(', ')} WHERE id = ?`, values);

        // Resync reminders if dates changed
        if (req.body.start_date || req.body.end_date) {
            await taskSyncService.deleteEventReminders(eventId);
            await taskSyncService.syncEventReminders(eventId);
        }

        const [updatedRow] = await pool.query('SELECT * FROM events WHERE id = ?', [eventId]);

        res.json({
            success: true,
            message: 'Event updated successfully',
            data: updatedRow[0]
        });
    } catch (error) {
        console.error('Update event error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update event'
        });
    }
});

// Delete event
router.delete('/:id', verifyToken, addUserFilter, async (req, res) => {
    try {
        const eventId = req.params.id;

        // Clean up reminders before deleting
        await taskSyncService.deleteEventReminders(eventId);

        let deleteQuery = 'DELETE FROM events WHERE id = ?';
        const params = [eventId];

        if (req.userFilter) {
            deleteQuery += ' AND user_id = ?';
            params.push(req.userFilter.user_id);
        }

        const [result] = await pool.query(deleteQuery, params);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Event not found'
            });
        }

        res.json({
            success: true,
            message: 'Event deleted successfully'
        });
    } catch (error) {
        console.error('Delete event error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete event'
        });
    }
});

module.exports = router;
