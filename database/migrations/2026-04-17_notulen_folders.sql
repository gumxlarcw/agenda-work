-- 2026-04-17 — Notulen folders + folder_id on sessions
-- Rollback:
--   ALTER TABLE notulen_sessions DROP FOREIGN KEY fk_notulen_sessions_folder, DROP KEY idx_folder, DROP COLUMN folder_id;
--   DROP TABLE notulen_folders;

CREATE TABLE IF NOT EXISTS notulen_folders (
    id INT(11) NOT NULL AUTO_INCREMENT,
    user_id INT(11) NOT NULL,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(20) NOT NULL DEFAULT 'blue',
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_user (user_id),
    CONSTRAINT fk_notulen_folders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE notulen_sessions
    ADD COLUMN folder_id INT(11) NULL AFTER status,
    ADD KEY idx_folder (folder_id),
    ADD CONSTRAINT fk_notulen_sessions_folder FOREIGN KEY (folder_id) REFERENCES notulen_folders(id) ON DELETE SET NULL;
