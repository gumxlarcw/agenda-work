const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { verifyToken } = require('../middleware/auth.middleware');

const router = express.Router();

// Get all tags with note count
router.get('/', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const [tags] = await pool.query(
            `SELECT t.*, COUNT(m.note_id) AS note_count
             FROM note_tags t
             LEFT JOIN note_tag_map m ON t.id = m.tag_id
             WHERE t.user_id = ?
             GROUP BY t.id
             ORDER BY t.name ASC`,
            [userId]
        );
        res.json({ success: true, data: tags });
    } catch (error) {
        console.error('Get tags error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch tags' });
    }
});

// Create tag
router.post('/', verifyToken, [
    body('name').trim().notEmpty().withMessage('Tag name is required'),
    body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Invalid color format')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { name, color } = req.body;
        const userId = req.user.id;

        const [result] = await pool.query(
            'INSERT INTO note_tags (user_id, name, color) VALUES (?, ?, ?)',
            [userId, name, color || '#6b7280']
        );

        const [newTag] = await pool.query('SELECT * FROM note_tags WHERE id = ?', [result.insertId]);
        res.status(201).json({ success: true, message: 'Tag created', data: newTag[0] });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: 'Tag already exists' });
        }
        console.error('Create tag error:', error);
        res.status(500).json({ success: false, message: 'Failed to create tag' });
    }
});

// Update tag
router.put('/:id', verifyToken, [
    body('name').optional().trim().notEmpty(),
    body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Invalid color format')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const tagId = req.params.id;
        const userId = req.user.id;

        const [existing] = await pool.query(
            'SELECT id FROM note_tags WHERE id = ? AND user_id = ?',
            [tagId, userId]
        );
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Tag not found' });
        }

        const updates = [];
        const values = [];

        if (req.body.name !== undefined) {
            updates.push('name = ?');
            values.push(req.body.name);
        }
        if (req.body.color !== undefined) {
            updates.push('color = ?');
            values.push(req.body.color);
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update' });
        }

        values.push(tagId, userId);
        await pool.query(`UPDATE note_tags SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`, values);

        const [updated] = await pool.query('SELECT * FROM note_tags WHERE id = ?', [tagId]);
        res.json({ success: true, message: 'Tag updated', data: updated[0] });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: 'Tag name already exists' });
        }
        console.error('Update tag error:', error);
        res.status(500).json({ success: false, message: 'Failed to update tag' });
    }
});

// Delete tag (CASCADE removes from note_tag_map)
router.delete('/:id', verifyToken, async (req, res) => {
    try {
        const tagId = req.params.id;
        const userId = req.user.id;

        const [result] = await pool.query(
            'DELETE FROM note_tags WHERE id = ? AND user_id = ?',
            [tagId, userId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Tag not found' });
        }

        res.json({ success: true, message: 'Tag deleted' });
    } catch (error) {
        console.error('Delete tag error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete tag' });
    }
});

module.exports = router;
