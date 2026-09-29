// Mock feeding data for local development. Generated in the browser, never
// sent anywhere: the dashboard has no write path, and this module is only
// imported behind import.meta.env.DEV, so production builds do not contain it.
//
// The generator runs each intended feeding through the firmware's own rules
// (feeding.cpp), so the mock carries the same quirks as real data: meals
// labeled by order, overrides exactly where a guard would have blocked, a
// deleted record, a feeding logged while the clock was lost.

import { ApiError } from './api.js';
import { DAY, HOUR, MINUTE, addDays, localDateOf, localInstant, localMidnight, localMinutesOf, weekdayOf } from './time.js';

export const MOCK_PEOPLE = ['Alex', 'Sam', 'Jordan', 'Riley'];
const SEED = 20260620;
const HISTORY_DAYS = 95;
const REFEED_GAP_MS = 3 * HOUR;   // MIN_REFEED_GAP_SEC

// Weighted feeders per slot.
const WHO = {
  weekdayBreakfast: [['Alex', 0.6], ['Sam', 0.25], ['Jordan', 0.15]],
  weekendBreakfast: [['Sam', 0.5], ['Riley', 0.3], ['Alex', 0.2]],
  dinner: [['Jordan', 0.45], ['Alex', 0.3], ['Sam', 0.2], ['Riley', 0.05]],
};

// Resting voltage vs state of charge for a 1S li-ion cell under the
// feeder's light load: steep near full, a long plateau, a knee near 3.5 V.
const OCV = [
  [0, 3.30], [5, 3.45], [10, 3.55], [15, 3.61], [20, 3.65], [30, 3.70], [40, 3.74],
  [50, 3.78], [60, 3.82], [70, 3.87], [80, 3.94], [90, 4.02], [100, 4.15],
];
// Matches the real device: ~4 mV/day mid-plateau, a charge lasting ~4 months.
const SOC_PER_DAY = 0.65;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(r) {
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

function pick(r, weighted) {
  let x = r() * weighted.reduce((s, [, w]) => s + w, 0);
  for (const [name, w] of weighted) {
    x -= w;
    if (x <= 0) return name;
  }
  return weighted[weighted.length - 1][0];
}

function voltageAt(soc) {
  const s = Math.max(0, Math.min(100, soc));
  for (let i = 1; i < OCV.length; i++) {
    const [s1, v1] = OCV[i];
    if (s <= s1) {
      const [s0, v0] = OCV[i - 1];
      return v0 + ((v1 - v0) * (s - s0)) / (s1 - s0);
    }
  }
  return OCV[OCV.length - 1][1];
}

// Feedings people intended, before the device sees them.
function intendedFeedings(r, today) {
  const start = addDays(today, -(HISTORY_DAYS - 1));
  const deletedDay = addDays(today, -41);
  const clockLostDay = addDays(today, -56);
  const out = [];
  for (let date = start; date <= today; date = addDays(date, 1)) {
    const weekend = weekdayOf(date) >= 5;
    const slots = [
      { mean: weekend ? 8 * 60 + 50 : 7 * 60 + 25, sd: weekend ? 30 : 18,
        who: weekend ? WHO.weekendBreakfast : WHO.weekdayBreakfast },
      { mean: 18 * 60 + 20, sd: 25, who: WHO.dinner },
    ];
    for (const [i, slot] of slots.entries()) {
      const scripted = (date === deletedDay && i === 1) || (date === clockLostDay && i === 0);
      if (r() < 0.025 && !scripted) continue;                         // missed
      let min = slot.mean + gaussian(r) * slot.sd;
      if (r() < 0.04) min += 120 + r() * 80;                           // late
      const person = pick(r, slot.who);
      const clockLost = date === clockLostDay && i === 0;
      out.push({ date, min, person, clockLost });
      if (r() < 0.02 || (date === deletedDay && i === 1)) {           // someone feeds again
        const other = pick(r, slot.who.filter(([n]) => n !== person).concat([['Riley', 0.1]]));
        out.push({ date, min: min + 30 + r() * 120, person: other, deleteFirst: date === deletedDay });
      }
    }
    if (r() < 0.01) out.push({ date, min: slots[1].mean + 150 + r() * 60, person: pick(r, WHO.dinner) });
  }
  return out.map((f) => ({ ...f, t: localInstant(f.date, f.min) + Math.floor(r() * MINUTE) }))
    .sort((a, b) => a.t - b.t);
}

// Raw table items (as DynamoDB stores them), for feedings up to `now`.
export function generateItems({ now = Date.now(), seed = SEED } = {}) {
  const r = mulberry32(seed);
  const today = localDateOf(now);
  const intended = intendedFeedings(r, today).filter((f) => f.t <= now);
  const startMs = localMidnight(addDays(today, -(HISTORY_DAYS - 1)));
  // Recharged a day after dipping below 3.60 V, inside the 90-day window so
  // every view past 7 days shows the tail, the jump, and the slow decline.
  const rechargeMs = startMs + 9 * DAY + 12 * HOUR;

  // Device state, as in store.cpp's snapshot.
  const s = { bfastTs: 0, dinnerTs: 0, lastTs: 0 };
  const sameDay = (a, b) => a !== 0 && localDateOf(a) === localDateOf(b);
  let nextId = 101;
  const items = [];
  for (const f of intended) {
    const soc = f.t < rechargeMs
      ? 19 - SOC_PER_DAY * ((f.t - startMs) / DAY)
      : 100 - SOC_PER_DAY * ((f.t - rechargeMs) / DAY);
    const item = {
      id: `feeder1-${String(nextId++).padStart(6, '0')}`,
      person: f.person,
      batteryVoltage: Math.round((voltageAt(soc) + gaussian(r) * 0.008) * 1000) / 1000,
      timeConfidence: r() < 0.1 ? 'drifting' : 'synced',
      timeSource: r() < 0.05 ? 'device' : 'server-anchored',
    };
    if (f.clockLost) {
      // Cold boot, no RTC or NTP yet: never blocked, meal unknown, and the
      // best-guess timestamp is hours off. The meal slots are not updated.
      const guess = f.t - 5 * HOUR - Math.floor(r() * 2 * HOUR);
      Object.assign(item, {
        meal: 'unknown', override: false, timestamp: new Date(guess).toISOString(),
        timeConfidence: 'unknown', timeSource: 'device',
      });
      s.lastTs = guess;
    } else {
      const n = (sameDay(s.bfastTs, f.t) ? 1 : 0) + (sameDay(s.dinnerTs, f.t) ? 1 : 0);
      const blocked = n >= 2 || (s.lastTs !== 0 && f.t - s.lastTs < REFEED_GAP_MS);
      item.meal = n === 0 ? 'breakfast' : 'dinner';
      item.override = blocked;   // a blocked feeding is only logged via hold-to-override
      item.timestamp = new Date(f.t).toISOString();
      if (n === 0) s.bfastTs = f.t; else s.dinnerTs = f.t;
      s.lastTs = f.t;
    }
    items.push({ ...item, deleteLater: false });
    if (f.deleteFirst) items[items.length - 2].deleteLater = true;
  }
  // Someone deleted a record in the console; the device still counted it.
  return items.filter((it) => !it.deleteLater).map(({ deleteLater, ...it }) => it);
}

// Shape items exactly as the read Lambda does (readFeedingLogs.js build()).
export function toApiResponse(items, { now, days = 90 }) {
  const fromMs = localMidnight(addDays(localDateOf(now), -(days - 1)));
  const parsed = items.map((it) => ({ it, ms: Date.parse(it.timestamp) }));
  const latest = parsed.reduce((a, b) => (!a || b.ms > a.ms ? b : a), null);
  const record = ({ it, ms }) => {
    const minutes = localMinutesOf(ms);
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    return { ...it, localDate: localDateOf(ms), localTime: `${hh}:${mm}` };
  };
  const inRange = parsed.filter((p) => p.ms >= fromMs).sort((a, b) => a.ms - b.ms);
  return {
    timezone: 'America/Chicago',
    days,
    from: new Date(fromMs).toISOString(),
    generatedAt: new Date(now).toISOString(),
    count: inRange.length,
    unparseable: 0,
    latest: latest ? record(latest) : null,
    items: inRange.map(record),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Stand-in for fetchFeedings(). Scenarios exercise every UI state.
export async function mockFetch({ scenario = 'normal', now = Date.now() } = {}) {
  await sleep(scenario === 'slow' ? 4000 : 350);
  if (scenario === 'error') {
    throw new ApiError('The API returned an error (HTTP 500).', {
      status: 500, requestId: 'mock-0000-request-id',
      hint: 'Mock "error" scenario. With live data, search the read Lambda\'s log group for this request ID.',
    });
  }
  if (scenario === 'empty') return toApiResponse([], { now });
  return toApiResponse(generateItems({ now }), { now });
}
