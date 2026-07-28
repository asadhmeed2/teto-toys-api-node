const express = require('express');
const { redis, db } = require('../server');
const router = express.Router();

// Shared with the admin API (which deletes this key on save) and the other
// storefront backends. Keep the string identical across services.
const CACHE_KEY = 'store_hours:all';
const CACHE_TTL_SECONDS = 60 * 60; // 1 hour

const STORE_TIMEZONE = process.env.STORE_TIMEZONE || 'Asia/Jerusalem';

// "HH:MM" -> minutes since midnight. Returns null when unparseable.
function toMinutes(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatTime(value) {
  // mysql2 returns TIME columns as "HH:MM:SS" strings; normalise to "HH:MM".
  if (typeof value !== 'string') return '00:00';
  const parts = value.split(':');
  if (parts.length < 2) return '00:00';
  return `${parts[0].padStart(2, '0')}:${parts[1]}`;
}

// Current weekday (0 = Sunday) and minutes-since-midnight in the store's timezone.
function nowInStoreTimezone() {
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: STORE_TIMEZONE,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch (err) {
    // Loud on purpose. Silently using server local time produces a WRONG
    // open/closed answer whenever the host isn't in the store's zone — e.g. a
    // UTC container reports "open" for hours after closing.
    console.error(
      `[store-hours] Timezone '${STORE_TIMEZONE}' could not be resolved (${err.message}). ` +
        'Falling back to server local time — open/closed WILL be wrong unless the host ' +
        'runs in that zone.',
    );
    const local = new Date();
    return {
      dayOfWeek: local.getDay(),
      minutes: local.getHours() * 60 + local.getMinutes(),
      label: `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`,
      resolved: false,
    };
  }

  const parts = formatter.formatToParts(new Date());
  const lookup = {};
  for (const part of parts) lookup[part.type] = part.value;

  const dayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  // "24" is what hour12:false emits at midnight in some ICU versions.
  const hour = lookup.hour === '24' ? 0 : parseInt(lookup.hour, 10);

  return {
    dayOfWeek: dayIndex[lookup.weekday] ?? new Date().getDay(),
    minutes: hour * 60 + parseInt(lookup.minute, 10),
    label: `${String(hour).padStart(2, '0')}:${lookup.minute}`,
    resolved: true,
  };
}

function computeIsOpenNow(days) {
  const now = nowInStoreTimezone();
  const today = days.find((d) => d.day_of_week === now.dayOfWeek);
  if (!today || today.is_closed) return { isOpen: false, now };

  const open = toMinutes(today.open_time);
  const close = toMinutes(today.close_time);
  if (open === null || close === null) return { isOpen: false, now };

  return { isOpen: now.minutes >= open && now.minutes < close, now };
}

async function loadFromDatabase() {
  const [rows] = await db.execute(
    'SELECT day_of_week, open_time, close_time, is_closed FROM store_hours ORDER BY day_of_week ASC',
  );
  return rows.map((r) => ({
    day_of_week: Number(r.day_of_week),
    open_time: formatTime(r.open_time),
    close_time: formatTime(r.close_time),
    is_closed: !!r.is_closed,
  }));
}

// GET /api/store-hours — public: weekly schedule + whether the shop is open right now.
router.get('/store-hours', async (req, res) => {
  try {
    let days = null;

    // 1. Try the cache. Redis being down must not take the storefront with it.
    try {
      const cached = await redis.get(CACHE_KEY);
      if (cached) days = JSON.parse(cached);
    } catch (err) {
      console.error('Store hours cache read failed:', err.message);
    }

    // 2. Cache miss — read through to MySQL and repopulate.
    if (!days) {
      days = await loadFromDatabase();
      try {
        await redis.set(CACHE_KEY, JSON.stringify(days), 'EX', CACHE_TTL_SECONDS);
      } catch (err) {
        console.error('Store hours cache write failed:', err.message);
      }
    }

    // 3. is_open_now is always computed fresh — never cached, or a stale "true"
    //    could outlive closing time by up to the full TTL.
    const { isOpen, now } = computeIsOpenNow(days);

    return res.json({
      timezone: STORE_TIMEZONE,
      // false => the host lacks IANA tz data and the times below are server-local,
      // not store-local. Surfaced so it's visible without reading logs.
      timezone_resolved: now.resolved !== false,
      server_time: now.label,
      is_open_now: isOpen,
      days,
    });
  } catch (err) {
    console.error('Fetch store hours error:', err.message);
    return res
      .status(500)
      .json({ error: 'server_error', error_description: 'An internal error occurred.' });
  }
});

module.exports = router;
