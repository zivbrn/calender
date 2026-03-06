const express = require('express');
const { requireAuth } = require('../auth/middleware');
const {
  getPsychometrixCredentials,
  getGoogleTokens,
  getLatestSyncLog,
  getRecentSyncLogs,
  getSyncedEvents,
  getStudentContacts,
  getWhatsappTemplate,
  getWhatsappTemplateTomorrow,
  getMonthlyEvents,
} = require('../db/users');

const HEBREW_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

function toIsraelTime(dateStr) {
  if (!dateStr) return dateStr;
  // SQLite stores timestamps without timezone info — treat as UTC
  const normalized = dateStr.replace(' ', 'T').replace(/Z?$/, 'Z');
  return new Date(normalized).toLocaleString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatLog(log) {
  return log ? { ...log, created_at: toIsraelTime(log.created_at) } : log;
}

function calcEarnings(userId, latestSync) {
  const now = new Date();
  const israelNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const year = israelNow.getFullYear();
  const month = israelNow.getMonth() + 1;
  const monthName = HEBREW_MONTHS[month - 1];

  // Check if last sync was in a previous month
  const syncDate = latestSync?.created_at ? new Date(latestSync.created_at) : null;
  const syncMonth = syncDate ? syncDate.getMonth() + 1 : null;
  const syncYear = syncDate ? syncDate.getFullYear() : null;
  const syncIsStale = syncDate && (syncYear < year || syncMonth < month);

  const allMonthEvs = getMonthlyEvents(userId, year, month);
  // Only count lessons that have already started
  const nowMs = israelNow.getTime();
  const evs = allMonthEvs.filter(ev => new Date(ev.start_time).getTime() <= nowMs);

  let groupClassMinutes = 0, groupClassCount = 0, privateCount = 0;

  for (const ev of evs) {
    if (ev.title.includes('שיעור כיתתי')) {
      groupClassMinutes += (new Date(ev.end_time) - new Date(ev.start_time)) / 60000;
      groupClassCount++;
    } else if (ev.title.includes('שיעור פרטי')) {
      privateCount++;
    }
  }

  const groupClassHours = groupClassMinutes / 60;
  const teachingEarnings = Math.round(groupClassHours * 80 * 100) / 100;
  const prepEarnings = Math.round(groupClassCount * 8.5 * 100) / 100;
  const privateEarnings = privateCount * 30;
  const total = Math.round((teachingEarnings + prepEarnings + privateEarnings) * 100) / 100;

  return {
    monthName, year,
    groupClassCount,
    groupClassHours: Math.round(groupClassHours * 10) / 10,
    teachingEarnings, prepEarnings,
    privateCount, privateMinutes: privateCount * 30, privateEarnings,
    total,
    syncIsStale,
    syncDateStr: syncDate ? syncDate.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric' }) : null,
  };
}

const router = express.Router();

function getTodayISO() {
  const now = new Date();
  const israelDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const y = israelDate.getFullYear();
  const m = String(israelDate.getMonth() + 1).padStart(2, '0');
  const d = String(israelDate.getDate()).padStart(2, '0');
  return { todayISO: `${y}-${m}-${d}`, now };
}

function extractStudentName(title) {
  const match = title.match(/שיעור פרטי\s*-\s*(.+)/);
  return match ? match[1].trim() : null;
}

router.get('/', requireAuth, (req, res) => res.redirect('/schedule'));

router.get('/schedule', requireAuth, (req, res) => {
  const userId = req.session.user.id;

  const hasPsychometrix = !!getPsychometrixCredentials(userId);
  const hasGoogle = !!getGoogleTokens(userId);
  const isSetup = hasPsychometrix && hasGoogle;

  const latestSync = getLatestSyncLog(userId);
  const recentLogs = getRecentSyncLogs(userId, 5);
  const events = getSyncedEvents(userId);

  const { todayISO, now } = getTodayISO();
  const contacts = getStudentContacts(userId);
  const template = getWhatsappTemplate(userId);
  const templateTomorrow = getWhatsappTemplateTomorrow(userId);

  const tomorrowDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowISO = `${tomorrowDate.getFullYear()}-${String(tomorrowDate.getMonth() + 1).padStart(2, '0')}-${String(tomorrowDate.getDate()).padStart(2, '0')}`;

  const todayLessons = events
    .filter(ev => ev.start_time.startsWith(todayISO) && ev.title.includes('שיעור פרטי'))
    .map(ev => {
      const studentName = extractStudentName(ev.title);
      const phone = studentName ? contacts[studentName] : null;
      const time = ev.start_time.substring(11, 16);
      return { title: ev.title, studentName, phone, time, startTime: ev.start_time, endTime: ev.end_time };
    });

  const tomorrowLessons = events
    .filter(ev => ev.start_time.startsWith(tomorrowISO) && ev.title.includes('שיעור פרטי'))
    .map(ev => {
      const studentName = extractStudentName(ev.title);
      const phone = studentName ? contacts[studentName] : null;
      const time = ev.start_time.substring(11, 16);
      return { title: ev.title, studentName, phone, time };
    });

  const weekEnd = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndISO = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, '0')}-${String(weekEnd.getDate()).padStart(2, '0')}`;

  const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const upcomingByDay = [];
  const dayMap = {};

  for (const ev of events) {
    const dateISO = ev.start_time.substring(0, 10);
    if (dateISO < todayISO || dateISO > weekEndISO) continue;
    if (!dayMap[dateISO]) {
      const d = new Date(dateISO + 'T12:00:00');
      const dayName = DAY_NAMES[d.getDay()];
      const [, m, day] = dateISO.split('-');
      const label = dateISO === todayISO ? `היום — ${dayName} ${parseInt(day)}/${parseInt(m)}` : `${dayName} ${parseInt(day)}/${parseInt(m)}`;
      dayMap[dateISO] = { date: dateISO, label, events: [] };
      upcomingByDay.push(dayMap[dateISO]);
    }
    dayMap[dateISO].events.push({
      title: ev.title,
      time: ev.start_time.substring(11, 16),
      endTime: ev.end_time.substring(11, 16),
    });
  }

  res.render('schedule', {
    isSetup, hasPsychometrix, hasGoogle,
    latestSync: formatLog(latestSync),
    recentLogs: recentLogs.map(formatLog),
    todayLessons, tomorrowLessons, template, templateTomorrow, upcomingByDay,
  });
});

router.get('/income', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const latestSync = getLatestSyncLog(userId);
  const earnings = calcEarnings(userId, latestSync);
  res.render('income', { earnings });
});

router.get('/calendar', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const year = parseInt(req.query.year) || now.getFullYear();
  const month = parseInt(req.query.month) || now.getMonth() + 1;

  const events = getMonthlyEvents(userId, year, month);
  const contacts = getStudentContacts(userId);
  const template = getWhatsappTemplate(userId);

  // Group events by date
  const eventsByDate = {};
  for (const ev of events) {
    const date = ev.start_time.substring(0, 10);
    if (!eventsByDate[date]) eventsByDate[date] = [];
    const studentName = ev.title.includes('שיעור פרטי')
      ? (ev.title.match(/שיעור פרטי\s*-\s*(.+)/)?.[1]?.trim() || null)
      : null;
    const phone = studentName ? (contacts[studentName] || null) : null;
    eventsByDate[date].push({
      title: ev.title,
      time: ev.start_time.substring(11, 16),
      endTime: ev.end_time.substring(11, 16),
      studentName,
      phone,
    });
  }

  const firstDay = new Date(year, month - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  res.render('calendar', {
    year, month,
    monthName: HEBREW_MONTHS[month - 1],
    firstDay, daysInMonth, todayISO,
    eventsByDate, template,
    prevMonth, prevYear, nextMonth, nextYear,
  });
});

module.exports = router;
