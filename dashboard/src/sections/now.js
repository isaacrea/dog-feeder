// "Right now": has Luna eaten today, and is the device healthy.

import { formatAgo, formatClock, formatDate, localDateOf, localMinutesOf } from '../time.js';
import { h, statusChip, statusIcon, fill } from '../ui.js';

function mealCard(label, s) {
  let level;
  let title;
  const lines = [];
  if (s.state === 'done') {
    level = 'good';
    title = formatClock(s.feeding.minutes);
    lines.push(`Fed by ${s.feeding.person ?? 'someone'}`);
    if (s.off) lines.push(s.off === 'late' ? 'Later than usual' : 'Earlier than usual');
    if (s.feeding.override) lines.push('Logged with an override');
  } else if (s.state === 'overdue') {
    level = 'warning';
    title = 'Not yet, and overdue';
    lines.push(`Usually by ${formatClock(s.by)}`);
  } else {
    level = 'pending';
    title = 'Not yet';
    if (s.usual != null) lines.push(`Usually around ${formatClock(s.usual)}`);
  }
  return h('div', { class: `meal-card is-${level}` },
    h('div', { class: 'meal-head' }, statusIcon(level), h('h3', {}, label)),
    h('p', { class: 'meal-title' }, title),
    lines.map((l) => h('p', { class: 'meal-line' }, l)));
}

export function projectionText(p, warnVolts) {
  const v = `${warnVolts.toFixed(2)} V`;
  switch (p.state) {
    case 'ok': return `About ${Math.round(p.days)} days until ${v} (around ${formatDate(localDateOf(p.crossingMs))})`;
    case 'below': return `At or below ${v} now: charge soon`;
    case 'flat': return 'Draining too slowly to project yet';
    case 'insufficient': return 'Not enough readings since the last charge to project';
    default: return 'No battery readings yet';
  }
}

function lastReport(ms, now) {
  if (ms == null) return 'No reports yet';
  const date = localDateOf(ms);
  const day = date === localDateOf(now) ? 'today' : formatDate(date);
  return `Last report ${formatAgo(ms, now)} (${day}, ${formatClock(localMinutesOf(ms))})`;
}

export function renderNow(body, m, { cfg }) {
  const { rightNow: r, battery: b } = m;
  fill(body,
    h('div', { class: 'now-grid' },
      mealCard('Breakfast', r.breakfast),
      mealCard('Dinner', r.dinner),
      h('div', { class: `meal-card device-card is-${b.status.level}` },
        h('div', { class: 'meal-head' }, statusIcon(b.status.level), h('h3', {}, 'Device')),
        h('p', { class: 'meal-title' }, b.latestV != null ? `${b.latestV.toFixed(2)} V` : 'No battery reading'),
        b.latestV != null ? h('p', { class: 'meal-line' }, statusChip(b.status.level, b.status.label)) : null,
        b.latestV != null ? h('p', { class: 'meal-line' }, projectionText(b.projection, cfg.warnVolts)) : null,
        h('p', { class: 'meal-line' }, lastReport(r.lastContactMs, m.now)),
        r.stale ? h('p', { class: 'meal-line' }, statusChip('warning', 'No report in over 20 hours')) : null)),
    r.extrasToday
      ? h('p', { class: 'note' }, `Luna was also fed ${r.extrasToday} extra time${r.extrasToday > 1 ? 's' : ''} today.`)
      : null,
    h('p', { class: 'note muted' },
      'The device reports only when someone logs a feeding. It has no heartbeat, so a quiet device and a skipped meal look the same.'),
  );
}
