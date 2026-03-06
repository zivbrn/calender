const express = require('express');
const { requireAuth } = require('../auth/middleware');
const { enqueueSync, isUserSyncing } = require('../queue/sync-queue');
const { enqueueImport, isUserImporting, getImportResult } = require('../queue/import-queue');
const { getLatestSyncLog } = require('../db/users');

const router = express.Router();

router.post('/sync', requireAuth, (req, res) => {
  const userId = req.session.user.id;

  if (isUserSyncing(userId)) {
    return res.json({ ok: false, message: 'סנכרון כבר מתבצע, נא להמתין.' });
  }

  const enqueued = enqueueSync(userId, 'manual');
  res.json({ ok: enqueued, message: enqueued ? 'הסנכרון התחיל.' : 'סנכרון כבר מתבצע.' });
});

router.get('/sync/status', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const syncing = isUserSyncing(userId);
  const latest = getLatestSyncLog(userId);

  res.json({ syncing, latest });
});

router.post('/import-next-moed', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  if (isUserImporting(userId)) {
    return res.json({ ok: false, message: 'ייבוא כבר מתבצע, נא להמתין.' });
  }
  enqueueImport(userId); // runs async in background
  res.json({ ok: true, message: 'הייבוא התחיל.' });
});

router.get('/import-next-moed/status', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const importing = isUserImporting(userId);
  const result = getImportResult(userId);
  res.json({ importing, result });
});

module.exports = router;
