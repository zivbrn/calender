const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { login } = require('../src/scraper/login');
const { decrypt } = require('../src/crypto/encrypt');
const { getPsychometrixCredentials } = require('../src/db/users');

const STUDENTS_URL = 'https://x.psychometrix.co.il/adm/student/students-list.aspx';

(async () => {
  const creds = getPsychometrixCredentials(2);
  const username = decrypt({ encrypted: creds.encrypted_username, iv: creds.iv_username, tag: creds.tag_username });
  const password = decrypt({ encrypted: creds.encrypted_password, iv: creds.iv_password, tag: creds.tag_password });

  const { browser, page } = await login({ username, password, headless: true });

  await page.goto(STUDENTS_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);

  const courseOptions = await page.evaluate(() => {
    const sel = document.querySelector('#_ctl0_page_content_drp_ExamDates');
    return Array.from(sel.options)
      .filter(o => o.value !== '-1' && o.value !== '2')
      .map(o => ({ value: o.value, text: o.textContent.trim() }));
  });

  // Iterate from most recent, find first with classes
  let foundCourse = null;
  let classOptions = [];

  for (const course of courseOptions) {
    console.log(`Trying course: ${course.text} (${course.value})`);
    await Promise.all([
      page.waitForLoadState('networkidle'),
      page.selectOption('#_ctl0_page_content_drp_ExamDates', course.value),
    ]);
    await page.waitForTimeout(1000);

    classOptions = await page.evaluate(() => {
      const sel = document.querySelector('#_ctl0_page_content_drp_Classes');
      return Array.from(sel.options).map(o => ({ value: o.value, text: o.textContent.trim() }));
    });

    const realOptions = classOptions.filter(o => o.value && o.value !== '-1');
    if (realOptions.length > 0) {
      console.log(`  ✓ Found ${realOptions.length} class(es): ${realOptions.map(o => o.text).join(', ')}`);
      foundCourse = course;
      classOptions = realOptions;
      break;
    } else {
      console.log(`  ✗ No classes`);
    }
  }

  if (!foundCourse) {
    console.log('No course with classes found!');
    await browser.close();
    return;
  }

  // Select first class
  const cls = classOptions[0];
  console.log(`\nSelecting class: ${cls.text}`);
  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.selectOption('#_ctl0_page_content_drp_Classes', cls.value),
  ]);
  await page.waitForTimeout(1500);

  // Set to 500
  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.selectOption('#_ctl0_page_content_drp_top', '500'),
  ]);
  await page.waitForTimeout(1500);

  // Log table headers
  const headers = await page.evaluate(() =>
    Array.from(document.querySelectorAll('th')).map(th => th.innerText.trim())
  );
  console.log('\nTable headers:', headers);

  // Log first 3 rows with all links
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('table tr')).slice(1, 4).map(tr =>
      Array.from(tr.querySelectorAll('td')).map(td => ({
        text: td.innerText.trim().substring(0, 60),
        links: Array.from(td.querySelectorAll('a')).map(a => ({
          href: a.href.substring(0, 120),
          text: a.innerText.trim().substring(0, 30),
        })),
      }))
    )
  );
  console.log('\nFirst 3 rows:');
  console.log(JSON.stringify(rows, null, 2));

  await browser.close();
})();
