-- 2026-04-27 — Notes module restoration
-- Additive, idempotent. See docs/superpowers/specs/2026-04-27-notes-restoration-and-hardening-design.md

-- 1. Expand note_activity_log.action enum from 7 to 18 values.
ALTER TABLE note_activity_log
  MODIFY action ENUM(
    'created','edited','title_edited','content_edited',
    'folder_moved','tag_changed','color_changed',
    'pinned','unpinned','archived','unarchived',
    'shared','share_revoked',
    'public_link_created','public_link_revoked',
    'status_changed','connection_added','connection_removed'
  ) NOT NULL;

-- 2. Add expires_at to public shares (NULL = never expires).
ALTER TABLE note_public_shares
  ADD COLUMN expires_at TIMESTAMP NULL DEFAULT NULL AFTER is_active;

-- 3. Performance indexes (MySQL 8 / MariaDB 10.5+ supports IF NOT EXISTS on ADD INDEX).
ALTER TABLE note_activity_log
  ADD INDEX IF NOT EXISTS idx_activity_note_time (note_id, created_at DESC);

ALTER TABLE note_public_shares
  ADD INDEX IF NOT EXISTS idx_public_share_token_active (share_token, is_active);

-- 4. Ensure note_user_state has unique (note_id, user_id) for upsert.
DELETE n1 FROM note_user_state n1
JOIN note_user_state n2
  ON n1.note_id = n2.note_id AND n1.user_id = n2.user_id AND n1.id < n2.id;
ALTER TABLE note_user_state ADD UNIQUE KEY IF NOT EXISTS uniq_note_user (note_id, user_id);
