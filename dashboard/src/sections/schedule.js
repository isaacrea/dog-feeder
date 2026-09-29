// Schedule consistency: every feeding's time of day, by day, over the usual
// window that defines "late" and "early".

import { windowFor } from '../analytics.js';
import {
  alpha, baseAxis, cursorOpts, dateValues, daySplits, mountChart, token, tooltipPlugin, tzDate, uPlot,
} from '../charts.js';
import { formatClock, formatDate, formatHour, localInstant } from '../time.js';
import { h, legend, showEmpty, tableView, fill } from '../ui.js';
import { SLOT_LABEL, dayTip, slotColor, slotText } from './day.js';

const SLOTS = ['breakfast', 'dinner'];

function hourSplits(span) {
  const step = span > 14 * 60 ? 240 : span > 8 * 60 ? 180 : 120;
  return (u) => {
    const { min, max } = u.scales.y;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
    return out;
  };
}

// Usual-window bands, drawn under the dots. Each day gets its own window
// (weekday or weekend), so the band steps where habits change.
function drawBands(days, windows) {
  return (u) => {
    const { ctx, bbox } = u;
    const xs = u.data[0];
    const half = xs.length > 1 ? (xs[1] - xs[0]) / 2 : 43200;
    ctx.save();
    ctx.beginPath();
    ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
    ctx.clip();
    for (const slot of SLOTS) {
      const color = slotColor(slot);
      days.forEach((d, i) => {
        const w = windowFor(windows, slot, d.date);
        if (!w) return;
        const x0 = u.valToPos(xs[i] - half, 'x', true);
        const x1 = u.valToPos(xs[i] + half, 'x', true);
        const yHi = u.valToPos(w.hi, 'y', true);
        const yLo = u.valToPos(w.lo, 'y', true);
        ctx.fillStyle = alpha(color, 0.1);
        ctx.fillRect(x0, yHi, x1 - x0, yLo - yHi);
        const ym = Math.round(u.valToPos(w.median, 'y', true)) + 0.5;
        ctx.strokeStyle = alpha(color, 0.55);
        ctx.lineWidth = uPlot.pxRatio;
        ctx.setLineDash([3 * uPlot.pxRatio, 3 * uPlot.pxRatio]);
        ctx.beginPath();
        ctx.moveTo(x0, ym);
        ctx.lineTo(x1, ym);
        ctx.stroke();
      });
    }
    ctx.restore();
  };
}

function windowText(slot, ws) {
  if (!ws.all) return 'Not enough data yet for a usual window';
  const fmt = (w) => `${formatClock(w.lo)} to ${formatClock(w.hi)}`;
  return ws.split
    ? `Usual window: ${fmt(ws.weekday)} weekdays, ${fmt(ws.weekend)} weekends`
    : `Usual window: ${fmt(ws.all)}`;
}

export function renderSchedule(body, m, { charts }) {
  const days = m.days;
  const fed = days.filter((d) => d.breakfast || d.dinner || d.extras.length);
  if (!fed.length) {
    showEmpty(body, 'No feedings in this range', 'Try a longer range, or check the device is syncing.');
    return;
  }

  const xs = days.map((d) => localInstant(d.date, 12 * 60) / 1000);
  const series = {
    breakfast: days.map((d) => d.breakfast?.minutes ?? null),
    dinner: days.map((d) => d.dinner?.minutes ?? null),
    extra: days.map((d) => d.extras[0]?.minutes ?? null),
  };
  const values = [...series.breakfast, ...series.dinner, ...series.extra].filter((v) => v != null);
  for (const slot of SLOTS) {
    for (const k of ['weekday', 'weekend']) {
      const w = m.windows[slot][k];
      if (w) values.push(w.lo, w.hi);
    }
  }
  const yMin = Math.max(0, Math.floor((Math.min(...values) - 30) / 60) * 60);
  const yMax = Math.min(24 * 60, Math.ceil((Math.max(...values) + 30) / 60) * 60);
  const halfDay = 43200;

  const surface = token('--surface');
  const point = (slot) => ({
    label: SLOT_LABEL[slot],
    stroke: slotColor(slot),
    paths: () => null,
    points: { show: true, size: 9, width: 2, stroke: surface, fill: slotColor(slot), space: 0 },
  });

  const chartBox = h('div', { class: 'chart' });
  fill(body,
    legend([
      { label: 'Breakfast', color: slotColor('breakfast') },
      { label: 'Dinner', color: slotColor('dinner') },
      { label: 'Extra feeding', color: slotColor('extra') },
      { label: 'Usual window (dashes: typical time)', shape: 'band' },
    ]),
    chartBox,
    h('dl', { class: 'stats' }, SLOTS.map((slot) => {
      const s = m.schedule[slot];
      return h('div', {},
        h('dt', {}, h('span', { class: 'key key-dot', style: { '--key': slotColor(slot) } }), SLOT_LABEL[slot]),
        h('dd', {}, s.n
          ? `Typical ${formatClock(s.median)} · middle half of days ${formatClock(s.p25)} to ${formatClock(s.p75)}`
          : 'None in this range'),
        h('dd', { class: 'muted' }, windowText(slot, s.windows)));
    })),
    h('p', { class: 'note muted' },
      `Meals before ${formatClock(m.split)} (halfway between the usual breakfast and dinner) count as breakfast. `
      + 'Outside the usual window means more than about two standard deviations from the usual time, and never less than an hour.'),
    tableView('Feeding times by day', ['Date', 'Breakfast', 'Dinner', 'Extra'],
      [...days].reverse().filter((d) => d.hasData).map((d) => [
        formatDate(d.date, { weekday: true }),
        slotText(d, 'breakfast'),
        slotText(d, 'dinner'),
        d.extras.map((f) => `${formatClock(f.minutes)} by ${f.person ?? 'someone'}`).join(', ') || '-',
      ])),
  );

  const narrow = chartBox.clientWidth < 520;
  charts.set('schedule', mountChart(chartBox, {
    height: narrow ? 240 : 280,
    tzDate,
    padding: [8, 22, 0, 0],   // right: room for the last date label
    legend: { show: false },
    cursor: cursorOpts((u, si) => u.series[si].points.fill),
    scales: {
      x: { time: true, range: () => [xs[0] - halfDay, xs[xs.length - 1] + halfDay] },
      y: { range: () => [yMin, yMax] },
    },
    axes: [
      baseAxis({ splits: daySplits(xs, 64), values: dateValues, space: 64, size: 32 }),
      baseAxis({ splits: hourSplits(yMax - yMin), values: (u, splits) => splits.map(formatHour), size: 52 }),
    ],
    series: [{}, point('breakfast'), point('dinner'), point('extra')],
    hooks: { drawAxes: [drawBands(days, m.windows)] },
    plugins: [tooltipPlugin((u, idx) => dayTip(days[idx]))],
  }, [xs, series.breakfast, series.dinner, series.extra]));
}

