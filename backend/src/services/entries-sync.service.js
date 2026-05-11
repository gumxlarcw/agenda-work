/**
 * Entries Sync Service
 * Auto-generates /root/.openclaw/workspace/work/entries.md from MySQL tasks table.
 * One-way sync: MySQL → entries.md (MySQL is source of truth)
 */

const pool = require('../config/database');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

const ENTRIES_FILE = process.env.ENTRIES_FILE || '/root/.openclaw/workspace/work/entries.md';
// #23: require explicit config — previously defaulted to user id 2 which silently failed
// if that user was ever deleted. Setting to 0/NaN disables the sync with a clear log.
const ENTRIES_SYNC_USER_ID_RAW = process.env.ENTRIES_SYNC_USER_ID;
const ENTRIES_SYNC_USER_ID = ENTRIES_SYNC_USER_ID_RAW ? parseInt(ENTRIES_SYNC_USER_ID_RAW) : 0;
if (!ENTRIES_SYNC_USER_ID) {
    console.warn('[EntriesSync] ENTRIES_SYNC_USER_ID not set — entries.md sync disabled.');
}

class EntriesSyncService {

    /**
     * Generate entries.md from MySQL tasks
     */
    async syncEntries() {
        if (!ENTRIES_SYNC_USER_ID) return { success: true, synced: 0, skipped: true };
        try {
            const [tasks] = await pool.query(`
                SELECT id, prefix, task, kegiatan, rencana_kinerja, priority, status,
                       DATE_FORMAT(start_date, '%d/%m/%Y') as start_date_fmt,
                       DATE_FORMAT(end_date, '%d/%m/%Y') as end_date_fmt,
                       DATE_FORMAT(start_date, '%Y-%m') as month_key,
                       capaian, bukti_dukung
                FROM tasks
                WHERE user_id = ?
                ORDER BY start_date ASC, id ASC
            `, [ENTRIES_SYNC_USER_ID]);

            if (tasks.length === 0) {
                console.log(`[entries-sync] No tasks found for user ${ENTRIES_SYNC_USER_ID}`);
                return { success: true, synced: 0 };
            }

            // Group tasks by month
            const months = {};
            for (const task of tasks) {
                const key = task.month_key || 'unknown';
                if (!months[key]) months[key] = [];
                months[key].push(task);
            }

            // Build markdown
            const now = new Date();
            const pad2 = n => String(n).padStart(2, '0');
            const dateStr = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${now.getFullYear()}`;

            let md = `# ENTRIES — Database Pekerjaan Wisnu (BPS)\n\n`;
            md += `Last updated: ${dateStr}\n\n`;
            md += `---\n\n`;
            md += `## Format Kolom\n`;
            md += `Kegiatan | Rencana Kinerja | Priority | Status | Start Date | End Date | Capaian | Bukti Dukung\n\n`;
            md += `---\n`;

            // Sort month keys chronologically
            const sortedMonths = Object.keys(months).sort();

            for (const monthKey of sortedMonths) {
                md += `\n## ${monthKey}\n`;

                let entryNum = 1;
                for (const task of months[monthKey]) {
                    const entryId = String(entryNum).padStart(3, '0');
                    const statusMapped = this.mapStatus(task.status);
                    const kegiatan = task.kegiatan || `${task.prefix} ${task.task}`;
                    const rencanaKinerja = task.rencana_kinerja || '*(kosong)*';
                    const capaian = task.capaian || '*(belum)*';
                    const buktiDukung = task.bukti_dukung || '*(belum)*';

                    md += `\n### Entry ${entryId} (Task #${task.id})\n`;
                    md += `| Kolom | Isi |\n`;
                    md += `|---|---|\n`;
                    md += `| Kegiatan | ${kegiatan} |\n`;
                    md += `| Rencana Kinerja | ${rencanaKinerja} |\n`;
                    md += `| Priority | ${task.priority} |\n`;
                    md += `| Status | ${statusMapped} |\n`;
                    md += `| Start Date | ${task.start_date_fmt} |\n`;
                    md += `| End Date | ${task.end_date_fmt} |\n`;
                    md += `| Capaian | ${capaian} |\n`;
                    md += `| Bukti Dukung | ${buktiDukung} |\n`;

                    entryNum++;
                }
            }

            // Ensure directory exists
            const dir = path.dirname(ENTRIES_FILE);
            await fsPromises.mkdir(dir, { recursive: true });

            // Write file
            await fsPromises.writeFile(ENTRIES_FILE, md, 'utf8');

            console.log(`[${new Date().toISOString()}] entries.md synced: ${tasks.length} tasks across ${sortedMonths.length} months`);
            return { success: true, synced: tasks.length };

        } catch (error) {
            console.error('[entries-sync] Error:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Map MySQL status to entries.md status
     */
    mapStatus(mysqlStatus) {
        const map = {
            'Pending': 'Not Started',
            'In Progress': 'In Progress',
            'Completed': 'Completed',
            'On Hold': 'Cancelled-Blocked',
            'Cancelled': 'Cancelled-Blocked'
        };
        return map[mysqlStatus] || mysqlStatus;
    }
}

module.exports = new EntriesSyncService();
