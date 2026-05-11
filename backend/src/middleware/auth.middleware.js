const jwt = require('jsonwebtoken');
const pool = require('../config/database');

// Paths a user with must_change_password=TRUE is still allowed to reach.
// Everything else is blocked until they change their password.
const PASSWORD_CHANGE_EXEMPT_PATHS = new Set([
    '/api/auth/me',
    '/api/auth/change-password',
    '/api/auth/logout',
]);

const verifyToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'Access token required'
            });
        }

        const token = authHeader.split(' ')[1];

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const [users] = await pool.query(
            'SELECT id, username, name, email, phone_number, tim, role, must_change_password FROM users WHERE id = ?',
            [decoded.userId]
        );

        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'User not found'
            });
        }

        req.user = users[0];

        if (req.user.must_change_password) {
            const path = req.originalUrl.split('?')[0];
            if (!PASSWORD_CHANGE_EXEMPT_PATHS.has(path)) {
                return res.status(403).json({
                    success: false,
                    message: 'Password change required before using this endpoint',
                    code: 'PASSWORD_CHANGE_REQUIRED'
                });
            }
        }

        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token expired',
                code: 'TOKEN_EXPIRED'
            });
        }
        return res.status(401).json({
            success: false,
            message: 'Invalid token'
        });
    }
};

// Check if user is admin
const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({
            success: false,
            message: 'Admin access required'
        });
    }
    next();
};

// Add user filter for queries (users see only their data, admin sees all)
const addUserFilter = (req, res, next) => {
    if (req.user.role === 'admin') {
        // Admin can see all data, optionally filter by user_id query param
        if (req.query.user_id) {
            const uid = parseInt(req.query.user_id);
            if (!uid || uid <= 0) {
                return res.status(400).json({ success: false, message: 'Invalid user_id parameter' });
            }
            req.userFilter = { user_id: uid };
        } else {
            req.userFilter = null;
        }
    } else {
        // Regular users can only see their own data
        req.userFilter = { user_id: req.user.id };
    }
    next();
};

module.exports = {
    verifyToken,
    isAdmin,
    addUserFilter
};
