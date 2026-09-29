// Page wiring: load once, analyze per range, render every section in
// isolation so one failing section cannot blank the page.

import './styles.css';
import { analyze } from './analytics.js';
import { ApiError, fetchFeedings } from './api.js';
import { config, liveConfigProblem } from './config.js';
import { formatAgo } from './time.js';
import { h, hideTip, icon, showEmpty, showError, showLoading } from './ui.js';
import { renderBattery } from './sections/battery.js';
import { renderCalendar } from './sections/calendar.js';
import { renderNow } from './sections/now.js';
import { renderOverrides } from './sections/overrides.js';
import { renderQuality } from './sections/quality.js';
import { renderSchedule } from './sections/schedule.js';
import { renderStreaks } from './sections/streaks.js';
import { renderWho } from './sections/who.js';

const RANGES = [7, 30, 90];
const REFRESH_AFTER_MS = 5 * 60e3;

const SECTIONS = [
  ['now', renderNow],
  ['streaks', renderStreaks],
  ['schedule', renderSchedule],
  ['calendar', renderCalendar],
  ['who', renderWho],
  ['battery', renderBattery],
  ['overrides', renderOverrides],
  ['quality', renderQuality],
];

const charts = new Map();
const state = { response: null, loadedAt: null, loading: false, error: null, range: storedRange() };

const $ = (sel) => document.querySelector(sel);
const bodyOf = (id) => document.querySelector(`#${id} .body`);

function storedRange() {
  try {
    const r = Number(localStorage.getItem('luna.range'));
    return RANGES.includes(r) ? r : 30;
  } catch { return 30; }
}

function storeRange(r) {
  try { localStorage.setItem('luna.range', String(r)); } catch { /* storage blocked: fine */ }
}

// The one place data comes from. In a production build, import.meta.env.DEV
// is the constant false, so the mock branch and mock.js are dropped entirely.
async function load() {
  if (import.meta.env.DEV && config.dataSource === 'mock') {
    const { mockFetch } = await import('./mock.js');
    return mockFetch({ scenario: config.mockScenario });
  }
  const problem = liveConfigProblem();
  if (problem) {
    throw new ApiError(problem, {
      hint: 'Copy dashboard/.env.example to dashboard/.env.local, fill in the values, and restart npm run dev.',
    });
  }
  return fetchFeedings({ apiUrl: config.apiUrl, apiKey: config.apiKey });
}

async function refresh() {
  if (state.loading) return;
  state.loading = true;
  document.body.classList.add('is-loading');
  $('#refresh').disabled = true;
  // First load shows skeletons; a refetch keeps the current render, dimmed.
  if (!state.response) for (const [id] of SECTIONS) showLoading(bodyOf(id));
  try {
    state.response = await load();
    state.loadedAt = Date.now();
    state.error = null;
  } catch (err) {
    console.error(err);
    state.error = err instanceof ApiError ? err : new ApiError(err?.message ?? String(err));
  } finally {
    state.loading = false;
    document.body.classList.remove('is-loading');
    $('#refresh').disabled = false;
    render();
  }
}

function renderBanner() {
  const banner = $('#banner');
  const e = state.error;
  banner.hidden = !e;
  if (!e) { banner.replaceChildren(); return; }
  banner.replaceChildren(icon('alert', 'status-warning'), h('div', {},
    h('p', { class: 'state-title' }, e.message),
    e.hint ? h('p', {}, e.hint) : null,
    e.requestId ? h('p', { class: 'muted' }, 'Request ID: ', h('code', {}, e.requestId)) : null,
    state.response ? h('p', { class: 'muted' }, `Still showing the data loaded ${formatAgo(state.loadedAt, Date.now())}.`) : null,
    h('button', { type: 'button', class: 'btn', onclick: refresh }, 'Try again')));
}

function updateStamp() {
  $('#updated').textContent = state.loading && !state.response ? 'Loading…'
    : state.loadedAt ? `Updated ${formatAgo(state.loadedAt, Date.now())}` : '';
}

function env() {
  return { charts, cfg: config, source: config.dataSource, scenario: config.mockScenario, loadedAt: state.loadedAt };
}

function renderSection(id, fn, model) {
  const body = bodyOf(id);
  try {
    fn(body, model, env());
  } catch (err) {
    console.error(`Section "${id}" failed to render`, err);
    showError(body, 'This section could not be displayed', `${err.message}. Details are in the browser console.`);
  }
}

function render() {
  hideTip();
  for (const c of charts.values()) c.destroy();
  charts.clear();
  renderBanner();
  updateStamp();
  if (!state.response) {
    if (state.error) {
      for (const [id] of SECTIONS) showError(bodyOf(id), 'Could not load feedings', 'See the message at the top of the page.');
    }
    return;
  }
  let model;
  try {
    model = analyze(state.response, {
      now: Date.now(), rangeDays: state.range, warnVolts: config.warnVolts, critVolts: config.critVolts,
    });
  } catch (err) {
    console.error(err);
    for (const [id] of SECTIONS) showError(bodyOf(id), 'The data could not be analyzed', err.message);
    return;
  }
  for (const [id, fn] of SECTIONS) {
    if (model.isEmpty && !['now', 'quality'].includes(id)) {
      showEmpty(bodyOf(id), 'No feedings recorded yet', 'This fills in once the device has synced a feeding.');
    } else {
      renderSection(id, fn, model);
    }
  }
}

// "Right now" ages by the minute; re-render just that section.
function tick() {
  updateStamp();
  if (!state.response || state.loading) return;
  try {
    const model = analyze(state.response, {
      now: Date.now(), rangeDays: state.range, warnVolts: config.warnVolts, critVolts: config.critVolts,
    });
    renderSection('now', renderNow, model);
  } catch (err) { console.error(err); }
}

function init() {
  if (config.dataSource === 'mock') {
    const badge = $('#mock-badge');
    badge.hidden = false;
    badge.textContent = config.mockScenario === 'normal' ? 'Mock data' : `Mock data: ${config.mockScenario}`;
  }
  for (const input of document.querySelectorAll('input[name="range"]')) {
    input.checked = Number(input.value) === state.range;
    input.addEventListener('change', () => {
      state.range = Number(input.value);
      storeRange(state.range);
      render();
    });
  }
  $('#refresh').addEventListener('click', refresh);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.loadedAt && Date.now() - state.loadedAt > REFRESH_AFTER_MS) refresh();
  });
  // Canvas charts read colors at draw time; redraw when the scheme flips.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
  setInterval(tick, 60e3);
  refresh();
}

init();
