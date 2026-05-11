const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { verifyToken, isAdmin } = require('../middleware/auth.middleware');

const router = express.Router();

// Get all users (admin only)
router.get('/', verifyToken, isAdmin, async (req, res) => {
    try {
        const [users] = await pool.query(
            'SELECT id, username, name, email, phone_number, tim, role, created_at, updated_at FROM users ORDER BY created_at DESC'
        );

        res.json({
            success: true,
            data: users
        });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch users'
        });
    }
});

// Get single user (admin only)
router.get('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const [users] = await pool.query(
            'SELECT id, username, name, email, phone_number, tim, role, created_at, updated_at FROM users WHERE id = ?',
            [req.params.id]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            data: users[0]
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch user'
        });
    }
});

// Create user (admin only)
router.post('/', verifyToken, isAdmin, [
    body('username').trim().isLength({ min: 3 }),
    body('name').optional().trim().isLength({ min: 1 }),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
    body('role').isIn(['admin', 'user']),
    body('phone_number').optional().matches(/^[+]?[0-9]{10,15}$/),
    body('tim').notEmpty().isIn([
        'Tim Tata Usaha', 'Tim Binagram', 'Tim Keuangan', 'Tim Kepegawaian',
        'Tim IPDS', 'Tim NWAS', 'Tim Sosial', 'Tim Distribusi', 'Tim Produksi', 'Solo-ist'
    ])
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { username, name, email, password, role, phone_number, tim } = req.body;

        // Check if user exists
        const [existingUsers] = await pool.query(
            'SELECT id FROM users WHERE email = ? OR username = ?',
            [email, username]
        );

        if (existingUsers.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'User with this email or username already exists'
            });
        }

        // Hash password
        const salt = await bcrypt.genSalt(12);
        const password_hash = await bcrypt.hash(password, salt);

        const displayName = name || username;
        const [result] = await pool.query(
            'INSERT INTO users (username, name, email, phone_number, tim, password_hash, role) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [username, displayName, email, phone_number || null, tim, password_hash, role]
        );

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            data: {
                id: result.insertId,
                username,
                name: displayName,
                email,
                phone_number,
                tim,
                role
            }
        });
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create user'
        });
    }
});

// Update user (admin only)
router.put('/:id', verifyToken, isAdmin, [
    body('username').optional().trim().isLength({ min: 3 }),
    body('name').optional().trim().isLength({ min: 1 }),
    body('email').optional().isEmail().normalizeEmail(),
    body('role').optional().isIn(['admin', 'user']),
    body('phone_number').optional().matches(/^[+]?[0-9]{10,15}$/),
    body('tim').optional().isIn([
        'Tim Tata Usaha', 'Tim Binagram', 'Tim Keuangan', 'Tim Kepegawaian',
        'Tim IPDS', 'Tim NWAS', 'Tim Sosial', 'Tim Distribusi', 'Tim Produksi', 'Solo-ist'
    ])
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { username, name, email, role, phone_number, tim } = req.body;
        const userId = req.params.id;

        // Build update query dynamically
        const updates = [];
        const values = [];

        if (username) {
            updates.push('username = ?');
            values.push(username);
        }
        if (name !== undefined) {
            updates.push('name = ?');
            values.push(name);
        }
        if (email) {
            updates.push('email = ?');
            values.push(email);
        }
        if (role) {
            updates.push('role = ?');
            values.push(role);
        }
        if (phone_number !== undefined) {
            updates.push('phone_number = ?');
            values.push(phone_number || null);
        }
        if (tim) {
            updates.push('tim = ?');
            values.push(tim);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No fields to update'
            });
        }

        values.push(userId);

        await pool.query(
            `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
            values
        );

        res.json({
            success: true,
            message: 'User updated successfully'
        });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update user'
        });
    }
});

// Delete user (admin only)
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
    try {
        const userId = req.params.id;

        // Prevent deleting self
        if (parseInt(userId) === req.user.id) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete your own account'
            });
        }

        const [result] = await pool.query('DELETE FROM users WHERE id = ?', [userId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            message: 'User deleted successfully'
        });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete user'
        });
    }
});

// Reset user password (admin only)
router.post('/:id/reset-password', verifyToken, isAdmin, [
    body('newPassword').isLength({ min: 6 })
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { newPassword } = req.body;
        const userId = req.params.id;

        const salt = await bcrypt.genSalt(12);
        const password_hash = await bcrypt.hash(newPassword, salt);

        await pool.query(
            'UPDATE users SET password_hash = ?, must_change_password = TRUE WHERE id = ?',
            [password_hash, userId]
        );

        // Invalidate all refresh tokens for user
        await pool.query('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);

        res.json({
            success: true,
            message: 'Password reset successfully'
        });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to reset password'
        });
    }
});

module.exports = router;
