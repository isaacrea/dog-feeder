// Theme picker: a dialog of live previews. Each preview carries its own
// theme's tokens as inline custom properties, so it renders in that theme's
// colors whatever the page is currently using. Choosing applies instantly.

import { AUTO_PAIR, THEMES, applyTheme, themeById, themeVars } from './themes.js';
import { h } from './ui.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MODE_LABEL = { auto: 'Follows device', light: 'Light', dark: 'Dark' };

// A small sample of the dashboard: a time, calendar cells, meal dots, and a
// battery line, all drawn from the theme's tokens.
function preview(theme) {
  const vars = themeVars(theme);
  const style = Object.fromEntries(Object.entries(vars).filter(([k]) => k.startsWith('--')));
  const cells = ['fed', 'fed', 'off', 'fed', 'missed', 'fed'].map((state, i) =>
    h('span', { class: 'tp-cell' },
      h('span', { class: `tp-half tp-b is-${i === 4 ? 'missed' : state}` }),
      h('span', { class: `tp-half tp-d is-${i === 4 ? 'fed' : state}` })));
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 60 16');
  svg.setAttribute('class', 'tp-line');
  svg.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS(SVG_NS, 'polyline');
  line.setAttribute('points', '0,3 10,5 20,6 30,8 40,9 50,11 60,12');
  svg.append(line);
  return h('span', { class: 'tp', style },
    h('span', { class: 'tp-time' }, '7:26 AM'),
    h('span', { class: 'tp-sub' }, 'Fed by Alex'),
    h('span', { class: 'tp-cells' }, cells),
    h('span', { class: 'tp-foot' },
      h('span', { class: 'tp-dots' }, ['breakfast', 'dinner', 'extra'].map((k) => h('i', { style: { background: `var(--${k})` } }))),
      svg));
}

function option(theme) {
  const previews = theme.mode === 'auto'
    ? [preview(themeById(AUTO_PAIR.light)), preview(themeById(AUTO_PAIR.dark))]
    : [preview(theme)];
  return h('label', { class: `theme-option${theme.mode === 'auto' ? ' is-auto' : ''}` },
    h('input', { type: 'radio', name: 'theme', value: theme.id }),
    h('span', { class: 'theme-previews' }, previews),
    h('span', { class: 'theme-meta' },
      h('span', { class: 'theme-name' }, theme.name),
      h('span', { class: 'theme-mode' }, MODE_LABEL[theme.mode])),
    h('span', { class: 'theme-blurb' }, theme.blurb));
}

export function initThemePicker({ initialId, onChange }) {
  const dialog = document.getElementById('theme-dialog');
  const list = dialog.querySelector('.theme-list');
  const groups = [
    ['', THEMES.filter((t) => t.mode === 'auto')],
    ['Light', THEMES.filter((t) => t.mode === 'light')],
    ['Dark', THEMES.filter((t) => t.mode === 'dark')],
  ];
  for (const [label, themes] of groups) {
    if (label) list.append(h('h3', { class: 'theme-group' }, label));
    list.append(h('div', { class: 'theme-grid' }, themes.map(option)));
  }

  // Not persisted: a configured default (VITE_THEME) stays a default until
  // the viewer actually picks something.
  let current = applyTheme(initialId, { persist: false }).id;

  list.addEventListener('change', (e) => {
    if (e.target.name !== 'theme') return;
    current = applyTheme(e.target.value).id;
    onChange();
  });

  document.getElementById('theme-btn').addEventListener('click', () => {
    const checked = list.querySelector(`input[value="${current}"]`);
    checked.checked = true;
    dialog.showModal();
    checked.focus();
  });
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  // Auto follows the device; keep the browser's theme-color in step.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (current === 'auto') applyTheme('auto', { persist: false });
  });
}
