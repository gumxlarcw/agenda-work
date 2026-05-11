-- 2026-04-28 — Backfill notes.position_x/y from note_user_state
--
-- Background: prior to commit 94b0619, the bulk-position endpoint
-- (PUT /api/notes/positions/bulk) wrote to note_user_state — a per-user
-- table that was never read back by any GET handler. This left
-- notes.position_x/y stale, so receivers in shared folders saw the
-- auto-grid layout instead of the owner's actual drag positions.
--
-- This migration copies each note owner's most recent per-user state
-- into the master notes.position_* columns. The JOIN constraint
-- s.user_id = n.user_id ensures we only promote rows that belong to
-- the note's owner — receivers' rows (if any leaked through the old
-- code path) are intentionally ignored so they don't influence the
-- canonical layout receivers see.
--
-- Idempotent: running twice produces the same result.

UPDATE notes n
JOIN note_user_state s
  ON s.note_id = n.id
 AND s.user_id = n.user_id
SET n.position_x  = s.position_x,
    n.position_y  = s.position_y,
    n.card_width  = COALESCE(s.card_width,  n.card_width),
    n.card_height = COALESCE(s.card_height, n.card_height)
WHERE s.position_x IS NOT NULL
  AND s.position_y IS NOT NULL;
