/**
 * Manual test: login to Psychometrix and scrape the schedule.
 * Launches a VISIBLE browser so you can explore the authenticated pages.
 *
 * Run: npm run test-scrape
 */

const { login } = require('../src/scraper/login');
const { scrapeSchedule } = require('../src/scraper/schedule');

async function main() {
  let browser;
  try {
    // Launch visible browser for manual exploration
    const result = await login({ headless: false });
    browser = result.browser;
    const page = result.page;

    console.log('\n--- Logged in successfully ---');
    console.log('Current URL:', page.url());

    // Navigate to schedule page and dump DOM structure for debugging
    const scheduleUrl = 'https://x.psychometrix.co.il/adm/instractor/private-lessons.aspx';
    console.log(`\nNavigating to: ${scheduleUrl}`);
    await page.goto(scheduleUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);

    // Dump page structure for analysis
    const domInfo = await page.evaluate(() => {
      const info = {};

      // Get all tables
      const tables = document.querySelectorAll('table');
      info.tables = Array.from(tables).map((t, i) => ({
        index: i,
        id: t.id,
        className: t.className,
        rows: t.rows.length,
        firstRowCells: t.rows[0] ? Array.from(t.rows[0].cells).map(c => c.innerText.trim().slice(0, 50)) : [],
        sampleDataRow: t.rows[1] ? Array.from(t.rows[1].cells).map(c => c.innerText.trim().slice(0, 80)) : [],
      }));

      // Get calendar/scheduler widgets
      info.calendarWidgets = document.querySelectorAll('.fc-event, .dx-scheduler, [class*="calendar"], [class*="schedule"], [class*="lesson"]').length;

      // Get all grid/list containers
      const grids = document.querySelectorAll('[class*="grid"], [class*="Grid"], [id*="grid"], [id*="Grid"]');
      info.grids = Array.from(grids).map(g => ({
        id: g.id,
        className: g.className,
        childCount: g.children.length,
      }));

      // Get page title and headings
      info.title = document.title;
      info.headings = Array.from(document.querySelectorAll('h1, h2, h3')).map(h => h.innerText.trim());

      // Get body text snippet
      info.bodySnippet = document.body.innerText.slice(0, 1000);

      return info;
    });

    console.log('\n=== PAGE STRUCTURE ===');
    console.log(JSON.stringify(domInfo, null, 2));

    console.log('\n\nAttempting scrape with current selectors...\n');
    const events = await scrapeSchedule(page);

    if (events.length === 0) {
      console.log('\nNo events found with current selectors.');
      console.log('Check the DOM structure above to identify the right selectors.');
      console.log('\nThe browser is still open — explore the site manually.');
      console.log('Press Ctrl+C to exit when done.\n');
      await new Promise(() => {});
    } else {
      console.log('\nScraped events:');
      console.log(JSON.stringify(events, null, 2));
      console.log('\nBrowser still open. Press Ctrl+C to exit.\n');
      await new Promise(() => {});
    }
  } catch (err) {
    console.error('Test scrape failed:', err.message);
    if (browser) await browser.close();
    process.exit(1);
  }
}

main();
