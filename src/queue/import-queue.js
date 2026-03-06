const { login } = require('../scraper/login');
const { scrapeNextMoed } = require('../scraper/students');
const { decrypt } = require('../crypto/encrypt');
const { getPsychometrixCredentials, saveStudentContacts } = require('../db/users');

const activeUsers = new Set();

// Per-user last result, keyed by userId
const results = {};

function isUserImporting(userId) {
  return activeUsers.has(userId);
}

function getImportResult(userId) {
  return results[userId] || null;
}

async function enqueueImport(userId) {
  if (activeUsers.has(userId)) return false;
  activeUsers.add(userId);
  results[userId] = { status: 'running' };

  let browser;
  try {
    const creds = getPsychometrixCredentials(userId);
    if (!creds) throw new Error('לא נמצאו פרטי התחברות ל-X Campus.');

    const username = decrypt({ encrypted: creds.encrypted_username, iv: creds.iv_username, tag: creds.tag_username });
    const password = decrypt({ encrypted: creds.encrypted_password, iv: creds.iv_password, tag: creds.tag_password });

    const { browser: b, page } = await login({ username, password, headless: true });
    browser = b;

    const result = await scrapeNextMoed(page);

    if (!result) {
      results[userId] = { status: 'not_found' };
    } else {
      const { contacts, moedLabel } = result;
      if (contacts.length > 0) saveStudentContacts(userId, contacts, moedLabel);
      results[userId] = { status: 'done', moedLabel, count: contacts.length };
      console.log(`[import] Imported ${contacts.length} students for מועד "${moedLabel}" (user ${userId}).`);
    }
  } catch (err) {
    console.error(`[import] Failed for user ${userId}:`, err.message);
    results[userId] = { status: 'error', error: err.message };
  } finally {
    if (browser) await browser.close();
    activeUsers.delete(userId);
  }

  return true;
}

module.exports = { enqueueImport, isUserImporting, getImportResult };
