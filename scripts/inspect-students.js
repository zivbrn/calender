const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { login } = require('../src/scraper/login');
const { decrypt } = require('../src/crypto/encrypt');
const { getPsychometrixCredentials } = require('../src/db/users');
const { initSchema } = require('../src/db/schema');

initSchema();

async function main() {
  let browser;
  try {
    const creds = getPsychometrixCredentials(2);
    if (!creds) {
      console.error('No credentials found in DB');
      process.exit(1);
    }

    const username = decrypt({ encrypted: creds.encrypted_username, iv: creds.iv_username, tag: creds.tag_username });
    const password = decrypt({ encrypted: creds.encrypted_password, iv: creds.iv_password, tag: creds.tag_password });

    const result = await login({ username, password, headless: false });
    browser = result.browser;
    const page = result.page;

    console.log('\n--- Logged in successfully ---');

    const studentsUrl = 'https://x.psychometrix.co.il/adm/student/students-list.aspx';
    await page.goto(studentsUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);

    // Step 1: Select the spring (March) 2026 course — value "33"
    console.log('\nSelecting course: אביב (מרץ) 2026...');
    await page.selectOption('#_ctl0_page_content_drp_ExamDates', '33');
    await page.waitForTimeout(3000);

    // Step 2: Check what classes are available
    const classes = await page.evaluate(() => {
      const select = document.querySelector('#_ctl0_page_content_drp_Classes');
      if (!select) return [];
      return Array.from(select.options).map(o => ({
        value: o.value,
        text: o.text.trim(),
        selected: o.selected,
      }));
    });
    console.log('\nClasses:', JSON.stringify(classes, null, 2));

    // Step 3: Select first non-empty class
    const validClass = classes.find(c => c.value && c.value !== '-1');
    if (validClass) {
      console.log(`\nSelecting class: ${validClass.text}...`);
      await page.selectOption('#_ctl0_page_content_drp_Classes', validClass.value);
      await page.waitForTimeout(3000);
    }

    // Step 4: Inspect the student list
    const pageInfo = await page.evaluate(() => {
      const info = {};

      // WhatsApp links
      const waLinks = document.querySelectorAll('a[href*="whatsapp"], a[href*="wa.me"], a[href*="api.whatsapp"]');
      info.whatsappLinks = Array.from(waLinks).slice(0, 10).map(a => ({
        href: a.href,
        text: a.innerText.trim().slice(0, 50),
        parentRow: a.closest('tr')?.innerText?.trim()?.slice(0, 300),
      }));

      // Phone links
      const allLinks = document.querySelectorAll('a');
      info.phoneLinks = Array.from(allLinks)
        .filter(a => /05\d|972|whatsapp|wa\.me/i.test(a.href + a.innerText))
        .slice(0, 10)
        .map(a => ({
          href: a.href,
          text: a.innerText.trim().slice(0, 50),
          parentRow: a.closest('tr')?.innerText?.trim()?.slice(0, 300),
        }));

      // Tables
      const tables = document.querySelectorAll('table');
      info.tables = Array.from(tables).map((t, i) => ({
        index: i,
        id: t.id,
        className: t.className,
        rows: t.rows.length,
        headerCells: t.rows[0] ? Array.from(t.rows[0].cells).map(c => c.innerText.trim().slice(0, 50)) : [],
        sampleRow: t.rows[1] ? Array.from(t.rows[1].cells).map(c => c.innerText.trim().slice(0, 80)) : [],
        sampleRowHTML: t.rows[1] ? t.rows[1].innerHTML.slice(0, 2000) : '',
      }));

      // All links in the student area
      const studentArea = document.querySelector('.table') || document.querySelector('table');
      if (studentArea) {
        const links = studentArea.querySelectorAll('a');
        info.allStudentLinks = Array.from(links).slice(0, 20).map(a => ({
          href: a.href,
          text: a.innerText.trim().slice(0, 80),
          className: a.className,
          title: a.title,
        }));
      }

      info.bodySnippet = document.body.innerText.slice(0, 3000);

      return info;
    });

    console.log('\n=== STUDENT LIST AFTER SELECTING COURSE ===');
    console.log(JSON.stringify(pageInfo, null, 2));

    console.log('\n\nBrowser open — Ctrl+C to exit.\n');
    await new Promise(() => {});
  } catch (err) {
    console.error('Inspection failed:', err.message);
    if (browser) await browser.close();
    process.exit(1);
  }
}

main();
