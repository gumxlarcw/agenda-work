-- Rollback for 2026-04-27-notes-restoration.sql
-- WARNING: coerces any new enum values to 'edited' before shrinking.

UPDATE note_activity_log
  SET action = 'edited'
  WHERE action NOT IN ('created','edited','shared','archived','unarchived','pinned','unpinned');

ALTER TABLE note_activity_log
  MODIFY action ENUM('created','edited','shared','archived','unarchived','pinned','unpinned') NOT NULL;

ALTER TABLE note_public_shares
  DROP COLUMN expires_at;

ALTER TABLE note_activity_log     DROP INDEX idx_activity_note_time;
ALTER TABLE note_public_shares    DROP INDEX idx_public_share_token_active;

ALTER TABLE note_user_state DROP INDEX uniq_note_user;
