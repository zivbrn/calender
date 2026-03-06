const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const required = ['SESSION_SECRET', 'ENCRYPTION_KEY'];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env var: ${key}`);
  }
}

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  sessionSecret: process.env.SESSION_SECRET,
  encryptionKey: process.env.ENCRYPTION_KEY,
  inviteCode: process.env.INVITE_CODE || '',
  cronSchedule: process.env.CRON_SCHEDULE || '0 6 * * *',
  psychometrix: {
    loginUrl: 'https://x.psychometrix.co.il/pages/loginout/login.aspx',
  },
  google: {
    credentialsPath: path.resolve(__dirname, '..', 'credentials.json'),
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback',
  },
};
