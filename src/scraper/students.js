const STUDENTS_URL = 'https://x.psychometrix.co.il/adm/student/students-list.aspx';

// Returns all courses that have at least one class, in order
async function getCoursesWithClasses(page) {
  await page.goto(STUDENTS_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#_ctl0_page_content_drp_ExamDates', { timeout: 8000 }).catch(() => {});

  const courseOptions = await page.evaluate(() => {
    const sel = document.querySelector('#_ctl0_page_content_drp_ExamDates');
    if (!sel) return [];
    return Array.from(sel.options)
      .filter(o => o.value !== '-1' && o.value !== '2')
      .map(o => ({ value: o.value, text: o.textContent.trim() }));
  });

  if (courseOptions.length === 0) return [];

  const coursesWithClasses = [];

  for (const course of courseOptions) {
    await page.selectOption('#_ctl0_page_content_drp_ExamDates', course.value);
    await page.waitForSelector('#_ctl0_page_content_drp_Classes', { timeout: 5000 }).catch(() => {});

    const classOptions = await page.evaluate(() => {
      const sel = document.querySelector('#_ctl0_page_content_drp_Classes');
      if (!sel) return [];
      return Array.from(sel.options)
        .filter(o => o.value && o.value !== '-1')
        .map(o => ({ value: o.value, text: o.textContent.trim() }));
    });

    if (classOptions.length > 0) {
      coursesWithClasses.push({ course, classOptions });
    }

    // Enough to check first 2 with classes
    if (coursesWithClasses.length >= 2) break;
  }

  return coursesWithClasses;
}

async function scrapeContactsForClass(page, classValue) {
  await page.selectOption('#_ctl0_page_content_drp_Classes', classValue);
  await page.waitForSelector('#_ctl0_page_content_drp_top', { timeout: 5000 }).catch(() => {});

  await page.selectOption('#_ctl0_page_content_drp_top', '500');
  await page.waitForSelector('table tr td', { timeout: 5000 }).catch(() => {});

  return page.evaluate(() => {
    const results = [];
    const rows = document.querySelectorAll('table tr');
    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 3) continue;
      const nameLink = cells[2].querySelector('a');
      if (!nameLink) continue;
      const name = nameLink.innerText.trim().replace(/^\*\s*/, '');
      if (!name) continue;
      // Search all cells for a WhatsApp link (column position varies)
      let phone = null;
      for (const cell of cells) {
        const waLink = cell.querySelector('a[href*="api.whatsapp.com"]');
        if (waLink) {
          const match = waLink.href.match(/phone=(\d+)/);
          if (match) { phone = match[1]; break; }
        }
      }
      results.push({ name, phone });
    }
    return results;
  });
}

async function scrapeContactsForCourse(page, course, classOptions) {
  // Select course (already selected, but ensure consistency)
  await page.selectOption('#_ctl0_page_content_drp_ExamDates', course.value);
  await page.waitForSelector('#_ctl0_page_content_drp_Classes', { timeout: 5000 }).catch(() => {});

  // Scrape all classes and merge — phones may only appear in one class
  const contactMap = new Map();
  for (const cls of classOptions) {
    const rows = await scrapeContactsForClass(page, cls.value);
    for (const { name, phone } of rows) {
      const existing = contactMap.get(name);
      // Keep entry if new one has a phone and old one doesn't
      if (!existing || (!existing.phone && phone)) {
        contactMap.set(name, { name, phone });
      }
    }
  }

  return [...contactMap.values()];
}

// Used during sync — scrapes current (first) active מועד
async function scrapeStudents(page) {
  console.log(`Navigating to students list: ${STUDENTS_URL}`);
  const courses = await getCoursesWithClasses(page);

  if (courses.length === 0) {
    console.log('No active course with classes found.');
    return { contacts: [], moedLabel: null };
  }

  const { course, classOptions } = courses[0];
  console.log(`Scraping students for מועד: ${course.text}`);
  const contacts = await scrapeContactsForCourse(page, course, classOptions);
  console.log(`Scraped ${contacts.length} student contact(s) for ${course.text}.`);
  return { contacts, moedLabel: course.text };
}

// Used for manual import — scrapes the NEXT מועד after the current one
async function scrapeNextMoed(page) {
  console.log(`Looking for next מועד on students list: ${STUDENTS_URL}`);
  const courses = await getCoursesWithClasses(page);

  if (courses.length < 2) {
    console.log('No next מועד found.');
    return null;
  }

  const { course, classOptions } = courses[1];
  console.log(`Scraping students for next מועד: ${course.text}`);
  const contacts = await scrapeContactsForCourse(page, course, classOptions);
  console.log(`Scraped ${contacts.length} student contact(s) for ${course.text}.`);
  return { contacts, moedLabel: course.text };
}

module.exports = { scrapeStudents, scrapeNextMoed };
