const SCHEDULE_PATH = '/adm/instractor/private-lessons.aspx';
const LESSON_DURATION_MIN = 30;

async function scrapeSchedule(page, { throughMonth, throughYear } = {}) {
  const baseUrl = new URL(page.url()).origin;
  const scheduleUrl = `${baseUrl}${SCHEDULE_PATH}`;

  console.log(`Navigating to schedule page: ${scheduleUrl}`);
  await page.goto(scheduleUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  const events = [];
  const maxMonths = 6; // safety limit
  let lastMonthYear = null;

  for (let i = 0; i < maxMonths; i++) {
    if (i > 0) {
      // Click "next" to go to next month
      const nextBtn = page.locator('a').filter({ hasText: 'הבא>' }).first();
      if (await nextBtn.count() > 0) {
        await nextBtn.click();
        await page.waitForTimeout(1500);
      }
      // Click on the 1st of the month to trigger page reload with that month's data
      const firstDayLink = page.locator('.ui-datepicker-calendar td a').filter({ hasText: /^1$/ }).first();
      if (await firstDayLink.count() > 0) {
        await firstDayLink.click();
        await page.waitForTimeout(2000);
      }
    }

    // Get the current month/year from the datepicker
    const monthYear = await page.evaluate(() => {
      const monthSelect = document.querySelector('.ui-datepicker-month');
      const yearSelect = document.querySelector('.ui-datepicker-year');
      if (monthSelect && yearSelect) {
        return {
          month: parseInt(monthSelect.value) + 1, // 0-indexed in JS
          year: parseInt(yearSelect.value),
        };
      }
      return null;
    });

    if (!monthYear) {
      console.log('Could not determine current month/year, skipping...');
      continue;
    }

    // Guard: if month didn't advance, navigation failed — stop to avoid duplicate scrape
    if (lastMonthYear && monthYear.month === lastMonthYear.month && monthYear.year === lastMonthYear.year) {
      console.warn(`Month navigation failed — still on ${monthYear.month}/${monthYear.year}, stopping early.`);
      break;
    }
    lastMonthYear = monthYear;

    console.log(`Scanning ${monthYear.month}/${monthYear.year}...`);

    // Scrape this month
    const monthEvents = await scrapeMonth(page, monthYear);
    events.push(...monthEvents);

    // Stop if we've passed the target month
    if (throughMonth && throughYear) {
      if (monthYear.year > throughYear || (monthYear.year === throughYear && monthYear.month >= throughMonth)) {
        break;
      }
    } else if (i >= 1) {
      // Default: current + next month
      break;
    }
  }

  console.log(`Scraped ${events.length} lesson(s) total.`);
  return events;
}

async function scrapeMonth(page, monthYear) {
  const events = [];

  // Find all dates with activities
  const activeDates = await page.evaluate(() => {
    const cells = document.querySelectorAll('.date-with-activities a');
    return Array.from(cells).map(a => a.innerText.trim());
  });

  console.log(`  Found ${activeDates.length} date(s) with activities: ${activeDates.join(', ')}`);

  // Click each date and extract lessons
  for (const dayStr of activeDates) {
    const dateLink = page.locator('.date-with-activities a').filter({ hasText: new RegExp(`^${dayStr}$`) }).first();
    if (await dateLink.count() === 0) continue;

    await dateLink.click();
    await page.waitForTimeout(1500);

    const day = parseInt(dayStr);
    const dateISO = `${monthYear.year}-${String(monthYear.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // Extract private lessons from #list_of_private_lessons
    const lessons = await page.evaluate(() => {
      const items = document.querySelectorAll('#list_of_private_lessons li');
      return Array.from(items).map(li => {
        const text = li.childNodes[0]?.textContent?.trim() || li.innerText.trim();
        const id = li.id;

        const link = li.querySelector('a[data-name]');
        const studentName = link?.getAttribute('data-name') || '';

        const select = li.querySelector('.student-select');
        const timeMatch = text.match(/^(\d{2}:\d{2})/);
        const time = timeMatch ? timeMatch[1] : '';

        const selectedOption = select?.querySelector('option[selected]');
        const status = selectedOption?.value || 'q';

        return { id, time, studentName, status };
      });
    });

    for (const lesson of lessons) {
      if (lesson.status === 'n') continue;

      const startTime = `${dateISO}T${lesson.time}:00`;
      const endTime = addMinutes(startTime, LESSON_DURATION_MIN);

      events.push({
        id: lesson.id.replace('item-', ''),
        title: `שיעור פרטי - ${lesson.studentName}`,
        description: lesson.status === 'y' ? 'מאושר' : 'ממתין לאישור',
        startTime: `${startTime}+02:00`,
        endTime: `${endTime}+02:00`,
        location: '',
      });
    }

    // Extract class lessons from dayCal-lesson slots
    const classSlots = await page.evaluate(() => {
      const slots = document.querySelectorAll('.dayCal-item.dayCal-lesson');
      return Array.from(slots).map(slot => {
        const timeEl = slot.querySelector('.dayCal-time');
        return timeEl?.innerText?.trim() || '';
      }).filter(Boolean);
    });

    if (classSlots.length > 0) {
      const firstSlot = classSlots[0];
      const lastSlot = classSlots[classSlots.length - 1];
      const endSlotTime = addMinutes(`${dateISO}T${lastSlot}:00`, LESSON_DURATION_MIN);

      events.push({
        id: `class-${dateISO}`,
        title: 'שיעור כיתתי',
        description: '',
        startTime: `${dateISO}T${firstSlot}:00+02:00`,
        endTime: `${endSlotTime}+02:00`,
        location: '',
      });
    }
  }

  return events;
}

function addMinutes(isoLocal, minutes) {
  const [datePart, timePart] = isoLocal.split('T');
  const [h, m, s] = timePart.split(':').map(Number);
  const totalMin = h * 60 + m + minutes;
  const newH = String(Math.floor(totalMin / 60)).padStart(2, '0');
  const newM = String(totalMin % 60).padStart(2, '0');
  return `${datePart}T${newH}:${newM}:${String(s).padStart(2, '0')}`;
}

module.exports = { scrapeSchedule };
