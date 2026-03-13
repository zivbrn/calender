const { hashEvent } = require('../utils/hash');

const SYNC_SOURCE = 'calendar-sync';

async function syncEvents(scrapedEvents, { calendarClient, calendarId }) {
  // 1. Fetch existing synced events from Google Calendar
  const existingEvents = await fetchSyncedEvents(calendarClient, calendarId);
  console.log(`Found ${existingEvents.length} existing synced event(s) in Google Calendar.`);

  // Build lookup by syncId, and a fallback lookup by startTime+title
  // Fallback catches cases where X Campus changed element IDs between syncs
  const existingMap = new Map();        // syncId → event
  const existingByTimeTitle = new Map(); // `${startMs}|${title}` → event
  let inserted = 0, updated = 0, skipped = 0, deleted = 0;

  for (const ev of existingEvents) {
    if (ev.status === 'cancelled') continue;
    const syncId = ev.extendedProperties?.private?.syncId;

    const startDt = ev.start?.dateTime || ev.start?.date || '';
    const startMs = startDt ? new Date(startDt).getTime() : 0;
    const timeKey = startMs ? `${startMs}|${ev.summary}` : null;

    // Delete duplicates by syncId
    if (syncId && existingMap.has(syncId)) {
      await calendarClient.events.delete({ calendarId, eventId: ev.id });
      deleted++;
      console.log(`  Cleaned up duplicate (syncId): ${ev.summary}`);
      continue;
    }

    // Delete duplicates by time+title (catches stale events with different syncIds)
    if (timeKey && existingByTimeTitle.has(timeKey)) {
      await calendarClient.events.delete({ calendarId, eventId: ev.id });
      deleted++;
      console.log(`  Cleaned up duplicate (time+title): ${ev.summary}`);
      continue;
    }

    if (syncId) existingMap.set(syncId, ev);
    if (timeKey) existingByTimeTitle.set(timeKey, ev);
  }

  // 2. Build a set of current scraped syncIds
  const currentSyncIds = new Set();

  for (const event of scrapedEvents) {
    const hash = hashEvent(event);
    const syncId = event.id;
    currentSyncIds.add(syncId);

    // Look up by syncId first, then fall back to time+title
    let existing = syncId ? existingMap.get(syncId) : null;
    if (!existing) {
      const startMs = event.startTime ? new Date(event.startTime).getTime() : 0;
      const timeKey = startMs ? `${startMs}|${event.title}` : null;
      if (timeKey) existing = existingByTimeTitle.get(timeKey);
    }

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
  // Check both by syncId and by time+title to avoid false deletions
  // Never delete past events — they may have been manually added or left from old syncs
  const now = new Date();
  const toDelete = [...existingMap.entries()].filter(([syncId, ev]) => {
    if (currentSyncIds.has(syncId)) return false;
    // Fallback: keep if any scraped event matches by time+title
    const startDt = ev.start?.dateTime || ev.start?.date || '';
    const startMs = startDt ? new Date(startDt).getTime() : 0;
    const matchedByTime = scrapedEvents.some(e => {
      const eMs = e.startTime ? new Date(e.startTime).getTime() : 0;
      return eMs === startMs && e.title === ev.summary;
    });
    if (matchedByTime) return false;
    // Skip deletion of past events (before today at 00:00)
    const eventEnd = new Date(startDt);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (eventEnd < todayStart) return false;
    return true;
  });

  // Safety check: abort if we'd delete a suspicious proportion of the calendar.
  // Use existingEvents.length (before duplicates) not existingMap.size (after), so check is effective
  if (existingEvents.length > 0 && toDelete.length > 5 && toDelete.length > existingEvents.length * 0.4) {
    throw new Error(
      `Safety check: aborting — scraped ${scrapedEvents.length} event(s) but would delete ${toDelete.length} of ${existingEvents.length} existing synced events (${Math.round(toDelete.length / existingEvents.length * 100)}%). Scrape was likely incomplete.`
    );
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

  // Fetch all events for deduplication matching, but protect past events from deletion
  do {
    const res = await calendarClient.events.list({
      calendarId,
      privateExtendedProperty: [`syncSource=${SYNC_SOURCE}`],
      maxResults: 250,
      singleEvents: true,
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