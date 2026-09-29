// Color themes. "Auto" follows the device between Sunset and Moonlight, whose
// tokens are also the defaults in styles.css (test/themes.test.js keeps the two
// in sync); choosing a theme applies its tokens as CSS custom properties on
// <html>.
//
// Breakfast, dinner, and extra share charts, so each theme's trio was chosen
// as a set against that theme's own surface: color-blind separation for every
// pair (protan/deutan, OKLab ΔE >= 8), a normal-vision floor (ΔE >= 15), and
// marks >= 3:1 (Studio's aqua "extra" is 2.7:1; legends and the table views
// carry it). Battery is a fourth hue that never shares a chart with meals.
// Status colors (good / warning / critical) are fixed across themes on
// purpose. test/themes.test.js re-checks contrast for every theme.

const FIXED = [
  {
    id: 'sunset', name: 'Sunset', mode: 'light',
    blurb: 'Peach sky, gold, magenta, and indigo',
    page: '#fbede4', surface: '#fff7f1', ink: '#2a1512', ink2: '#684741',
    muted: '#977670', grid: '#f0dcd1', axis: '#dec1b4',
    breakfast: '#bf8105', dinner: '#c34695', extra: '#454ead', battery: '#018d87',
    // Gold is under 3:1 on the peach page; keyboard focus rings use magenta.
    focus: '#c34695',
  },
  {
    id: 'studio-light', name: 'Studio', mode: 'light',
    blurb: 'Neutral and crisp; the reference palette',
    page: '#f9f9f7', surface: '#fcfcfb', ink: '#0b0b0b', ink2: '#52514e',
    muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7',
    breakfast: '#2a78d6', dinner: '#eb6834', extra: '#1baf7a', battery: '#4a3aa7',
  },
  {
    id: 'moonlight', name: 'Moonlight', mode: 'dark',
    blurb: 'Luna\'s own: moon gold on inky indigo',
    page: '#0c0b18', surface: '#161529', ink: '#f3f1ff', ink2: '#c2bee0',
    muted: '#8c88ab', grid: '#24223f', axis: '#353259',
    breakfast: '#b18e15', dinner: '#c25485', extra: '#1292c0', battery: '#9379d7',
  },
  {
    id: 'studio-dark', name: 'Studio Dark', mode: 'dark',
    blurb: 'Neutral and crisp, after dark',
    page: '#0d0d0d', surface: '#1a1a19', ink: '#ffffff', ink2: '#c3c2b7',
    muted: '#898781', grid: '#2c2c2a', axis: '#383835',
    breakfast: '#3987e5', dinner: '#d95926', extra: '#199e70', battery: '#9085e9',
  },
];

export const THEMES = [
  { id: 'auto', name: 'Auto', mode: 'auto', blurb: 'Sunset by day, Moonlight by night, following your device' },
  ...FIXED,
];

export const themeById = (id) => THEMES.find((t) => t.id === id) ?? THEMES[0];

// What Auto shows in each device mode (mirrored by the defaults in styles.css).
export const AUTO_PAIR = { light: 'sunset', dark: 'moonlight' };

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

// CSS custom properties for a theme, or null for Auto.
export function themeVars(theme) {
  if (!theme.page) return null;
  return {
    'color-scheme': theme.mode,
    '--page': theme.page,
    '--surface': theme.surface,
    '--ink': theme.ink,
    '--ink-2': theme.ink2,
    '--muted': theme.muted,
    '--grid': theme.grid,
    '--axis': theme.axis,
    '--border': rgba(theme.ink, 0.1),
    '--wash': rgba(theme.ink, theme.mode === 'dark' ? 0.06 : 0.05),
    '--breakfast': theme.breakfast,
    '--dinner': theme.dinner,
    '--extra': theme.extra,
    '--battery': theme.battery,
    '--focus': theme.focus ?? theme.breakfast,
  };
}

const VAR_KEYS = Object.keys(themeVars(FIXED[0]));
const STORE_ID = 'luna.theme';
// Read by public/theme-boot.js before first paint, so a saved theme never flashes.
const STORE_VARS = 'luna.themeVars';

// The viewer's saved choice wins; then the configured default; then Auto.
export function initialThemeId(configured) {
  try {
    const saved = localStorage.getItem(STORE_ID);
    if (THEMES.some((t) => t.id === saved)) return saved;
    if (saved) {
      // A theme that was removed: forget it, so theme-boot.js stops applying it.
      localStorage.removeItem(STORE_ID);
      localStorage.removeItem(STORE_VARS);
    }
  } catch { /* storage blocked */ }
  return THEMES.some((t) => t.id === configured) ? configured : 'auto';
}

export function applyTheme(id, { persist = true } = {}) {
  const theme = themeById(id);
  const root = document.documentElement;
  const vars = themeVars(theme);
  for (const k of VAR_KEYS) root.style.removeProperty(k);
  if (vars) for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.theme = theme.id;
  // One theme-color per device mode, so Auto is right before any script runs.
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.content = vars ? vars['--page'] : themeById(AUTO_PAIR[meta.media.includes('dark') ? 'dark' : 'light']).page;
  }
  if (persist) {
    try {
      localStorage.setItem(STORE_ID, theme.id);
      if (vars) localStorage.setItem(STORE_VARS, JSON.stringify(vars));
      else localStorage.removeItem(STORE_VARS);
    } catch { /* storage blocked: the choice lasts this visit */ }
  }
  return theme;
}
