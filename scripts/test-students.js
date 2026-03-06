const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { login } = require('../src/scraper/login');
const { decrypt } = require('../src/crypto/encrypt');
const { getPsychometrixCredentials } = require('../src/db/users');
const { scrapeStudents } = require('../src/scraper/students');

(async () => {
  const creds = getPsychometrixCredentials(2);
  const username = decrypt({ encrypted: creds.encrypted_username, iv: creds.iv_username, tag: creds.tag_username });
  const password = decrypt({ encrypted: creds.encrypted_password, iv: creds.iv_password, tag: creds.tag_password });

  const { browser, page } = await login({ username, password, headless: true });
  const contacts = await scrapeStudents(page);
  await browser.close();

  console.log(`\nTotal: ${contacts.length} contacts`);
  console.log('First 5:', contacts.slice(0, 5));
  const withPhone = contacts.filter(c => c.phone);
  console.log(`With phone: ${withPhone.length}`);
})();
