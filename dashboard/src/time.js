// Central-time helpers. Every date the dashboard shows or groups by is a
// Central calendar date, whatever timezone the viewer's device is in, so
// "today" is always Luna's today. Mirrors the read Lambda's logic
// (cloud/lambda/readFeedingLogs.js); the IANA zone name keeps DST correct.

export const TZ = 'America/Chicago';
export const MINUTE = 60e3;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const wallClock = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

export function zonedParts(ms) {
  const p = {};
  for (const { type, value } of wallClock.formatToParts(ms)) p[type] = value;
  return p;
}

// 'YYYY-MM-DD' of the Central day containing an instant.
export function localDateOf(ms) {
  const p = zonedParts(ms);
  return `${p.year}-${p.month}-${p.day}`;
}

// Minutes since Central midnight.
export function localMinutesOf(ms) {
  const p = zonedParts(ms);
  return Number(p.hour) * 60 + Number(p.minute);
}

// 'HH:MM' (as the API's localTime) to minutes since midnight.
export function minutesOf(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

const splitDate = (date) => date.split('-').map(Number);

// Calendar arithmetic on 'YYYY-MM-DD' strings; no timezone involved.
export function addDays(date, n) {
  const [y, m, d] = splitDate(date);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Days from a to b (b later is positive).
export function daysBetween(a, b) {
  const [ay, am, ad] = splitDate(a);
  const [by, bm, bd] = splitDate(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY);
}

// 0 = Monday ... 6 = Sunday.
export function weekdayOf(date) {
  const [y, m, d] = splitDate(date);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function offsetMs(ms) {
  const p = zonedParts(ms);
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return wall - Math.floor(ms / 1000) * 1000;
}

// The instant a Central calendar date begins. Two passes because the offset
// at the first guess can differ across a DST change.
export function localMidnight(date) {
  const [y, m, d] = splitDate(date);
  const wall = Date.UTC(y, m - 1, d);
  const guess = wall - offsetMs(wall);
  return wall - offsetMs(guess);
}

// The instant a Central wall-clock time occurs on a date.
export function localInstant(date, minutes) {
  const wall = localMidnight(date);
  // Offset can change between midnight and the target time on a DST day;
  // correct by the difference.
  const t = wall + minutes * MINUTE;
  return t - (offsetMs(t) - offsetMs(wall));
}

// ---- Formatting ------------------------------------------------------------

export function formatClock(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  return `${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}

// Axis ticks: "7 AM", "12 PM".
export function formatHour(minutes) {
  const h = Math.floor((((minutes % 1440) + 1440) % 1440) / 60);
  return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
}

const shortDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
const longDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });

// 'Sep 28' / 'Mon, Sep 28' for a 'YYYY-MM-DD' Central date.
export function formatDate(date, { weekday = false } = {}) {
  const [y, m, d] = splitDate(date);
  return (weekday ? longDate : shortDate).format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatDuration(minutes) {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  return h ? `${h} h ${String(m % 60).padStart(2, '0')} m` : `${m} m`;
}

export function formatAgo(ms, now) {
  const mins = Math.max(0, Math.floor((now - ms) / MINUTE));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} h ${mins % 60 ? `${mins % 60} min ` : ''}ago`;
  return `${Math.floor(hours / 24)} days ago`;
}
