const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { verifyToken } = require('../middleware/auth.middleware');

const router = express.Router();

// Dummy bcrypt hash used to keep login response time constant when the email
// doesn't exist — prevents timing-based user enumeration.
const DUMMY_HASH = '$2a$12$CwTycUXWue0Thq9StjUM0uJ8.b4E8Zv9F6iZ5m3vXJmR8VQxvXG4e';

const generateTokens = (userId) => {
    const accessToken = jwt.sign(
        { userId },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );

    const refreshToken = jwt.sign(
        { userId },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
    );

    return { accessToken, refreshToken };
};

// Issue a new refresh token and invalidate any existing ones for this user.
// Rotation prevents old tokens from accumulating and limits blast radius if
// one leaks.
const rotateRefreshToken = async (userId, refreshToken) => {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);
    await pool.query(
        'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
        [userId, refreshToken, expiresAt]
    );
};

const normalizeLoginEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

// Register — gated behind PUBLIC_REGISTRATION_ENABLED. When disabled, accounts
// must be created by an admin via /api/users (admin-only route).
router.post('/register', [
    body('username').trim().isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
    body('name').optional().trim().isLength({ min: 1 }).withMessage('Name cannot be empty'),
    body('email').isEmail().withMessage('Valid email required').customSanitizer(normalizeLoginEmail),
    body('password').isLength({ min: 10 }).withMessage('Password must be at least 10 characters'),
    body('phone_number').matches(/^[+]?[0-9]{10,15}$/).withMessage('Valid phone number required (10–15 digits, optional leading +)'),
    body('tim').notEmpty().withMessage('Tim is required').isIn([
        'Tim Tata Usaha', 'Tim Binagram', 'Tim Keuangan', 'Tim Kepegawaian',
        'Tim IPDS', 'Tim NWAS', 'Tim Sosial', 'Tim Distribusi', 'Tim Produksi', 'Solo-ist'
    ]).withMessage('Invalid tim value')
], async (req, res) => {
    if (process.env.PUBLIC_REGISTRATION_ENABLED !== 'true') {
        return res.status(403).json({
            success: false,
            message: 'Public registration is disabled. Please contact an administrator.'
        });
    }

    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { username, name, email, password, phone_number, tim } = req.body;
        const displayName = name || username;

        const [existingUsers] = await pool.query(
            'SELECT id FROM users WHERE email = ? OR username = ? OR phone_number = ?',
            [email, username, phone_number]
        );

        if (existingUsers.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'User with this email, username, or phone number already exists'
            });
        }

        const salt = await bcrypt.genSalt(12);
        const password_hash = await bcrypt.hash(password, salt);

        const [result] = await pool.query(
            'INSERT INTO users (username, name, email, phone_number, tim, password_hash, role) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [username, displayName, email, phone_number, tim, password_hash, 'user']
        );

        const { accessToken, refreshToken } = generateTokens(result.insertId);
        await rotateRefreshToken(result.insertId, refreshToken);

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            data: {
                user: {
                    id: result.insertId,
                    username,
                    name: displayName,
                    email,
                    phone_number,
                    tim,
                    role: 'user'
                },
                accessToken,
                refreshToken
            }
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({
            success: false,
            message: 'Registration failed'
        });
    }
});

// Login
router.post('/login', [
    body('email').isEmail().withMessage('Valid email required').customSanitizer(normalizeLoginEmail),
    body('password').notEmpty()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { email, password } = req.body;

        const [users] = await pool.query(
            'SELECT id, username, name, email, phone_number, tim, password_hash, role, must_change_password FROM users WHERE email = ?',
            [email]
        );

        const user = users[0];
        // Always run bcrypt.compare — against the real hash if the user exists,
        // otherwise against a dummy hash — so response time does not reveal
        // whether an account with this email is registered.
        const hashToCheck = user ? user.password_hash : DUMMY_HASH;
        const isMatch = await bcrypt.compare(password, hashToCheck);

        if (!user || !isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        const { accessToken, refreshToken } = generateTokens(user.id);
        await rotateRefreshToken(user.id, refreshToken);

        res.json({
            success: true,
            message: 'Login successful',
            data: {
                user: {
                    id: user.id,
                    username: user.username,
                    name: user.name,
                    email: user.email,
                    phone_number: user.phone_number,
                    tim: user.tim,
                    role: user.role,
                    must_change_password: user.must_change_password
                },
                accessToken,
                refreshToken
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Login failed'
        });
    }
});

// Refresh token
router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({
                success: false,
                message: 'Refresh token required'
            });
        }

        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

        // Atomic claim: DELETE the token and check affectedRows so that
        // concurrent refreshes cannot both succeed with the same token.
        const [deleteResult] = await pool.query(
            'DELETE FROM refresh_tokens WHERE token = ? AND user_id = ? AND expires_at > NOW()',
            [refreshToken, decoded.userId]
        );

        if (deleteResult.affectedRows === 0) {
            return res.status(401).json({
                success: false,
                message: 'Invalid refresh token'
            });
        }

        // Confirm the user still exists — a deleted account's refresh tokens
        // must not be able to mint new access tokens.
        const [users] = await pool.query('SELECT id FROM users WHERE id = ?', [decoded.userId]);
        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Invalid refresh token'
            });
        }

        const newTokens = generateTokens(decoded.userId);

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);
        await pool.query(
            'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
            [decoded.userId, newTokens.refreshToken, expiresAt]
        );

        res.json({
            success: true,
            data: {
                accessToken: newTokens.accessToken,
                refreshToken: newTokens.refreshToken
            }
        });
    } catch (error) {
        console.error('Refresh error:', error);
        res.status(401).json({
            success: false,
            message: 'Invalid refresh token'
        });
    }
});

// Logout — intentionally unauthenticated. An expired access token should not
// prevent a client from invalidating its refresh token server-side.
router.post('/logout', async (req, res) => {
    try {
        const { refreshToken } = req.body;

        if (refreshToken) {
            await pool.query('DELETE FROM refresh_tokens WHERE token = ?', [refreshToken]);
        }

        res.json({
            success: true,
            message: 'Logged out successfully'
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({
            success: false,
            message: 'Logout failed'
        });
    }
});

// Get current user
router.get('/me', verifyToken, async (req, res) => {
    res.json({
        success: true,
        data: {
            user: req.user
        }
    });
});

// Change password
router.post('/change-password', verifyToken, [
    body('currentPassword').notEmpty(),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { currentPassword, newPassword } = req.body;

        // Get user with password
        const [users] = await pool.query(
            'SELECT password_hash FROM users WHERE id = ?',
            [req.user.id]
        );

        // Verify current password
        const isMatch = await bcrypt.compare(currentPassword, users[0].password_hash);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Current password is incorrect'
            });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(12);
        const password_hash = await bcrypt.hash(newPassword, salt);

        // Update password
        await pool.query(
            'UPDATE users SET password_hash = ?, must_change_password = FALSE WHERE id = ?',
            [password_hash, req.user.id]
        );

        res.json({
            success: true,
            message: 'Password changed successfully'
        });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to change password'
        });
    }
});

// Update profile (name, phone number)
router.put('/update-profile', verifyToken, [
    body('phone_number').optional().matches(/^[+]?[0-9]{10,15}$/).withMessage('Valid phone number required'),
    body('name').optional().trim().isLength({ min: 1 }).withMessage('Name cannot be empty')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { phone_number, name } = req.body;

        // Build dynamic update
        const updates = [];
        const params = [];
        if (phone_number !== undefined) { updates.push('phone_number = ?'); params.push(phone_number); }
        if (name !== undefined) { updates.push('name = ?'); params.push(name); }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update' });
        }

        params.push(req.user.id);
        await pool.query(
            `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        const [users] = await pool.query(
            'SELECT id, username, name, email, phone_number, tim, role, must_change_password FROM users WHERE id = ?',
            [req.user.id]
        );

        res.json({
            success: true,
            message: 'Profile updated successfully',
            data: { user: users[0] }
        });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ success: false, message: 'Failed to update profile' });
    }
});

module.exports = router;
