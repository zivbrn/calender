const crypto = require('crypto');

function hashEvent(event) {
  const payload = JSON.stringify({
    title: event.title,
    description: event.description || '',
    startTime: event.startTime,
    endTime: event.endTime,
    location: event.location || '',
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

module.exports = { hashEvent };
