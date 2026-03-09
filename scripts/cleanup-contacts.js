// One-time script: delete December contacts for user 2, keep March
const { getDb } = require('../src/db/connection');
const db = getDb();

const before = db.prepare('SELECT moed, COUNT(*) as cnt FROM student_contacts WHERE user_id=2 GROUP BY moed').all();
console.log('Before:', before);

const result = db.prepare("DELETE FROM student_contacts WHERE user_id=2 AND moed LIKE '%2025%'").run();
console.log(`Deleted ${result.changes} December rows.`);

const after = db.prepare('SELECT moed, COUNT(*) as cnt FROM student_contacts WHERE user_id=2 GROUP BY moed').all();
console.log('After:', after);
