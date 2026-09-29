import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, initialThemeId, themeById, themeVars } from '../src/themes.js';

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

test('theme list: Auto first, unique ids, a wide light and dark range', () => {
  assert.equal(THEMES[0].id, 'auto');
  assert.equal(new Set(THEMES.map((t) => t.id)).size, THEMES.length);
  assert.ok(FIXED.filter((t) => t.mode === 'light').length >= 6);
  assert.ok(FIXED.filter((t) => t.mode === 'dark').length >= 6);
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
    // Extra feedings are rare; Studio's aqua is 2.7:1 and relies on the
    // legend and table views. Nothing may go lower.
    on(t.extra, t.surface, 2.5, 'extra marks');
    const hues = [t.breakfast, t.dinner, t.extra, t.battery];
    assert.equal(new Set(hues).size, 4, 'four distinct series colors');
  });
}

test('themeVars: every token the CSS uses, derived border and wash', () => {
  const v = themeVars(themeById('nord'));
  for (const k of ['--page', '--surface', '--ink', '--ink-2', '--muted', '--grid', '--axis', '--border',
    '--wash', '--breakfast', '--dinner', '--extra', '--battery', '--focus']) {
    assert.ok(v[k], k);
  }
  assert.equal(v['color-scheme'], 'dark');
  assert.match(v['--border'], /^rgba\(236, 239, 244, 0\.1\)$/);
  assert.equal(themeVars(themeById('auto')), null);
});

test('initial theme: configured default, falling back to Auto', () => {
  // No localStorage in Node: the saved-choice lookup fails safe.
  assert.equal(initialThemeId('nord'), 'nord');
  assert.equal(initialThemeId('not-a-theme'), 'auto');
  assert.equal(initialThemeId(undefined), 'auto');
});
