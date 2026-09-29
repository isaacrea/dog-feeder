// Battery: voltage over time, the warn/critical thresholds, and the
// projection to the warn threshold, with its method spelled out.

import {
  DAY, addDays, formatClock, formatDate, localDateOf, localInstant, localMinutesOf,
} from '../time.js';
import {
  alpha, baseAxis, cursorOpts, dateValues, mountChart, refLine, token, tooltipPlugin, tzDate, uPlot,
} from '../charts.js';
import { h, showEmpty, statusChip, tableView, tipRow, fill } from '../ui.js';
import { projectionText } from './now.js';

const fmtV = (v) => `${v.toFixed(2)} V`;
const when = (ms) => `${formatDate(localDateOf(ms))}, ${formatClock(localMinutesOf(ms))}`;

// Date splits for an irregular time series: Central noon on whole days,
// counted back from today and spaced so labels never collide.
function dateSplits(today, minPx) {
  return (u) => {
    const { min, max } = u.scales.x;
    const pxPerDay = (u.bbox.width / uPlot.pxRatio) / ((max - min) / 86400);
    const step = [1, 2, 3, 7, 14, 28].find((s) => s * pxPerDay >= minPx) ?? 28;
    const out = [];
    for (let d = today; ; d = addDays(d, -step)) {
      const t = localInstant(d, 12 * 60) / 1000;
      if (t < min) break;
      if (t <= max) out.unshift(t);
    }
    return out;
  };
}

export function renderBattery(body, m, { charts, cfg }) {
  const b = m.battery;
  const p = b.projection;
  const readings = b.readingsInRange;
  if (!readings.length) {
    showEmpty(body, 'No battery readings in this range', 'Readings arrive with each feeding.');
    return;
  }

  const color = token('--battery');
  const xs = readings.map((r) => r.ms / 1000);
  const ys = readings.map((r) => r.v);
  const nowSec = m.now / 1000;
  const spanSec = Math.max(nowSec - m.rangeStartMs / 1000, 86400);
  const xMin = m.rangeStartMs / 1000;
  const xMax = nowSec + spanSec * 0.2;   // room to show where the trend is heading
  const lo = Math.min(...ys, cfg.critVolts) - 0.05;
  const hi = Math.max(...ys, cfg.warnVolts) + 0.05;
  const yMin = Math.floor(lo * 20) / 20;
  const yMax = Math.min(4.3, Math.ceil(hi * 20) / 20);

  const drawOverlay = (u) => {
    refLine(u, cfg.warnVolts, token('--warning'), `Low ${fmtV(cfg.warnVolts)}`);
    refLine(u, cfg.critVolts, token('--critical'), `Critical ${fmtV(cfg.critVolts)}`);
    const { ctx, bbox } = u;
    ctx.save();
    ctx.beginPath();
    ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
    ctx.clip();
    // Recharges: a thin vertical rule where a new cycle begins.
    for (const ms of p.charges ?? []) {
      const x = Math.round(u.valToPos(ms / 1000, 'x', true)) + 0.5;
      ctx.strokeStyle = token('--axis');
      ctx.lineWidth = uPlot.pxRatio;
      ctx.beginPath();
      ctx.moveTo(x, bbox.top);
      ctx.lineTo(x, bbox.top + bbox.height);
      ctx.stroke();
      ctx.fillStyle = token('--ink-2');
      ctx.font = `${11 * uPlot.pxRatio}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText('Charged', x + 4 * uPlot.pxRatio, bbox.top + 4 * uPlot.pxRatio);
    }
    // The fitted trend, dashed, from the latest reading forward.
    if (p.slopeMvPerDay != null) {
      const last = readings[readings.length - 1].ms;
      const at = (ms) => p.trendNowV + (p.slopeMvPerDay / 1000) * ((ms - last) / DAY);
      const pt = (ms) => [u.valToPos(ms / 1000, 'x', true), u.valToPos(at(ms), 'y', true)];
      ctx.strokeStyle = alpha(color, 0.9);
      ctx.lineWidth = 1.5 * uPlot.pxRatio;
      ctx.setLineDash([5 * uPlot.pxRatio, 4 * uPlot.pxRatio]);
      ctx.beginPath();
      ctx.moveTo(...pt(last));
      ctx.lineTo(...pt(xMax * 1000));
      ctx.stroke();
    }
    ctx.restore();
  };

  const chartBox = h('div', { class: 'chart' });
  const fitNote = p.slopeMvPerDay != null
    ? `Trend ${p.slopeMvPerDay.toFixed(1)} mV/day from ${p.n} readings over ${Math.round(p.spanDays)} days.`
      + (p.state === 'ok' ? ` Range ${Math.round(p.daysLo)} to ${Number.isFinite(p.daysHi) ? Math.round(p.daysHi) : 'many'} days from noise alone.` : '')
    : '';

  fill(body,
    h('div', { class: 'battery-head' },
      h('p', { class: 'tile-value' }, b.latestV != null ? fmtV(b.latestV) : '-'),
      statusChip(b.status.level, b.status.label)),
    h('p', {}, projectionText(p, cfg.warnVolts)),
    fitNote ? h('p', { class: 'muted small' }, fitNote) : null,
    chartBox,
    h('details', { class: 'method' },
      h('summary', {}, 'How the projection works'),
      h('ol', {},
        h('li', {}, 'A rise of 0.10 V or more between readings marks a recharge; only the current charge cycle is used. Readings of 4.15 V or more (on the charger) are left out.'),
        h('li', {}, 'A least-squares line is fitted to the last 30 days of that cycle. This battery drains about 4 mV a day, so a shorter window would be mostly measurement noise (about ±0.02 V per reading).'),
        h('li', {}, `The line is extended to ${fmtV(cfg.warnVolts)}, the low-battery alert. If the slope is within noise of flat, or there are fewer than 6 readings over 5 days, no projection is shown.`),
        h('li', {}, 'Caveat: li-ion voltage falls slowly through a long plateau, then faster below about 3.65 V. A straight line fitted on the plateau is optimistic, so treat the date as "no later than", and trust the low-battery email over this chart.'))),
    tableView('Battery readings', ['When', 'Voltage'],
      [...readings].reverse().map((r) => [when(r.ms), fmtV(r.v)])),
  );

  const narrow = chartBox.clientWidth < 520;
  charts.set('battery', mountChart(chartBox, {
    height: narrow ? 220 : 260,
    tzDate,
    padding: [8, 22, 0, 0],   // right: room for the last date label
    legend: { show: false },
    cursor: cursorOpts(() => color),
    scales: { x: { time: true, range: () => [xMin, xMax] }, y: { range: () => [yMin, yMax] } },
    axes: [
      baseAxis({ splits: dateSplits(m.today, 64), values: dateValues, space: 64, size: 32 }),
      baseAxis({ values: (u, splits) => splits.map((v) => v.toFixed(2)), size: 48, incrs: [0.05, 0.1, 0.2, 0.25, 0.5] }),
    ],
    series: [{}, {
      label: 'Battery',
      stroke: color,
      width: 2,
      points: { show: true, size: 8, width: 2, stroke: token('--surface'), fill: color, filter: () => [readings.length - 1] },
    }],
    hooks: { draw: [drawOverlay] },
    plugins: [tooltipPlugin((u, idx) => [
      h('div', { class: 'tip-title' }, when(readings[idx].ms)),
      tipRow(color, fmtV(readings[idx].v), 'Battery'),
    ])],
  }, [xs, ys]));
}
