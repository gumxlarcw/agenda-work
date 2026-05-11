const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { verifyToken, addUserFilter } = require('../middleware/auth.middleware');

const router = express.Router();

const VALID_PRIORITIES = ['Low', 'Medium', 'High'];

// Get all todos
router.get('/', verifyToken, addUserFilter, async (req, res) => {
    try {
        // Admin gets all todos with username, users get only their todos
        let query_sql = req.user.role === 'admin' && !req.userFilter
            ? 'SELECT t.*, u.username FROM todos t JOIN users u ON t.user_id = u.id'
            : 'SELECT * FROM todos';
        const params = [];
        const conditions = [];

        if (req.userFilter) {
            conditions.push('user_id = ?');
            params.push(req.userFilter.user_id);
        }

        // Filter by completion status
        if (req.query.completed === 'true') {
            conditions.push('is_completed = TRUE');
        } else if (req.query.completed === 'false') {
            conditions.push('is_completed = FALSE');
        }

        if (conditions.length > 0) {
            query_sql += ' WHERE ' + conditions.join(' AND ');
        }

        // Adjust ORDER BY for joined query
        const orderBy = req.user.role === 'admin' && !req.userFilter
            ? ' ORDER BY t.is_completed ASC, FIELD(t.priority, "High", "Medium", "Low"), t.due_date ASC'
            : ' ORDER BY is_completed ASC, FIELD(priority, "High", "Medium", "Low"), due_date ASC';

        // #13: page/limit pagination. 500 remains the hard per-page ceiling.
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 500);
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const offset = (page - 1) * limit;
        query_sql += orderBy + ' LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const [todos] = await pool.query(query_sql, params);

        res.json({
            success: true,
            data: todos,
            pagination: { page, limit }
        });
    } catch (error) {
        console.error('Get todos error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch todos'
        });
    }
});

// Get single todo
router.get('/:id', verifyToken, addUserFilter, async (req, res) => {
    try {
        let query_sql = 'SELECT * FROM todos WHERE id = ?';
        const params = [req.params.id];

        if (req.userFilter) {
            query_sql += ' AND user_id = ?';
            params.push(req.userFilter.user_id);
        }

        const [todos] = await pool.query(query_sql, params);

        if (todos.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Todo not found'
            });
        }

        res.json({
            success: true,
            data: todos[0]
        });
    } catch (error) {
        console.error('Get todo error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch todo'
        });
    }
});

// Create todo
router.post('/', verifyToken, [
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('description').optional().trim(),
    body('priority').optional().isIn(VALID_PRIORITIES),
    body('due_date').optional().isISO8601().toDate(),
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

        const { title, description, priority, due_date, is_completed } = req.body;
        const userId = req.user.role === 'admin' && req.body.user_id 
            ? req.body.user_id 
            : req.user.id;

        const [result] = await pool.query(
            'INSERT INTO todos (user_id, title, description, priority, due_date, is_completed) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, title, description || null, priority || 'Medium', due_date || null, is_completed || false]
        );

        const [newTodo] = await pool.query('SELECT * FROM todos WHERE id = ?', [result.insertId]);

        res.status(201).json({
            success: true,
            message: 'Todo created successfully',
            data: newTodo[0]
        });
    } catch (error) {
        console.error('Create todo error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create todo'
        });
    }
});

// Update todo
router.put('/:id', verifyToken, addUserFilter, [
    body('title').optional().trim().notEmpty(),
    body('description').optional().trim(),
    body('priority').optional().isIn(VALID_PRIORITIES),
    body('due_date').optional().isISO8601().toDate(),
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

        const todoId = req.params.id;

        // Check ownership
        let checkQuery = 'SELECT id FROM todos WHERE id = ?';
        const checkParams = [todoId];
        if (req.userFilter) {
            checkQuery += ' AND user_id = ?';
            checkParams.push(req.userFilter.user_id);
        }

        const [existing] = await pool.query(checkQuery, checkParams);
        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Todo not found'
            });
        }

        const allowedFields = ['title', 'description', 'priority', 'due_date', 'is_completed'];
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

        values.push(todoId);
        await pool.query(`UPDATE todos SET ${updates.join(', ')} WHERE id = ?`, values);

        const [updatedTodo] = await pool.query('SELECT * FROM todos WHERE id = ?', [todoId]);

        res.json({
            success: true,
            message: 'Todo updated successfully',
            data: updatedTodo[0]
        });
    } catch (error) {
        console.error('Update todo error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update todo'
        });
    }
});

// Toggle todo completion
router.patch('/:id/toggle', verifyToken, addUserFilter, async (req, res) => {
    try {
        const todoId = req.params.id;

        // Get current state
        let selectQuery = 'SELECT is_completed FROM todos WHERE id = ?';
        const selectParams = [todoId];
        if (req.userFilter) {
            selectQuery += ' AND user_id = ?';
            selectParams.push(req.userFilter.user_id);
        }

        const [todos] = await pool.query(selectQuery, selectParams);

        if (todos.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Todo not found'
            });
        }

        const newState = !todos[0].is_completed;
        await pool.query('UPDATE todos SET is_completed = ? WHERE id = ?', [newState, todoId]);

        res.json({
            success: true,
            message: `Todo marked as ${newState ? 'completed' : 'incomplete'}`,
            data: { is_completed: newState }
        });
    } catch (error) {
        console.error('Toggle todo error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to toggle todo'
        });
    }
});

// Delete todo
router.delete('/:id', verifyToken, addUserFilter, async (req, res) => {
    try {
        const todoId = req.params.id;

        let deleteQuery = 'DELETE FROM todos WHERE id = ?';
        const params = [todoId];

        if (req.userFilter) {
            deleteQuery += ' AND user_id = ?';
            params.push(req.userFilter.user_id);
        }

        const [result] = await pool.query(deleteQuery, params);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'Todo not found'
            });
        }

        res.json({
            success: true,
            message: 'Todo deleted successfully'
        });
    } catch (error) {
        console.error('Delete todo error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete todo'
        });
    }
});

// Delete all completed todos
router.delete('/completed/all', verifyToken, addUserFilter, async (req, res) => {
    try {
        let deleteQuery = 'DELETE FROM todos WHERE is_completed = TRUE';
        const params = [];

        if (req.userFilter) {
            deleteQuery += ' AND user_id = ?';
            params.push(req.userFilter.user_id);
        }

        const [result] = await pool.query(deleteQuery, params);

        res.json({
            success: true,
            message: `${result.affectedRows} completed todos deleted`
        });
    } catch (error) {
        console.error('Delete completed todos error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete completed todos'
        });
    }
});

module.exports = router;
