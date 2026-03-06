const fs = require('fs');
const { google } = require('googleapis');
const config = require('../config');
const { updateGoogleTokens } = require('../db/users');

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

function loadCredentials() {
  if (!fs.existsSync(config.google.credentialsPath)) {
    throw new Error(
      `Missing credentials.json at ${config.google.credentialsPath}.\n` +
      'Download it from Google Cloud Console (OAuth 2.0 Web App).'
    );
  }
  return JSON.parse(fs.readFileSync(config.google.credentialsPath, 'utf8'));
}

function createOAuth2Client() {
  const creds = loadCredentials();
  const { client_id, client_secret } = creds.web || creds.installed;
  return new google.auth.OAuth2(client_id, client_secret, config.google.redirectUri);
}

function getAuthUrl(state) {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
  });
}

async function getTokensFromCode(code) {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  return tokens;
}

function getCalendarClientForUser(tokens, userId) {
  const client = createOAuth2Client();
  client.setCredentials(tokens);

  // Auto-save refreshed tokens
  client.on('tokens', (newTokens) => {
    updateGoogleTokens(userId, {
      access_token: newTokens.access_token,
      expiry_date: newTokens.expiry_date,
    });
  });

  return google.calendar({ version: 'v3', auth: client });
}

module.exports = { getAuthUrl, getTokensFromCode, getCalendarClientForUser, SCOPES };
