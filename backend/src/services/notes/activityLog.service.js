const pool = require('../../config/database');

/**
 * Insert an activity-log row. Failures are logged but never thrown — instrumentation
 * must never break a user's actual write.
 *
 * @param {number} noteId
 * @param {number} userId
 * @param {string} action  - one of the enum values in note_activity_log.action
 * @param {object|null} details - optional structured payload (will be JSON-stringified)
 */
async function logNoteActivity(noteId, userId, action, details = null) {
  const detailsJson = details === null || details === undefined ? null : JSON.stringify(details);
  try {
    await pool.query(
      'INSERT INTO note_activity_log (note_id, user_id, action, details) VALUES (?, ?, ?, ?)',
      [noteId, userId, action, detailsJson]
    );
  } catch (err) {
    console.error('logNoteActivity failed:', { noteId, userId, action, message: err.message });
  }
}

/**
 * Fetch the last N activity entries for a note, joined with user names.
 */
async function getRecentActivity(noteId, limit = 20) {
  const [rows] = await pool.query(
    `SELECT nal.id, nal.action, nal.details, nal.created_at,
            COALESCE(u.name, u.username) AS user_name, nal.user_id
     FROM note_activity_log nal
     JOIN users u ON nal.user_id = u.id
     WHERE nal.note_id = ?
     ORDER BY nal.created_at DESC
     LIMIT ?`,
    [noteId, limit]
  );
  return rows;
}

module.exports = { logNoteActivity, getRecentActivity };
