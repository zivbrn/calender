# XSync — X Campus to Google Calendar Sync

A web app that scrapes your class schedule from [X Campus](https://x.psychometrix.co.il) (Psychometrix) and automatically syncs it to Google Calendar.

## What it does

- Logs into X Campus with your credentials and scrapes your private lesson schedule
- Syncs lessons to a Google Calendar of your choice (insert, update, delete as needed)
- Runs on a cron schedule (every 6 hours by default)
- Supports multiple users, each with their own X Campus + Google Calendar credentials
- Sends email notifications on sync success/failure
- Shows a calendar view, student contact list, and income tracker in the web UI

## Stack

- **Backend:** Node.js + Express
- **Scraping:** Playwright (headless Chromium)
- **Auth:** Google OAuth 2.0
- **DB:** SQLite (via better-sqlite3)
- **Hosting:** GCP VM (`calender-sync`, `us-west1-b`) running as a systemd service on port 3000
- **Domain:** calender-sync.duckdns.org

## Project structure

```
src/
  app.js              # Express app setup
  server.js           # Entry point, cron scheduler
  scraper/
    login.js          # Playwright login to X Campus
    schedule.js       # Scrapes lesson schedule by month
    students.js       # Scrapes student contact list
  calendar/
    sync.js           # Diffs scraped events against Google Calendar
  queue/
    sync-queue.js     # Serial sync queue with retry logic
  auth/
    google-oauth.js   # Google OAuth flow
    middleware.js     # Session auth middleware
  db/
    connection.js     # SQLite connection
    schema.js         # Table definitions
    users.js          # DB queries
  email/
    notify.js         # Sync result email notifications
  routes/             # Express route handlers
  views/              # EJS templates
public/
  css/style.css
```

## Local setup

```bash
npm install
npx playwright install chromium
cp .env.example .env  # fill in your values
node src/server.js
```

## Deploy

1. Make changes locally
2. `git add <files> && git commit && git push`
3. On VM: `cd ~/calendar-sync && git pull origin master && sudo systemctl restart calender-sync`

Check logs: `sudo journalctl -u calender-sync -n 50`

## Environment variables

| Variable | Description |
|---|---|
| `ENCRYPTION_KEY` | AES-256 key for encrypting stored credentials |
| `SESSION_SECRET` | Express session secret |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL |
| `PORT` | Server port (default 3000) |

## Notes

- X Campus (`x.psychometrix.co.il`) is hosted in Ireland (AWS eu-west-1). Scraping from the US-West VM adds ~150ms latency per request — sync takes ~30-60s per user.
- The app scans the current month + 2 months ahead per sync.
- Syncs retry up to 2 times (5-min delay) on network timeouts before sending a failure notification.
- `post.bgu.ac.il` Google Workspace accounts cannot connect due to BGU IT restrictions — use a personal Gmail.