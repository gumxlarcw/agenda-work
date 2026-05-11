-- =============================================
-- AGENDA WORK DATABASE SCHEMA
-- Database: agenda_work_db
-- =============================================

CREATE DATABASE IF NOT EXISTS agenda_work_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE agenda_work_db;

-- =============================================
-- USERS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone_number VARCHAR(20) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin', 'user') DEFAULT 'user',
    must_change_password BOOLEAN DEFAULT FALSE,
    dashboard_layout JSON DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_users_email (email),
    INDEX idx_users_phone (phone_number),
    INDEX idx_users_role (role)
) ENGINE=InnoDB;

-- =============================================
-- SESSIONS TABLE (for express-mysql-session)
-- =============================================
CREATE TABLE IF NOT EXISTS sessions (
    session_id VARCHAR(128) PRIMARY KEY,
    expires INT UNSIGNED NOT NULL,
    data MEDIUMTEXT,
    INDEX idx_sessions_expires (expires)
) ENGINE=InnoDB;

-- =============================================
-- REFRESH TOKENS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token VARCHAR(500) NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_refresh_tokens_token (token(255)),
    INDEX idx_refresh_tokens_expires (expires_at)
) ENGINE=InnoDB;

-- =============================================
-- TASKS TABLE (Main Work Management)
-- =============================================
CREATE TABLE IF NOT EXISTS tasks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    task VARCHAR(255) NOT NULL,
    prefix ENUM('Membuat', 'Melakukan', 'Mengikuti', 'Mengisi', 'Memberikan', 'Mengumpulkan') NOT NULL,
    kegiatan TEXT,
    rencana_kinerja TEXT,
    priority ENUM('P0', 'P1', 'P2', 'P3') DEFAULT 'P2',
    status ENUM('Pending', 'In Progress', 'Completed', 'On Hold', 'Cancelled') DEFAULT 'Pending',
    start_date DATE,
    end_date DATE,
    capaian TEXT,
    bukti_dukung TEXT,
    notes TEXT,
    jumlah_hari INT GENERATED ALWAYS AS (DATEDIFF(end_date, start_date) + 1) STORED,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_tasks_user (user_id),
    INDEX idx_tasks_status (status),
    INDEX idx_tasks_priority (priority),
    INDEX idx_tasks_dates (start_date, end_date)
) ENGINE=InnoDB;

-- =============================================
-- NOTES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS notes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT,
    category VARCHAR(100),
    is_pinned BOOLEAN DEFAULT FALSE,
    color VARCHAR(20) DEFAULT '#ffffff',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_notes_user (user_id),
    INDEX idx_notes_pinned (is_pinned)
) ENGINE=InnoDB;

-- =============================================
-- REMINDERS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS reminders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    reminder_datetime DATETIME NOT NULL,
    repeat_type ENUM('None', 'Daily', 'Weekly', 'Monthly', 'Yearly') DEFAULT 'None',
    is_active BOOLEAN DEFAULT TRUE,
    is_completed BOOLEAN DEFAULT FALSE,
    is_sent TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_reminders_user (user_id),
    INDEX idx_reminders_datetime (reminder_datetime),
    INDEX idx_reminders_active (is_active),
    INDEX idx_reminders_sent (is_sent)
) ENGINE=InnoDB;

-- =============================================
-- TODOS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS todos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    is_completed BOOLEAN DEFAULT FALSE,
    priority ENUM('Low', 'Medium', 'High') DEFAULT 'Medium',
    due_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_todos_user (user_id),
    INDEX idx_todos_completed (is_completed),
    INDEX idx_todos_due (due_date)
) ENGINE=InnoDB;

-- =============================================
-- SEED ADMIN USER
-- Password: 'admin' (will be hashed by the app)
-- Temporary plain hash for initial setup - app will rehash on first login
-- =============================================
-- Note: The actual admin user will be created by the seed script with proper bcrypt hashing

-- =============================================
-- EVENTS TABLE (Timeline Events)
-- =============================================
CREATE TABLE IF NOT EXISTS events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    description TEXT,
    category VARCHAR(100),
    color VARCHAR(20) DEFAULT '#3b82f6',
    priority ENUM('Low', 'Medium', 'High') DEFAULT 'Medium',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_events_user (user_id),
    INDEX idx_events_dates (start_date, end_date)
) ENGINE=InnoDB;

-- =============================================
-- KEGIATAN TABLE (Calendar Activities)
-- =============================================
CREATE TABLE IF NOT EXISTS kegiatan (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    time_start TIME DEFAULT NULL,
    time_end TIME DEFAULT NULL,
    description TEXT,
    category VARCHAR(100),
    color VARCHAR(20) DEFAULT '#10b981',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_kegiatan_user (user_id),
    INDEX idx_kegiatan_dates (start_date, end_date)
) ENGINE=InnoDB;

-- =============================================
-- USER NOTIFICATION SETTINGS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS automation_runs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    run_type ENUM('dry-run', 'live') DEFAULT 'dry-run',
    status ENUM('pending', 'running', 'waiting_otp', 'completed', 'failed', 'cancelled') DEFAULT 'pending',
    year INT NOT NULL,
    month INT NOT NULL,
    total_tasks INT DEFAULT 0,
    processed INT DEFAULT 0,
    skipped INT DEFAULT 0,
    failed_tasks INT DEFAULT 0,
    log TEXT,
    error_message TEXT,
    started_at DATETIME DEFAULT NULL,
    completed_at DATETIME DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_run_status (status),
    INDEX idx_run_user (user_id)
) ENGINE=InnoDB;

-- =============================================
-- USER NOTIFICATION SETTINGS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS user_notification_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT FALSE,
    notification_time TIME DEFAULT '07:00:00',
    notification_days JSON DEFAULT '["Monday","Tuesday","Wednesday","Thursday","Friday"]',
    notification_types JSON DEFAULT '["daily"]',
    last_sent_at DATETIME DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_notif_active (is_active)
) ENGINE=InnoDB;
