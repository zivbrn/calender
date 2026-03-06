const { login } = require('../scraper/login');
const { scrapeSchedule } = require('../scraper/schedule');
const { scrapeStudents } = require('../scraper/students');
const { syncEvents } = require('../calendar/sync');
const { getCalendarClientForUser } = require('../auth/google-oauth');
const { decrypt } = require('../crypto/encrypt');
const {
  getPsychometrixCredentials,
  getGoogleTokens,
  createSyncLog,
  saveSyncedEvents,
  saveStudentContacts,
  getConnectedUsers,
  getNotificationSettings,
  findUserById,
} = require('../db/users');
const { sendSyncNotification } = require('../email/notify');
const { notifySyncResult } = require('../notify/desktop');

async function trySendNotification(userId, status, { stats, error, triggerType }) {
  try {
    const notif = getNotificationSettings(userId);
    if (!notif.enabled || !notif.email || !notif.appPassword) return;
    await sendSyncNotification({
      toEmail: notif.toEmail || notif.email,
      gmailUser: notif.email,
      gmailPass: notif.appPassword,
      status,
      stats,
      error,
      triggerType,
    });
    console.log(`Notification email sent to ${notif.email}`);
  } catch (e) {
    console.error('Failed to send notification email:', e.message);
  }
}

function cleanError(err) {
  const msg = err.message || String(err);
  // Playwright crash — extract the exit code line only
  if (msg.includes('--disable-') || msg.includes('chrome-headless')) {
    const exitMatch = msg.match(/process did exit: exitCode=(\d+)/);
    if (exitMatch) return `הדפדפן קרס בזמן הסנכרון (קוד: ${exitMatch[1]})`;
    return 'הדפדפן קרס בזמן הסנכרון';
  }
  // Truncate anything else to 200 chars
  return msg.length > 200 ? msg.substring(0, 200) + '...' : msg;
}

// Simple serial queue — one browser at a time
const queue = [];
let running = false;

// Track in-progress syncs by userId
const activeUsers = new Set();

function enqueueSync(userId, triggerType = 'manual') {
  if (activeUsers.has(userId)) {
    console.log(`Sync already in progress for user ${userId}, skipping.`);
    return false;
  }
  queue.push({ userId, triggerType });
  processQueue();
  return true;
}

async function processQueue() {
  if (running || queue.length === 0) return;
  running = true;

  const { userId, triggerType } = queue.shift();
  activeUsers.add(userId);

  let browser;
  try {
    console.log(`[${new Date().toISOString()}] Starting sync for user ${userId}...`);

    // 1. Decrypt Psychometrix credentials
    const creds = getPsychometrixCredentials(userId);
    if (!creds) throw new Error('לא נמצאו פרטי התחברות ל-X Campus. הזן אותם בהגדרות.');

    const username = decrypt({
      encrypted: creds.encrypted_username,
      iv: creds.iv_username,
      tag: creds.tag_username,
    });
    const password = decrypt({
      encrypted: creds.encrypted_password,
      iv: creds.iv_password,
      tag: creds.tag_password,
    });

    // 2. Login + scrape
    const result = await login({ username, password, headless: true });
    browser = result.browser;

    const now = new Date();
    const throughDate = new Date(now.getFullYear(), now.getMonth() + 6, 1);
    const events = await scrapeSchedule(result.page, {
      throughMonth: throughDate.getMonth() + 1,
      throughYear: throughDate.getFullYear(),
    });

    // Scrape student contacts (same browser session)
    try {
      const { contacts, moedLabel } = await scrapeStudents(result.page);
      if (contacts.length > 0) {
        saveStudentContacts(userId, contacts, moedLabel);
        console.log(`Saved ${contacts.length} student contact(s) for מועד "${moedLabel}" (user ${userId}).`);
      }
    } catch (studentErr) {
      console.error(`Student scraping failed (non-fatal): ${studentErr.message}`);
    }

    // Close browser before syncing
    await browser.close();
    browser = null;

    if (events.length === 0) {
      console.log('No events scraped — skipping Google Calendar sync.');
      createSyncLog(userId, 'success', { inserted: 0, updated: 0, skipped: 0, deleted: 0 }, triggerType);
      return;
    }

    // 3. Sync to Google Calendar
    const tokens = getGoogleTokens(userId);
    if (!tokens) throw new Error('יומן גוגל לא מחובר. חבר אותו בהגדרות.');

    const calendarClient = getCalendarClientForUser(
      { access_token: tokens.access_token, refresh_token: tokens.refresh_token, expiry_date: tokens.expiry_date },
      userId
    );
    const calendarId = tokens.calendar_id || 'primary';

    const stats = await syncEvents(events, { calendarClient, calendarId });

    // 4. Log + save events
    const syncId = createSyncLog(userId, 'success', stats, triggerType);
    saveSyncedEvents(userId, syncId, events);

    console.log(`[${new Date().toISOString()}] Sync completed for user ${userId}.`);

    // 5. Notifications
    notifySyncResult('success', stats);
    await trySendNotification(userId, 'success', { stats, triggerType });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Sync failed for user ${userId}:`, err.message);
    const cleanedError = cleanError(err);
    createSyncLog(userId, 'error', null, triggerType, cleanedError);
    notifySyncResult('error', null, cleanedError);
    await trySendNotification(userId, 'error', { error: cleanedError, triggerType });
  } finally {
    if (browser) await browser.close();
    activeUsers.delete(userId);
    running = false;
    processQueue(); // Process next item
  }
}

function isUserSyncing(userId) {
  return activeUsers.has(userId);
}

async function runSyncForAllUsers(triggerType = 'scheduled') {
  const users = getConnectedUsers();
  console.log(`Running scheduled sync for ${users.length} connected user(s).`);
  for (const user of users) {
    enqueueSync(user.id, triggerType);
  }
}

module.exports = { enqueueSync, isUserSyncing, runSyncForAllUsers };
