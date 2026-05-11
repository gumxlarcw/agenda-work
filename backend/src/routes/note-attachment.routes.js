const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { verifyToken } = require('../middleware/auth.middleware');

const router = express.Router();

const uploadDir = path.resolve(__dirname, '../../uploads/notes');

// B2: Validate file extension (in addition to MIME which is client-controlled)
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const sanitized = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        const unique = `${req.params.noteId}_${Date.now()}_${sanitized}`;
        cb(null, unique);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        const ext = path.extname(file.originalname).toLowerCase();
        // B2: Check both MIME type AND file extension
        if (!allowed.includes(file.mimetype) || !ALLOWED_EXTENSIONS.includes(ext)) {
            return cb(new Error('Only image files (jpg/png/webp/gif) are allowed'), false);
        }
        cb(null, true);
    }
});

// B1: Middleware to verify the caller can write to this note BEFORE multer
// writes to disk. Allows owner OR shared editor (direct or folder share).
// Viewers and unrelated users get 404 (avoids leaking note existence).
async function verifyNoteOwnership(req, res, next) {
    try {
        const noteId = req.params.noteId;
        const userId = req.user.id;
        const [rows] = await pool.query(
            `SELECT user_id, folder_id, shared_roles FROM notes
             WHERE id = ? AND (
               user_id = ?
               OR JSON_CONTAINS(shared_with, JSON_ARRAY(?))
               OR EXISTS (
                 SELECT 1 FROM note_folder_shares fs
                 WHERE fs.folder_id = notes.folder_id AND fs.shared_with_user_id = ?
               )
             )`,
            [noteId, userId, userId, userId]
        );
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Note not found' });
        }
        const note = rows[0];

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
        if (role !== 'owner' && role !== 'editor') {
            return res.status(403).json({ success: false, message: 'Read-only access; you cannot upload to this note' });
        }
        next();
    } catch (error) {
        console.error('Note ownership check error:', error);
        res.status(500).json({ success: false, message: 'Failed to verify note ownership' });
    }
}

// B10: Magic bytes validation — verify file header matches claimed MIME type
const MAGIC_BYTES = {
    'image/jpeg': [Buffer.from([0xFF, 0xD8, 0xFF])],
    'image/png':  [Buffer.from([0x89, 0x50, 0x4E, 0x47])],
    'image/gif':  [Buffer.from('GIF87a'), Buffer.from('GIF89a')],
    'image/webp': [Buffer.from('RIFF')], // RIFF....WEBP
};

function validateMagicBytes(filePath, mimetype) {
    try {
        const buf = Buffer.alloc(12);
        const fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, buf, 0, 12, 0);
        fs.closeSync(fd);

        const signatures = MAGIC_BYTES[mimetype];
        if (!signatures) return false;

        const valid = signatures.some(sig => buf.subarray(0, sig.length).equals(sig));

        // Extra check for WebP: bytes 8-11 must be "WEBP"
        if (mimetype === 'image/webp' && valid) {
            return buf.subarray(8, 12).toString('ascii') === 'WEBP';
        }
        return valid;
    } catch {
        return false;
    }
}

// Upload attachment — B1: ownership check BEFORE multer
router.post('/:noteId/attachments', verifyToken, verifyNoteOwnership, upload.single('file'), async (req, res) => {
    try {
        const noteId = req.params.noteId;

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No valid image file provided (jpg/png/webp/gif, max 5MB)' });
        }

        // B10: Validate magic bytes match claimed MIME type
        if (!validateMagicBytes(req.file.path, req.file.mimetype)) {
            // Clean up the fake file
            try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
            return res.status(400).json({ success: false, message: 'File content does not match its extension. Upload rejected.' });
        }

        const [result] = await pool.query(
            'INSERT INTO note_attachments (note_id, filename, filepath, mimetype, size_bytes) VALUES (?, ?, ?, ?, ?)',
            [noteId, req.file.originalname, `/uploads/notes/${req.file.filename}`, req.file.mimetype, req.file.size]
        );

        const [attachment] = await pool.query('SELECT * FROM note_attachments WHERE id = ?', [result.insertId]);
        res.status(201).json({ success: true, message: 'Attachment uploaded', data: attachment[0] });
    } catch (error) {
        // B1: Cleanup uploaded file on any error
        if (req.file && fs.existsSync(req.file.path)) {
            try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore cleanup errors */ }
        }
        console.error('Upload attachment error:', error);
        res.status(500).json({ success: false, message: 'Failed to upload attachment' });
    }
});

// Delete attachment — mirror POST permission: owner OR editor (direct or folder share)
router.delete('/attachments/:attachmentId', verifyToken, async (req, res) => {
    try {
        const attachmentId = req.params.attachmentId;
        const userId = req.user.id;

        const [attachment] = await pool.query(
            `SELECT a.*, n.user_id AS note_owner_id, n.folder_id, n.shared_roles
             FROM note_attachments a
             JOIN notes n ON a.note_id = n.id
             WHERE a.id = ?`,
            [attachmentId]
        );

        if (attachment.length === 0) {
            return res.status(404).json({ success: false, message: 'Attachment not found' });
        }

        const att = attachment[0];
        let role = null;
        if (att.note_owner_id === userId) {
            role = 'owner';
        } else {
            const roles = typeof att.shared_roles === 'string'
                ? JSON.parse(att.shared_roles || '{}')
                : (att.shared_roles || {});
            if (roles[userId]) {
                role = roles[userId];
            } else if (att.folder_id) {
                const [[fs]] = await pool.query(
                    'SELECT role FROM note_folder_shares WHERE folder_id = ? AND shared_with_user_id = ? LIMIT 1',
                    [att.folder_id, userId]
                );
                if (fs) role = fs.role || 'viewer';
            }
        }
        if (role !== 'owner' && role !== 'editor') {
            return res.status(403).json({ success: false, message: 'Read-only access; you cannot delete this attachment' });
        }

        // B9: Path traversal guard — ensure resolved path is within uploadDir
        const filePath = path.resolve(__dirname, '../..', attachment[0].filepath);
        if (!filePath.startsWith(uploadDir + path.sep) && filePath !== uploadDir) {
            console.error('Path traversal attempt blocked:', attachment[0].filepath);
            return res.status(400).json({ success: false, message: 'Invalid file path' });
        }

        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        await pool.query('DELETE FROM note_attachments WHERE id = ?', [attachmentId]);
        res.json({ success: true, message: 'Attachment deleted' });
    } catch (error) {
        console.error('Delete attachment error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete attachment' });
    }
});

module.exports = router;
