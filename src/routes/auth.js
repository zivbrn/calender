const express = require('express');
const bcrypt = require('bcrypt');
const config = require('../config');
const { createUser, findUserByEmail } = require('../db/users');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login');
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    req.session.flash = { type: 'error', message: 'יש להזין אימייל וסיסמה.' };
    return res.redirect('/login');
  }

  const user = findUserByEmail(email.toLowerCase().trim());
  if (!user) {
    req.session.flash = { type: 'error', message: 'אימייל או סיסמה שגויים.' };
    return res.redirect('/login');
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    req.session.flash = { type: 'error', message: 'אימייל או סיסמה שגויים.' };
    return res.redirect('/login');
  }

  req.session.user = { id: user.id, email: user.email, displayName: user.display_name };
  res.redirect('/');
});

router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('register', { inviteRequired: !!config.inviteCode });
});

router.post('/register', async (req, res) => {
  const { email, password, displayName, inviteCode } = req.body;

  if (!email || !password) {
    req.session.flash = { type: 'error', message: 'יש להזין אימייל וסיסמה.' };
    return res.redirect('/register');
  }

  if (config.inviteCode && inviteCode !== config.inviteCode) {
    req.session.flash = { type: 'error', message: 'קוד הזמנה שגוי.' };
    return res.redirect('/register');
  }

  if (findUserByEmail(email.toLowerCase().trim())) {
    req.session.flash = { type: 'error', message: 'האימייל הזה כבר רשום במערכת.' };
    return res.redirect('/register');
  }

  const hash = await bcrypt.hash(password, 10);
  const userId = createUser(email.toLowerCase().trim(), hash, displayName || null);

  req.session.user = { id: userId, email: email.toLowerCase().trim(), displayName: displayName || null };
  res.redirect('/onboarding/xcampus');
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
