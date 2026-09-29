// One day described the same way everywhere it appears: schedule tooltip,
// calendar tooltip, calendar cell label, table rows.

import { token } from '../charts.js';
import { formatClock, formatDate } from '../time.js';
import { h, tipRow } from '../ui.js';

export const SLOT_LABEL = { breakfast: 'Breakfast', dinner: 'Dinner', extra: 'Extra feeding' };
export const slotColor = (slot) => token({ breakfast: '--breakfast', dinner: '--dinner', extra: '--extra' }[slot]);

const who = (f) => f.person ?? 'someone';

function notes(f, off) {
  const n = [];
  if (off) n.push(off === 'late' ? 'later than usual' : 'earlier than usual');
  if (f.override) n.push('override');
  return n.join(', ');
}

// Plain-text status of one slot on one day.
export function slotText(day, slot) {
  const f = day[slot];
  if (f) {
    const extra = notes(f, day[`${slot}Off`]);
    return `${formatClock(f.minutes)} by ${who(f)}${extra ? ` (${extra})` : ''}`;
  }
  if (!day.hasData) return 'no data';
  return day.isToday ? 'not yet' : 'missed';
}

export function dayLabel(day) {
  const parts = [`${formatDate(day.date, { weekday: true })}${day.isToday ? ' (today)' : ''}`,
    `breakfast ${slotText(day, 'breakfast')}`, `dinner ${slotText(day, 'dinner')}`];
  for (const f of day.extras) parts.push(`extra feeding ${formatClock(f.minutes)} by ${who(f)}${f.override ? ' (override)' : ''}`);
  return parts.join('; ');
}

export function dayTip(day) {
  const row = (slot) => {
    const f = day[slot];
    if (f) return tipRow(slotColor(slot), formatClock(f.minutes), `${SLOT_LABEL[slot]} · ${who(f)}`, notes(f, day[`${slot}Off`]));
    return tipRow(slotColor(slot), day.isToday ? 'Not yet' : day.hasData ? 'Missed' : 'No data', SLOT_LABEL[slot]);
  };
  return [
    h('div', { class: 'tip-title' }, `${formatDate(day.date, { weekday: true })}${day.isToday ? ' · today' : ''}`),
    row('breakfast'),
    row('dinner'),
    ...day.extras.map((f) => tipRow(slotColor('extra'), formatClock(f.minutes), `Extra · ${who(f)}`, f.override ? 'override' : '')),
  ];
}
