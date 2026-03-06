const { getDb } = require('./connection');

function initSchema() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      sync_schedule TEXT DEFAULT 'daily',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS psychometrix_credentials (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      encrypted_username TEXT NOT NULL,
      encrypted_password TEXT NOT NULL,
      iv_username TEXT NOT NULL,
      tag_username TEXT NOT NULL,
      iv_password TEXT NOT NULL,
      tag_password TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS google_tokens (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expiry_date INTEGER,
      calendar_id TEXT DEFAULT 'primary',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      inserted INTEGER DEFAULT 0,
      updated INTEGER DEFAULT 0,
      skipped INTEGER DEFAULT 0,
      deleted INTEGER DEFAULT 0,
      error_message TEXT,
      trigger_type TEXT DEFAULT 'manual',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS synced_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sync_id INTEGER REFERENCES sync_logs(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS student_contacts (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      student_name TEXT NOT NULL,
      phone TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, student_name)
    );
  `);

  // Migrations
  const columns = db.pragma('table_info(users)').map(c => c.name);
  if (!columns.includes('whatsapp_template')) {
    db.exec(`ALTER TABLE users ADD COLUMN whatsapp_template TEXT`);
  }
  if (!columns.includes('whatsapp_template_tomorrow')) {
    db.exec(`ALTER TABLE users ADD COLUMN whatsapp_template_tomorrow TEXT`);
  }
  if (!columns.includes('notification_email')) {
    db.exec(`ALTER TABLE users ADD COLUMN notification_email TEXT`);
  }
  if (!columns.includes('gmail_app_password')) {
    db.exec(`ALTER TABLE users ADD COLUMN gmail_app_password TEXT`);
  }
  if (!columns.includes('notifications_enabled')) {
    db.exec(`ALTER TABLE users ADD COLUMN notifications_enabled INTEGER DEFAULT 1`);
  }
  if (!columns.includes('notification_to_email')) {
    db.exec(`ALTER TABLE users ADD COLUMN notification_to_email TEXT`);
  }

  // Migrate student_contacts to support multiple מועדים
  const scCols = db.pragma('table_info(student_contacts)').map(c => c.name);
  if (!scCols.includes('moed')) {
    db.exec(`
      ALTER TABLE student_contacts RENAME TO student_contacts_old;
      CREATE TABLE student_contacts (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        moed TEXT NOT NULL DEFAULT 'נוכחי',
        student_name TEXT NOT NULL,
        phone TEXT,
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, moed, student_name)
      );
      INSERT INTO student_contacts (user_id, moed, student_name, phone, updated_at)
        SELECT user_id, 'נוכחי', student_name, phone, updated_at FROM student_contacts_old;
      DROP TABLE student_contacts_old;
    `);
  }
}

module.exports = { initSchema };
