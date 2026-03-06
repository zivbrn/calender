const { getDb } = require('./connection');

function createUser(email, passwordHash, displayName) {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)'
  );
  const result = stmt.run(email, passwordHash, displayName || null);
  return result.lastInsertRowid;
}

function findUserByEmail(email) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function findUserById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// Psychometrix credentials
function savePsychometrixCredentials(userId, encUsername, encPassword) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO psychometrix_credentials
      (user_id, encrypted_username, iv_username, tag_username,
       encrypted_password, iv_password, tag_password, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  stmt.run(
    userId,
    encUsername.encrypted, encUsername.iv, encUsername.tag,
    encPassword.encrypted, encPassword.iv, encPassword.tag
  );
}

function getPsychometrixCredentials(userId) {
  const db = getDb();
  return db.prepare('SELECT * FROM psychometrix_credentials WHERE user_id = ?').get(userId);
}

// Google tokens
function saveGoogleTokens(userId, tokens, calendarId) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO google_tokens
      (user_id, access_token, refresh_token, expiry_date, calendar_id, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `);
  stmt.run(
    userId,
    tokens.access_token,
    tokens.refresh_token,
    tokens.expiry_date || null,
    calendarId || 'primary'
  );
}

function getGoogleTokens(userId) {
  const db = getDb();
  return db.prepare('SELECT * FROM google_tokens WHERE user_id = ?').get(userId);
}

function updateGoogleTokens(userId, tokens) {
  const db = getDb();
  const existing = getGoogleTokens(userId);
  if (!existing) return;

  const stmt = db.prepare(`
    UPDATE google_tokens
    SET access_token = ?, expiry_date = ?, updated_at = datetime('now')
    WHERE user_id = ?
  `);
  stmt.run(tokens.access_token, tokens.expiry_date || null, userId);
}

// Sync logs
function createSyncLog(userId, status, stats, triggerType, errorMessage) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO sync_logs (user_id, status, inserted, updated, skipped, deleted, error_message, trigger_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    userId, status,
    stats?.inserted || 0, stats?.updated || 0,
    stats?.skipped || 0, stats?.deleted || 0,
    errorMessage || null, triggerType || 'manual'
  );
  return result.lastInsertRowid;
}

function getLatestSyncLog(userId) {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM sync_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(userId);
}

function getRecentSyncLogs(userId, limit = 10) {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM sync_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(userId, limit);
}

// Synced events
function saveSyncedEvents(userId, syncId, events) {
  const db = getDb();
  // Clear old events for this user
  db.prepare('DELETE FROM synced_events WHERE user_id = ?').run(userId);

  const stmt = db.prepare(`
    INSERT INTO synced_events (user_id, sync_id, title, start_time, end_time)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((evts) => {
    for (const evt of evts) {
      stmt.run(userId, syncId, evt.title, evt.startTime, evt.endTime);
    }
  });

  insertMany(events);
}

function getSyncedEvents(userId) {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM synced_events WHERE user_id = ? ORDER BY start_time ASC'
  ).all(userId);
}

// Sync schedule
function setSyncSchedule(userId, schedule) {
  const db = getDb();
  db.prepare('UPDATE users SET sync_schedule = ? WHERE id = ?').run(schedule, userId);
}

function getSyncSchedule(userId) {
  const db = getDb();
  const row = db.prepare('SELECT sync_schedule FROM users WHERE id = ?').get(userId);
  return row?.sync_schedule || 'daily';
}

// Disconnect — remove all user data except account
function disconnectUser(userId) {
  const db = getDb();
  db.prepare('DELETE FROM psychometrix_credentials WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM google_tokens WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM synced_events WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM sync_logs WHERE user_id = ?').run(userId);
}

// Delete account entirely
function deleteUser(userId) {
  const db = getDb();
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

// Student contacts
function saveStudentContacts(userId, contacts, moed) {
  const db = getDb();
  const moedLabel = moed || 'נוכחי';
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO student_contacts (user_id, moed, student_name, phone, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `);
  const save = db.transaction((items) => {
    // Clean up migration placeholder when a real moed name comes in
    if (moedLabel !== 'נוכחי') {
      db.prepare("DELETE FROM student_contacts WHERE user_id = ? AND moed = 'נוכחי'").run(userId);
    }
    for (const c of items) {
      insertStmt.run(userId, moedLabel, c.name, c.phone || null);
    }
  });
  save(contacts);
}

function getStudentContacts(userId, moed) {
  const db = getDb();
  let rows;
  if (moed) {
    rows = db.prepare('SELECT student_name, phone FROM student_contacts WHERE user_id = ? AND moed = ?').all(userId, moed);
  } else {
    const latest = db.prepare('SELECT moed FROM student_contacts WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1').get(userId);
    if (!latest) return {};
    rows = db.prepare('SELECT student_name, phone FROM student_contacts WHERE user_id = ? AND moed = ?').all(userId, latest.moed);
  }
  const map = {};
  for (const row of rows) map[row.student_name] = row.phone;
  return map;
}

function getStudentMoeds(userId) {
  const db = getDb();
  return db.prepare(`
    SELECT moed, COUNT(*) as count, MAX(updated_at) as updated_at
    FROM student_contacts WHERE user_id = ?
    GROUP BY moed ORDER BY MAX(updated_at) DESC
  `).all(userId);
}

// WhatsApp template
const DEFAULT_WHATSAPP_TEMPLATE = 'היי מה קורה? מזכיר שיש לנו היום שיעור אז ממליץ להכין שאלות/נושאים שנעבור עליהם. יום מצוין!';
const DEFAULT_WHATSAPP_TEMPLATE_TOMORROW = 'היי מה קורה? מזכיר שמחר יש לנו שיעור אז ממליץ להכין שאלות/נושאים שנעבור עליהם. יום מצוין!';

function getWhatsappTemplate(userId) {
  const db = getDb();
  const row = db.prepare('SELECT whatsapp_template FROM users WHERE id = ?').get(userId);
  return row?.whatsapp_template || DEFAULT_WHATSAPP_TEMPLATE;
}

function setWhatsappTemplate(userId, template) {
  const db = getDb();
  db.prepare('UPDATE users SET whatsapp_template = ? WHERE id = ?').run(template, userId);
}

function getWhatsappTemplateTomorrow(userId) {
  const db = getDb();
  const row = db.prepare('SELECT whatsapp_template_tomorrow FROM users WHERE id = ?').get(userId);
  return row?.whatsapp_template_tomorrow || DEFAULT_WHATSAPP_TEMPLATE_TOMORROW;
}

function setWhatsappTemplateTomorrow(userId, template) {
  const db = getDb();
  db.prepare('UPDATE users SET whatsapp_template_tomorrow = ? WHERE id = ?').run(template, userId);
}

// Email notification settings
function getNotificationSettings(userId) {
  const db = getDb();
  const row = db.prepare('SELECT notification_email, gmail_app_password, notifications_enabled, notification_to_email FROM users WHERE id = ?').get(userId);
  return {
    email: row?.notification_email || null,
    appPassword: row?.gmail_app_password || null,
    enabled: row?.notifications_enabled !== 0,
    toEmail: row?.notification_to_email || null,
  };
}

function setNotificationSettings(userId, email, appPassword, toEmail, enabled) {
  const db = getDb();
  db.prepare('UPDATE users SET notification_email = ?, gmail_app_password = ?, notification_to_email = ?, notifications_enabled = ? WHERE id = ?')
    .run(email || null, appPassword || null, toEmail || email || null, enabled ? 1 : 0, userId);
}

function setNotificationsEnabled(userId, enabled) {
  const db = getDb();
  db.prepare('UPDATE users SET notifications_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, userId);
}

// Monthly events for earnings report
function getMonthlyEvents(userId, year, month) {
  const db = getDb();
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return db.prepare(
    "SELECT title, start_time, end_time FROM synced_events WHERE user_id = ? AND start_time LIKE ? ORDER BY start_time ASC"
  ).all(userId, `${prefix}%`);
}

// Get all users with both credentials and Google tokens (for cron)
function getConnectedUsers() {
  const db = getDb();
  return db.prepare(`
    SELECT u.id, u.email, u.display_name, u.sync_schedule
    FROM users u
    INNER JOIN psychometrix_credentials pc ON pc.user_id = u.id
    INNER JOIN google_tokens gt ON gt.user_id = u.id
  `).all();
}

module.exports = {
  createUser, findUserByEmail, findUserById,
  savePsychometrixCredentials, getPsychometrixCredentials,
  saveGoogleTokens, getGoogleTokens, updateGoogleTokens,
  createSyncLog, getLatestSyncLog, getRecentSyncLogs,
  saveSyncedEvents, getSyncedEvents,
  setSyncSchedule, getSyncSchedule,
  saveStudentContacts, getStudentContacts, getStudentMoeds,
  getWhatsappTemplate, setWhatsappTemplate,
  getWhatsappTemplateTomorrow, setWhatsappTemplateTomorrow,
  getMonthlyEvents,
  getNotificationSettings, setNotificationSettings, setNotificationsEnabled,
  disconnectUser, deleteUser,
  getConnectedUsers,
};
