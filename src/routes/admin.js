'use strict';

const express = require('express');
const { execSync } = require('child_process');
const os = require('os');
const router = express.Router();

const {
  enqueueSync,
  isUserSyncing,
  getQueueStatus,
  pauseAutoSync,
  resumeAutoSync,
} = require('../queue/sync-queue');
const { getRecentSyncLogs, getConnectedUsers } = require('../db/users');
const config = require('../config');

// API key auth — every admin request must include X-Admin-Key header
router.use((req, res, next) => {
  if (!config.adminApiKey) {
    return res.status(503).json({ error: 'Admin API is not configured (ADMIN_API_KEY not set).' });
  }
  if (req.headers['x-admin-key'] !== config.adminApiKey) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  next();
});

// GET /admin/health — server vitals
router.get('/health', (req, res) => {
  const mem = process.memoryUsage();
  const freeRam = os.freemem();
  const totalRam = os.totalmem();

  let chromiumProcesses = 0;
  try {
    const out = execSync('pgrep -c chrome-headless-shell 2>/dev/null || echo 0', {
      timeout: 3000, shell: true,
    }).toString().trim();
    chromiumProcesses = parseInt(out, 10) || 0;
  } catch (_) { /* ignore */ }

  const queueStatus = getQueueStatus();
  const users = getConnectedUsers();

  res.json({
    uptime: Math.floor(process.uptime()),
    memory: {
      processHeapMb: Math.round(mem.heapUsed / 1024 / 1024),
      freeRamMb: Math.round(freeRam / 1024 / 1024),
      totalRamMb: Math.round(totalRam / 1024 / 1024),
    },
    chromiumProcesses,
    queue: queueStatus,
    connectedUsers: users.length,
    users: users.map(u => ({
      id: u.id,
      email: u.email,
      syncing: isUserSyncing(u.id),
      schedule: u.sync_schedule,
    })),
  });
});

// GET /admin/logs?limit=N — recent sync logs across all users
router.get('/logs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 15, 50);
  const users = getConnectedUsers();

  const allLogs = [];
  for (const user of users) {
    const logs = getRecentSyncLogs(user.id, limit);
    for (const log of logs) {
      allLogs.push({ ...log, userEmail: user.email });
    }
  }

  allLogs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(allLogs.slice(0, limit));
});

// POST /admin/sync/trigger — trigger sync for all connected users
router.post('/sync/trigger', (req, res) => {
  const users = getConnectedUsers();
  if (users.length === 0) {
    return res.json({ ok: false, message: 'No connected users found.' });
  }
  let queued = 0;
  for (const user of users) {
    if (enqueueSync(user.id, 'admin')) queued++;
  }
  res.json({ ok: true, message: `Queued sync for ${queued} of ${users.length} user(s).`, queued });
});

// POST /admin/sync/trigger/:userId — trigger sync for a specific user
router.post('/sync/trigger/:userId', (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) return res.status(400).json({ error: 'Invalid userId.' });
  const enqueued = enqueueSync(userId, 'admin');
  res.json({ ok: enqueued, message: enqueued ? 'Sync queued.' : 'Sync already in progress for this user.' });
});

// POST /admin/sync/pause — pause scheduled (auto) syncs
router.post('/sync/pause', (req, res) => {
  pauseAutoSync();
  res.json({ ok: true, message: 'Auto-sync paused. Manual syncs still work.' });
});

// POST /admin/sync/resume — resume scheduled syncs
router.post('/sync/resume', (req, res) => {
  resumeAutoSync();
  res.json({ ok: true, message: 'Auto-sync resumed.' });
});

// GET /admin/sync/status — queue state only
router.get('/sync/status', (req, res) => {
  res.json(getQueueStatus());
});

module.exports = router;
