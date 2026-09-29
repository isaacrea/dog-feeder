// uPlot glue: theme colors from CSS tokens, responsive sizing, day-aligned
// axes, and the shared tooltip. uPlot draws on canvas, so colors are read
// from the CSS custom properties at render time; the page re-renders when
// the color scheme changes.

import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { TZ, formatDate, localDateOf } from './time.js';
import { hideTip, showTip } from './ui.js';

export const FONT = '12px system-ui, -apple-system, "Segoe UI", sans-serif';

export function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function alpha(hex, a) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export const tzDate = (ts) => uPlot.tzDate(new Date(ts * 1e3), TZ);

export function baseAxis(extra = {}) {
  return {
    stroke: token('--muted'),
    font: FONT,
    grid: { stroke: token('--grid'), width: 1 },
    ticks: { show: false },
    ...extra,
  };
}

// X splits on whole days, spaced so date labels never collide.
export function daySplits(xs, minPx) {
  return (u) => {
    const per = u.bbox.width / uPlot.pxRatio / Math.max(xs.length, 1);
    const step = Math.max(1, Math.ceil(minPx / per));
    const last = xs.length - 1;
    return xs.filter((_, i) => (last - i) % step === 0);   // anchor on the newest day
  };
}

export const dateValues = (u, splits) => splits.map((s) => formatDate(localDateOf(s * 1e3)));

// Crosshair snaps to the nearest x; one tooltip lists every series there.
export function tooltipPlugin(contentFor) {
  let touchedAt = 0;
  const listeners = new AbortController();
  return {
    // Phones send a synthetic mouseleave right after a tap, which would
    // hide the cursor (and tooltip) the tap just placed. Ignore that one.
    opts: (u, opts) => {
      opts.cursor = {
        ...opts.cursor,
        bind: {
          ...opts.cursor?.bind,
          mouseleave: (self, targ, handle) => (e) => {
            if (e.target === targ && Date.now() - touchedAt > 1000) handle(e);
          },
        },
      };
    },
    hooks: {
      // uPlot follows the mouse only. A tap places the cursor explicitly,
      // which runs setCursor below; a tap anywhere else clears it.
      ready: (u) => {
        const { signal } = listeners;
        u.over.addEventListener('pointerdown', (e) => {
          if (e.pointerType === 'mouse') return;
          touchedAt = Date.now();
          const r = u.over.getBoundingClientRect();
          u.setCursor({ left: e.clientX - r.left, top: e.clientY - r.top });
        }, { signal });
        document.addEventListener('pointerdown', (e) => {
          if (e.pointerType !== 'mouse' && !u.root.contains(e.target)) u.setCursor({ left: -10, top: -10 });
        }, { signal });
      },
      destroy: () => listeners.abort(),
      setCursor: (u) => {
        const idx = u.cursor.idx;
        if (idx == null || u.cursor.left == null || u.cursor.left < 0) { hideTip(); return; }
        const content = contentFor(u, idx);
        if (!content) { hideTip(); return; }
        const over = u.over.getBoundingClientRect();
        const x = over.left + u.valToPos(u.data[0][idx], 'x');
        showTip(content, { left: x, top: over.top + Math.max(0, u.cursor.top ?? 0) - 6, width: 0, height: 0 }, u.root);
      },
    },
  };
}

export function cursorOpts(pointFill) {
  return {
    x: true,
    y: false,
    drag: { x: false, y: false, setScale: false },
    points: { size: 13, width: 2, stroke: token('--surface'), fill: pointFill },
  };
}

// Mounts a chart sized to its container and keeps it sized. Returns a
// handle whose destroy() the caller runs before re-rendering.
export function mountChart(container, opts, data) {
  const u = new uPlot({ ...opts, width: container.clientWidth || 320 }, data, container);
  const ro = new ResizeObserver(() => {
    const w = container.clientWidth;
    if (w && Math.abs(w - u.width) > 1) u.setSize({ width: w, height: opts.height });
  });
  ro.observe(container);
  return { u, destroy() { ro.disconnect(); u.destroy(); } };
}

// Draw helper: a dashed horizontal reference line with a small label.
export function refLine(u, value, color, label, { dash = [4, 4], align = 'left' } = {}) {
  const { ctx, bbox } = u;
  const y = Math.round(u.valToPos(value, 'y', true)) + 0.5;
  if (y < bbox.top || y > bbox.top + bbox.height) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = uPlot.pxRatio;
  ctx.setLineDash(dash.map((d) => d * uPlot.pxRatio));
  ctx.beginPath();
  ctx.moveTo(bbox.left, y);
  ctx.lineTo(bbox.left + bbox.width, y);
  ctx.stroke();
  if (label) {
    ctx.setLineDash([]);
    ctx.font = `${11 * uPlot.pxRatio}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillStyle = token('--ink-2');
    ctx.textAlign = align;
    ctx.textBaseline = 'bottom';
    const x = align === 'left' ? bbox.left + 4 * uPlot.pxRatio : bbox.left + bbox.width - 4 * uPlot.pxRatio;
    ctx.fillText(label, x, y - 3 * uPlot.pxRatio);
  }
  ctx.restore();
}

export { uPlot };
