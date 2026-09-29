import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyze, batteryProjection, buildDays, linearFit, median, overrideReason, quantile,
  slotCenters, streaks, toFeedings, usualWindow,
} from '../src/analytics.js';
import { DAY, addDays, localInstant, minutesOf } from '../src/time.js';

const OPTS = { warnVolts: 3.6, critVolts: 3.45 };
let seq = 0;

// An API-shaped item at a Central date and wall-clock time.
function item(date, hhmm, meal, person = 'Alex', extra = {}) {
  seq++;
  return {
    id: `feeder1-${String(seq).padStart(6, '0')}`,
    person, meal,
    timestamp: new Date(localInstant(date, minutesOf(hhmm))).toISOString(),
    localDate: date, localTime: hhmm,
    override: false, batteryVoltage: 3.9,
    timeConfidence: 'synced', timeSource: 'server-anchored',
    ...extra,
  };
}

const response = (items) => ({ days: 90, items, unparseable: 0, latest: items[items.length - 1] ?? null });

test('quantile and median interpolate', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(quantile([0, 10], 0.25), 2.5);
  assert.equal(median([]), null);
});

test('linearFit recovers an exact line with zero standard error', () => {
  const fit = linearFit([0, 1, 2, 3, 4].map((x) => ({ x, y: 4 - 0.004 * x })));
  assert.ok(Math.abs(fit.b + 0.004) < 1e-12);
  assert.ok(Math.abs(fit.a - 4) < 1e-12);
  assert.ok(fit.se < 1e-9);
});

test('slots are assigned by time, not by the device label', () => {
  const items = [];
  for (let i = 1; i <= 5; i++) {
    const d = addDays('2026-09-01', i);
    items.push(item(d, '07:30', 'breakfast'), item(d, '18:30', 'dinner'));
  }
  // Breakfast skipped: the device labels the evening feeding "breakfast".
  items.push(item('2026-09-07', '19:00', 'breakfast', 'Sam'));
  const feedings = toFeedings(items);
  const centers = slotCenters(feedings);
  assert.equal(centers.split, (7.5 * 60 + 18.5 * 60) / 2);
  const days = buildDays(feedings, { today: '2026-09-07', windowDays: 7, centers });
  const sep7 = days.find((d) => d.date === '2026-09-07');
  assert.equal(sep7.breakfast, null);
  assert.equal(sep7.dinner.person, 'Sam');
  assert.equal(days.find((d) => d.date === '2026-09-01').hasData, false, 'before the first record is not a miss');
});

test('the feeding closest to the usual time fills the slot; others are extras', () => {
  const items = [];
  for (let i = 1; i <= 5; i++) {
    const d = addDays('2026-09-01', i);
    items.push(item(d, '07:30', 'breakfast'), item(d, '18:30', 'dinner'));
  }
  // Late breakfast, a second feeding at 1:54 PM (past the split), real dinner at 6:55 PM.
  items.push(item('2026-09-07', '11:34', 'breakfast', 'Alex'),
    item('2026-09-07', '13:54', 'dinner', 'Sam', { override: true }),
    item('2026-09-07', '18:55', 'dinner', 'Jordan', { override: true }));
  const feedings = toFeedings(items);
  const days = buildDays(feedings, { today: '2026-09-07', windowDays: 7, centers: slotCenters(feedings) });
  const sep7 = days.find((d) => d.date === '2026-09-07');
  assert.equal(sep7.breakfast.localTime, '11:34');
  assert.equal(sep7.dinner.localTime, '18:55');
  assert.deepEqual(sep7.extras.map((f) => f.localTime), ['13:54']);
});

test('streaks: current counts back from today; an unfinished today breaks nothing', () => {
  const mk = (date, complete, isToday = false) => ({ date, complete, isToday });
  const days = [
    ...[0, 1, 2, 3, 4].map((i) => mk(addDays('2026-09-01', i), true)),
    mk('2026-09-06', false),
    ...[6, 7, 8].map((i) => mk(addDays('2026-09-01', i), true)),
    mk('2026-09-10', false, true),
  ];
  const s = streaks(days, '2026-09-01');
  assert.equal(s.current, 3);
  assert.equal(s.longest, 5);
  assert.equal(s.currentAtLeast, false);
  // Longest respects the range start.
  assert.equal(streaks(days, '2026-09-04').longest, 3);
});

test('streak that reaches the start of the data window is reported as "at least"', () => {
  const days = [0, 1, 2].map((i) => ({ date: addDays('2026-09-01', i), complete: true, isToday: i === 2 }));
  assert.deepEqual(streaks(days, '2026-09-01'), { current: 3, currentAtLeast: true, longest: 3 });
});

test('usual window: robust spread with a one-hour floor', () => {
  const tight = usualWindow([450, 452, 455, 448, 451, 453]);
  assert.equal(tight.hi - tight.median, 60);
  const wide = usualWindow([420, 480, 540, 600, 660, 720, 780]);   // MAD 120
  assert.equal(wide.median, 600);
  assert.equal(wide.hi, 600 + 360);
  assert.equal(usualWindow([450, 460]), null, 'too few samples to judge');
});

test('weekend breakfasts are judged against weekend habits', () => {
  const items = [];
  for (let i = 0; i < 28; i++) {
    const d = addDays('2026-08-31', i);   // Mon Aug 31 onward, four weeks
    const weekend = i % 7 >= 5;
    items.push(item(d, weekend ? `09:0${i % 3}` : `07:2${i % 5}`, 'breakfast'), item(d, '18:30', 'dinner'));
  }
  const now = localInstant('2026-09-28', 12 * 60);
  const m = analyze(response(items), { now, rangeDays: 30, ...OPTS });
  assert.equal(m.windows.breakfast.split, true);
  assert.ok(!m.exceptions.some((e) => e.slot === 'breakfast'), 'no weekend breakfast flagged late');

  // With too few weekend samples, one combined window judges every day.
  const weekdaysOnly = items.filter((it) => !['2026-09-05', '2026-09-06', '2026-09-12', '2026-09-13',
    '2026-09-19', '2026-09-20'].includes(it.localDate));
  const m2 = analyze(response(weekdaysOnly), { now, rangeDays: 30, ...OPTS });
  assert.equal(m2.windows.breakfast.split, false);
  assert.ok(m2.exceptions.some((e) => e.slot === 'breakfast' && e.kind === 'late'),
    'the remaining weekend breakfast is late against weekday habits');
});

test('override reasons follow the device rules, including a deleted record', () => {
  const twiceDay = [
    item('2026-09-10', '07:30', 'breakfast'),
    item('2026-09-10', '18:00', 'dinner'),
    item('2026-09-10', '21:30', 'dinner', 'Sam', { override: true }),
  ];
  const recent = [
    item('2026-09-11', '07:30', 'breakfast'),
    item('2026-09-11', '08:15', 'dinner', 'Sam', { override: true }),
  ];
  // Like feeder1-000040: breakfast at 12:28, overridden dinner at 20:16, the
  // record between them deleted from the table.
  const unexplained = [
    item('2026-09-12', '12:28', 'breakfast'),
    item('2026-09-12', '20:16', 'dinner', 'Sam', { override: true }),
  ];
  const all = toFeedings([...twiceDay, ...recent, ...unexplained]);
  const byTime = (d, t) => all.find((f) => f.localDate === d && f.localTime === t);
  assert.equal(overrideReason(byTime('2026-09-10', '21:30'), all).kind, 'twice');
  const r = overrideReason(byTime('2026-09-11', '08:15'), all);
  assert.equal(r.kind, 'recent');
  assert.equal(r.gapMin, 45);
  assert.equal(r.prevPerson, 'Alex');
  assert.equal(overrideReason(byTime('2026-09-12', '20:16'), all).kind, 'unexplained');
});

// Twice-daily readings with a small deterministic wobble (+/- 15 mV).
function readings({ startMs, days, v0, mvPerDay }) {
  const out = [];
  for (let i = 0; i < days * 2; i++) {
    const t = i / 2;
    out.push({ ms: startMs + t * DAY, v: v0 - (mvPerDay / 1000) * t + (i % 3 - 1) * 0.015 });
  }
  return out;
}

test('battery projection: trend to the warn threshold, with a range', () => {
  const r = readings({ startMs: Date.parse('2026-08-01T12:00:00Z'), days: 30, v0: 3.85, mvPerDay: 4 });
  const p = batteryProjection(r, OPTS);
  assert.equal(p.state, 'ok');
  assert.ok(Math.abs(p.slopeMvPerDay + 4) < 0.5, `slope ${p.slopeMvPerDay}`);
  // Trend now ~3.85 - 0.004 * 29.5 = 3.732 V; 0.132 V left at 4 mV/day ~ 33 days.
  assert.ok(p.days > 28 && p.days < 38, `days ${p.days}`);
  assert.ok(p.daysLo < p.days && p.days < p.daysHi);
});

test('battery projection: only the current cycle, after a recharge, is fitted', () => {
  const before = readings({ startMs: Date.parse('2026-07-01T12:00:00Z'), days: 10, v0: 3.62, mvPerDay: 10 });
  const after = readings({ startMs: Date.parse('2026-07-12T12:00:00Z'), days: 20, v0: 4.05, mvPerDay: 5 });
  const p = batteryProjection([...before, ...after], OPTS);
  assert.equal(p.charges.length, 1);
  assert.equal(p.fitStartMs, after[0].ms);
  assert.ok(Math.abs(p.slopeMvPerDay + 5) < 0.7, `slope ${p.slopeMvPerDay}`);
});

test('battery projection: flat, sparse, and already-low batteries say so', () => {
  const flat = readings({ startMs: Date.parse('2026-08-01T12:00:00Z'), days: 20, v0: 3.9, mvPerDay: 0 });
  assert.equal(batteryProjection(flat, OPTS).state, 'flat');
  const sparse = readings({ startMs: Date.parse('2026-08-01T12:00:00Z'), days: 2, v0: 3.9, mvPerDay: 5 });
  assert.equal(batteryProjection(sparse, OPTS).state, 'insufficient');
  const low = readings({ startMs: Date.parse('2026-08-01T12:00:00Z'), days: 20, v0: 3.62, mvPerDay: 5 });
  assert.equal(batteryProjection(low, OPTS).state, 'below');
  assert.equal(batteryProjection([], OPTS).state, 'none');
});

test('analyze: right-now states, who feeds, exceptions, empty data', () => {
  const items = [];
  for (let i = 0; i < 10; i++) {
    const d = addDays('2026-09-20', i);
    items.push(item(d, '07:30', 'breakfast', i % 2 ? 'Alex' : 'Sam'));
    if (i !== 4) items.push(item(d, '18:30', 'dinner', 'Jordan'));   // Sep 24: dinner missed
  }
  items.push(item('2026-09-30', '07:35', 'breakfast', 'Alex'));
  // 7 PM Central on Sep 30: breakfast done, dinner overdue (usual ~18:30, window floor 60 min).
  const now = localInstant('2026-09-30', 19 * 60 + 45);
  const m = analyze(response(items), { now, rangeDays: 30, ...OPTS });
  assert.equal(m.today, '2026-09-30');
  assert.equal(m.rightNow.breakfast.state, 'done');
  assert.equal(m.rightNow.dinner.state, 'overdue');
  assert.ok(m.exceptions.some((e) => e.date === '2026-09-24' && e.slot === 'dinner' && e.kind === 'missed'));
  assert.ok(!m.exceptions.some((e) => e.date === '2026-09-30'), 'today is never "missed"');
  const shares = m.whoFeeds.reduce((s, p) => s + p.share, 0);
  assert.ok(Math.abs(shares - 1) < 1e-9);
  assert.equal(m.whoFeeds[0].name, 'Jordan');
  assert.equal(m.streaks.current, 5, 'Sep 25-29 complete; Sep 30 unfinished');
  assert.equal(m.completion.complete, 9);
  assert.equal(m.completion.eligible, 10);

  const empty = analyze(response([]), { now, rangeDays: 7, ...OPTS });
  assert.equal(empty.isEmpty, true);
  assert.equal(empty.rightNow.lastContactMs, null);
  assert.equal(empty.battery.projection.state, 'none');
});

test('analyze: a feeding with an untrusted clock is kept out of the charts', () => {
  const items = [
    item('2026-09-28', '07:30', 'breakfast'),
    item('2026-09-28', '18:30', 'dinner'),
    item('2026-09-29', '03:10', 'unknown', 'Sam', { timeConfidence: 'unknown', timeSource: 'device' }),
  ];
  const m = analyze(response(items), { now: localInstant('2026-09-29', 12 * 60), rangeDays: 7, ...OPTS });
  assert.equal(m.quality.untrustedTime, 1);
  assert.equal(m.quality.unknownMeal, 1);
  assert.equal(m.totalFeedings, 2);
});
