import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AUTO_PAIR, THEMES, initialThemeId, themeById, themeVars } from '../src/themes.js';

// WCAG 2 relative luminance and contrast ratio.
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const FIXED = THEMES.filter((t) => t.mode !== 'auto');
const COLOR_KEYS = ['page', 'surface', 'ink', 'ink2', 'muted', 'grid', 'axis', 'breakfast', 'dinner', 'extra', 'battery'];

test('theme list: Auto, then Sunset, Studio, Moonlight, Studio Dark', () => {
  assert.deepEqual(THEMES.map((t) => t.id), ['auto', 'sunset', 'studio-light', 'moonlight', 'studio-dark']);
  assert.equal(themeById(AUTO_PAIR.light).mode, 'light');
  assert.equal(themeById(AUTO_PAIR.dark).mode, 'dark');
  assert.equal(themeById('no-such-theme').id, 'auto');
});

for (const t of FIXED) {
  test(`${t.name}: complete, readable, and marks stand out`, () => {
    for (const k of COLOR_KEYS) assert.match(t[k], /^#[0-9a-f]{6}$/, `${k} is a 6-digit hex`);
    assert.ok(['light', 'dark'].includes(t.mode));
    const on = (fg, bg, min, what) => {
      const c = contrast(fg, bg);
      assert.ok(c >= min, `${what} ${c.toFixed(2)}:1 < ${min}:1`);
    };
    on(t.ink, t.surface, 7, 'body text on cards');
    on(t.ink, t.page, 7, 'body text on page');
    on(t.ink2, t.surface, 4.5, 'secondary text on cards');
    on(t.ink2, t.page, 4.5, 'secondary text on page');
    on(t.muted, t.surface, 3, 'axis labels');
    on(t.breakfast, t.surface, 3, 'breakfast marks');
    on(t.dinner, t.surface, 3, 'dinner marks');
    on(t.battery, t.surface, 3, 'battery line');
    const focus = themeVars(t)['--focus'];
    on(focus, t.page, 3, 'focus ring on page');
    on(focus, t.surface, 3, 'focus ring on cards');
    // Extra feedings are rare; Studio's aqua is 2.7:1 and relies on the
    // legend and table views. Nothing may go lower.
    on(t.extra, t.surface, 2.5, 'extra marks');
    const hues = [t.breakfast, t.dinner, t.extra, t.battery];
    assert.equal(new Set(hues).size, 4, 'four distinct series colors');
  });
}

test('themeVars: every token the CSS uses, derived border and wash', () => {
  const v = themeVars(themeById('moonlight'));
  for (const k of ['--page', '--surface', '--ink', '--ink-2', '--muted', '--grid', '--axis', '--border',
    '--wash', '--breakfast', '--dinner', '--extra', '--battery', '--focus']) {
    assert.ok(v[k], k);
  }
  assert.equal(v['color-scheme'], 'dark');
  assert.equal(v['--border'], 'rgba(243, 241, 255, 0.1)');
  assert.equal(themeVars(themeById('auto')), null);
});

test('initial theme: configured default, falling back to Auto', () => {
  // No localStorage in Node: the saved-choice lookup fails safe.
  assert.equal(initialThemeId('moonlight'), 'moonlight');
  assert.equal(initialThemeId('nord'), 'auto', 'a removed theme falls back');
  assert.equal(initialThemeId('not-a-theme'), 'auto');
  assert.equal(initialThemeId(undefined), 'auto');
});

// Auto is plain CSS (so it works before any script runs): its default tokens
// in styles.css must be exactly Sunset's, and Moonlight's under dark mode.
test('styles.css defaults equal Sunset (light) and Moonlight (dark)', () => {
  const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const tokens = (block) => Object.fromEntries(
    [...block.matchAll(/(--[a-z0-9-]+|color-scheme):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const light = tokens(css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {'))));
  const darkAt = css.indexOf(':root {', css.indexOf('@media (prefers-color-scheme: dark)'));
  const dark = tokens(css.slice(darkAt, css.indexOf('}', darkAt)));
  for (const [id, block] of [[AUTO_PAIR.light, light], [AUTO_PAIR.dark, dark]]) {
    for (const [k, v] of Object.entries(themeVars(themeById(id)))) {
      assert.equal(block[k], v, `${id} ${k} in styles.css`);
    }
  }
});
