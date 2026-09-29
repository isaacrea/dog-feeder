// DOM helpers. Text always goes in as text nodes, never innerHTML: person
// names come from the device through the API, so they are data, not markup.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') {
      // setProperty handles custom properties (--x), which assignment ignores.
      for (const [prop, val] of Object.entries(v)) el.style.setProperty(prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), val);
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  el.append(...children.flat(Infinity).filter((c) => c != null && c !== false).map(
    (c) => (c instanceof Node ? c : String(c))));
  return el;
}

// Replaces an element's children, skipping null/false like h() does
// (replaceChildren alone would render them as the text "null").
export function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
}

// ---- Icons (static path data only) ------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  check: ['M4.5 10.5l3.5 3.5 7.5-8'],
  clock: ['M10 3.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13', 'M10 6.5V10l2.5 2'],
  alert: ['M10 3.2L17.5 16.5H2.5Z', 'M10 8v3.6', 'M10 13.9v.1'],
  stop: ['M10 3.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13', 'M7.5 7.5l5 5M12.5 7.5l-5 5'],
  info: ['M10 3.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13', 'M10 9v4.5', 'M10 6.4v.1'],
  refresh: ['M15.5 9.5A5.5 5.5 0 1 1 13.8 5.6', 'M15.8 3.5v3.3h-3.3'],
};

export function icon(name, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon ${cls}`.trim());
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

// Status never rides on color alone: icon + label, colored icon, ink text.
const STATUS_ICON = { good: 'check', warning: 'alert', serious: 'alert', critical: 'stop', pending: 'clock', unknown: 'info' };
export function statusChip(level, label) {
  return h('span', { class: 'chip' }, icon(STATUS_ICON[level] ?? 'info', `status-${level}`), label);
}
export const statusIcon = (level) => icon(STATUS_ICON[level] ?? 'info', `status-${level}`);

// ---- Tooltip ----------------------------------------------------------------

let tip = null;
let tipOwner = null;

function tipEl() {
  if (!tip) {
    tip = h('div', { class: 'tooltip', role: 'tooltip', hidden: true });
    document.body.append(tip);
    document.addEventListener('pointerdown', (e) => {
      if (tipOwner && !tipOwner.contains(e.target)) hideTip();
    });
    window.addEventListener('scroll', hideTip, { passive: true });
  }
  return tip;
}

// Shows content above an anchor rect (viewport coordinates), flipping below
// when there is no room, and clamped to the viewport.
export function showTip(content, rect, owner) {
  const t = tipEl();
  t.replaceChildren(...[content].flat());
  t.hidden = false;
  tipOwner = owner;
  const r = t.getBoundingClientRect();
  const m = 8;
  const x = Math.min(Math.max(rect.left + rect.width / 2 - r.width / 2, m), window.innerWidth - r.width - m);
  let y = rect.top - r.height - 10;
  if (y < m) y = rect.top + rect.height + 10;
  t.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

export function hideTip() {
  if (tip) tip.hidden = true;
  tipOwner = null;
}

// Hover (mouse), focus (keyboard), and tap (touch) all show the same content.
export function attachTip(el, contentFn) {
  const show = () => showTip(contentFn(), el.getBoundingClientRect(), el);
  el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') show(); });
  el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideTip(); });
  el.addEventListener('focus', show);
  el.addEventListener('blur', hideTip);
  el.addEventListener('click', show);
}

// A tooltip row: the value leads, the label follows, keyed by a short stroke.
export function tipRow(color, value, label, extra) {
  return h('div', { class: 'tip-row' },
    h('span', { class: 'tip-key', style: { background: color } }),
    h('strong', {}, value),
    label ? h('span', { class: 'tip-label' }, label) : null,
    extra ? h('span', { class: 'tip-extra' }, extra) : null);
}

// ---- Section states -----------------------------------------------------------

export function showLoading(body, lines = 3) {
  body.replaceChildren(h('div', { class: 'skeleton', 'aria-busy': 'true', 'aria-label': 'Loading' },
    ...Array.from({ length: lines }, (_, i) => h('span', { style: { width: `${90 - i * 15}%` } }))));
}

export function showEmpty(body, title, detail) {
  body.replaceChildren(h('div', { class: 'state' },
    icon('info'), h('div', {}, h('p', { class: 'state-title' }, title), detail ? h('p', { class: 'muted' }, detail) : null)));
}

export function showError(body, title, detail, onRetry) {
  body.replaceChildren(h('div', { class: 'state state-error' },
    icon('alert', 'status-warning'),
    h('div', {},
      h('p', { class: 'state-title' }, title),
      detail ? h('p', { class: 'muted' }, detail) : null,
      onRetry ? h('button', { type: 'button', class: 'btn', onclick: onRetry }, 'Try again') : null)));
}

// The table twin of a chart: every value reachable without hovering.
export function tableView(caption, headers, rows) {
  return h('details', { class: 'table-view' },
    h('summary', {}, 'Show as table'),
    h('div', { class: 'table-wrap' },
      h('table', {},
        h('caption', { class: 'sr-only' }, caption),
        h('thead', {}, h('tr', {}, headers.map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c))))))));
}

export function legend(items) {
  return h('ul', { class: 'legend' }, items.map(({ label, color, shape = 'dot', cls = '' }) =>
    h('li', {}, h('span', { class: `key key-${shape} ${cls}`.trim(), style: color ? { '--key': color } : null }), label)));
}
