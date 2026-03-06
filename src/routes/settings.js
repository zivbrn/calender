const express = require('express');
const { requireAuth } = require('../auth/middleware');
const { encrypt } = require('../crypto/encrypt');
const {
  savePsychometrixCredentials,
  getPsychometrixCredentials,
  getGoogleTokens,
  setSyncSchedule,
  getSyncSchedule,
  getWhatsappTemplate,
  setWhatsappTemplate,
  getWhatsappTemplateTomorrow,
  setWhatsappTemplateTomorrow,
  getNotificationSettings,
  setNotificationSettings,
  setNotificationsEnabled,
  getStudentMoeds,
  disconnectUser,
  deleteUser,
} = require('../db/users');

const router = express.Router();

router.get('/settings', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const hasPsychometrix = !!getPsychometrixCredentials(userId);
  const hasGoogle = !!getGoogleTokens(userId);
  const syncSchedule = getSyncSchedule(userId);
  const whatsappTemplate = getWhatsappTemplate(userId);
  const whatsappTemplateTomorrow = getWhatsappTemplateTomorrow(userId);
  const notifSettings = getNotificationSettings(userId);
  const studentMoeds = getStudentMoeds(userId);

  res.render('settings', { hasPsychometrix, hasGoogle, syncSchedule, whatsappTemplate, whatsappTemplateTomorrow, notifSettings, studentMoeds });
});

router.post('/settings/psychometrix', requireAuth, (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    req.session.flash = { type: 'error', message: 'יש להזין אימייל וסיסמה.' };
    return res.redirect('/settings');
  }

  const encUsername = encrypt(username);
  const encPassword = encrypt(password);
  savePsychometrixCredentials(req.session.user.id, encUsername, encPassword);

  req.session.flash = { type: 'success', message: 'פרטי X Campus נשמרו בהצלחה.' };
  res.redirect('/settings');
});

router.post('/settings/schedule', requireAuth, (req, res) => {
  const { schedule } = req.body;
  const valid = ['every6h', 'every12h', 'daily'];
  if (!valid.includes(schedule)) {
    req.session.flash = { type: 'error', message: 'תדירות לא חוקית.' };
    return res.redirect('/settings');
  }

  setSyncSchedule(req.session.user.id, schedule);
  req.session.flash = { type: 'success', message: 'תדירות הסנכרון עודכנה.' };
  res.redirect('/settings');
});

router.post('/settings/whatsapp-template', requireAuth, (req, res) => {
  const { template } = req.body;
  if (template == null) {
    req.session.flash = { type: 'error', message: 'תבנית לא חוקית.' };
    return res.redirect('/settings');
  }
  setWhatsappTemplate(req.session.user.id, template.trim());
  req.session.flash = { type: 'success', message: 'תבנית ההודעה עודכנה.' };
  res.redirect('/settings');
});

router.post('/settings/whatsapp-template-tomorrow', requireAuth, (req, res) => {
  const { template } = req.body;
  if (template == null) {
    req.session.flash = { type: 'error', message: 'תבנית לא חוקית.' };
    return res.redirect('/settings');
  }
  setWhatsappTemplateTomorrow(req.session.user.id, template.trim());
  req.session.flash = { type: 'success', message: 'תבנית תזכורת מחר עודכנה.' };
  res.redirect('/settings');
});

router.post('/settings/notifications', requireAuth, (req, res) => {
  const { email, app_password, to_email } = req.body;
  if (!email || !app_password) {
    req.session.flash = { type: 'error', message: 'יש להזין אימייל Gmail וסיסמת אפליקציה.' };
    return res.redirect('/settings');
  }
  setNotificationSettings(req.session.user.id, email.trim(), app_password.trim(), (to_email || '').trim() || null, true);
  req.session.flash = { type: 'success', message: 'הגדרות התראות נשמרו.' };
  res.redirect('/settings');
});

router.post('/settings/notifications/toggle', requireAuth, (req, res) => {
  const { enabled } = req.body;
  setNotificationsEnabled(req.session.user.id, enabled === '1');
  req.session.flash = { type: 'success', message: enabled === '1' ? 'התראות הופעלו.' : 'התראות כובו.' };
  res.redirect('/settings');
});

router.post('/settings/disconnect', requireAuth, (req, res) => {
  disconnectUser(req.session.user.id);
  req.session.flash = { type: 'success', message: 'הנתונים נמחקו. הפרטים וחיבור היומן הוסרו.' };
  res.redirect('/settings');
});

router.post('/settings/delete-account', requireAuth, (req, res) => {
  const userId = req.session.user.id;
  disconnectUser(userId);
  deleteUser(userId);
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
