/**
 * Task Sync & Unified Digest Daemon
 * 1. Syncs incomplete tasks to todos (every 5 min)
 * 2. Syncs entries.md from MySQL (every 5 min)
 * 3. Sends unified LLM-powered digest at user's notification_time (check every 60s)
 * 4. Advances recurring custom reminders (every 5 min)
 * 5. Generates overdue task reminders (daily at 00:05 WIT)
 */

const taskSyncService = require('./src/services/task-sync.service');
const entriesSyncService = require('./src/services/entries-sync.service');
const notificationScheduler = require('./src/services/notification-scheduler.service');

const SYNC_INTERVAL = process.env.SYNC_INTERVAL || 5 * 60 * 1000; // 5 minutes

console.log('='.repeat(50));
console.log('Agenda Work - Task Sync & Digest Daemon');
console.log('='.repeat(50));
console.log(`Sync interval: ${SYNC_INTERVAL / 1000}s`);
console.log('');

let lastOverdueDate = null;

// #48: simple consecutive-error counter. If either sub-task fails N times in a row,
// we log a LOUD alert so it's visible in the PM2 log stream without combing the tail.
// The daemon continues to try — the counter is just a signal, not a kill switch.
const FAILURE_ALERT_THRESHOLD = 5;
const failureCounts = { taskSync: 0, entries: 0, overdue: 0 };

function trackFailure(key, err) {
    failureCounts[key] = (failureCounts[key] || 0) + 1;
    console.error(`[Daemon] ${key} failed (streak ${failureCounts[key]}):`, err?.message || err);
    if (failureCounts[key] >= FAILURE_ALERT_THRESHOLD) {
        console.error(`[Daemon] !!! ${key} has failed ${failureCounts[key]}× in a row — investigate !!!`);
    }
}
function trackSuccess(key) { failureCounts[key] = 0; }

async function runSync() {
    try {
        const result = await taskSyncService.syncAllTasks();
        if (result.success) {
            console.log(`Task sync: ${result.synced} tasks processed.`);
            trackSuccess('taskSync');
        } else {
            trackFailure('taskSync', result.error);
        }
    } catch (err) {
        trackFailure('taskSync', err);
    }

    try {
        const entriesResult = await entriesSyncService.syncEntries();
        if (entriesResult.success) {
            if (!entriesResult.skipped) console.log(`entries.md: ${entriesResult.synced} tasks written.`);
            trackSuccess('entries');
        } else {
            trackFailure('entries', entriesResult.error);
        }
    } catch (err) {
        trackFailure('entries', err);
    }

    // Generate overdue reminders once per day
    const today = new Date().toISOString().slice(0, 10);
    if (lastOverdueDate !== today) {
        lastOverdueDate = today;
        try {
            await taskSyncService.generateOverdueReminders();
            trackSuccess('overdue');
        } catch (err) {
            trackFailure('overdue', err);
        }
    }
}

// Run initial sync
runSync();

// Periodic sync (every 5 minutes)
setInterval(runSync, SYNC_INTERVAL);

// Unified digest check (every 60 seconds)
setInterval(() => notificationScheduler.checkAndSendNotifications(), 60 * 1000);

// Advance recurring custom reminders (every 5 minutes)
setInterval(() => notificationScheduler.processRecurringReminders(), 5 * 60 * 1000);

console.log('Daemon running:');
console.log('  - Task + entries sync: every 5 min');
console.log('  - Digest check: every 60s');
console.log('  - Recurring reminder advance: every 5 min');
console.log('  - Overdue reminder generation: daily');
console.log('');
