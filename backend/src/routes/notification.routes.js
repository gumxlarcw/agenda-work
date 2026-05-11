const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { verifyToken } = require('../middleware/auth.middleware');

// GET /api/notifications — get current user's notifications
router.get('/', verifyToken, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 30, 50);
    const unreadOnly = req.query.unread === '1';

    let query = `
      SELECT n.*, u.name as from_name, u.username as from_username
      FROM notifications n
      LEFT JOIN users u ON u.id = n.from_user_id
      WHERE n.user_id = ?
    `;
    const params = [req.user.id];

    if (unreadOnly) {
      query += ' AND n.is_read = 0';
    }

    query += ' ORDER BY n.created_at DESC LIMIT ?';
    params.push(limit);

    const [rows] = await pool.query(query, params);

    // Unread count
    const [countResult] = await pool.query(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
      [req.user.id]
    );

    res.json({
      success: true,
      data: rows,
      unread_count: countResult[0].count,
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
  }
});

// PATCH /api/notifications/read-all — mark all as read
router.patch('/read-all', verifyToken, async (req, res) => {
  try {
    await pool.query(
      'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
      [req.user.id]
    );
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({ success: false, message: 'Failed to mark notifications as read' });
  }
});

// PATCH /api/notifications/:id/read — mark one as read
router.patch('/:id/read', verifyToken, async (req, res) => {
  try {
    await pool.query(
      'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ success: false, message: 'Failed to mark notification as read' });
  }
});

module.exports = router;
