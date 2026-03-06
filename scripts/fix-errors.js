const { getDb } = require('../src/db/connection');
const db = getDb();

const rows = db.prepare("SELECT id, error_message FROM sync_logs WHERE status = 'error' AND error_message IS NOT NULL").all();
let fixed = 0;

for (const row of rows) {
  const msg = row.error_message;
  if (msg.includes('--disable-') || msg.includes('chrome-headless')) {
    const exitMatch = msg.match(/process did exit: exitCode=(\d+)/);
    const clean = exitMatch
      ? `הדפדפן קרס בזמן הסנכרון (קוד: ${exitMatch[1]})`
      : 'הדפדפן קרס בזמן הסנכרון';
    db.prepare('UPDATE sync_logs SET error_message = ? WHERE id = ?').run(clean, row.id);
    fixed++;
  }
}

console.log(`Fixed ${fixed} error message(s).`);
