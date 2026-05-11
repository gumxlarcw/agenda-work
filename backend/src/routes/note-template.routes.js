const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { verifyToken } = require('../middleware/auth.middleware');

const router = express.Router();

// Get all templates (system + user's own)
router.get('/', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const [templates] = await pool.query(
            `SELECT * FROM note_templates
             WHERE is_system = 1 OR user_id = ?
             ORDER BY is_system DESC, name ASC`,
            [userId]
        );
        res.json({ success: true, data: templates });
    } catch (error) {
        console.error('Get templates error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch templates' });
    }
});

// Create user template
router.post('/', verifyToken, [
    body('name').trim().notEmpty().withMessage('Template name is required'),
    body('description').optional().trim(),
    body('content_json').notEmpty().withMessage('Template content is required'),
    body('category').optional().trim()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { name, description, content_json, category } = req.body;
        const userId = req.user.id;

        const contentStr = typeof content_json === 'string' ? content_json : JSON.stringify(content_json);

        const [result] = await pool.query(
            'INSERT INTO note_templates (user_id, name, description, content_json, category, is_system) VALUES (?, ?, ?, ?, ?, 0)',
            [userId, name, description || null, contentStr, category || null]
        );

        const [newTemplate] = await pool.query('SELECT * FROM note_templates WHERE id = ?', [result.insertId]);
        res.status(201).json({ success: true, message: 'Template created', data: newTemplate[0] });
    } catch (error) {
        console.error('Create template error:', error);
        res.status(500).json({ success: false, message: 'Failed to create template' });
    }
});

// B11: Update user template (cannot update system templates)
router.put('/:id', verifyToken, [
    body('name').optional().trim().notEmpty().withMessage('Template name cannot be empty'),
    body('description').optional().trim(),
    body('content_json').optional(),
    body('category').optional().trim()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const templateId = req.params.id;
        const userId = req.user.id;

        const [template] = await pool.query('SELECT is_system, user_id FROM note_templates WHERE id = ?', [templateId]);
        if (template.length === 0) {
            return res.status(404).json({ success: false, message: 'Template not found' });
        }
        if (template[0].is_system) {
            return res.status(403).json({ success: false, message: 'Cannot edit system templates' });
        }
        if (template[0].user_id !== userId) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        const allowedFields = ['name', 'description', 'category'];
        const updates = [];
        const values = [];

        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updates.push(`${field} = ?`);
                values.push(req.body[field]);
            }
        }
        if (req.body.content_json !== undefined) {
            updates.push('content_json = ?');
            const contentStr = typeof req.body.content_json === 'string' ? req.body.content_json : JSON.stringify(req.body.content_json);
            values.push(contentStr);
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update' });
        }

        values.push(templateId);
        await pool.query(`UPDATE note_templates SET ${updates.join(', ')} WHERE id = ?`, values);

        const [updated] = await pool.query('SELECT * FROM note_templates WHERE id = ?', [templateId]);
        res.json({ success: true, message: 'Template updated', data: updated[0] });
    } catch (error) {
        console.error('Update template error:', error);
        res.status(500).json({ success: false, message: 'Failed to update template' });
    }
});

// Delete user template (cannot delete system templates)
router.delete('/:id', verifyToken, async (req, res) => {
    try {
        const templateId = req.params.id;
        const userId = req.user.id;

        // Check if system template
        const [template] = await pool.query('SELECT is_system, user_id FROM note_templates WHERE id = ?', [templateId]);
        if (template.length === 0) {
            return res.status(404).json({ success: false, message: 'Template not found' });
        }
        if (template[0].is_system) {
            return res.status(403).json({ success: false, message: 'Cannot delete system templates' });
        }
        if (template[0].user_id !== userId) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        await pool.query('DELETE FROM note_templates WHERE id = ?', [templateId]);
        res.json({ success: true, message: 'Template deleted' });
    } catch (error) {
        console.error('Delete template error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete template' });
    }
});

module.exports = router;
