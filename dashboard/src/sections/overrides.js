// Guard overrides: each hold-to-override feeding, with the guard it got past
// re-derived from the data (the device logs that an override happened, not
// which guard it was).

import { formatClock, formatDate, formatDuration } from '../time.js';
import { h, fill } from '../ui.js';

export function renderOverrides(body, m) {
  const list = m.overrides;
  const n = list.length;
  const rate = m.totalFeedings ? Math.round((100 * n) / m.totalFeedings) : 0;
  if (!n) {
    fill(body, h('p', { class: 'lead' }, `No overrides in the last ${m.rangeDays} days.`),
      h('p', { class: 'muted' }, 'Every feeding passed both guards: not already fed twice today, and at least 3 hours since the last feeding.'));
    return;
  }
  fill(body,
    h('p', { class: 'lead' }, `${n} override${n === 1 ? '' : 's'} in the last ${m.rangeDays} days`,
      h('span', { class: 'muted' }, ` · ${rate}% of feedings`)),
    h('ul', { class: 'ovr-list' }, list.map(({ feeding: f, reason: r }) => h('li', {},
      h('p', {}, h('strong', {}, `${formatDate(f.localDate, { weekday: true })}, ${formatClock(f.minutes)}`),
        ` · ${f.person ?? 'someone'}`),
      h('p', { class: 'muted' }, r.kind === 'recent'
        ? `${formatDuration(r.gapMin)} after ${r.prevPerson ?? 'someone'}'s feeding: the 3-hour recency guard`
        : r.text)))),
  );
}
