const express = require('express');
const { body, query, validationResult } = require('express-validator');
const pool = require('../config/database');
const { verifyToken, addUserFilter } = require('../middleware/auth.middleware');
const taskSyncService = require('../services/task-sync.service');

const router = express.Router();

const VALID_PREFIXES = ['Membuat', 'Melakukan', 'Mengikuti', 'Mengisi', 'Memberikan', 'Mengumpulkan'];
const VALID_PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const VALID_STATUSES = ['Pending', 'In Progress', 'Completed', 'On Hold', 'Cancelled'];
const ALLOWED_SORT_FIELDS = ['created_at', 'updated_at', 'start_date', 'end_date', 'priority', 'status', 'task'];

// URL validation regex
const URL_REGEX = /^https?:\/\/.+/i;

// Get all tasks
router.get('/', verifyToken, addUserFilter, async (req, res) => {
    try {
        // Admin gets all tasks with username, users get only their tasks
        let query_sql = req.user.role === 'admin' && !req.userFilter
            ? 'SELECT t.*, u.username FROM tasks t JOIN users u ON t.user_id = u.id'
            : 'SELECT * FROM tasks';
        const params = [];

        if (req.userFilter) {
            query_sql += ' WHERE user_id = ?';
            params.push(req.userFilter.user_id);
        }

        // Add sorting - use alias for joined query
        const sortBy = ALLOWED_SORT_FIELDS.includes(req.query.sortBy) ? req.query.sortBy : 'created_at';
        const sortOrder = req.query.sortOrder === 'asc' ? 'ASC' : 'DESC';
        const sortPrefix = req.user.role === 'admin' && !req.userFilter ? 't.' : '';
        query_sql += ` ORDER BY ${sortPrefix}${sortBy} ${sortOrder}`;

        // Add pagination
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const offset = (page - 1) * limit;
        query_sql += ` LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const [tasks] = await pool.query(query_sql, params);

        // Get total count
        let countQuery = 'SELECT COUNT(*) as total FROM tasks';
        const countParams = [];
        if (req.userFilter) {
            countQuery += ' WHERE user_id = ?';
            countParams.push(req.userFilter.user_id);
        }
        const [countResult] = await pool.query(countQuery, countParams);

        res.json({
            success: true,
            data: tasks,
            pagination: {
                page,
                limit,
                total: countResult[0].total,
                totalPages: Math.ceil(countResult[0].total / limit)
            }
        });
    } catch (error) {
        console.error('Get tasks error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch tasks'
        });
    }
});

// Get single task
router.get('/:id', verifyToken, addUserFilter, async (req, res) => {
    try {
        let query_sql = 'SELECT * FROM tasks WHERE id = ?';
        const params = [req.params.id];

        if (req.userFilter) {
            query_sql += ' AND user_id = ?';
            params.push(req.userFilter.user_id);
        }

        const [tasks] = await pool.query(query_sql, params);

        if (tasks.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Task not found'
            });
        }

        res.json({
            success: true,
            data: tasks[0]
        });
    } catch (error) {
        console.error('Get task error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch task'
        });
    }
});

// Create task
router.post('/', verifyToken, [
    body('task').trim().notEmpty().withMessage('Task name is required'),
    body('prefix').isIn(VALID_PREFIXES).withMessage('Invalid prefix'),
    body('kegiatan').trim().notEmpty().withMessage('Kegiatan is required'),
    body('rencana_kinerja').optional().trim(),
    body('priority').optional().isIn(VALID_PRIORITIES).withMessage('Invalid priority'),
    body('status').optional().isIn(VALID_STATUSES).withMessage('Invalid status'),
    body('start_date').notEmpty().withMessage('Start date is required for reminder sync').isISO8601().toDate(),
    body('end_date').notEmpty().withMessage('End date is required for reminder sync').isISO8601().toDate(),
    body('capaian').optional().trim(),
    body('bukti_dukung').optional().custom((value) => {
        if (value && !URL_REGEX.test(value)) {
            throw new Error('Invalid URL format for bukti_dukung');
        }
        return true;
    }),
    body('notes').optional().trim()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const {
            task, prefix, kegiatan, rencana_kinerja, priority,
            status, start_date, end_date, capaian, bukti_dukung, notes
        } = req.body;

        // Determine user_id (admin can create for others)
        const userId = req.user.role === 'admin' && req.body.user_id 
            ? req.body.user_id 
            : req.user.id;

        const [result] = await pool.query(
            `INSERT INTO tasks (user_id, task, prefix, kegiatan, rencana_kinerja, priority, status, start_date, end_date, capaian, bukti_dukung, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, task, prefix, kegiatan || null, rencana_kinerja || null,
             priority || 'P2', status || 'Pending', start_date || null, end_date || null,
             capaian || null, bukti_dukung || null, notes || null]
        );

        // Auto-sync new task to todo and reminder
        await taskSyncService.syncNewTask(result.insertId);

        // Fetch created task with computed jumlah_hari
        const [newTask] = await pool.query('SELECT * FROM tasks WHERE id = ?', [result.insertId]);

        res.status(201).json({
            success: true,
            message: 'Task created successfully',
            data: newTask[0]
        });
    } catch (error) {
        console.error('Create task error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create task'
        });
    }
});

// Update task
router.put('/:id', verifyToken, addUserFilter, [
    body('task').optional().trim().notEmpty(),
    body('prefix').optional().isIn(VALID_PREFIXES),
    body('priority').optional().isIn(VALID_PRIORITIES),
    body('status').optional().isIn(VALID_STATUSES),
    body('start_date').optional().isISO8601().toDate(),
    body('end_date').optional().isISO8601().toDate(),
    body('bukti_dukung').optional().custom((value) => {
        if (value && !URL_REGEX.test(value)) {
            throw new Error('Invalid URL format');
        }
        return true;
    })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const taskId = req.params.id;

        // Check ownership
        let checkQuery = 'SELECT id FROM tasks WHERE id = ?';
        const checkParams = [taskId];
        if (req.userFilter) {
            checkQuery += ' AND user_id = ?';
            checkParams.push(req.userFilter.user_id);
        }

        const [existing] = await pool.query(checkQuery, checkParams);
        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Task not found'
            });
        }

        // Build update query
        const allowedFields = ['task', 'prefix', 'kegiatan', 'rencana_kinerja', 'priority',
                               'status', 'start_date', 'end_date', 'capaian', 'bukti_dukung', 'notes'];
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

        values.push(taskId);
        await pool.query(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, values);

        // If status changed to Completed, sync related todos/reminders
        if (req.body.status === 'Completed') {
            await taskSyncService.handleTaskCompleted(taskId);
        }

        // If end_date changed and task not completed, resync reminders
        if (req.body.end_date && req.body.status !== 'Completed') {
            const [t] = await pool.query('SELECT * FROM tasks WHERE id = ?', [taskId]);
            if (t.length > 0 && t[0].status !== 'Completed' && t[0].status !== 'Cancelled') {
                await pool.query(
                    'DELETE FROM reminders WHERE user_id = ? AND title LIKE ? AND is_completed = FALSE',
                    [t[0].user_id, `[Task #${taskId}]%`]
                );
                await taskSyncService.syncNewTask(taskId);
            }
        }

        // Fetch updated task
        const [updatedTask] = await pool.query('SELECT * FROM tasks WHERE id = ?', [taskId]);

        res.json({
            success: true,
            message: 'Task updated successfully',
            data: updatedTask[0]
        });
    } catch (error) {
        console.error('Update task error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update task'
        });
    }
});

// Delete task
router.delete('/:id', verifyToken, addUserFilter, async (req, res) => {
    try {
        const taskId = req.params.id;

        // Clean up reminders and todos before deleting task
        const [taskToDelete] = await pool.query('SELECT user_id FROM tasks WHERE id = ?', [taskId]);
        if (taskToDelete.length > 0) {
            await taskSyncService.deleteTaskReminders(taskId, taskToDelete[0].user_id);
        }

        let deleteQuery = 'DELETE FROM tasks WHERE id = ?';
        const params = [taskId];

        if (req.userFilter) {
            deleteQuery += ' AND user_id = ?';
            params.push(req.userFilter.user_id);
        }

        const [result] = await pool.query(deleteQuery, params);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Task not found'
            });
        }

        res.json({
            success: true,
            message: 'Task deleted successfully'
        });
    } catch (error) {
        console.error('Delete task error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete task'
        });
    }
});

// Get task statistics
router.get('/stats/summary', verifyToken, addUserFilter, async (req, res) => {
    try {
        let whereClause = '';
        const params = [];

        if (req.userFilter) {
            whereClause = 'WHERE user_id = ?';
            params.push(req.userFilter.user_id);
        }

        const [stats] = await pool.query(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END) as in_progress,
                SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN priority = 'P0' THEN 1 ELSE 0 END) as priority_p0,
                SUM(CASE WHEN priority = 'P1' THEN 1 ELSE 0 END) as priority_p1
            FROM tasks ${whereClause}
        `, params);

        // Overdue count
        const [overdueResult] = await pool.query(
            `SELECT COUNT(*) as overdue FROM tasks
             WHERE end_date < CURDATE() AND status NOT IN ('Completed', 'Cancelled')
             ${req.userFilter ? 'AND user_id = ?' : ''}`,
            req.userFilter ? [req.userFilter.user_id] : []
        );

        // Completion rate
        const completionRate = stats[0].total > 0
            ? Math.round((stats[0].completed / stats[0].total) * 100)
            : 0;

        // Trends: activity-based last 7 days
        const [trendsResult] = await pool.query(
            `SELECT
                SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as created_last_7d,
                SUM(CASE WHEN status = 'Completed' AND updated_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as completed_last_7d,
                SUM(CASE WHEN status = 'In Progress' AND updated_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as started_last_7d,
                SUM(CASE WHEN end_date < CURDATE() AND end_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
                    AND status NOT IN ('Completed', 'Cancelled') THEN 1 ELSE 0 END) as became_overdue_last_7d
             FROM tasks
             ${req.userFilter ? 'WHERE user_id = ?' : ''}`,
            req.userFilter ? [req.userFilter.user_id] : []
        );
        const trends7d = trendsResult[0] || {};

        // Streak: consecutive days with ≥1 task completed
        const [streakResult] = await pool.query(
            `SELECT DATE(updated_at) as d FROM tasks
             WHERE status = 'Completed'
             ${req.userFilter ? 'AND user_id = ?' : ''}
             GROUP BY DATE(updated_at)
             ORDER BY d DESC`,
            req.userFilter ? [req.userFilter.user_id] : []
        );
        let streakDays = 0;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (const row of streakResult) {
            const d = new Date(row.d);
            d.setHours(0, 0, 0, 0);
            const expectedDate = new Date(today);
            expectedDate.setDate(expectedDate.getDate() - streakDays);
            if (d.getTime() === expectedDate.getTime()) {
                streakDays++;
            } else {
                break;
            }
        }

        res.json({
            success: true,
            data: {
                ...stats[0],
                overdue: overdueResult[0]?.overdue || 0,
                completion_rate: completionRate,
                trends: {
                    total_change: Number(trends7d.created_last_7d) || 0,
                    completed_change: Number(trends7d.completed_last_7d) || 0,
                    in_progress_change: Number(trends7d.started_last_7d) || 0,
                    overdue_change: Number(trends7d.became_overdue_last_7d) || 0,
                },
                streak_days: streakDays,
            }
        });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch statistics'
        });
    }
});

// Get per-user statistics (admin only)
router.get('/stats/by-user', verifyToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Admin access required'
            });
        }

        const [userStats] = await pool.query(`
            SELECT 
                u.id AS user_id,
                u.username,
                COUNT(t.id) AS total_tasks,
                SUM(CASE WHEN t.status = 'Completed' THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN t.status = 'In Progress' THEN 1 ELSE 0 END) AS in_progress,
                SUM(CASE WHEN t.status = 'Pending' THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN t.priority IN ('P0', 'P1') THEN 1 ELSE 0 END) AS high_priority_count,
                (SELECT COUNT(*) FROM todos WHERE todos.user_id = u.id AND todos.is_completed = 0) AS pending_todos,
                (SELECT COUNT(*) FROM reminders WHERE reminders.user_id = u.id AND reminders.is_completed = 0 AND reminders.is_active = 1) AS active_reminders,
                (SELECT COUNT(*) FROM notes WHERE notes.user_id = u.id) AS total_notes
            FROM users u
            LEFT JOIN tasks t ON u.id = t.user_id
            GROUP BY u.id, u.username
            ORDER BY u.username
        `);

        res.json({
            success: true,
            data: userStats
        });
    } catch (error) {
        console.error('Get user stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch user statistics'
        });
    }
});

// Get heatmap data (task activity per day, counting all days between start_date and end_date)
router.get('/stats/heatmap', verifyToken, addUserFilter, async (req, res) => {
    try {
        const months = Math.min(Math.max(parseInt(req.query.months) || 6, 1), 24);
        const cutoffDate = new Date();
        cutoffDate.setMonth(cutoffDate.getMonth() - months);
        const cutoffStr = cutoffDate.toISOString().slice(0, 10);
        let taskFilter = `WHERE start_date IS NOT NULL AND end_date IS NOT NULL AND end_date >= ? AND DATEDIFF(end_date, start_date) <= 365`;
        const params = [cutoffStr];

        if (req.userFilter) {
            taskFilter += ' AND user_id = ?';
            params.push(req.userFilter.user_id);
        }

        const [rows] = await pool.query(`
            WITH RECURSIVE task_days AS (
                SELECT id, DATE(start_date) AS d, DATE(end_date) AS end_d
                FROM tasks
                ${taskFilter}
                UNION ALL
                SELECT id, DATE_ADD(d, INTERVAL 1 DAY), end_d
                FROM task_days
                WHERE d < end_d
            )
            SELECT d AS date, COUNT(*) AS count
            FROM task_days
            WHERE d >= ?
            GROUP BY d
            ORDER BY d
        `, [...params, cutoffStr]);

        res.json({
            success: true,
            data: rows
        });
    } catch (error) {
        console.error('Get heatmap data error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch heatmap data'
        });
    }
});

module.exports = router;
