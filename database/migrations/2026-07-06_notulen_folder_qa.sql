-- 2026-07-06 — Notulen folder Q&A: riwayat "Tanya AI per folder"
-- Rollback: DROP TABLE notulen_folder_qa;

CREATE TABLE IF NOT EXISTS notulen_folder_qa (
    id INT(11) NOT NULL AUTO_INCREMENT,
    folder_id INT(11) NOT NULL,
    user_id INT(11) NOT NULL,
    question TEXT NOT NULL,
    answer MEDIUMTEXT NULL,
    status ENUM('processing','done','error') NOT NULL DEFAULT 'processing',
    error_message VARCHAR(500) NULL,
    sessions_covered INT(11) NULL,
    batch_failed INT(11) NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    answered_at TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_nfq_folder (folder_id, created_at),
    CONSTRAINT fk_nfq_folder FOREIGN KEY (folder_id) REFERENCES notulen_folders(id) ON DELETE CASCADE,
    CONSTRAINT fk_nfq_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
