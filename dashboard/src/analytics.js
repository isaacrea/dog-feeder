// Analytics over the read API's response. Pure functions: no DOM, no
// network, no clock reads (the caller passes `now`), so live data, mock data,
// and unit tests all run the same code.

import {
  DAY, HOUR, MINUTE, addDays, localDateOf, localMidnight, localMinutesOf, minutesOf, weekdayOf,
} from './time.js';

// Mirrors MIN_REFEED_GAP_SEC in firmware/config.h: the device's recency guard.
export const REFEED_GAP_MIN = 180;

// A day's two meal slots. The device labels meals by order (first feeding of
// the day is "breakfast"), so a skipped breakfast labels the evening feeding
// "breakfast". Analytics assign slots by time instead: before the split point
// (halfway between the usual breakfast and dinner times) is breakfast.
const DEFAULT_BREAKFAST_MIN = 8 * 60;
const DEFAULT_DINNER_MIN = 18 * 60;

// Off-schedule: more than ~2 standard deviations from the usual time,
// estimated robustly (3 x median absolute deviation), never under an hour.
const WINDOW_MAD_FACTOR = 3;
const WINDOW_FLOOR_MIN = 60;
const WINDOW_MIN_SAMPLES = 5;

// Battery projection. Readings at or above CHARGER_V are taken on the
// charger; a rise of RECHARGE_JUMP_V between readings starts a new cycle.
const CHARGER_V = 4.15;
const RECHARGE_JUMP_V = 0.10;
const FIT_WINDOW_DAYS = 30;
const FIT_MIN_READINGS = 6;
const FIT_MIN_SPAN_DAYS = 5;

// No report for this long is worth flagging. The device only contacts the
// cloud when someone logs a feeding; an overnight gap is ~12-16 h.
const STALE_CONTACT_MS = 20 * HOUR;

// ---- Statistics ------------------------------------------------------------

export function quantile(values, q) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export const median = (values) => quantile(values, 0.5);

// Ordinary least squares y = a + b x, with the standard error of b.
export function linearFit(points) {
  const n = points.length;
  if (n < 3) return null;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  if (sxx === 0) return null;
  const b = sxy / sxx;
  const a = my - b * mx;
  const sse = points.reduce((s, p) => s + (p.y - (a + b * p.x)) ** 2, 0);
  const se = Math.sqrt(sse / (n - 2) / sxx);
  return { a, b, se, n };
}

// ---- Records ---------------------------------------------------------------

// A timestamp is untrusted only when the device's clock was lost AND the
// server could not anchor it; its calendar day may be wrong.
const isTrustedTime = (it) => !(it.timeSource === 'device' && it.timeConfidence === 'unknown');

export function toFeedings(items) {
  return items
    .map((it) => ({
      ...it,
      ms: Date.parse(it.timestamp),
      minutes: minutesOf(it.localTime),
      trusted: isTrustedTime(it),
    }))
    .filter((f) => Number.isFinite(f.ms))
    .sort((a, b) => a.ms - b.ms);
}

// Usual breakfast and dinner times (from the device's labels, which are
// right on most days) and the split point halfway between them.
export function slotCenters(feedings) {
  const byLabel = (meal) => feedings.filter((f) => f.trusted && f.meal === meal).map((f) => f.minutes);
  const b = byLabel('breakfast');
  const d = byLabel('dinner');
  let breakfast = b.length >= 3 ? median(b) : DEFAULT_BREAKFAST_MIN;
  let dinner = d.length >= 3 ? median(d) : DEFAULT_DINNER_MIN;
  if (dinner - breakfast < 2 * 60) { breakfast = DEFAULT_BREAKFAST_MIN; dinner = DEFAULT_DINNER_MIN; }
  return { breakfast, dinner, split: (breakfast + dinner) / 2 };
}

// Usual window for one slot's times, or null with too few samples.
export function usualWindow(minutes) {
  if (minutes.length < WINDOW_MIN_SAMPLES) return null;
  const m = median(minutes);
  const mad = median(minutes.map((x) => Math.abs(x - m)));
  const half = Math.max(WINDOW_FLOOR_MIN, WINDOW_MAD_FACTOR * mad);
  return { median: m, lo: m - half, hi: m + half, mad };
}

export const isWeekend = (date) => weekdayOf(date) >= 5;

// Weekday and weekend windows kept apart, so a household that feeds later on
// Saturdays is not flagged late every weekend. Falls back to one combined
// window when either kind of day has too few samples.
export function slotWindows(days, slot) {
  const mins = (pred) => days.filter((d) => d[slot] && pred(d.date)).map((d) => d[slot].minutes);
  const all = usualWindow(mins(() => true));
  const weekday = usualWindow(mins((date) => !isWeekend(date)));
  const weekend = usualWindow(mins(isWeekend));
  const split = Boolean(weekday && weekend);
  return { all, split, weekday: split ? weekday : all, weekend: split ? weekend : all };
}

export const windowFor = (windows, slot, date) =>
  windows[slot][isWeekend(date) ? 'weekend' : 'weekday'];

const offSchedule = (feeding, win) => {
  if (!feeding || !win) return null;
  if (feeding.minutes > win.hi) return 'late';
  if (feeding.minutes < win.lo) return 'early';
  return null;
};

// ---- Days ------------------------------------------------------------------

// One entry per Central date in the response's window, oldest first. Each
// feeding is a candidate for the slot on its side of the split; the
// candidate closest to that slot's usual time fills it, and the rest are
// extras. (A late breakfast followed by a second feeding at 2 PM leaves the
// 7 PM feeding as dinner, not the 2 PM one.)
export function buildDays(feedings, { today, windowDays, centers }) {
  const start = addDays(today, -(windowDays - 1));
  const byDate = new Map();
  for (const f of feedings) {
    if (!f.trusted) continue;
    if (!byDate.has(f.localDate)) byDate.set(f.localDate, []);
    byDate.get(f.localDate).push(f);
  }
  const firstDataDate = feedings.find((f) => f.trusted)?.localDate ?? null;

  const days = [];
  for (let date = start; date <= today; date = addDays(date, 1)) {
    const day = { date, breakfast: null, dinner: null, extras: [], isToday: date === today };
    const candidates = { breakfast: [], dinner: [] };
    for (const f of byDate.get(date) ?? []) {
      candidates[f.minutes < centers.split ? 'breakfast' : 'dinner'].push(f);
    }
    for (const slot of ['breakfast', 'dinner']) {
      const list = candidates[slot];
      if (!list.length) continue;
      const dist = (f) => Math.abs(f.minutes - centers[slot]);
      day[slot] = list.reduce((best, f) => (dist(f) < dist(best) ? f : best));
      day.extras.push(...list.filter((f) => f !== day[slot]));
    }
    day.extras.sort((a, b) => a.ms - b.ms);
    day.hasData = firstDataDate != null && date >= firstDataDate;
    day.complete = Boolean(day.breakfast && day.dinner);
    days.push(day);
  }
  return days;
}

export function streaks(days, rangeStartDate) {
  const last = days.length - 1;
  let current = days[last]?.complete ? 1 : 0;
  let i = last - 1;
  while (i >= 0 && days[i].complete) { current++; i--; }
  const currentAtLeast = i < 0 && current > 0;   // ran off the start of the data window

  let longest = 0;
  let run = 0;
  for (const d of days) {
    if (d.date < rangeStartDate) continue;
    if (d.isToday && !d.complete) continue;       // an unfinished today breaks nothing
    run = d.complete ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return { current, currentAtLeast, longest };
}

// ---- Overrides -------------------------------------------------------------

// Which guard a logged override got past, re-derived from the data with the
// device's own rules (feeding.cpp): twice-today is checked before recency.
export function overrideReason(feeding, allFeedings) {
  const earlier = allFeedings.filter((f) => f.ms < feeding.ms);
  const sameDayMeals = earlier.filter(
    (f) => f.localDate === feeding.localDate && (f.meal === 'breakfast' || f.meal === 'dinner'));
  if (sameDayMeals.length >= 2) {
    return { kind: 'twice', text: 'Third feeding of the day (the "already fed twice" guard)' };
  }
  const prev = earlier[earlier.length - 1];
  if (prev && feeding.ms - prev.ms < REFEED_GAP_MIN * MINUTE) {
    return {
      kind: 'recent',
      gapMin: Math.round((feeding.ms - prev.ms) / MINUTE),
      prevPerson: prev.person,
      text: 'Within 3 hours of the previous feeding (the recency guard)',
    };
  }
  return {
    kind: 'unexplained',
    text: 'No earlier feeding in the data explains it; the record it overrode was probably deleted',
  };
}

// ---- Battery ---------------------------------------------------------------

export function batteryStatus(v, { warnVolts, critVolts }) {
  if (v == null) return { level: 'unknown', label: 'No reading' };
  if (v >= CHARGER_V) return { level: 'good', label: 'Full or on charger' };
  if (v > warnVolts) return { level: 'good', label: 'OK' };
  if (v > critVolts) return { level: 'warning', label: 'Low: charge soon' };
  return { level: 'critical', label: 'Critical: charge today' };
}

// Least-squares trend over the current discharge cycle's last 30 days,
// projected to the warn threshold. Linear on purpose: simple to explain.
// Li-ion voltage falls faster below ~3.65 V, so late in a cycle the real
// crossing tends to come sooner than the line says.
export function batteryProjection(readings, { warnVolts }) {
  if (!readings.length) return { state: 'none' };
  let cycleStart = 0;
  const charges = [];
  for (let i = 1; i < readings.length; i++) {
    if (readings[i].v - readings[i - 1].v >= RECHARGE_JUMP_V) {
      cycleStart = i;
      charges.push(readings[i].ms);
    }
  }
  const latest = readings[readings.length - 1];
  const fitSet = readings
    .slice(cycleStart)
    .filter((r) => r.v < CHARGER_V && r.ms >= latest.ms - FIT_WINDOW_DAYS * DAY);
  const spanDays = fitSet.length ? (fitSet[fitSet.length - 1].ms - fitSet[0].ms) / DAY : 0;
  const base = { charges, n: fitSet.length, spanDays, fitStartMs: fitSet[0]?.ms ?? null };

  if (fitSet.length < FIT_MIN_READINGS || spanDays < FIT_MIN_SPAN_DAYS) {
    return { ...base, state: 'insufficient' };
  }
  // x in days relative to the latest reading, so a = trend voltage "now".
  const fit = linearFit(fitSet.map((r) => ({ x: (r.ms - latest.ms) / DAY, y: r.v })));
  if (!fit) return { ...base, state: 'insufficient' };
  const trend = { ...base, slopeMvPerDay: fit.b * 1000, seMvPerDay: fit.se * 1000, trendNowV: fit.a };

  // Not measurably discharging: the slope is within noise of flat.
  if (fit.b >= 0 || -fit.b < 2 * fit.se) return { ...trend, state: 'flat' };
  if (fit.a <= warnVolts) return { ...trend, state: 'below' };

  const daysAt = (slope) => (fit.a - warnVolts) / -slope;
  const days = daysAt(fit.b);
  const slowest = fit.b + 2 * fit.se;
  return {
    ...trend,
    state: 'ok',
    days,
    daysLo: daysAt(fit.b - 2 * fit.se),
    daysHi: slowest < 0 ? daysAt(slowest) : Infinity,
    crossingMs: latest.ms + days * DAY,
  };
}

// ---- Everything the page shows ----------------------------------------------

export function analyze(response, { now, rangeDays, warnVolts, critVolts }) {
  const today = localDateOf(now);
  const windowDays = response.days ?? 90;
  const feedings = toFeedings(response.items ?? []);
  const trusted = feedings.filter((f) => f.trusted);
  const centers = slotCenters(feedings);
  const split = centers.split;
  const days = buildDays(feedings, { today, windowDays, centers });

  const rangeStartDate = addDays(today, -(rangeDays - 1));
  const rangeStartMs = localMidnight(rangeStartDate);
  const rangeDaysList = days.filter((d) => d.date >= rangeStartDate);

  // Usual windows come from the whole 90 days, so "late" means the same thing
  // in every range view.
  const windows = { breakfast: slotWindows(days, 'breakfast'), dinner: slotWindows(days, 'dinner') };
  for (const d of days) {
    d.breakfastOff = offSchedule(d.breakfast, windowFor(windows, 'breakfast', d.date));
    d.dinnerOff = offSchedule(d.dinner, windowFor(windows, 'dinner', d.date));
    d.overrides = [d.breakfast, d.dinner, ...d.extras].filter((f) => f?.override).length;
  }

  // Right now.
  const todayRec = days[days.length - 1];
  const nowMin = localMinutesOf(now);
  const slotNow = (slot) => {
    const f = todayRec?.[slot];
    const win = windowFor(windows, slot, today);
    if (f) return { state: 'done', feeding: f, off: todayRec[`${slot}Off`] };
    if (win && nowMin > win.hi) return { state: 'overdue', usual: win.median, by: win.hi };
    return { state: 'pending', usual: win?.median ?? null };
  };
  const latest = response.latest ?? null;
  const latestMs = latest ? Date.parse(latest.timestamp) : null;
  const readings = trusted
    .filter((f) => Number.isFinite(f.batteryVoltage))
    .map((f) => ({ ms: f.ms, v: f.batteryVoltage }));
  const battery = {
    latestV: latest?.batteryVoltage ?? null,
    status: batteryStatus(latest?.batteryVoltage ?? null, { warnVolts, critVolts }),
    projection: batteryProjection(readings, { warnVolts }),
    readingsInRange: readings.filter((r) => r.ms >= rangeStartMs),
  };

  // Streaks and completion.
  const past = rangeDaysList.filter((d) => !d.isToday && d.hasData);
  const completion = { complete: past.filter((d) => d.complete).length, eligible: past.length };

  // Schedule stats for the range.
  const scheduleStat = (slot) => {
    const mins = rangeDaysList.filter((d) => d[slot]).map((d) => d[slot].minutes);
    return {
      n: mins.length,
      median: median(mins),
      p25: quantile(mins, 0.25),
      p75: quantile(mins, 0.75),
      windows: windows[slot],
    };
  };
  const gaps = rangeDaysList
    .filter((d) => d.complete)
    .map((d) => (d.dinner.ms - d.breakfast.ms) / MINUTE);

  // Missed and off-schedule meals in the range, newest first.
  const exceptions = [];
  for (const d of [...rangeDaysList].reverse()) {
    if (!d.hasData) continue;
    for (const slot of ['breakfast', 'dinner']) {
      if (!d[slot] && !d.isToday) exceptions.push({ date: d.date, slot, kind: 'missed' });
      const off = d[`${slot}Off`];
      if (off) exceptions.push({ date: d.date, slot, kind: off, feeding: d[slot] });
    }
  }

  // Who feeds Luna, by slot.
  const people = new Map();
  let totalFeedings = 0;
  for (const d of rangeDaysList) {
    for (const [slot, list] of [['breakfast', [d.breakfast]], ['dinner', [d.dinner]], ['extra', d.extras]]) {
      for (const f of list) {
        if (!f) continue;
        const name = f.person ?? 'Unknown';
        if (!people.has(name)) people.set(name, { name, breakfast: 0, dinner: 0, extra: 0, total: 0 });
        const p = people.get(name);
        p[slot]++;
        p.total++;
        totalFeedings++;
      }
    }
  }
  const whoFeeds = [...people.values()]
    .map((p) => ({ ...p, share: totalFeedings ? p.total / totalFeedings : 0 }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  // Overrides in the range, newest first, with the guard each one got past.
  const overrides = feedings
    .filter((f) => f.override && f.localDate >= rangeStartDate)
    .map((f) => ({ feeding: f, reason: overrideReason(f, feedings) }))
    .reverse();

  const quality = {
    unparseable: response.unparseable ?? 0,
    untrustedTime: feedings.filter((f) => !f.trusted).length,
    unknownMeal: feedings.filter((f) => f.meal === 'unknown').length,
    relabeled: days.reduce((n, d) => n
      + (d.breakfast && d.breakfast.meal === 'dinner' ? 1 : 0)
      + (d.dinner && d.dinner.meal === 'breakfast' ? 1 : 0), 0),
  };

  return {
    today,
    now,
    rangeDays,
    rangeStartDate,
    rangeStartMs,
    split,
    windows,
    days: rangeDaysList,
    rightNow: {
      breakfast: slotNow('breakfast'),
      dinner: slotNow('dinner'),
      extrasToday: todayRec?.extras.length ?? 0,
      lastContactMs: latestMs,
      stale: latestMs != null && now - latestMs > STALE_CONTACT_MS,
    },
    streaks: streaks(days, rangeStartDate),
    completion,
    schedule: {
      breakfast: scheduleStat('breakfast'),
      dinner: scheduleStat('dinner'),
      gap: gaps.length ? { median: median(gaps), min: Math.min(...gaps), max: Math.max(...gaps), n: gaps.length } : null,
    },
    exceptions,
    whoFeeds,
    totalFeedings,
    overrides,
    battery,
    quality,
    isEmpty: feedings.length === 0,
  };
}
