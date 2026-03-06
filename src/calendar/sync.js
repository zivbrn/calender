const { hashEvent } = require('../utils/hash');

const SYNC_SOURCE = 'calendar-sync';

async function syncEvents(scrapedEvents, { calendarClient, calendarId }) {
  // 1. Fetch existing synced events from Google Calendar
  const existingEvents = await fetchSyncedEvents(calendarClient, calendarId);
  console.log(`Found ${existingEvents.length} existing synced event(s) in Google Calendar.`);

  // Build lookup by syncId, deleting any duplicates found
  const existingMap = new Map();
  let inserted = 0, updated = 0, skipped = 0, deleted = 0;

  for (const ev of existingEvents) {
    if (ev.status === 'cancelled') continue;
    const syncId = ev.extendedProperties?.private?.syncId;
    if (!syncId) continue;
    if (existingMap.has(syncId)) {
      // Duplicate entry — clean it up
      await calendarClient.events.delete({ calendarId, eventId: ev.id });
      deleted++;
      console.log(`  Cleaned up duplicate: ${ev.summary}`);
    } else {
      existingMap.set(syncId, ev);
    }
  }

  // 2. Build a set of current scraped syncIds
  const currentSyncIds = new Set();

  for (const event of scrapedEvents) {
    const hash = hashEvent(event);
    const syncId = event.id;
    currentSyncIds.add(syncId);

    const existing = existingMap.get(syncId);

    if (existing) {
      const existingHash = existing.extendedProperties?.private?.contentHash;
      if (existingHash === hash) {
        skipped++;
        continue;
      }
      // Update changed event
      await calendarClient.events.update({
        calendarId,
        eventId: existing.id,
        requestBody: buildGoogleEvent(event, hash, syncId),
      });
      updated++;
      console.log(`  Updated: ${event.title}`);
    } else {
      // Insert new event
      await calendarClient.events.insert({
        calendarId,
        requestBody: buildGoogleEvent(event, hash, syncId),
      });
      inserted++;
      console.log(`  Inserted: ${event.title}`);
    }
  }

  // 3. Delete events that no longer exist in scraped data
  const toDelete = [...existingMap.entries()].filter(([syncId]) => !currentSyncIds.has(syncId));
  if (toDelete.length > 5 && toDelete.length > existingMap.size * 0.4) {
    throw new Error(`Safety check: aborting — would delete ${toDelete.length} of ${existingMap.size} future events. Scrape may be incomplete.`);
  }
  for (const [, ev] of toDelete) {
    await calendarClient.events.delete({ calendarId, eventId: ev.id });
    deleted++;
    console.log(`  Deleted: ${ev.summary}`);
  }

  const stats = { inserted, updated, skipped, deleted };
  console.log(`Sync complete: ${inserted} inserted, ${updated} updated, ${skipped} unchanged, ${deleted} deleted.`);
  return stats;
}

async function fetchSyncedEvents(calendarClient, calendarId) {
  const events = [];
  let pageToken;

  // Only fetch events from today onwards — never delete past events
  const timeMin = new Date();
  timeMin.setHours(0, 0, 0, 0);

  do {
    const res = await calendarClient.events.list({
      calendarId,
      privateExtendedProperty: `syncSource=${SYNC_SOURCE}`,
      maxResults: 250,
      singleEvents: true,
      timeMin: timeMin.toISOString(),
      pageToken,
    });
    if (res.data.items) events.push(...res.data.items);
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return events;
}

function buildGoogleEvent(event, hash, syncId) {
  const isAllDay = !event.startTime?.includes('T');

  const start = isAllDay
    ? { date: event.startTime }
    : { dateTime: event.startTime, timeZone: 'Asia/Jerusalem' };

  const end = isAllDay
    ? { date: event.endTime }
    : { dateTime: event.endTime, timeZone: 'Asia/Jerusalem' };

  return {
    summary: event.title,
    description: event.description || '',
    location: event.location || '',
    start,
    end,
    extendedProperties: {
      private: {
        syncSource: SYNC_SOURCE,
        syncId,
        contentHash: hash,
      },
    },
  };
}

module.exports = { syncEvents };
