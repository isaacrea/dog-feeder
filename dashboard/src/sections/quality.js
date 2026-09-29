// Footer: where the data came from and anything that was left out.

import { formatAgo, formatClock } from '../time.js';
import { h, fill } from '../ui.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function renderQuality(body, m, ctx) {
  const q = m.quality;
  const notes = [];
  if (q.unparseable) notes.push(`${plural(q.unparseable, 'record has', 'records have')} a timestamp the API could not read; left out.`);
  if (q.untrustedTime) notes.push(`${plural(q.untrustedTime, 'feeding was', 'feedings were')} logged while the device clock was lost, so the time is a guess; left out of the charts.`);
  if (q.relabeled) notes.push(`${plural(q.relabeled, 'day has', 'days have')} a meal the device labeled by order but the dashboard places by time (usually a skipped breakfast).`);
  fill(body,
    h('ul', { class: 'quality' },
      h('li', {}, ctx.source === 'mock'
        ? `Mock data (scenario: ${ctx.scenario}), generated in this browser. Nothing is sent anywhere.`
        : `Live data from the read API, fetched ${formatAgo(ctx.loadedAt, m.now)}.`),
      h('li', {}, `All times are Central (America/Chicago). Feedings before ${formatClock(m.split)} count as breakfast.`),
      notes.map((n) => h('li', {}, n))),
  );
}
