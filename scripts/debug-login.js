const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { chromium } = require('playwright');
const { decrypt } = require('../src/crypto/encrypt');
const { getPsychometrixCredentials } = require('../src/db/users');
const { initSchema } = require('../src/db/schema');

initSchema();

async function main() {
  const creds = getPsychometrixCredentials(1);
  if (!creds) {
    console.error('No credentials found in DB');
    process.exit(1);
  }

  const username = decrypt({ encrypted: creds.encrypted_username, iv: creds.iv_username, tag: creds.tag_username });
  const password = decrypt({ encrypted: creds.encrypted_password, iv: creds.iv_password, tag: creds.tag_password });

  console.log('Username:', username);
  console.log('Password length:', password.length);

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log('Navigating to login page...');
  await page.goto('https://x.psychometrix.co.il/pages/loginout/login.aspx', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Inspect the login form
  const formInfo = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input');
    return Array.from(inputs).map(i => ({
      id: i.id,
      name: i.name,
      type: i.type,
      placeholder: i.placeholder,
      value: i.value ? '(has value)' : '(empty)',
    }));
  });
  console.log('\nForm inputs:', JSON.stringify(formInfo, null, 2));

  // Try filling the form
  const userField = await page.$('#_ctl0_page_content_txt_UserName');
  const passField = await page.$('#_ctl0_page_content_txt_Password');

  console.log('\nUsername field found:', !!userField);
  console.log('Password field found:', !!passField);

  if (userField && passField) {
    await page.fill('#_ctl0_page_content_txt_UserName', username);
    await page.fill('#_ctl0_page_content_txt_Password', password);
    console.log('Fields filled. Submitting...');

    const submitBtn = await page.$('#_ctl0_page_content_btn_login');
    console.log('Submit button found:', !!submitBtn);

    if (submitBtn) {
      await submitBtn.click();
    } else {
      // Try other submit methods
      const altSubmit = await page.$('input[type="submit"]');
      console.log('Alt submit found:', !!altSubmit);
      if (altSubmit) await altSubmit.click();
    }

    await page.waitForTimeout(5000);
    console.log('\nAfter submit URL:', page.url());
    const bodyText = await page.textContent('body');
    console.log('Body snippet:', bodyText.slice(0, 500));
  } else {
    console.log('\nLogin form selectors may have changed!');
    const bodyText = await page.textContent('body');
    console.log('Page text:', bodyText.slice(0, 1000));
  }

  console.log('\nBrowser open — check it manually. Ctrl+C to exit.');
  await new Promise(() => {});
}

main();
