const express = require('express');
const { requireAuth } = require('../auth/middleware');
const { encrypt } = require('../crypto/encrypt');
const { savePsychometrixCredentials } = require('../db/users');

const router = express.Router();

router.get('/onboarding/xcampus', requireAuth, (req, res) => {
  res.render('onboarding-xcampus', { step: 2 });
});

router.post('/onboarding/xcampus', requireAuth, (req, res) => {
  const { username, password } = req.body;

  if (username && password) {
    const encUsername = encrypt(username);
    const encPassword = encrypt(password);
    savePsychometrixCredentials(req.session.user.id, encUsername, encPassword);
  }

  res.redirect('/onboarding/google');
});

router.get('/onboarding/google', requireAuth, (req, res) => {
  req.session.onboarding = true;
  res.render('onboarding-google', { step: 3 });
});

router.get('/onboarding/skip', requireAuth, (req, res) => {
  req.session.onboarding = false;
  res.redirect('/');
});

module.exports = router;
