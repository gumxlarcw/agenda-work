const express = require('express');
const pool = require('../config/database');
const { verifyToken, isAdmin } = require('../middleware/auth.middleware');

const router = express.Router();

// Get user statistics - admin only
router.get('/', verifyToken, isAdmin, async (req, res) => {
    try {
        // Get per-user task statistics
        const [userStats] = await pool.query(`
            SELECT 
                u.id as user_id,
                u.username,
                u.email,
                u.phone_number,
                COALESCE(task_stats.total_tasks, 0) as total_tasks,
                COALESCE(task_stats.completed_tasks, 0) as completed_tasks,
                COALESCE(task_stats.pending_tasks, 0) as pending_tasks,
                COALESCE(task_stats.p0_tasks, 0) as high_priority_count,
                COALESCE(note_stats.total_notes, 0) as total_notes,
                COALESCE(todo_stats.total_todos, 0) as total_todos,
                COALESCE(todo_stats.completed_todos, 0) as completed_todos,
                COALESCE(reminder_stats.total_reminders, 0) as total_reminders,
                COALESCE(reminder_stats.pending_reminders, 0) as pending_reminders
            FROM users u
            LEFT JOIN (
                SELECT 
                    user_id,
                    COUNT(*) as total_tasks,
                    SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as completed_tasks,
                    SUM(CASE WHEN status != 'Completed' THEN 1 ELSE 0 END) as pending_tasks,
                    SUM(CASE WHEN priority IN ('P0', 'P1') THEN 1 ELSE 0 END) as p0_tasks
                FROM tasks
                GROUP BY user_id
            ) task_stats ON u.id = task_stats.user_id
            LEFT JOIN (
                SELECT user_id, COUNT(*) as total_notes
                FROM notes
                GROUP BY user_id
            ) note_stats ON u.id = note_stats.user_id
            LEFT JOIN (
                SELECT 
                    user_id,
                    COUNT(*) as total_todos,
                    SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END) as completed_todos
                FROM todos
                GROUP BY user_id
            ) todo_stats ON u.id = todo_stats.user_id
            LEFT JOIN (
                SELECT 
                    user_id,
                    COUNT(*) as total_reminders,
                    SUM(CASE WHEN is_completed = 0 AND reminder_datetime > NOW() THEN 1 ELSE 0 END) as pending_reminders
                FROM reminders
                GROUP BY user_id
            ) reminder_stats ON u.id = reminder_stats.user_id
            ORDER BY u.id
        `);

        // Get overall summary
        const [overallStats] = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM users) as total_users,
                (SELECT COUNT(*) FROM tasks) as total_tasks,
                (SELECT COUNT(*) FROM tasks WHERE status = 'Completed') as completed_tasks,
                (SELECT COUNT(*) FROM tasks WHERE status != 'Completed' AND status != 'Cancelled') as active_tasks,
                (SELECT COUNT(*) FROM tasks WHERE priority IN ('P0', 'P1')) as high_priority_tasks,
                (SELECT COUNT(*) FROM notes) as total_notes,
                (SELECT COUNT(*) FROM todos) as total_todos,
                (SELECT COUNT(*) FROM todos WHERE is_completed = 1) as completed_todos,
                (SELECT COUNT(*) FROM reminders) as total_reminders,
                (SELECT COUNT(*) FROM reminders WHERE is_sent = 1) as sent_reminders
        `);

        res.json({
            success: true,
            data: {
                overall: overallStats[0],
                users: userStats
            }
        });

    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get statistics'
        });
    }
});

module.exports = router;
