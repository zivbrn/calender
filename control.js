#!/usr/bin/env node
'use strict';

/**
 * Calendar Sync — Local Control Panel
 * Run: node control.js  (or: npm run control)
 */

const readline = require('readline');
const { spawnSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ─── Load config from .env ────────────────────────────────────────────────────
const ENV_PATH = path.join(__dirname, '.env');
const env = {};
if (fs.existsSync(ENV_PATH)) {
  fs.readFileSync(ENV_PATH, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  });
}

const ADMIN_KEY  = env.ADMIN_API_KEY || '';
const VM_PORT    = parseInt(env.PORT, 10) || 3000;
const GCLOUD     = 'C:\\Users\\zivbr\\AppData\\Local\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd';
const SSH_TARGET = 'zivbrn@calender-sync';
const ZONE       = 'us-west1-b';
const INSTANCE   = 'calender-sync';
const PROJECT    = 'calender-487322';

// ─── Colors ──────────────────────────────────────────────────────────────────
const bold   = s => `\x1b[1m${s}\x1b[0m`;
const dim    = s => `\x1b[2m${s}\x1b[0m`;
const red    = s => `\x1b[31m${s}\x1b[0m`;
const green  = s => `\x1b[32m${s}\x1b[0m`;
const yellow = s => `\x1b[33m${s}\x1b[0m`;
const cyan   = s => `\x1b[36m${s}\x1b[0m`;
const gray   = s => `\x1b[90m${s}\x1b[0m`;

// ─── SSH + API helpers ────────────────────────────────────────────────────────
function gcloudSsh(command, timeoutMs = 30000) {
  // Escape double quotes inside the command for PowerShell
  const escaped = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const result = spawnSync('powershell.exe', [
    '-Command',
    `& "${GCLOUD}" compute ssh ${SSH_TARGET} --zone=${ZONE} --quiet --command="${escaped}" 2>&1`,
  ], { timeout: timeoutMs, encoding: 'utf8' });
  return ((result.stdout || '') + (result.stderr || '')).trim();
}

function gcloudRun(args, timeoutMs = 30000) {
  const result = spawnSync('powershell.exe', [
    '-Command',
    `& "${GCLOUD}" ${args} 2>&1`,
  ], { timeout: timeoutMs, encoding: 'utf8' });
  return ((result.stdout || '') + (result.stderr || '')).trim();
}

/**
 * Calls an admin API endpoint by running curl on the VM via SSH.
 * This avoids needing to open any firewall ports.
 */
function adminApi(method, endpoint, body = null) {
  if (!ADMIN_KEY) return { error: 'ADMIN_API_KEY not set in .env' };

  let cmd = `curl -s -m 15 -X ${method}`;
  cmd += ` -H "X-Admin-Key: ${ADMIN_KEY}"`;
  cmd += ` -H "Content-Type: application/json"`;
  if (body) {
    const json = JSON.stringify(body).replace(/'/g, "'\\''");
    cmd += ` -d '${json}'`;
  }
  cmd += ` http://localhost:${VM_PORT}/admin${endpoint}`;

  const raw = gcloudSsh(cmd, 40000);
  try {
    return JSON.parse(raw);
  } catch {
    return { error: raw || 'No response from server.' };
  }
}

// ─── Readline ─────────────────────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(resolve => rl.question(q, resolve));
const pause = () => ask(gray('\nPress Enter to continue...'));
const clear = () => process.stdout.write('\x1b[2J\x1b[H');

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmtUptime(s) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleString('he-IL', {
    timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

// ─── Actions ──────────────────────────────────────────────────────────────────

async function showStatus() {
  clear();
  console.log(bold('  Fetching server status...\n'));
  const h = adminApi('GET', '/health');

  if (h.error) {
    console.log(red('  ✗ Could not reach server: ') + h.error);
    await pause(); return;
  }

  const ramPct = Math.round((1 - h.memory.freeRamMb / h.memory.totalRamMb) * 100);
  const ramColor = ramPct > 85 ? red : ramPct > 70 ? yellow : green;

  console.log(bold('  ┌─ Server Health ───────────────────────────────────┐'));
  console.log(`  │  Uptime:        ${green(fmtUptime(h.uptime))}`);
  console.log(`  │  Process RAM:   ${h.memory.processHeapMb} MB (Node heap)`);
  console.log(`  │  System RAM:    ${ramColor(ramPct + '%')} used — ${h.memory.freeRamMb}/${h.memory.totalRamMb} MB free`);
  console.log(`  │  Chromium:      ${h.chromiumProcesses > 0 ? yellow(h.chromiumProcesses + ' process(es) alive') : green('idle (0)')}`);
  console.log(`  │  Auto-sync:     ${h.queue.paused ? yellow('PAUSED') : green('active')}`);
  console.log(`  │  Queue:         ${h.queue.queueLength} pending, ${h.queue.activeUsers.length} active`);
  console.log(`  │  Users:         ${h.connectedUsers} connected`);
  console.log('  └────────────────────────────────────────────────────────┘\n');

  if (h.users.length > 0) {
    console.log(bold('  Connected users:'));
    for (const u of h.users) {
      const st = u.syncing ? cyan('  ↻ syncing...') : green('  ✓ idle');
      console.log(`    • ${u.email} ${gray('(' + u.schedule + ')')}${st}`);
    }
    console.log('');
  }
  await pause();
}

async function showLogs() {
  clear();
  console.log(bold('  Fetching recent sync logs...\n'));
  const logs = adminApi('GET', '/logs?limit=15');

  if (logs.error) {
    console.log(red('  ✗ ') + logs.error);
    await pause(); return;
  }
  if (!Array.isArray(logs) || logs.length === 0) {
    console.log(gray('  No sync logs yet.'));
    await pause(); return;
  }

  console.log(bold('  Recent syncs:\n'));
  for (const log of logs) {
    const icon = log.status === 'success' ? green('✓') : red('✗');
    const date = fmtDate(log.created_at);
    const trigger = gray(`[${log.trigger_type}]`);
    const user = dim(log.userEmail);
    if (log.status === 'success') {
      const stats = green(`+${log.inserted} ~${log.updated} =${log.skipped} -${log.deleted}`);
      console.log(`  ${icon} ${date} ${trigger} ${stats}  ${user}`);
    } else {
      const err = (log.error_message || 'unknown error').substring(0, 65);
      console.log(`  ${icon} ${date} ${trigger} ${red(err)}  ${user}`);
    }
  }
  console.log(dim('\n  Legend: +inserted  ~updated  =unchanged  -deleted'));
  await pause();
}

async function triggerSync() {
  clear();
  console.log(bold('  Triggering sync for all users...\n'));
  const r = adminApi('POST', '/sync/trigger');
  if (r.error) {
    console.log(red('  ✗ ') + r.error);
  } else if (r.ok) {
    console.log(green(`  ✓ ${r.message}`));
    console.log(dim('  Sync is running in the background on the server.'));
  } else {
    console.log(yellow('  ! ') + r.message);
  }
  await pause();
}

async function toggleAutoSync(isPaused) {
  clear();
  const action = isPaused ? 'resume' : 'pause';
  const confirm = await ask(
    isPaused
      ? yellow('  Resume automatic syncs? ') + gray('(y/N) ')
      : yellow('  Pause automatic syncs? ') + gray('(y/N) ')
  );
  if (confirm.toLowerCase() !== 'y') return;

  const r = adminApi('POST', `/sync/${action}`);
  if (r.error) {
    console.log(red('\n  ✗ ') + r.error);
  } else {
    console.log(green(`\n  ✓ ${r.message}`));
  }
  await pause();
}

async function restartServer() {
  clear();
  const confirm = await ask(yellow('  Restart the server process? ') + gray('(y/N) '));
  if (confirm.toLowerCase() !== 'y') return;

  console.log('\n  Sending restart command...');
  const out = gcloudSsh('sudo systemctl restart calender-sync && sleep 2 && systemctl is-active calender-sync', 20000);
  if (out.trim() === 'active') {
    console.log(green('  ✓ Server restarted and is active.'));
  } else if (out.includes('active')) {
    console.log(green('  ✓ Server restarted.'));
  } else {
    console.log(yellow('  Output: ') + out);
  }
  await pause();
}

async function viewLiveLogs() {
  clear();
  console.log(bold('  Live server logs') + dim(' — Ctrl+C to stop\n'));
  const proc = spawn('powershell.exe', [
    '-Command',
    `& "${GCLOUD}" compute ssh ${SSH_TARGET} --zone=${ZONE} --quiet -- "sudo journalctl -u calender-sync -f --no-pager -n 30" 2>&1`,
  ], { stdio: 'inherit' });

  await new Promise(resolve => {
    proc.on('close', resolve);
    proc.on('error', resolve);
  });
}

async function rebootVM() {
  clear();
  const confirm = await ask(red('  REBOOT the VM? Takes ~60s to come back. ') + gray('(y/N) '));
  if (confirm.toLowerCase() !== 'y') return;

  console.log('\n  Rebooting VM...');
  const out = gcloudRun(
    `compute instances reset ${INSTANCE} --zone=${ZONE} --project=${PROJECT} --quiet`,
    30000
  );
  console.log(dim('  ' + out));
  console.log(yellow('\n  VM is rebooting. It will be back online in ~60 seconds.'));
  await pause();
}

async function setupSwap() {
  clear();
  console.log(bold('  Checking swap space on VM...\n'));
  const swapInfo = gcloudSsh('free -m | grep -i swap');
  console.log(dim('  ' + swapInfo));

  if (swapInfo.match(/Swap:\s+[1-9]/)) {
    console.log(green('\n  ✓ Swap is already configured.'));
    await pause(); return;
  }

  console.log(yellow('\n  No swap detected.'));
  const confirm = await ask(yellow('  Set up 2 GB swap file now? ') + gray('(y/N) '));
  if (confirm.toLowerCase() !== 'y') return;

  console.log('\n  Setting up swap (may take ~30s)...');
  const cmds = [
    'sudo fallocate -l 2G /swapfile',
    'sudo chmod 600 /swapfile',
    'sudo mkswap /swapfile',
    'sudo swapon /swapfile',
    'grep -q /swapfile /etc/fstab || echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab',
    'echo "vm.swappiness=10" | sudo tee -a /etc/sysctl.conf',
    'free -m',
  ].join(' && ');

  const out = gcloudSsh(cmds, 60000);
  console.log(dim('\n  ' + out.split('\n').join('\n  ')));
  console.log(green('\n  ✓ 2 GB swap configured and will persist on reboot.'));
  await pause();
}

// ─── Main menu loop ───────────────────────────────────────────────────────────
async function fetchHealth() {
  try { return adminApi('GET', '/health'); } catch { return null; }
}

async function main() {
  if (!ADMIN_KEY) {
    console.log(red('\n  ✗ ADMIN_API_KEY is not set in .env'));
    console.log(dim('  Add ADMIN_API_KEY=<a-random-key> to .env on both your PC and the VM.\n'));
    process.exit(1);
  }

  while (true) {
    clear();
    process.stdout.write(dim('  Connecting...'));
    const h = await fetchHealth();
    process.stdout.write('\r                \r');

    const online    = !h?.error;
    const serverStr = online ? green('● ONLINE') : red('● OFFLINE');
    const uptimeStr = online && h.uptime ? dim(` (up ${fmtUptime(h.uptime)})`) : '';
    const ramStr    = online ? dim(` | RAM: ${h.memory.freeRamMb}/${h.memory.totalRamMb} MB free`) : '';
    const pausedStr = h?.queue?.paused ? yellow(' | AUTO-SYNC PAUSED') : '';
    const syncStr   = h?.queue?.activeUsers?.length > 0 ? cyan(' | SYNCING') : '';
    const isPaused  = h?.queue?.paused ?? false;

    console.log('');
    console.log(bold('  ┌─ Calendar Sync Control ──────────────────────────────┐'));
    console.log(`  │  ${serverStr}${uptimeStr}${ramStr}${pausedStr}${syncStr}`);
    console.log( '  ├────────────────────────────────────────────────────────┤');
    console.log(`  │   ${bold('1.')}  Server status & health`);
    console.log(`  │   ${bold('2.')}  View recent sync logs`);
    console.log(`  │   ${bold('3.')}  Trigger sync now`);
    console.log(`  │   ${bold('4.')}  ${isPaused ? 'Resume' : 'Pause'} automatic syncs`);
    console.log(`  │   ${bold('5.')}  Restart server`);
    console.log(`  │   ${bold('6.')}  View live logs (streaming)`);
    console.log(`  │   ${bold('7.')}  Reboot VM`);
    console.log(`  │   ${bold('8.')}  Setup swap space (run once)`);
    console.log(`  │   ${bold('0.')}  Exit`);
    console.log( '  └────────────────────────────────────────────────────────┘');
    console.log('');

    const choice = (await ask('  Choose: ')).trim();

    switch (choice) {
      case '1': await showStatus(); break;
      case '2': await showLogs(); break;
      case '3': await triggerSync(); break;
      case '4': await toggleAutoSync(isPaused); break;
      case '5': await restartServer(); break;
      case '6': await viewLiveLogs(); break;
      case '7': await rebootVM(); break;
      case '8': await setupSwap(); break;
      case '0':
        rl.close();
        console.log(dim('\n  Goodbye.\n'));
        process.exit(0);
      default:
        // invalid choice — just redraw menu
    }
  }
}

main().catch(err => {
  console.error(red('\nFatal error: ') + err.message);
  process.exit(1);
});
