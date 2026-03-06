const express = require('express');
const { requireAuth } = require('../auth/middleware');
const { getAuthUrl, getTokensFromCode } = require('../auth/google-oauth');
const { saveGoogleTokens } = require('../db/users');

const router = express.Router();

router.get('/connect', requireAuth, (req, res) => {
  const state = String(req.session.user.id);
  const url = getAuthUrl(state);
  res.redirect(url);
});

router.get('/callback', requireAuth, async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    req.session.flash = { type: 'error', message: `Google auth failed: ${error}` };
    return res.redirect('/settings');
  }

  try {
    const tokens = await getTokensFromCode(code);
    saveGoogleTokens(req.session.user.id, tokens, 'primary');
    req.session.flash = { type: 'success', message: 'Google Calendar connected!' };
  } catch (err) {
    console.error('Google OAuth callback error:', err.message);
    req.session.flash = { type: 'error', message: 'Failed to connect Google Calendar.' };
  }

  const fromOnboarding = req.session.onboarding;
  req.session.onboarding = false;
  res.redirect(fromOnboarding ? '/' : '/settings');
});

module.exports = router;
