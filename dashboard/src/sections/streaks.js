// Headline numbers: stat tiles, not charts. The number is the chart.

import { formatDuration } from '../time.js';
import { h, fill } from '../ui.js';

const tile = (label, value, sub) =>
  h('div', { class: 'tile' }, h('p', { class: 'tile-label' }, label), h('p', { class: 'tile-value' }, value),
    sub ? h('p', { class: 'tile-sub' }, sub) : null);

const days = (n) => `${n} day${n === 1 ? '' : 's'}`;

export function renderStreaks(body, m) {
  const { streaks: s, completion: c, schedule } = m;
  const pct = c.eligible ? Math.round((100 * c.complete) / c.eligible) : null;
  const gap = schedule.gap;
  const todayDone = m.days[m.days.length - 1]?.complete;
  fill(body, h('div', { class: 'tiles' },
    tile('Current streak', `${s.current}${s.currentAtLeast ? '+' : ''} ${s.current === 1 ? 'day' : 'days'}`,
      s.current ? `Both meals every day, through ${todayDone ? 'today' : 'yesterday'}` : 'Resets on any day missing a meal'),
    tile('Longest streak', days(s.longest), `In the last ${m.rangeDays} days`),
    tile('Days with both meals', c.eligible ? `${c.complete} of ${c.eligible}` : '-',
      pct != null ? `${pct}% of finished days` : 'No finished days in range'),
    tile('Breakfast to dinner', gap ? formatDuration(gap.median) : '-',
      gap ? `Typical gap · ${formatDuration(gap.min)} to ${formatDuration(gap.max)}` : 'Needs a day with both meals'),
  ));
}
