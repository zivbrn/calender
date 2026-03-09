const config = require('./config');
const { initSchema } = require('./db/schema');
const app = require('./app');
const cron = require('node-cron');
const { enqueueSync, isAutoSyncPaused } = require('./queue/sync-queue');
const { getConnectedUsers } = require('./db/users');

// Initialize database
initSchema();

// Migrate: add sync_schedule column if missing (for existing DBs)
try {
  const { getDb } = require('./db/connection');
  getDb().exec(`ALTER TABLE users ADD COLUMN sync_schedule TEXT DEFAULT 'daily'`);
} catch (e) {
  // Column already exists — ignore
}

// Start server
app.listen(config.port, () => {
  console.log(`X Campus Calendar Sync running on http://localhost:${config.port}`);
});

// Run hourly — checks each user's preferred schedule
cron.schedule('0 * * * *', () => {
  const now = new Date();
  const hour = now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', hour: 'numeric', hour12: false });
  const currentHour = parseInt(hour, 10);

  const users = getConnectedUsers();
  for (const user of users) {
    let shouldSync = false;
    switch (user.sync_schedule) {
      case 'every6h':
        shouldSync = currentHour % 6 === 0;
        break;
      case 'every12h':
        shouldSync = currentHour % 12 === 0;
        break;
      case 'daily':
      default:
        shouldSync = currentHour === 6; // 6 AM Israel time
        break;
    }

    if (shouldSync) {
      if (isAutoSyncPaused()) {
        console.log(`[${now.toISOString()}] Auto-sync is paused — skipping scheduled sync for user ${user.id}.`);
        continue;
      }
      console.log(`[${now.toISOString()}] Scheduled sync for user ${user.id} (${user.sync_schedule})`);
      enqueueSync(user.id, 'scheduled');
    }
  }
}, {
  timezone: 'Asia/Jerusalem',
});

console.log('Cron running: checks every hour, syncs users based on their schedule preference.');
