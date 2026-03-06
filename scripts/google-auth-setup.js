/**
 * One-time Google OAuth consent flow.
 * Run: npm run google-auth
 *
 * Prerequisites:
 *   1. Create a Google Cloud project and enable the Calendar API
 *   2. Create OAuth 2.0 Desktop App credentials
 *   3. Download the credentials JSON and save as credentials.json in the project root
 */

const fs = require('fs');
const http = require('http');
const { URL } = require('url');
const { google } = require('googleapis');

// Load config (only needs credentials path + token path)
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const CREDENTIALS_PATH = path.resolve(__dirname, '..', 'credentials.json');
const TOKEN_PATH = path.resolve(__dirname, '..', 'token.json');
const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const REDIRECT_PORT = 3000;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;

async function main() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error(`Error: credentials.json not found at ${CREDENTIALS_PATH}`);
    console.error('Download it from Google Cloud Console (OAuth 2.0 Desktop App credentials).');
    process.exit(1);
  }

  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const { client_id, client_secret } = creds.installed || creds.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('Opening browser for Google OAuth consent...');
  console.log(`If the browser does not open, visit:\n${authUrl}\n`);

  // Dynamically import `open` (ESM module)
  const open = (await import('open')).default;
  await open(authUrl);

  // Start local server to receive the OAuth callback
  const code = await waitForAuthCode();
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);

  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log(`\nToken saved to ${TOKEN_PATH}`);
  console.log('Google Calendar auth setup complete!');
  process.exit(0);
}

function waitForAuthCode() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>Authorization denied</h1><p>You can close this tab.</p>');
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authorization successful!</h1><p>You can close this tab.</p>');
        server.close();
        resolve(code);
      }
    });

    server.listen(REDIRECT_PORT, () => {
      console.log(`Waiting for OAuth callback on http://localhost:${REDIRECT_PORT}...`);
    });
  });
}

main().catch((err) => {
  console.error('Auth setup failed:', err.message);
  process.exit(1);
});
