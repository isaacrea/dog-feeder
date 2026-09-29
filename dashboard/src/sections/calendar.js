// Calendar: one cell per Central day, split into a breakfast half and a
// dinner half, so a missed meal shows as a hole in the right place. Below it,
// the missed and off-schedule meals as a list.

import { addDays, formatClock, formatDate, weekdayOf } from '../time.js';
import { attachTip, h, legend, showEmpty, fill } from '../ui.js';
import { SLOT_LABEL, dayLabel, dayTip, slotColor } from './day.js';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function halfState(day, slot) {
  if (!day.hasData) return 'nodata';
  if (day[slot]) return day[`${slot}Off`] ? 'off' : 'fed';
  return day.isToday ? 'pending' : 'missed';
}

function cell(day) {
  const btn = h('button', {
    type: 'button',
    class: `cal-cell${day.isToday ? ' is-today' : ''}`,
    'aria-label': dayLabel(day),
  },
  h('span', { class: `half half-b is-${halfState(day, 'breakfast')}` }),
  h('span', { class: `half half-d is-${halfState(day, 'dinner')}` }),
  day.overrides ? h('span', { class: 'ovr-dot', 'aria-hidden': 'true' }) : null);
  attachTip(btn, () => dayTip(day));
  return btn;
}

function exceptionText(e) {
  if (e.kind === 'missed') return `${SLOT_LABEL[e.slot]} missed`;
  return `${SLOT_LABEL[e.slot]} ${e.kind} at ${formatClock(e.feeding.minutes)} by ${e.feeding.person ?? 'someone'}`;
}

export function renderCalendar(body, m) {
  const days = m.days;
  if (!days.some((d) => d.hasData)) {
    showEmpty(body, 'No feedings recorded yet', 'Days fill in as the device syncs.');
    return;
  }
  const byDate = new Map(days.map((d) => [d.date, d]));
  const first = days[0].date;
  const last = days[days.length - 1].date;
  const gridStart = addDays(first, -weekdayOf(first));   // back to Monday

  const rows = [];
  for (let week = gridStart; week <= last; week = addDays(week, 7)) {
    const cells = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(week, i);
      const day = byDate.get(date);
      cells.push(day ? cell(day) : h('span', { class: 'cal-cell is-outside', 'aria-hidden': 'true' }));
    }
    const label = week < first ? first : week;
    rows.push(h('div', { class: 'cal-row' }, h('span', { class: 'cal-week' }, formatDate(label)), cells));
  }

  const ex = m.exceptions;
  fill(body,
    h('div', { class: 'cal', role: 'group', 'aria-label': 'Feeding calendar' },
      h('div', { class: 'cal-row cal-head', 'aria-hidden': 'true' }, h('span', { class: 'cal-week' }), WEEKDAYS.map((d) => h('span', {}, d))),
      rows),
    legend([
      { label: 'Breakfast (top)', color: slotColor('breakfast'), shape: 'half-top' },
      { label: 'Dinner (bottom)', color: slotColor('dinner'), shape: 'half-bottom' },
      { label: 'Off-schedule (pale)', shape: 'pale' },
      { label: 'Missed (empty)', shape: 'missed' },
      { label: 'Override', shape: 'ovr' },
    ]),
    h('h3', { class: 'sub-h' }, `Missed and off-schedule meals (${ex.length})`),
    ex.length
      ? h('ul', { class: 'exc-list' }, ex.map((e) => h('li', {},
        h('span', { class: 'exc-date' }, formatDate(e.date, { weekday: true })),
        h('span', {}, exceptionText(e)))))
      : h('p', { class: 'muted' }, `Every meal on schedule in the last ${m.rangeDays} days.`),
  );
}
