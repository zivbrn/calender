const notifier = require('node-notifier');

function notifySyncResult(status, stats, error) {
  if (status === 'success') {
    const { inserted = 0, updated = 0, deleted = 0 } = stats || {};
    const parts = [];
    if (inserted) parts.push(`+${inserted} נוספו`);
    if (updated) parts.push(`~${updated} עודכנו`);
    if (deleted) parts.push(`-${deleted} הוסרו`);
    const message = parts.length ? parts.join(', ') : 'ללא שינויים';

    notifier.notify({
      title: 'סנכרון יומן הצליח ✓',
      message,
      appID: 'X Campus Calendar Sync',
      timeout: 8,
      withFallback: false,
    });
  } else {
    notifier.notify({
      title: 'סנכרון יומן נכשל ✗',
      message: error || 'שגיאה לא ידועה — בדוק את ההגדרות',
      appID: 'X Campus Calendar Sync',
      timeout: 12,
      withFallback: false,
    });
  }
}

module.exports = { notifySyncResult };
