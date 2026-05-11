const express = require('express');
const axios = require('axios');
const { body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { verifyToken, addUserFilter } = require('../middleware/auth.middleware');
const { getRecentActivity, logNoteActivity } = require('../services/notes/activityLog.service');
const { diffStatusCells } = require('../services/notes/statusDiff.service');
const crypto = require('crypto');

const router = express.Router();

// Helper: extract plain text from TipTap/ProseMirror JSON
function extractPlainText(json) {
    if (!json) return '';
    const walk = (node) => {
        if (node.text) return node.text;
        if (node.content) return node.content.map(walk).join('\n');
        return '';
    };
    return walk(json).trim();
}

// B3: Safe JSON parse helper
function safeParseJson(input) {
    if (!input) return null;
    if (typeof input !== 'string') return input;
    try {
        return JSON.parse(input);
    } catch (e) {
        return null;
    }
}

// B5: Validate tag_ids belong to user
async function validateTagOwnership(tagIds, userId) {
    if (!Array.isArray(tagIds) || tagIds.length === 0) {
        return { valid: [], invalid: [] };
    }
    const sanitized = tagIds.map(id => parseInt(id, 10)).filter(id => Number.isInteger(id) && id > 0);
    if (sanitized.length === 0) {
        return { valid: [], invalid: tagIds };
    }
    const [rows] = await pool.query(
        'SELECT id FROM note_tags WHERE id IN (?) AND user_id = ?',
        [sanitized, userId]
    );
    const validIds = new Set(rows.map(r => r.id));
    const valid   = sanitized.filter(id => validIds.has(id));
    const invalid = sanitized.filter(id => !validIds.has(id));
    return { valid, invalid };
}

// B7: Strip FULLTEXT boolean mode special characters from user input
function sanitizeSearchTerm(term) {
    // Remove all boolean mode operators to prevent parse errors
    return term.replace(/[+\-<>~*"@()]/g, '').trim();
}

// GET /api/notes/shareable-users — list users for ShareModal (excludes self)
router.get('/shareable-users', verifyToken, async (req, res) => {
    try {
        const [users] = await pool.query(
            `SELECT id, username, COALESCE(name, username) AS name
             FROM users
             WHERE id != ?
             ORDER BY COALESCE(name, username) ASC`,
            [req.user.id]
        );
        res.json({ success: true, data: users });
    } catch (error) {
        console.error('Get shareable users error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch users' });
    }
});

// GET /api/notes/counts — sidebar filter counts
router.get('/counts', verifyToken, addUserFilter, async (req, res) => {
    try {
        const targetUserId = req.userFilter?.user_id || req.user.id;
        const [[all]]      = await pool.query('SELECT COUNT(*) AS c FROM notes WHERE user_id = ? AND is_archived = 0', [targetUserId]);
        const [[mine]]     = await pool.query('SELECT COUNT(*) AS c FROM notes WHERE user_id = ? AND is_archived = 0', [targetUserId]);
        const [[pinned]]   = await pool.query('SELECT COUNT(*) AS c FROM notes WHERE user_id = ? AND is_archived = 0 AND is_pinned = 1', [targetUserId]);
        const [[archived]] = await pool.query('SELECT COUNT(*) AS c FROM notes WHERE user_id = ? AND is_archived = 1', [targetUserId]);
        const [[shared]]   = await pool.query(
            `SELECT COUNT(*) AS c FROM notes
             WHERE is_archived = 0 AND user_id != ? AND JSON_CONTAINS(shared_with, JSON_ARRAY(?))`,
            [targetUserId, targetUserId]
        );
        res.json({
            success: true,
            data: { all: all.c, mine: mine.c, pinned: pinned.c, archived: archived.c, shared: shared.c },
        });
    } catch (error) {
        console.error('Get note counts error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch counts' });
    }
});

// GET /api/notes/recent — dashboard preview
router.get('/recent', verifyToken, addUserFilter, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 3, 10);
        const userFilter = req.userFilter;
        const userClause = userFilter ? 'AND n.user_id = ?' : '';
        const userParam = userFilter ? [userFilter.user_id] : [];

        const [notes] = await pool.query(
            `SELECT n.id, n.title, SUBSTRING(n.content, 1, 100) as plain_text_preview,
             n.updated_at, n.color, nf.name as folder_name
             FROM notes n
             LEFT JOIN note_folders nf ON n.folder_id = nf.id
             WHERE n.is_archived = 0 ${userClause}
             ORDER BY n.updated_at DESC
             LIMIT ?`,
            [...userParam, limit]
        );

        res.json({ success: true, data: notes });
    } catch (error) {
        console.error('Recent notes error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch recent notes' });
    }
});

// Get all notes (with pagination + date filter + search + folder + tag + archive + shared)
router.get('/', verifyToken, addUserFilter, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 10, 100);
        const offset = (page - 1) * limit;
        const { date_from, date_to, search, folder_id, tag_id, is_archived, shared_with_me, shared, is_pinned } = req.query;
        const wantShared = shared === '1' || shared === 'true' || shared_with_me === '1' || shared_with_me === 'true';

        const isAdminView = req.user.role === 'admin' && !req.userFilter;
        const prefix = isAdminView ? 'n.' : '';

        const needTagJoin = !!tag_id;

        let query_sql = isAdminView
            ? 'SELECT n.*, u.username FROM notes n JOIN users u ON n.user_id = u.id'
            : 'SELECT n.* FROM notes n';
        let count_sql = isAdminView
            ? 'SELECT COUNT(*) as total FROM notes n JOIN users u ON n.user_id = u.id'
            : 'SELECT COUNT(*) as total FROM notes n';

        if (needTagJoin) {
            const tagJoin = ' JOIN note_tag_map ntm ON n.id = ntm.note_id';
            query_sql += tagJoin;
            count_sql += tagJoin;
        }

        const params = [];
        const countParams = [];
        const conditions = [];

        if (wantShared) {
            // "Shared with me": notes I do NOT own, where I'm in shared_with
            conditions.push(`${prefix}user_id != ? AND JSON_CONTAINS(${prefix}shared_with, JSON_ARRAY(?))`);
            params.push(req.user.id, req.user.id);
            countParams.push(req.user.id, req.user.id);
        } else if (req.userFilter) {
            // If browsing a folder that was shared with this user, drop the user_id
            // filter so notes owned by the folder owner show up.
            let folderSharedWithMe = false;
            if (folder_id) {
                const [shareCheck] = await pool.query(
                    'SELECT 1 FROM note_folder_shares WHERE folder_id = ? AND shared_with_user_id = ? LIMIT 1',
                    [parseInt(folder_id), req.userFilter.user_id]
                );
                folderSharedWithMe = shareCheck.length > 0;
            }
            if (!folderSharedWithMe) {
                conditions.push(`${prefix}user_id = ?`);
                params.push(req.userFilter.user_id);
                countParams.push(req.userFilter.user_id);
            }
        }

        if (is_pinned === '1' || is_pinned === 'true') {
            conditions.push(`${prefix}is_pinned = 1`);
        }

        if (is_archived === '1' || is_archived === 'true') {
            conditions.push(`${prefix}is_archived = 1`);
        } else {
            conditions.push(`${prefix}is_archived = 0`);
        }

        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (date_from) {
            if (!dateRegex.test(date_from)) {
                return res.status(400).json({ success: false, message: 'Invalid date_from format (YYYY-MM-DD)' });
            }
            conditions.push(`${prefix}created_at >= ?`);
            params.push(date_from + ' 00:00:00');
            countParams.push(date_from + ' 00:00:00');
        }

        if (date_to) {
            if (!dateRegex.test(date_to)) {
                return res.status(400).json({ success: false, message: 'Invalid date_to format (YYYY-MM-DD)' });
            }
            conditions.push(`${prefix}created_at <= ?`);
            params.push(date_to + ' 23:59:59');
            countParams.push(date_to + ' 23:59:59');
        }

        // B7: Sanitize FULLTEXT search input
        if (search && search.trim()) {
            const cleaned = sanitizeSearchTerm(search);
            if (cleaned.length > 0) {
                const searchTerm = cleaned + '*';
                conditions.push(`MATCH(${prefix}title, ${prefix}content) AGAINST(? IN BOOLEAN MODE)`);
                params.push(searchTerm);
                countParams.push(searchTerm);
            }
        }

        if (folder_id) {
            conditions.push(`${prefix}folder_id = ?`);
            params.push(parseInt(folder_id));
            countParams.push(parseInt(folder_id));
        }

        if (tag_id) {
            conditions.push(`ntm.tag_id = ?`);
            params.push(parseInt(tag_id));
            countParams.push(parseInt(tag_id));
        }

        if (conditions.length > 0) {
            const where = ' WHERE ' + conditions.join(' AND ');
            query_sql += where;
            count_sql += where;
        }

        query_sql += ` ORDER BY ${prefix}is_pinned DESC, ${prefix}sort_order ASC, ${prefix}updated_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const [[{ total }]] = await pool.query(count_sql, countParams);
        const [notes] = await pool.query(query_sql, params);

        res.json({
            success: true,
            data: notes,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Get notes error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch notes' });
    }
});

// Get single note (with tags, attachments, activity_log, editing_by_user, user_role)
router.get('/:id', verifyToken, addUserFilter, async (req, res) => {
    try {
        const noteId = req.params.id;
        const targetUserId = req.userFilter?.user_id || req.user.id;

        const [notes] = await pool.query(
            `SELECT n.*,
                    COALESCE(
                      (SELECT JSON_ARRAYAGG(JSON_OBJECT(
                               'id', t.id, 'user_id', t.user_id, 'name', t.name,
                               'color', t.color))
                       FROM note_tags t
                       JOIN note_tag_map m ON t.id = m.tag_id
                       WHERE m.note_id = n.id),
                      JSON_ARRAY()
                    ) AS tags_json,
                    COALESCE(
                      (SELECT JSON_ARRAYAGG(JSON_OBJECT(
                               'id', a.id, 'note_id', a.note_id, 'filename', a.filename,
                               'filepath', a.filepath, 'mimetype', a.mimetype,
                               'size_bytes', a.size_bytes, 'created_at', a.created_at))
                       FROM note_attachments a
                       WHERE a.note_id = n.id),
                      JSON_ARRAY()
                    ) AS attachments_json
             FROM notes n
             WHERE n.id = ? AND (
               n.user_id = ?
               OR JSON_CONTAINS(n.shared_with, JSON_ARRAY(?))
               OR EXISTS (
                 SELECT 1 FROM note_folder_shares fs
                 WHERE fs.folder_id = n.folder_id AND fs.shared_with_user_id = ?
               )
             )`,
            [noteId, targetUserId, targetUserId, targetUserId]
        );
        if (notes.length === 0) return res.status(404).json({ success: false, message: 'Note not found' });
        const note = notes[0];

        // tags_json and attachments_json may come back as already-parsed arrays (mysql2 auto-parses JSON)
        // or as JSON strings depending on driver version — handle both.
        const _parseMaybe = (v) => {
            if (Array.isArray(v)) return v;
            if (typeof v === 'string') { try { return JSON.parse(v) || []; } catch { return []; } }
            return [];
        };
        note.tags = _parseMaybe(note.tags_json);
        note.attachments = _parseMaybe(note.attachments_json);
        delete note.tags_json;
        delete note.attachments_json;
        note.activity_log = await getRecentActivity(noteId, 20);

        if (note.editing_by && note.editing_since) {
            const elapsed = Date.now() - new Date(note.editing_since).getTime();
            if (elapsed > 5 * 60 * 1000) {
                await pool.query('UPDATE notes SET editing_by = NULL, editing_since = NULL WHERE id = ?', [noteId]);
                note.editing_by = null;
                note.editing_since = null;
            }
        }
        if (note.editing_by) {
            const [[editor]] = await pool.query('SELECT id, name, username FROM users WHERE id = ?', [note.editing_by]);
            note.editing_by_user = editor ? { id: editor.id, name: editor.name || editor.username } : null;
        } else {
            note.editing_by_user = null;
        }

        if (note.user_id === req.user.id) {
            note.user_role = 'owner';
        } else {
            const roles = typeof note.shared_roles === 'string'
                ? JSON.parse(note.shared_roles || '{}')
                : (note.shared_roles || {});
            note.user_role = roles[req.user.id] || 'viewer';
        }

        res.json({ success: true, data: note });
    } catch (error) {
        console.error('Get note error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch note' });
    }
});

// PATCH /api/notes/:id/lock — acquire 5-minute editing lock
router.patch('/:id/lock', verifyToken, async (req, res) => {
    try {
        const noteId = req.params.id;
        const userId = req.user.id;

        const [notes] = await pool.query(
            `SELECT n.id, n.user_id, n.folder_id, n.shared_with, n.shared_roles, n.editing_by, n.editing_since
             FROM notes n
             WHERE n.id = ? AND (
               n.user_id = ?
               OR JSON_CONTAINS(n.shared_with, JSON_ARRAY(?))
               OR EXISTS (
                 SELECT 1 FROM note_folder_shares fs
                 WHERE fs.folder_id = n.folder_id AND fs.shared_with_user_id = ?
               )
             )`,
            [noteId, userId, userId, userId]
        );
        if (notes.length === 0) return res.status(404).json({ success: false, message: 'Note not found' });
        const note = notes[0];

        // Resolve effective role for editing
        let effectiveRole = null;
        if (note.user_id === userId) {
            effectiveRole = 'owner';
        } else {
            // Direct note share?
            const roles = typeof note.shared_roles === 'string'
                ? JSON.parse(note.shared_roles || '{}')
                : (note.shared_roles || {});
            if (roles[userId]) {
                effectiveRole = roles[userId];
            } else if (note.folder_id) {
                // Folder share?
                const [[folderShare]] = await pool.query(
                    'SELECT role FROM note_folder_shares WHERE folder_id = ? AND shared_with_user_id = ? LIMIT 1',
                    [note.folder_id, userId]
                );
                if (folderShare) effectiveRole = folderShare.role || 'viewer';
            }
        }

        if (effectiveRole !== 'owner' && effectiveRole !== 'editor') {
            return res.status(403).json({ success: false, message: 'Viewer cannot edit this note' });
        }

        if (note.editing_by && note.editing_by !== userId) {
            const elapsed = Date.now() - new Date(note.editing_since).getTime();
            if (elapsed < 5 * 60 * 1000 && !req.body.force) {
                const [[editor]] = await pool.query('SELECT name, username FROM users WHERE id = ?', [note.editing_by]);
                const editorName = editor?.name || editor?.username || 'Someone';
                return res.status(409).json({
                    success: false,
                    message: `Sedang diedit oleh ${editorName}`,
                    editing_by_user: { id: note.editing_by, name: editorName },
                });
            }
        }

        await pool.query('UPDATE notes SET editing_by = ?, editing_since = NOW() WHERE id = ?', [userId, noteId]);
        res.json({ success: true, message: 'Lock acquired' });
    } catch (error) {
        console.error('Lock note error:', error);
        res.status(500).json({ success: false, message: 'Failed to acquire lock' });
    }
});

// PATCH /api/notes/:id/unlock — release editing lock (owner, editor via share, or current lock holder)
router.patch('/:id/unlock', verifyToken, async (req, res) => {
    try {
        const noteId = req.params.id;
        const userId = req.user.id;
        const [notes] = await pool.query(
            'SELECT editing_by, user_id, folder_id, shared_roles FROM notes WHERE id = ?',
            [noteId]
        );
        if (notes.length === 0) return res.status(404).json({ success: false, message: 'Note not found' });
        const note = notes[0];

        let role = null;
        if (note.user_id === userId) {
            role = 'owner';
        } else {
            const roles = typeof note.shared_roles === 'string'
                ? JSON.parse(note.shared_roles || '{}')
                : (note.shared_roles || {});
            if (roles[userId]) {
                role = roles[userId];
            } else if (note.folder_id) {
                const [[fs]] = await pool.query(
                    'SELECT role FROM note_folder_shares WHERE folder_id = ? AND shared_with_user_id = ? LIMIT 1',
                    [note.folder_id, userId]
                );
                if (fs) role = fs.role || 'viewer';
            }
        }

        const isLockHolder = note.editing_by === userId;
        const canRelease = role === 'owner' || role === 'editor' || isLockHolder;
        if (!canRelease) {
            return res.status(403).json({ success: false, message: 'You do not have permission to release this lock' });
        }

        await pool.query('UPDATE notes SET editing_by = NULL, editing_since = NULL WHERE id = ?', [noteId]);
        res.json({ success: true, message: 'Lock released' });
    } catch (error) {
        console.error('Unlock note error:', error);
        res.status(500).json({ success: false, message: 'Failed to release lock' });
    }
});

// Create note
router.post('/', verifyToken, [
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('content').optional().trim(),
    body('content_json').optional(),
    body('category').optional().trim(),
    body('is_pinned').optional().isBoolean(),
    body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/),
    body('folder_id').optional({ nullable: true }).isInt(),
    body('linked_task_id').optional({ nullable: true }).isInt(),
    body('linked_kegiatan_id').optional({ nullable: true }).isInt(),
    body('tag_ids').optional().isArray(),
    body('user_id').optional().isInt({ min: 1 })  // B10: validate admin impersonation field
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { title, content, content_json, category, is_pinned, color, folder_id, linked_task_id, linked_kegiatan_id, tag_ids } = req.body;
        // B10: parseInt for safety
        const userId = req.user.role === 'admin' && req.body.user_id
            ? parseInt(req.body.user_id, 10)
            : req.user.id;

        // B3: Safe JSON parse for content_json
        let finalContent = content || null;
        let finalContentJson = null;
        if (content_json) {
            const parsed = safeParseJson(content_json);
            if (!parsed) {
                return res.status(400).json({ success: false, message: 'Invalid content_json format' });
            }
            finalContentJson = typeof content_json === 'string' ? content_json : JSON.stringify(content_json);
            finalContent = extractPlainText(parsed);
        }

        // B5: Validate tag ownership early (before INSERT)
        if (Array.isArray(tag_ids) && tag_ids.length > 0) {
            const tagCheck = await validateTagOwnership(tag_ids, userId);
            if (tagCheck.invalid.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Some tag IDs are invalid or not owned by you',
                    invalid_tag_ids: tagCheck.invalid,
                });
            }
        }

        // Validate folder_id ownership
        if (folder_id) {
            const [folder] = await pool.query('SELECT id FROM note_folders WHERE id = ? AND user_id = ?', [parseInt(folder_id), userId]);
            if (folder.length === 0) {
                return res.status(400).json({ success: false, message: 'Invalid folder' });
            }
        }

        const [result] = await pool.query(
            `INSERT INTO notes (user_id, title, content, content_json, category, is_pinned, color, folder_id, linked_task_id, linked_kegiatan_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId, title, finalContent, finalContentJson,
                category || null, is_pinned || false, color || '#ffffff',
                folder_id ? parseInt(folder_id) : null, linked_task_id ? parseInt(linked_task_id) : null, linked_kegiatan_id ? parseInt(linked_kegiatan_id) : null
            ]
        );

        // B5: Insert validated tags (all already validated above)
        if (Array.isArray(tag_ids) && tag_ids.length > 0) {
            const validTagIds = (await validateTagOwnership(tag_ids, userId)).valid;
            if (validTagIds.length > 0) {
                const tagValues = validTagIds.map(tagId => [result.insertId, tagId]);
                await pool.query('INSERT INTO note_tag_map (note_id, tag_id) VALUES ?', [tagValues]);
            }
        }

        const _isImpersonating = req.user.role === 'admin' && Number(userId) !== Number(req.user.id);
        if (_isImpersonating) {
            await logNoteActivity(result.insertId, userId, 'created', {
                impersonated_by: { id: req.user.id, name: req.user.name || req.user.username || 'Admin' },
            });
        } else {
            await logNoteActivity(result.insertId, userId, 'created');
        }

        const [newNote] = await pool.query('SELECT * FROM notes WHERE id = ?', [result.insertId]);
        res.status(201).json({ success: true, message: 'Note created successfully', data: newNote[0] });
    } catch (error) {
        console.error('Create note error:', error);
        res.status(500).json({ success: false, message: 'Failed to create note' });
    }
});

// Update note
router.put('/:id', verifyToken, addUserFilter, [
    body('title').optional().trim().notEmpty(),
    body('content').optional().trim(),
    body('content_json').optional(),
    body('category').optional().trim(),
    body('is_pinned').optional().isBoolean(),
    body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/),
    body('folder_id').optional({ nullable: true }).isInt({ allow_string: true }),
    body('linked_task_id').optional({ nullable: true }).isInt({ allow_string: true }),
    body('linked_kegiatan_id').optional({ nullable: true }).isInt({ allow_string: true }),
    body('tag_ids').optional().isArray()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const noteId = req.params.id;

        // Existence + access check: owner, direct share, or folder share.
        let checkQuery = 'SELECT id, user_id, folder_id, shared_roles FROM notes WHERE id = ?';
        const checkParams = [noteId];
        if (req.userFilter) {
            checkQuery += ` AND (
                user_id = ?
                OR JSON_CONTAINS(shared_with, JSON_ARRAY(?))
                OR EXISTS (
                  SELECT 1 FROM note_folder_shares fs
                  WHERE fs.folder_id = notes.folder_id AND fs.shared_with_user_id = ?
                )
            )`;
            const u = req.userFilter.user_id;
            checkParams.push(u, u, u);
        }

        const [existing] = await pool.query(checkQuery, checkParams);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Note not found' });
        }

        const noteOwnerId = existing[0].user_id;

        // Resolve the caller's effective role for this note. Viewers are rejected.
        let effectiveRole = null;
        if (noteOwnerId === req.user.id) {
            effectiveRole = 'owner';
        } else {
            const roles = typeof existing[0].shared_roles === 'string'
                ? JSON.parse(existing[0].shared_roles || '{}')
                : (existing[0].shared_roles || {});
            if (roles[req.user.id]) {
                effectiveRole = roles[req.user.id];
            } else if (existing[0].folder_id) {
                const [[folderShare]] = await pool.query(
                    'SELECT role FROM note_folder_shares WHERE folder_id = ? AND shared_with_user_id = ? LIMIT 1',
                    [existing[0].folder_id, req.user.id]
                );
                if (folderShare) effectiveRole = folderShare.role || 'viewer';
            }
        }
        if (effectiveRole !== 'owner' && effectiveRole !== 'editor') {
            return res.status(403).json({ success: false, message: 'Read-only access; you cannot edit this note' });
        }

        // Capture old values for activity-log diffing
        const [_oldNoteRows] = await pool.query('SELECT title, content_json, folder_id, color, is_pinned FROM notes WHERE id = ?', [noteId]);
        const _oldNote = _oldNoteRows[0] || {};
        const prevTitle    = _oldNote.title;
        const prevContent  = _oldNote.content_json;
        const prevFolderId = _oldNote.folder_id;
        const prevColor    = _oldNote.color;
        const prevPinned   = !!_oldNote.is_pinned;
        const [_prevTagRows] = await pool.query(
            `SELECT t.id, t.name FROM note_tags t
             JOIN note_tag_map m ON t.id = m.tag_id
             WHERE m.note_id = ?`,
            [noteId]
        );
        const prevTagNames = _prevTagRows.map(r => r.name);

        const allowedFields = ['title', 'content', 'category', 'is_pinned', 'color', 'folder_id', 'linked_task_id', 'linked_kegiatan_id', 'content_json'];
        const updates = [];
        const values = [];

        // B3: Safe JSON parse for content_json
        if (req.body.content_json !== undefined) {
            const contentJson = req.body.content_json;
            const parsed = safeParseJson(contentJson);
            if (!parsed) {
                return res.status(400).json({ success: false, message: 'Invalid content_json format' });
            }
            const jsonStr = typeof contentJson === 'string' ? contentJson : JSON.stringify(contentJson);
            updates.push('content_json = ?');
            values.push(jsonStr);
            updates.push('content = ?');
            values.push(extractPlainText(parsed));
        }

        const intFields = new Set(['folder_id', 'linked_task_id', 'linked_kegiatan_id']);
        for (const field of allowedFields) {
            if (field === 'content_json') continue;
            if (field === 'content' && req.body.content_json !== undefined) continue;
            if (req.body[field] !== undefined) {
                updates.push(`${field} = ?`);
                const val = intFields.has(field) ? (req.body[field] ? parseInt(req.body[field], 10) : null) : req.body[field];
                values.push(val);
            }
        }

        // Validate folder_id ownership on update
        if (req.body.folder_id) {
            const [folder] = await pool.query('SELECT id FROM note_folders WHERE id = ? AND user_id = ?', [parseInt(req.body.folder_id), noteOwnerId]);
            if (folder.length === 0) {
                return res.status(400).json({ success: false, message: 'Invalid folder' });
            }
        }

        // B5: Validate tag ownership early (before UPDATE)
        if (Array.isArray(req.body.tag_ids) && req.body.tag_ids.length > 0) {
            const _tagCheck = await validateTagOwnership(req.body.tag_ids, noteOwnerId);
            if (_tagCheck.invalid.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Some tag IDs are invalid or not owned by you',
                    invalid_tag_ids: _tagCheck.invalid,
                });
            }
        }

        if (updates.length === 0 && !req.body.tag_ids) {
            return res.status(400).json({ success: false, message: 'No fields to update' });
        }

        if (updates.length > 0) {
            values.push(noteId);
            await pool.query(`UPDATE notes SET ${updates.join(', ')} WHERE id = ?`, values);
        }

        // B5: Insert validated tags (all already validated above)
        if (req.body.tag_ids !== undefined) {
            await pool.query('DELETE FROM note_tag_map WHERE note_id = ?', [noteId]);
            if (req.body.tag_ids.length > 0) {
                const validTagIds = (await validateTagOwnership(req.body.tag_ids, noteOwnerId)).valid;
                if (validTagIds.length > 0) {
                    const tagValues = validTagIds.map(tagId => [parseInt(noteId), tagId]);
                    await pool.query('INSERT INTO note_tag_map (note_id, tag_id) VALUES ?', [tagValues]);
                }
            }
        }

        const [updatedNote] = await pool.query('SELECT * FROM notes WHERE id = ?', [noteId]);

        // Activity log writes
        const _userId = req.user.id;
        if (typeof req.body.title === 'string' && req.body.title !== prevTitle) {
            await logNoteActivity(noteId, _userId, 'title_edited', { from: prevTitle, to: req.body.title });
        }
        if (req.body.content_json !== undefined) {
            const _newContent = typeof req.body.content_json === 'string'
                ? req.body.content_json
                : JSON.stringify(req.body.content_json);
            if (_newContent !== (prevContent || '')) {
                await logNoteActivity(noteId, _userId, 'content_edited');
            }
            try {
                const _oldJson = prevContent ? JSON.parse(prevContent) : null;
                const _newJson = typeof req.body.content_json === 'object'
                    ? req.body.content_json
                    : (req.body.content_json ? JSON.parse(req.body.content_json) : null);
                const _cellChanges = diffStatusCells(_oldJson, _newJson);
                for (const _change of _cellChanges) {
                    await logNoteActivity(noteId, _userId, 'status_changed', _change);
                }
            } catch (_e) {
                console.error('statusDiff parse error:', _e.message);
            }
        }
        if (req.body.folder_id !== undefined && Number(req.body.folder_id || 0) !== Number(prevFolderId || 0)) {
            const [[_fromF]] = prevFolderId
                ? await pool.query('SELECT name FROM note_folders WHERE id = ?', [prevFolderId])
                : [[null]];
            const [[_toF]] = req.body.folder_id
                ? await pool.query('SELECT name FROM note_folders WHERE id = ?', [req.body.folder_id])
                : [[null]];
            await logNoteActivity(noteId, _userId, 'folder_moved', {
                from_id: prevFolderId, from_name: _fromF?.name || null,
                to_id: req.body.folder_id || null, to_name: _toF?.name || null,
            });
        }
        if (req.body.color !== undefined && req.body.color !== prevColor) {
            await logNoteActivity(noteId, _userId, 'color_changed', { from: prevColor, to: req.body.color });
        }
        if (req.body.is_pinned !== undefined && Boolean(req.body.is_pinned) !== prevPinned) {
            await logNoteActivity(noteId, _userId, req.body.is_pinned ? 'pinned' : 'unpinned');
        }
        if (Array.isArray(req.body.tag_ids)) {
            const [_newTagRows] = await pool.query(
                `SELECT t.id, t.name FROM note_tags t
                 JOIN note_tag_map m ON t.id = m.tag_id
                 WHERE m.note_id = ?`,
                [noteId]
            );
            const _newTagNames = _newTagRows.map(r => r.name);
            const _added   = _newTagNames.filter(n => !prevTagNames.includes(n));
            const _removed = prevTagNames.filter(n => !_newTagNames.includes(n));
            if (_added.length > 0 || _removed.length > 0) {
                await logNoteActivity(noteId, _userId, 'tag_changed', { added: _added, removed: _removed });
            }
        }

        res.json({ success: true, message: 'Note updated successfully', data: updatedNote[0] });
    } catch (error) {
        console.error('Update note error:', error);
        res.status(500).json({ success: false, message: 'Failed to update note' });
    }
});

// Toggle archive
router.patch('/:id/archive', verifyToken, addUserFilter, async (req, res) => {
    try {
        const noteId = req.params.id;

        // Allow owner OR shared editor (direct or folder share) to archive.
        let checkQuery = 'SELECT id, is_archived, user_id, folder_id, shared_roles FROM notes WHERE id = ?';
        const checkParams = [noteId];
        if (req.userFilter) {
            checkQuery += ` AND (
                user_id = ?
                OR JSON_CONTAINS(shared_with, JSON_ARRAY(?))
                OR EXISTS (
                  SELECT 1 FROM note_folder_shares fs
                  WHERE fs.folder_id = notes.folder_id AND fs.shared_with_user_id = ?
                )
            )`;
            const u = req.userFilter.user_id;
            checkParams.push(u, u, u);
        }

        const [existing] = await pool.query(checkQuery, checkParams);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Note not found' });
        }

        // Resolve role: viewers cannot archive
        let _archiveRole = null;
        if (existing[0].user_id === req.user.id) {
            _archiveRole = 'owner';
        } else {
            const _roles = typeof existing[0].shared_roles === 'string'
                ? JSON.parse(existing[0].shared_roles || '{}')
                : (existing[0].shared_roles || {});
            if (_roles[req.user.id]) {
                _archiveRole = _roles[req.user.id];
            } else if (existing[0].folder_id) {
                const [[_fs]] = await pool.query(
                    'SELECT role FROM note_folder_shares WHERE folder_id = ? AND shared_with_user_id = ? LIMIT 1',
                    [existing[0].folder_id, req.user.id]
                );
                if (_fs) _archiveRole = _fs.role || 'viewer';
            }
        }
        if (_archiveRole !== 'owner' && _archiveRole !== 'editor') {
            return res.status(403).json({ success: false, message: 'Read-only access; you cannot archive this note' });
        }

        const newArchived = existing[0].is_archived ? 0 : 1;
        await pool.query('UPDATE notes SET is_archived = ? WHERE id = ?', [newArchived, noteId]);
        await logNoteActivity(noteId, req.user.id, newArchived ? 'archived' : 'unarchived');

        const [updatedNote] = await pool.query('SELECT * FROM notes WHERE id = ?', [noteId]);
        res.json({
            success: true,
            message: newArchived ? 'Note archived' : 'Note unarchived',
            data: updatedNote[0]
        });
    } catch (error) {
        console.error('Archive note error:', error);
        res.status(500).json({ success: false, message: 'Failed to toggle archive' });
    }
});

// Share note
router.patch('/:id/share', verifyToken, addUserFilter, async (req, res) => {
    try {
        const noteId = req.params.id;
        const { user_ids } = req.body;

        if (!Array.isArray(user_ids)) {
            return res.status(400).json({ success: false, message: 'user_ids must be an array' });
        }

        // B4: Validate user_ids — must be positive integers, max 50, and exist in users table
        const sanitizedIds = user_ids
            .map(id => parseInt(id, 10))
            .filter(id => !isNaN(id) && id > 0);

        if (sanitizedIds.length > 50) {
            return res.status(400).json({ success: false, message: 'Maximum 50 users can be shared with' });
        }

        // Verify existing users if any IDs provided
        let validUserIds = [];
        if (sanitizedIds.length > 0) {
            const [existingUsers] = await pool.query('SELECT id FROM users WHERE id IN (?)', [sanitizedIds]);
            validUserIds = existingUsers.map(u => u.id);
        }

        // B12: Ownership check with 403 for non-owners
        let checkQuery = 'SELECT id, user_id, shared_with FROM notes WHERE id = ?';
        const checkParams = [noteId];
        if (req.userFilter) {
            checkQuery += ' AND user_id = ?';
            checkParams.push(req.userFilter.user_id);
        }

        const [existing] = await pool.query(checkQuery, checkParams);
        if (existing.length === 0) {
            // Check if note exists at all (for proper 403 vs 404)
            if (req.userFilter) {
                const [noteExists] = await pool.query('SELECT id FROM notes WHERE id = ?', [noteId]);
                if (noteExists.length > 0) {
                    return res.status(403).json({ success: false, message: 'You can only share your own notes' });
                }
            }
            return res.status(404).json({ success: false, message: 'Note not found' });
        }

        const rolesPayload = (req.body.roles && typeof req.body.roles === 'object') ? req.body.roles : {};
        await pool.query(
            'UPDATE notes SET shared_with = ?, shared_roles = ? WHERE id = ?',
            [JSON.stringify(validUserIds), JSON.stringify(rolesPayload), noteId]
        );

        // Diff and log activity
        const _prevShared = existing[0].shared_with
            ? (typeof existing[0].shared_with === 'string'
                ? JSON.parse(existing[0].shared_with || '[]')
                : (existing[0].shared_with || []))
            : [];
        const _addedIds   = validUserIds.filter(uid => !_prevShared.includes(uid));
        const _removedIds = _prevShared.filter(uid => !validUserIds.includes(uid));
        if (_addedIds.length > 0 || _removedIds.length > 0) {
            const _allRelevant = [..._addedIds, ..._removedIds, 0];
            const [_users] = await pool.query(
                'SELECT id, COALESCE(name, username) AS name FROM users WHERE id IN (?)',
                [_allRelevant]
            );
            const _nameById = Object.fromEntries(_users.map(u => [u.id, u.name]));
            const _addedNamed   = _addedIds.map(id => ({ id, name: _nameById[id] || `User #${id}` }));
            const _removedNamed = _removedIds.map(id => ({ id, name: _nameById[id] || `User #${id}` }));
            if (_addedNamed.length > 0) {
                await logNoteActivity(noteId, req.user.id, 'shared', { added: _addedNamed, roles: rolesPayload });
            }
            if (_removedNamed.length > 0) {
                await logNoteActivity(noteId, req.user.id, 'share_revoked', { removed: _removedNamed });
            }
        }

        const [updatedNote] = await pool.query('SELECT * FROM notes WHERE id = ?', [noteId]);
        res.json({ success: true, message: 'Note sharing updated', data: updatedNote[0] });
    } catch (error) {
        console.error('Share note error:', error);
        res.status(500).json({ success: false, message: 'Failed to update sharing' });
    }
});

// AI Summary
router.post('/:id/summarize', verifyToken, addUserFilter, async (req, res) => {
    try {
        const noteId = req.params.id;

        let checkQuery = 'SELECT * FROM notes WHERE id = ?';
        const checkParams = [noteId];
        if (req.userFilter) {
            checkQuery += ' AND user_id = ?';
            checkParams.push(req.userFilter.user_id);
        }

        const [notes] = await pool.query(checkQuery, checkParams);
        if (notes.length === 0) {
            return res.status(404).json({ success: false, message: 'Note not found' });
        }

        const note = notes[0];

        // B3: Safe JSON parse for stored content_json
        let plainText = '';
        if (note.content_json) {
            const parsed = safeParseJson(note.content_json);
            if (parsed) {
                plainText = extractPlainText(parsed);
            }
        }
        if (!plainText) {
            plainText = note.content || '';
        }

        if (!plainText.trim()) {
            return res.status(400).json({ success: false, message: 'Note has no content to summarize' });
        }

        // Cap input to 20K chars to prevent excessive token usage
        if (plainText.length > 20000) {
            plainText = plainText.substring(0, 20000);
        }

        const llmResponse = await axios.post('http://localhost:3031/v1/chat/completions', {
            model: 'claude-sonnet-4-6',
            messages: [
                {
                    role: 'system',
                    content: 'Rangkum catatan berikut dalam 3-5 poin utama, bahasa Indonesia, format bullet. Jika ada checklist, sebutkan progress (X/Y selesai).'
                },
                { role: 'user', content: plainText }
            ]
        }, { timeout: 30000 });

        const summary = llmResponse.data.choices[0].message.content;
        await pool.query('UPDATE notes SET ai_summary = ? WHERE id = ?', [summary, noteId]);

        res.json({ success: true, message: 'Summary generated', data: { ai_summary: summary } });
    } catch (error) {
        console.error('Summarize note error:', error);
        res.status(500).json({ success: false, message: 'Failed to generate summary' });
    }
});

// Checklist to Task
router.post('/:id/checklist-to-task', verifyToken, addUserFilter, [
    body('text').trim().notEmpty().withMessage('Task text is required'),
    body('priority').optional().isIn(['P0', 'P1', 'P2', 'P3']),
    body('end_date').optional().isISO8601().withMessage('Invalid date format')  // B8: validate end_date
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const noteId = req.params.id;
        const { text, priority, end_date } = req.body;

        let checkQuery = 'SELECT id FROM notes WHERE id = ?';
        const checkParams = [noteId];
        if (req.userFilter) {
            checkQuery += ' AND user_id = ?';
            checkParams.push(req.userFilter.user_id);
        }

        const [existing] = await pool.query(checkQuery, checkParams);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Note not found' });
        }

        const taskPriority = priority || 'P2';
        const [taskResult] = await pool.query(
            'INSERT INTO tasks (user_id, task, priority, status, end_date) VALUES (?, ?, ?, ?, ?)',
            [req.user.id, text.trim(), taskPriority, 'pending', end_date || null]
        );

        await pool.query('UPDATE notes SET linked_task_id = ? WHERE id = ?', [taskResult.insertId, noteId]);

        const [newTask] = await pool.query('SELECT * FROM tasks WHERE id = ?', [taskResult.insertId]);
        res.status(201).json({ success: true, message: 'Task created from checklist', data: newTask[0] });
    } catch (error) {
        console.error('Checklist to task error:', error);
        res.status(500).json({ success: false, message: 'Failed to create task from checklist' });
    }
});

// Delete note
router.delete('/:id', verifyToken, addUserFilter, async (req, res) => {
    try {
        const noteId = req.params.id;

        let deleteQuery = 'DELETE FROM notes WHERE id = ?';
        const params = [noteId];

        if (req.userFilter) {
            deleteQuery += ' AND user_id = ?';
            params.push(req.userFilter.user_id);
        }

        const [result] = await pool.query(deleteQuery, params);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Note not found' });
        }

        res.json({ success: true, message: 'Note deleted successfully' });
    } catch (error) {
        console.error('Delete note error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete note' });
    }
});

// Reorder notes (drag-and-drop)
router.patch('/reorder', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { orderedIds } = req.body;

        if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
            return res.status(400).json({ success: false, message: 'orderedIds array is required' });
        }

        // Sanitize IDs
        const ids = orderedIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id) && id > 0);
        if (ids.length === 0) {
            return res.status(400).json({ success: false, message: 'No valid note IDs provided' });
        }

        // Verify all notes belong to user
        const [owned] = await pool.query(
            'SELECT id FROM notes WHERE id IN (?) AND user_id = ?',
            [ids, userId]
        );
        const ownedIds = new Set(owned.map(n => n.id));

        // Build batch update — CASE/WHEN for performance
        const cases = [];
        const caseParams = [];
        const validIds = [];
        ids.forEach((id, index) => {
            if (ownedIds.has(id)) {
                cases.push('WHEN id = ? THEN ?');
                caseParams.push(id, index);
                validIds.push(id);
            }
        });

        if (validIds.length === 0) {
            return res.status(404).json({ success: false, message: 'No matching notes found' });
        }

        await pool.query(
            `UPDATE notes SET sort_order = CASE ${cases.join(' ')} END WHERE id IN (?) AND user_id = ?`,
            [...caseParams, validIds, userId]
        );

        res.json({ success: true, message: 'Notes reordered' });
    } catch (error) {
        console.error('Reorder notes error:', error);
        res.status(500).json({ success: false, message: 'Failed to reorder notes' });
    }
});

// PUT /api/notes/positions/bulk — owner-only canvas layout on the notes table.
// Receivers (direct share or folder share) cannot modify positions; their
// drags are silently rejected here even if the frontend's readOnly guard
// is bypassed. Positions are stored on notes.position_x/y so all viewers
// of a shared folder see the owner's layout consistently.
router.put('/positions/bulk', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { positions = {}, widths = {}, heights = {} } = req.body || {};
        const ids = Object.keys(positions);
        if (ids.length === 0) return res.json({ success: true, updated: 0, rejected: 0 });

        const [ownedRows] = await pool.query(
            'SELECT id FROM notes WHERE id IN (?) AND user_id = ?',
            [ids, userId]
        );
        const owned = new Set(ownedRows.map(r => String(r.id)));

        let updated = 0;
        let rejected = 0;
        for (const noteId of ids) {
            if (!owned.has(String(noteId))) { rejected++; continue; }
            const pos = positions[noteId] || {};
            const w = widths[noteId];
            const h = heights[noteId];
            await pool.query(
                `UPDATE notes
                 SET position_x = ?, position_y = ?,
                     card_width = COALESCE(?, card_width),
                     card_height = COALESCE(?, card_height)
                 WHERE id = ? AND user_id = ?`,
                [pos.x ?? null, pos.y ?? null, w ?? null, h ?? null, noteId, userId]
            );
            updated++;
        }
        res.json({ success: true, updated, rejected });
    } catch (error) {
        console.error('Bulk position update error:', error);
        res.status(500).json({ success: false, message: 'Failed to update positions' });
    }
});

// ─── Update note position (free drag) ──────────────────
router.patch('/:id/position', verifyToken, [
    body('position_x').optional({ nullable: true }).isFloat({ min: 0 }),
    body('position_y').optional({ nullable: true }).isFloat({ min: 0 }),
    body('card_width').optional({ nullable: true }).isInt({ min: 200, max: 800 }),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
    }
    try {
        const { position_x, position_y, card_width } = req.body;
        const [result] = await pool.query(
            'UPDATE notes SET position_x = ?, position_y = ?, card_width = ? WHERE id = ? AND user_id = ?',
            [position_x, position_y, card_width ?? null, req.params.id, req.user.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Note not found' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Update note position error:', error);
        res.status(500).json({ success: false, message: 'Failed to update position' });
    }
});

// ═══════════════════════════════════════════════════════════════
// NOTE CONNECTIONS — arrows between notes on the canvas. Restored
// from note.routes.js.backup (these had been accidentally dropped,
// which left the frontend's noteConnectionsAPI returning 404 and
// killed both the arrows and the aggregated progress on master notes).
// ═══════════════════════════════════════════════════════════════

// POST /api/notes/public-share — create or revive a public share link
router.post('/public-share', verifyToken, [
    body('share_type').isIn(['note', 'folder']),
    body('note_id').optional({ nullable: true }).isInt(),
    body('folder_id').optional({ nullable: true }).isInt(),
    body('expires_at').optional({ nullable: true }).isISO8601(),
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

        const userId = req.user.id;
        const { share_type, note_id, folder_id, expires_at = null } = req.body;

        if (share_type === 'note') {
            if (!note_id) return res.status(400).json({ success: false, message: 'note_id required' });
            const [[note]] = await pool.query('SELECT id FROM notes WHERE id = ? AND user_id = ?', [note_id, userId]);
            if (!note) return res.status(404).json({ success: false, message: 'Note not found' });
        } else {
            if (!folder_id) return res.status(400).json({ success: false, message: 'folder_id required' });
            const [[folder]] = await pool.query('SELECT id FROM note_folders WHERE id = ? AND user_id = ?', [folder_id, userId]);
            if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });
        }

        const checkCol = share_type === 'note' ? 'note_id' : 'folder_id';
        const checkVal = share_type === 'note' ? note_id : folder_id;
        const [[existing]] = await pool.query(
            `SELECT * FROM note_public_shares WHERE share_type = ? AND ${checkCol} = ? AND user_id = ?`,
            [share_type, checkVal, userId]
        );
        if (existing) {
            if (!existing.is_active) {
                await pool.query('UPDATE note_public_shares SET is_active = 1, expires_at = ? WHERE id = ?', [expires_at, existing.id]);
            }
            if (share_type === 'note' && note_id && !existing.is_active) {
                await logNoteActivity(note_id, userId, 'public_link_created', { token_tail: existing.share_token.slice(-4) });
            }
            return res.json({ success: true, data: { ...existing, is_active: 1, expires_at } });
        }

        const token = crypto.randomBytes(24).toString('hex');
        const [result] = await pool.query(
            `INSERT INTO note_public_shares (share_token, share_type, note_id, folder_id, user_id, expires_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [token, share_type, note_id || null, folder_id || null, userId, expires_at]
        );
        const [[share]] = await pool.query('SELECT * FROM note_public_shares WHERE id = ?', [result.insertId]);
        if (share_type === 'note' && note_id) {
            await logNoteActivity(note_id, userId, 'public_link_created', { token_tail: token.slice(-4) });
        }
        res.json({ success: true, data: share });
    } catch (error) {
        console.error('Create public share error:', error);
        res.status(500).json({ success: false, message: 'Failed to create public share' });
    }
});

// GET /api/notes/public-share/list — all my shares with item names
router.get('/public-share/list', verifyToken, async (req, res) => {
    try {
        const [shares] = await pool.query(
            `SELECT nps.*,
                    CASE WHEN nps.share_type = 'note'
                         THEN (SELECT title FROM notes WHERE id = nps.note_id)
                         ELSE (SELECT name  FROM note_folders WHERE id = nps.folder_id)
                    END AS item_name
             FROM note_public_shares nps
             WHERE nps.user_id = ?
             ORDER BY nps.created_at DESC`,
            [req.user.id]
        );
        res.json({ success: true, data: shares });
    } catch (error) {
        console.error('List public shares error:', error);
        res.status(500).json({ success: false, message: 'Failed to list shares' });
    }
});

// PUT /api/notes/public-share/:id/toggle — toggle active flag
router.put('/public-share/:id/toggle', verifyToken, async (req, res) => {
    try {
        const [[share]] = await pool.query(
            'SELECT * FROM note_public_shares WHERE id = ? AND user_id = ?',
            [req.params.id, req.user.id]
        );
        if (!share) return res.status(404).json({ success: false, message: 'Share not found' });
        const newActive = share.is_active ? 0 : 1;
        await pool.query('UPDATE note_public_shares SET is_active = ? WHERE id = ?', [newActive, share.id]);
        res.json({ success: true, data: { ...share, is_active: newActive } });
    } catch (error) {
        console.error('Toggle public share error:', error);
        res.status(500).json({ success: false, message: 'Failed to toggle share' });
    }
});

// DELETE /api/notes/public-share/:id — revoke a public share
router.delete('/public-share/:id', verifyToken, async (req, res) => {
    try {
        const [[_shareRow]] = await pool.query(
            'SELECT * FROM note_public_shares WHERE id = ? AND user_id = ?',
            [req.params.id, req.user.id]
        );
        if (!_shareRow) return res.status(404).json({ success: false, message: 'Share not found' });
        await pool.query('DELETE FROM note_public_shares WHERE id = ?', [_shareRow.id]);
        if (_shareRow.share_type === 'note' && _shareRow.note_id) {
            await logNoteActivity(_shareRow.note_id, req.user.id, 'public_link_revoked', {
                token_tail: _shareRow.share_token.slice(-4),
            });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Delete public share error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete share' });
    }
});

// GET /api/notes/public/:token — UNAUTHENTICATED public viewer endpoint
router.get('/public/:token', async (req, res) => {
    try {
        const [[share]] = await pool.query(
            'SELECT * FROM note_public_shares WHERE share_token = ? AND is_active = 1',
            [req.params.token]
        );
        if (!share) return res.status(404).json({ success: false, message: 'Share not found or inactive' });
        if (share.expires_at && new Date(share.expires_at) < new Date()) {
            return res.status(410).json({ success: false, message: 'Share link has expired' });
        }

        await pool.query('UPDATE note_public_shares SET view_count = view_count + 1 WHERE id = ?', [share.id]);

        if (share.share_type === 'note') {
            const [[note]] = await pool.query(
                `SELECT id, title, content, content_json, color, created_at, updated_at
                 FROM notes WHERE id = ?`,
                [share.note_id]
            );
            if (!note) return res.status(404).json({ success: false, message: 'Note not found' });
            const [tags] = await pool.query(
                `SELECT t.* FROM note_tags t JOIN note_tag_map ntm ON t.id = ntm.tag_id WHERE ntm.note_id = ?`,
                [note.id]
            );
            return res.json({ success: true, data: { type: 'note', share, note: { ...note, tags } } });
        } else {
            const [[folder]] = await pool.query(
                'SELECT id, name, color FROM note_folders WHERE id = ?',
                [share.folder_id]
            );
            if (!folder) return res.status(404).json({ success: false, message: 'Folder not found' });
            const [notes] = await pool.query(
                `SELECT id, title, content, content_json, color, position_x, position_y, card_width, card_height,
                        is_pinned, created_at, updated_at
                 FROM notes WHERE folder_id = ? AND is_archived = 0
                 ORDER BY is_pinned DESC, sort_order ASC, created_at DESC`,
                [share.folder_id]
            );
            return res.json({ success: true, data: { type: 'folder', share, folder, notes } });
        }
    } catch (error) {
        console.error('Get public share error:', error);
        res.status(500).json({ success: false, message: 'Failed to load share' });
    }
});

// GET connections for current user's notes (or owner's if viewing shared folder)
router.get('/connections/list', verifyToken, addUserFilter, async (req, res) => {
    try {
        let targetUserId = req.userFilter?.user_id || req.user.id;

        if (req.query.owner_id) {
            const ownerId = parseInt(req.query.owner_id);
            const [access] = await pool.query(
                `SELECT 1 FROM note_folder_shares fs
                 JOIN note_folders f ON fs.folder_id = f.id
                 WHERE fs.shared_with_user_id = ? AND f.user_id = ? LIMIT 1`,
                [req.user.id, ownerId]
            );
            if (access.length > 0) targetUserId = ownerId;
        }

        const [rows] = await pool.query(
            `SELECT nc.*, sn.title as source_title, tn.title as target_title
             FROM note_connections nc
             JOIN notes sn ON nc.source_note_id = sn.id
             JOIN notes tn ON nc.target_note_id = tn.id
             WHERE nc.user_id = ?
             ORDER BY nc.created_at DESC`,
            [targetUserId]
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Get connections error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch connections' });
    }
});

// POST create connection
router.post('/connections', verifyToken, addUserFilter, [
    body('source_note_id').isInt(),
    body('target_note_id').isInt(),
    body('label').optional({ nullable: true }).isString().isLength({ max: 100 }),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    try {
        const userId = req.userFilter?.user_id || req.user.id;
        const { source_note_id, target_note_id, label } = req.body;

        if (source_note_id === target_note_id) {
            return res.status(400).json({ success: false, message: 'Cannot connect a note to itself' });
        }

        const [notes] = await pool.query(
            `SELECT id FROM notes WHERE id IN (?, ?) AND (user_id = ? OR JSON_CONTAINS(shared_with, ?))`,
            [source_note_id, target_note_id, userId, userId]
        );
        if (notes.length < 2) {
            return res.status(403).json({ success: false, message: 'One or both notes not accessible' });
        }

        const [result] = await pool.query(
            `INSERT INTO note_connections (source_note_id, target_note_id, label, user_id) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE label = VALUES(label)`,
            [source_note_id, target_note_id, label || null, userId]
        );

        const insertId = result.insertId || result.affectedRows;
        const [[_targetNote]] = await pool.query('SELECT title FROM notes WHERE id = ?', [target_note_id]);
        await logNoteActivity(source_note_id, req.user.id, 'connection_added', {
            other_note_id: target_note_id,
            other_title: _targetNote?.title || `Note #${target_note_id}`,
        });
        res.status(201).json({ success: true, data: { id: insertId, source_note_id, target_note_id, label } });
    } catch (error) {
        console.error('Create connection error:', error);
        res.status(500).json({ success: false, message: 'Failed to create connection' });
    }
});

// PUT update connection label
router.put('/connections/:id', verifyToken, addUserFilter, [
    body('label').optional({ nullable: true }).isString().isLength({ max: 100 }),
], async (req, res) => {
    try {
        const userId = req.userFilter?.user_id || req.user.id;
        const { label } = req.body;
        const [result] = await pool.query(
            `UPDATE note_connections SET label = ? WHERE id = ? AND user_id = ?`,
            [label || null, req.params.id, userId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Connection not found' });
        res.json({ success: true });
    } catch (error) {
        console.error('Update connection error:', error);
        res.status(500).json({ success: false, message: 'Failed to update connection' });
    }
});

// DELETE connection
router.delete('/connections/:id', verifyToken, addUserFilter, async (req, res) => {
    try {
        const userId = req.userFilter?.user_id || req.user.id;
        const [[_connRow]] = await pool.query(
            'SELECT source_note_id, target_note_id FROM note_connections WHERE id = ? AND user_id = ?',
            [req.params.id, userId]
        );
        const [result] = await pool.query(
            `DELETE FROM note_connections WHERE id = ? AND user_id = ?`,
            [req.params.id, userId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Connection not found' });
        if (_connRow && result.affectedRows > 0) {
            const [[_targetNote]] = await pool.query('SELECT title FROM notes WHERE id = ?', [_connRow.target_note_id]);
            await logNoteActivity(_connRow.source_note_id, req.user.id, 'connection_removed', {
                other_note_id: _connRow.target_note_id,
                other_title: _targetNote?.title || `Note #${_connRow.target_note_id}`,
            });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Delete connection error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete connection' });
    }
});

module.exports = router;
