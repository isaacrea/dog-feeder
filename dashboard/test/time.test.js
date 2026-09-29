import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, daysBetween, formatAgo, formatClock, formatDuration, formatHour, localDateOf,
  localInstant, localMidnight, localMinutesOf, weekdayOf,
} from '../src/time.js';

const iso = (ms) => new Date(ms).toISOString();

test('a dinner after 7 PM CDT belongs to the Central date, not the UTC date', () => {
  const ms = Date.parse('2026-06-23T01:16:04.334Z');
  assert.equal(localDateOf(ms), '2026-06-22');
  assert.equal(localMinutesOf(ms), 20 * 60 + 16);
});

test('local midnight across both DST changes', () => {
  assert.equal(iso(localMidnight('2026-03-08')), '2026-03-08T06:00:00.000Z');   // CST
  assert.equal(iso(localMidnight('2026-03-09')), '2026-03-09T05:00:00.000Z');   // CDT
  assert.equal(iso(localMidnight('2026-11-01')), '2026-11-01T05:00:00.000Z');   // CDT
  assert.equal(iso(localMidnight('2026-11-02')), '2026-11-02T06:00:00.000Z');   // CST
});

test('localInstant lands on the wall-clock time, even on a DST day', () => {
  assert.equal(iso(localInstant('2026-03-08', 18 * 60)), '2026-03-08T23:00:00.000Z');   // 6 PM CDT
  assert.equal(iso(localInstant('2026-11-01', 18 * 60)), '2026-11-02T00:00:00.000Z');   // 6 PM CST
  assert.equal(localMinutesOf(localInstant('2026-06-20', 7 * 60 + 5)), 7 * 60 + 5);
});

test('calendar arithmetic', () => {
  assert.equal(addDays('2026-09-29', -89), '2026-07-02');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2026-09-01', '2026-09-29'), 28);
  assert.equal(weekdayOf('2026-09-28'), 0);   // Monday
  assert.equal(weekdayOf('2026-09-27'), 6);   // Sunday
});

test('formatting', () => {
  assert.equal(formatClock(0), '12:00 AM');
  assert.equal(formatClock(7 * 60 + 5), '7:05 AM');
  assert.equal(formatClock(12 * 60), '12:00 PM');
  assert.equal(formatClock(20 * 60 + 16), '8:16 PM');
  assert.equal(formatHour(13 * 60), '1 PM');
  assert.equal(formatDuration(635), '10 h 35 m');
  assert.equal(formatDuration(45), '45 m');
  const now = Date.parse('2026-09-29T20:00:00Z');
  assert.equal(formatAgo(now - 30e3, now), 'just now');
  assert.equal(formatAgo(now - 5 * 60e3, now), '5 min ago');
  assert.equal(formatAgo(now - 190 * 60e3, now), '3 h 10 min ago');
  assert.equal(formatAgo(now - 3 * 86400e3, now), '3 days ago');
});
