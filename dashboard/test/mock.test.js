import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/analytics.js';
import { ApiError } from '../src/api.js';
import { generateItems, mockFetch, toApiResponse } from '../src/mock.js';
import { DAY, HOUR, addDays, localDateOf, localMidnight, localMinutesOf } from '../src/time.js';

const NOW = Date.parse('2026-09-29T20:00:00Z');   // 3 PM CDT
const items = generateItems({ now: NOW });
const byTime = [...items].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

test('deterministic for a given moment', () => {
  assert.deepEqual(generateItems({ now: NOW }), items);
});

test('about 95 days of roughly two feedings a day, nothing in the future', () => {
  const dates = new Set(items.map((it) => localDateOf(Date.parse(it.timestamp))));
  assert.ok(dates.size >= 90, `${dates.size} days`);
  const perDay = items.length / 95;
  assert.ok(perDay > 1.8 && perDay < 2.2, `${perDay} per day`);
  assert.ok(items.every((it) => Date.parse(it.timestamp) <= NOW));
});

test('ids are unique and increasing, with a gap where a record was deleted', () => {
  const nums = items.map((it) => Number(it.id.split('-')[1]));
  assert.ok(nums.every((n, i) => i === 0 || n > nums[i - 1]));
  const gaps = nums.filter((n, i) => i > 0 && n !== nums[i - 1] + 1);
  assert.equal(gaps.length, 1);
});

test('meal labels and override flags follow the firmware rules', () => {
  // Replay feeding.cpp over the records that exist.
  const s = { bfastTs: 0, dinnerTs: 0, lastTs: 0 };
  const sameDay = (a, b) => a !== 0 && localDateOf(a) === localDateOf(b);
  const mismatches = [];
  for (const it of byTime) {
    const t = Date.parse(it.timestamp);
    if (it.meal === 'unknown') { s.lastTs = t; continue; }
    const n = (sameDay(s.bfastTs, t) ? 1 : 0) + (sameDay(s.dinnerTs, t) ? 1 : 0);
    assert.equal(it.meal, n === 0 ? 'breakfast' : 'dinner', `label of ${it.id}`);
    const blocked = n >= 2 || (s.lastTs !== 0 && t - s.lastTs < 3 * HOUR);
    if (blocked !== it.override) mismatches.push(it.id);
    if (n === 0) s.bfastTs = t; else s.dinnerTs = t;
    s.lastTs = t;
  }
  // Exactly one override the remaining data cannot explain: the record it
  // overrode was deleted.
  assert.equal(mismatches.length, 1);
  assert.ok(items.some((it) => it.override), 'some overrides exist');
});

test('one feeding was logged while the clock was lost', () => {
  const lost = items.filter((it) => it.timeConfidence === 'unknown');
  assert.equal(lost.length, 1);
  assert.equal(lost[0].meal, 'unknown');
  assert.equal(lost[0].timeSource, 'device');
});

test('battery: plausible li-ion voltages with exactly one recharge', () => {
  const v = byTime.map((it) => it.batteryVoltage);
  assert.ok(v.every((x) => x > 3.3 && x < 4.2));
  const jumps = v.filter((x, i) => i > 0 && x - v[i - 1] >= 0.1);
  assert.equal(jumps.length, 1);
  assert.ok(v[0] < 3.65, 'starts at the tail of the previous charge');
  assert.ok(v[v.length - 1] > 3.7 && v[v.length - 1] < 3.8, `now ${v[v.length - 1]}`);
});

test('API shaping matches the read Lambda: Central fields, window, latest', () => {
  const res = toApiResponse(items, { now: NOW });
  const from = localMidnight(addDays(localDateOf(NOW), -89));
  assert.equal(res.days, 90);
  assert.equal(res.from, new Date(from).toISOString());
  assert.equal(res.count, res.items.length);
  for (const it of res.items) {
    const ms = Date.parse(it.timestamp);
    assert.ok(ms >= from);
    assert.equal(it.localDate, localDateOf(ms));
    const m = localMinutesOf(ms);
    assert.equal(it.localTime, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  assert.equal(res.latest.id, byTime[byTime.length - 1].id);
});

test('mock data exercises every analytic', () => {
  const m = analyze(toApiResponse(items, { now: NOW }), { now: NOW, rangeDays: 90, warnVolts: 3.6, critVolts: 3.45 });
  assert.equal(m.battery.projection.state, 'ok');
  assert.ok(m.overrides.some((o) => o.reason.kind === 'unexplained'));
  assert.ok(m.overrides.some((o) => o.reason.kind === 'recent'));
  assert.ok(m.exceptions.some((e) => e.kind === 'missed'));
  assert.ok(m.exceptions.some((e) => e.kind === 'late'));
  assert.equal(m.quality.untrustedTime, 1);
  assert.equal(m.whoFeeds.length, 4);
  assert.ok(m.streaks.longest >= 5);
});

test('scenarios: empty and error', async () => {
  const empty = await mockFetch({ scenario: 'empty', now: NOW });
  assert.deepEqual(empty.items, []);
  assert.equal(empty.latest, null);
  await assert.rejects(mockFetch({ scenario: 'error', now: NOW }), (err) =>
    err instanceof ApiError && err.status === 500 && Boolean(err.requestId));
});
