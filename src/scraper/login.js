const { chromium } = require('playwright');
const config = require('../config');

async function login({ username, password, headless = true }) {
  if (!username || !password) {
    throw new Error('Psychometrix username and password are required.');
  }

  const browser = await chromium.launch({
    headless,
    args: [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Navigating to Psychometrix login page...');
  await page.goto(config.psychometrix.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Fill credentials
  await page.fill('#_ctl0_page_content_txt_UserName', username);
  await page.fill('#_ctl0_page_content_txt_Password', password);

  // Submit the form — try multiple strategies to find the submit button
  const submitSelectors = [
    '#_ctl0_page_content_btn_login',
    'input[type="submit"]',
    'button[type="submit"]',
    'a[href*="javascript:__doPostBack"]',
    '[onclick*="submit"]',
    'input[type="button"]',
    '.login-btn',
    'button',
  ];

  let clicked = false;
  for (const selector of submitSelectors) {
    const el = page.locator(selector).first();
    if (await el.count() > 0) {
      console.log(`Found submit element: ${selector}`);
      await el.click();
      clicked = true;
      break;
    }
  }

  if (!clicked) {
    // Fallback: submit the form via JavaScript
    console.log('No submit button found, submitting form via JS...');
    await page.evaluate(() => {
      const form = document.querySelector('form');
      if (form) form.submit();
    });
  }

  // Wait for the page to settle after form submission
  await page.waitForLoadState('domcontentloaded', { timeout: 60000 });
  await page.waitForTimeout(2000);

  // Verify login by checking for authenticated content (user menu, logout link, etc.)
  const bodyText = await page.textContent('body');
  const hasAuthContent = bodyText.includes('יציאה') || bodyText.includes('אזור אישי') || bodyText.includes('תפריט');
  if (!hasAuthContent) {
    throw new Error('Login failed — no authenticated content found on page. Check credentials.');
  }
  console.log('Login successful. Current URL:', page.url());

  return { browser, page };
}

module.exports = { login };
