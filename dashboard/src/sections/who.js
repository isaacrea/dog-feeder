// Who feeds Luna: one row per person, segments by meal. Rows are labeled
// with names, so color only has to carry the meal, the same everywhere.

import { attachTip, h, legend, showEmpty, tableView, tipRow, fill } from '../ui.js';
import { SLOT_LABEL, slotColor } from './day.js';

const pct = (x) => `${Math.round(x * 100)}%`;

export function renderWho(body, m) {
  const people = m.whoFeeds;
  if (!people.length) {
    showEmpty(body, 'No feedings in this range');
    return;
  }
  const max = Math.max(...people.map((p) => p.total));
  const rows = people.map((p) => {
    const segs = ['breakfast', 'dinner', 'extra'].filter((slot) => p[slot]).map((slot) => {
      const seg = h('button', {
        type: 'button',
        class: 'seg',
        style: { flexGrow: String(p[slot]), background: slotColor(slot) },
        'aria-label': `${p.name}: ${p[slot]} ${SLOT_LABEL[slot].toLowerCase()}`,
      });
      attachTip(seg, () => [
        h('div', { class: 'tip-title' }, p.name),
        tipRow(slotColor(slot), String(p[slot]), SLOT_LABEL[slot], `${pct(p[slot] / p.total)} of ${p.name}'s`),
      ]);
      return seg;
    });
    return h('div', { class: 'who-row' },
      h('span', { class: 'who-name' }, p.name),
      // Track length scales with the person's total; the value sits at its tip.
      h('div', { class: 'who-bar' },
        h('div', { class: 'who-segs', style: { '--ratio': String(p.total / max) } }, segs),
        h('span', { class: 'who-total' }, `${p.total} · ${pct(p.share)}`)));
  });

  fill(body,
    legend([
      { label: 'Breakfast', color: slotColor('breakfast'), shape: 'rect' },
      { label: 'Dinner', color: slotColor('dinner'), shape: 'rect' },
      { label: 'Extra feeding', color: slotColor('extra'), shape: 'rect' },
    ]),
    h('div', { class: 'who' }, rows),
    h('p', { class: 'note muted' }, `${m.totalFeedings} feedings in the last ${m.rangeDays} days. Bar length is feedings; the label adds each person's share.`),
    tableView('Feedings per person', ['Person', 'Breakfast', 'Dinner', 'Extra', 'Total', 'Share'],
      people.map((p) => [p.name, p.breakfast, p.dinner, p.extra, p.total, pct(p.share)])),
  );
}
