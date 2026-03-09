const { execSync } = require('child_process');
const os = require('os');
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

const RETRY_DELAY_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 2;
const MIN_FREE_RAM_MB = 180; // minimum free RAM before launching Chromium

function isRetryableError(err) {
  const msg = err.message || '';
  return msg.includes('Timeout') || msg.includes('net::') ||
    msg.includes('ECONNREFUSED') || msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT');
}

function killZombieChromium() {
  try {
    execSync('pkill -f chrome-headless-shell 2>/dev/null || true', { timeout: 5000, shell: true });
  } catch (_) { /* ignore */ }
}

function checkMemory() {
  const freeMb = Math.round(os.freemem() / 1024 / 1024);
  if (freeMb < MIN_FREE_RAM_MB) {
    throw new Error(`Not enough memory to launch browser: ${freeMb}MB free (need ${MIN_FREE_RAM_MB}MB). Will retry later.`);
  }
}

// Simple serial queue — one browser at a time
const queue = [];
let running = false;
let paused = false;

// Track in-progress syncs by userId
const activeUsers = new Set();

function enqueueSync(userId, triggerType = 'manual', retryCount = 0) {
  if (activeUsers.has(userId)) {
    console.log(`Sync already in progress for user ${userId}, skipping.`);
    return false;
  }
  queue.push({ userId, triggerType, retryCount });
  processQueue();
  return true;
}

async function processQueue() {
  if (running || queue.length === 0) return;
  running = true;

  const { userId, triggerType, retryCount = 0 } = queue.shift();
  activeUsers.add(userId);

  let browser;
  let scheduleRetry = false;
  try {
    console.log(`[${new Date().toISOString()}] Starting sync for user ${userId}${retryCount > 0 ? ` (retry ${retryCount}/${MAX_RETRIES})` : ''}...`);

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

    // 2. Kill any leftover Chromium processes, check memory, then launch
    killZombieChromium();
    checkMemory();
    const result = await login({ username, password, headless: true });
    browser = result.browser;

    const now = new Date();
    const throughDate = new Date(now.getFullYear(), now.getMonth() + 2, 1);
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
      const msg = 'הסקריפר לא מצא אירועים — הסנכרון הופסק כדי למנוע מחיקה. בדוק שיש שיעורים ב-X Campus.';
      console.warn(`[${new Date().toISOString()}] Sync warning for user ${userId}: scraper returned 0 events, skipping to avoid clearing calendar.`);
      createSyncLog(userId, 'error', null, triggerType, msg);
      await trySendNotification(userId, 'error', { error: msg, triggerType });
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
    if (retryCount < MAX_RETRIES && isRetryableError(err)) {
      console.warn(`[${new Date().toISOString()}] Sync failed for user ${userId} (attempt ${retryCount + 1}/${MAX_RETRIES + 1}), retrying in 5 min: ${err.message.split('\n')[0]}`);
      scheduleRetry = true;
    } else {
      console.error(`[${new Date().toISOString()}] Sync failed for user ${userId}:`, err.message);
      const cleanedError = cleanError(err);
      createSyncLog(userId, 'error', null, triggerType, cleanedError);
      notifySyncResult('error', null, cleanedError);
      await trySendNotification(userId, 'error', { error: cleanedError, triggerType });
    }
  } finally {
    if (browser) await browser.close();
    activeUsers.delete(userId);
    running = false;
    if (scheduleRetry) {
      setTimeout(() => enqueueSync(userId, triggerType, retryCount + 1), RETRY_DELAY_MS);
    }
    processQueue(); // Process next item
  }
}

function isUserSyncing(userId) {
  return activeUsers.has(userId);
}

function pauseAutoSync() {
  paused = true;
  console.log(`[${new Date().toISOString()}] Auto-sync paused.`);
}

function resumeAutoSync() {
  paused = false;
  console.log(`[${new Date().toISOString()}] Auto-sync resumed.`);
}

function isAutoSyncPaused() {
  return paused;
}

function getQueueStatus() {
  return {
    queueLength: queue.length,
    activeUsers: [...activeUsers],
    running,
    paused,
  };
}

async function runSyncForAllUsers(triggerType = 'scheduled') {
  const users = getConnectedUsers();
  console.log(`Running scheduled sync for ${users.length} connected user(s).`);
  for (const user of users) {
    enqueueSync(user.id, triggerType);
  }
}

module.exports = {
  enqueueSync, isUserSyncing, runSyncForAllUsers,
  pauseAutoSync, resumeAutoSync, isAutoSyncPaused, getQueueStatus,
};
