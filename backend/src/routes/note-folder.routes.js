const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { verifyToken, addUserFilter } = require('../middleware/auth.middleware');

const router = express.Router();

// Get all folders for current user (with progress)
router.get('/', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const [folders] = await pool.query(
            `SELECT f.*,
             (SELECT COUNT(*) FROM notes WHERE folder_id = f.id AND is_archived = 0) as note_count,
             (SELECT ROUND(AVG(progress), 1) FROM notes WHERE folder_id = f.id AND is_archived = 0 AND progress_total > 0) as folder_progress,
             (SELECT SUM(progress_total) FROM notes WHERE folder_id = f.id AND is_archived = 0) as total_items,
             (SELECT SUM(progress_done) FROM notes WHERE folder_id = f.id AND is_archived = 0) as done_items
             FROM note_folders f WHERE f.user_id = ? ORDER BY f.sort_order ASC, f.name ASC`,
            [userId]
        );
        res.json({ success: true, data: folders });
    } catch (error) {
        console.error('Get folders error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch folders' });
    }
});

// Create folder
router.post('/', verifyToken, [
    body('name').trim().notEmpty().withMessage('Folder name is required'),
    body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Invalid color format'),
    body('parent_id').optional().isInt()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { name, color, parent_id } = req.body;
        const userId = req.user.id;

        // Enforce max 2 levels: if parent has a parent, reject
        if (parent_id) {
            const [parent] = await pool.query(
                'SELECT parent_id FROM note_folders WHERE id = ? AND user_id = ?',
                [parent_id, userId]
            );
            if (parent.length === 0) {
                return res.status(404).json({ success: false, message: 'Parent folder not found' });
            }
            if (parent[0].parent_id !== null) {
                return res.status(400).json({ success: false, message: 'Maximum 2 folder levels allowed' });
            }
        }

        const [result] = await pool.query(
            'INSERT INTO note_folders (user_id, name, color, parent_id) VALUES (?, ?, ?, ?)',
            [userId, name, color || null, parent_id || null]
        );

        const [newFolder] = await pool.query('SELECT * FROM note_folders WHERE id = ?', [result.insertId]);
        res.status(201).json({ success: true, message: 'Folder created', data: newFolder[0] });
    } catch (error) {
        console.error('Create folder error:', error);
        res.status(500).json({ success: false, message: 'Failed to create folder' });
    }
});

// Update folder
router.put('/:id', verifyToken, [
    body('name').optional().trim().notEmpty(),
    body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Invalid color format'),
    body('parent_id').optional(),
    body('sort_order').optional().isInt()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const folderId = req.params.id;
        const userId = req.user.id;

        const [existing] = await pool.query(
            'SELECT id FROM note_folders WHERE id = ? AND user_id = ?',
            [folderId, userId]
        );
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Folder not found' });
        }

        // If changing parent, enforce max 2 levels and prevent self-reference
        if (req.body.parent_id !== undefined) {
            const parentId = req.body.parent_id;
            if (parentId) {
                // B6: Prevent folder from being its own parent
                if (String(parentId) === String(folderId)) {
                    return res.status(400).json({ success: false, message: 'A folder cannot be its own parent' });
                }
                const [parent] = await pool.query(
                    'SELECT parent_id FROM note_folders WHERE id = ? AND user_id = ?',
                    [parentId, userId]
                );
                if (parent.length === 0) {
                    return res.status(404).json({ success: false, message: 'Parent folder not found' });
                }
                if (parent[0].parent_id !== null) {
                    return res.status(400).json({ success: false, message: 'Maximum 2 folder levels allowed' });
                }
                // B6: Prevent circular reference (child becoming parent of its parent)
                if (String(parent[0].parent_id) === String(folderId)) {
                    return res.status(400).json({ success: false, message: 'Circular folder reference not allowed' });
                }
            }
        }

        const allowedFields = ['name', 'color', 'parent_id', 'sort_order'];
        const updates = [];
        const values = [];

        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updates.push(`${field} = ?`);
                values.push(req.body[field]);
            }
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update' });
        }

        values.push(folderId, userId);
        await pool.query(`UPDATE note_folders SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`, values);

        const [updated] = await pool.query('SELECT * FROM note_folders WHERE id = ?', [folderId]);
        res.json({ success: true, message: 'Folder updated', data: updated[0] });
    } catch (error) {
        console.error('Update folder error:', error);
        res.status(500).json({ success: false, message: 'Failed to update folder' });
    }
});

// Delete folder (notes move to root) — wrapped in transaction
router.delete('/:id', verifyToken, async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const folderId = req.params.id;
        const userId = req.user.id;

        await conn.beginTransaction();

        // Move notes to root first
        await conn.query(
            'UPDATE notes SET folder_id = NULL WHERE folder_id = ? AND user_id = ?',
            [folderId, userId]
        );

        // Also move notes from child folders
        const [children] = await conn.query(
            'SELECT id FROM note_folders WHERE parent_id = ? AND user_id = ?',
            [folderId, userId]
        );
        for (const child of children) {
            await conn.query(
                'UPDATE notes SET folder_id = NULL WHERE folder_id = ? AND user_id = ?',
                [child.id, userId]
            );
        }

        // Delete child folders first, then parent
        if (children.length > 0) {
            const childIds = children.map(c => c.id);
            await conn.query('DELETE FROM note_folders WHERE id IN (?) AND user_id = ?', [childIds, userId]);
        }

        const [result] = await conn.query(
            'DELETE FROM note_folders WHERE id = ? AND user_id = ?',
            [folderId, userId]
        );

        if (result.affectedRows === 0) {
            await conn.rollback();
            return res.status(404).json({ success: false, message: 'Folder not found' });
        }

        await conn.commit();
        res.json({ success: true, message: 'Folder deleted' });
    } catch (error) {
        await conn.rollback();
        console.error('Delete folder error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete folder' });
    } finally {
        conn.release();
    }
});

// ========================================
// Folder Sharing
// ========================================

// Get folders shared with me
router.get('/shared-with-me', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const [folders] = await pool.query(
            `SELECT f.*, fs.role, fs.shared_by_user_id,
             COALESCE(u.name, u.username) as owner_name,
             (SELECT COUNT(*) FROM notes WHERE folder_id = f.id) as note_count
             FROM note_folder_shares fs
             JOIN note_folders f ON fs.folder_id = f.id
             JOIN users u ON f.user_id = u.id
             WHERE fs.shared_with_user_id = ?
             ORDER BY f.name ASC`,
            [userId]
        );
        res.json({ success: true, data: folders });
    } catch (error) {
        console.error('Get shared folders error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch shared folders' });
    }
});

// Share folder with users
router.post('/:id/share', verifyToken, async (req, res) => {
    try {
        const folderId = req.params.id;
        const userId = req.user.id;
        const { user_ids, role = 'editor' } = req.body;

        if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
            return res.status(400).json({ success: false, message: 'user_ids required' });
        }

        // Verify ownership
        const [folder] = await pool.query(
            'SELECT id FROM note_folders WHERE id = ? AND user_id = ?',
            [folderId, userId]
        );
        if (folder.length === 0) {
            return res.status(404).json({ success: false, message: 'Folder not found' });
        }

        // Filter out self
        const validIds = user_ids.filter(id => id !== userId);

        // Upsert shares
        for (const uid of validIds) {
            await pool.query(
                `INSERT INTO note_folder_shares (folder_id, shared_with_user_id, role, shared_by_user_id)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE role = VALUES(role)`,
                [folderId, uid, role, userId]
            );
        }

        res.json({ success: true, message: `Folder shared with ${validIds.length} user(s)` });
    } catch (error) {
        console.error('Share folder error:', error);
        res.status(500).json({ success: false, message: 'Failed to share folder' });
    }
});

// Get users a folder is shared with
router.get('/:id/shares', verifyToken, async (req, res) => {
    try {
        const folderId = req.params.id;
        const userId = req.user.id;

        // Verify ownership
        const [folder] = await pool.query(
            'SELECT id FROM note_folders WHERE id = ? AND user_id = ?',
            [folderId, userId]
        );
        if (folder.length === 0) {
            return res.status(404).json({ success: false, message: 'Folder not found' });
        }

        const [shares] = await pool.query(
            `SELECT fs.id, fs.shared_with_user_id, fs.role, fs.created_at,
             COALESCE(u.name, u.username) as user_name, u.username
             FROM note_folder_shares fs
             JOIN users u ON fs.shared_with_user_id = u.id
             WHERE fs.folder_id = ?`,
            [folderId]
        );
        res.json({ success: true, data: shares });
    } catch (error) {
        console.error('Get folder shares error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch shares' });
    }
});

// Remove share for a specific user
router.delete('/:id/share/:userId', verifyToken, async (req, res) => {
    try {
        const folderId = req.params.id;
        const currentUserId = req.user.id;
        const targetUserId = req.params.userId;

        // Verify ownership
        const [folder] = await pool.query(
            'SELECT id FROM note_folders WHERE id = ? AND user_id = ?',
            [folderId, currentUserId]
        );
        if (folder.length === 0) {
            return res.status(404).json({ success: false, message: 'Folder not found' });
        }

        await pool.query(
            'DELETE FROM note_folder_shares WHERE folder_id = ? AND shared_with_user_id = ?',
            [folderId, targetUserId]
        );
        res.json({ success: true, message: 'Share removed' });
    } catch (error) {
        console.error('Remove folder share error:', error);
        res.status(500).json({ success: false, message: 'Failed to remove share' });
    }
});

module.exports = router;
