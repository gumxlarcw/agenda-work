#!/usr/bin/env node
/**
 * One-time backfill script: creates reminders for existing data
 * 1. All incomplete tasks → recurring reminders
 * 2. All future events → H-3/H-1/Hari-H reminders
 * 3. All future kegiatan → H-3/H-1/Hari-H for ALL users
 *
 * Usage: node backend/scripts/backfill-reminders.js
 */

const pool = require('../src/config/database');
const taskSyncService = require('../src/services/task-sync.service');

async function backfill() {
    console.log('=== Backfill Reminders ===\n');

    // 1. Incomplete tasks → recurring reminders
    const [tasks] = await pool.query(`
        SELECT t.*, u.username
        FROM tasks t JOIN users u ON t.user_id = u.id
        WHERE t.status NOT IN ('Completed', 'Cancelled')
    `);
    console.log(`[Tasks] Found ${tasks.length} incomplete tasks`);
    for (const task of tasks) {
        await taskSyncService.syncTaskRecurringReminder(task);
    }
    console.log('[Tasks] Done\n');

    // 2. Future events → H-3/H-1/Hari-H for event owner
    const [events] = await pool.query('SELECT id FROM events WHERE start_date >= CURDATE()');
    console.log(`[Events] Found ${events.length} future events`);
    for (const event of events) {
        await taskSyncService.syncEventReminders(event.id);
    }
    console.log('[Events] Done\n');

    // 3. Future kegiatan → H-3/H-1/Hari-H for ALL users
    const [kegiatanList] = await pool.query('SELECT id FROM kegiatan WHERE start_date >= CURDATE()');
    console.log(`[Kegiatan] Found ${kegiatanList.length} future kegiatan`);
    for (const k of kegiatanList) {
        await taskSyncService.syncKegiatanReminders(k.id);
    }
    console.log('[Kegiatan] Done\n');

    // Summary
    const [reminderCount] = await pool.query('SELECT COUNT(*) as total FROM reminders WHERE is_completed = FALSE AND is_active = TRUE');
    console.log(`=== Backfill complete. Total active reminders: ${reminderCount[0].total} ===`);

    process.exit(0);
}

backfill().catch(err => {
    console.error('Backfill failed:', err);
    process.exit(1);
});
