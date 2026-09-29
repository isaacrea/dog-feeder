// Color themes. "Auto" follows the device between Studio and Studio Dark
// (the defaults in styles.css); every other theme is a fixed, complete set of
// tokens applied as CSS custom properties on <html>.
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
    id: 'studio-light', name: 'Studio', mode: 'light',
    blurb: 'Neutral and crisp; the reference palette',
    page: '#f9f9f7', surface: '#fcfcfb', ink: '#0b0b0b', ink2: '#52514e',
    muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7',
    breakfast: '#2a78d6', dinner: '#eb6834', extra: '#1baf7a', battery: '#4a3aa7',
  },
  {
    id: 'paper', name: 'Paper', mode: 'light',
    blurb: 'Warm newsprint with inky, muted color',
    page: '#f2eee4', surface: '#fbf8f1', ink: '#1f1b14', ink2: '#574f43',
    muted: '#857c6e', grid: '#e7e0d1', axis: '#cbc1ad',
    breakfast: '#2460a8', dinner: '#ad472e', extra: '#4d965f', battery: '#ad6eb1',
  },
  {
    id: 'meadow', name: 'Meadow', mode: 'light',
    blurb: 'Sage and sunshine',
    page: '#edf2e8', surface: '#f8fbf4', ink: '#16211a', ink2: '#48584c',
    muted: '#7a8a7e', grid: '#dce5d6', axis: '#bfcbb9',
    breakfast: '#b98403', dinner: '#bc467c', extra: '#2a75ba', battery: '#2f8247',
  },
  {
    id: 'ocean', name: 'Ocean', mode: 'light',
    blurb: 'Cool sea glass, coral, and deep teal',
    page: '#e8f1f5', surface: '#f5fafc', ink: '#0b1c26', ink2: '#3b5562',
    muted: '#71899a', grid: '#d5e3ea', axis: '#b5c9d4',
    breakfast: '#0195a1', dinner: '#d95c4b', extra: '#5b4fb0', battery: '#815b04',
  },
  {
    id: 'sunset', name: 'Sunset', mode: 'light',
    blurb: 'Peach sky, gold, magenta, and indigo',
    page: '#fbede4', surface: '#fff7f1', ink: '#2a1512', ink2: '#684741',
    muted: '#977670', grid: '#f0dcd1', axis: '#dec1b4',
    breakfast: '#bf8105', dinner: '#c34695', extra: '#454ead', battery: '#018d87',
  },
  {
    id: 'pastel', name: 'Pastel', mode: 'light',
    blurb: 'Soft lavender with candy tones',
    page: '#f3f0fb', surface: '#fcfbff', ink: '#1c1830', ink2: '#4f4869',
    muted: '#8580a0', grid: '#e5e0f2', axis: '#cdc6e2',
    breakfast: '#4f6eb7', dinner: '#ac5346', extra: '#3d9d80', battery: '#9961a6',
  },
  {
    id: 'solarized-light', name: 'Solarized Light', mode: 'light',
    blurb: 'The classic editor palette, tuned for charts',
    page: '#eee8d5', surface: '#fdf6e3', ink: '#073642', ink2: '#4f656c',
    muted: '#6f8285', grid: '#ebe3cc', axis: '#d2c9ae',
    breakfast: '#02628c', dinner: '#c64913', extra: '#079e92', battery: '#6d71c0',
  },
  {
    id: 'contrast-light', name: 'High Contrast', mode: 'light',
    blurb: 'Pure white, black ink, strong color',
    page: '#ffffff', surface: '#ffffff', ink: '#000000', ink2: '#1f1f1f',
    muted: '#505050', grid: '#d4d4d4', axis: '#8c8c8c',
    breakfast: '#0251c2', dinner: '#cd4001', extra: '#078053', battery: '#8c2faf',
  },
  {
    id: 'studio-dark', name: 'Studio Dark', mode: 'dark',
    blurb: 'Neutral and crisp, after dark',
    page: '#0d0d0d', surface: '#1a1a19', ink: '#ffffff', ink2: '#c3c2b7',
    muted: '#898781', grid: '#2c2c2a', axis: '#383835',
    breakfast: '#3987e5', dinner: '#d95926', extra: '#199e70', battery: '#9085e9',
  },
  {
    id: 'midnight', name: 'Midnight', mode: 'dark',
    blurb: 'Deep navy with electric accents',
    page: '#090e1c', surface: '#111a2e', ink: '#eef2ff', ink2: '#b5bfdb',
    muted: '#7f8aab', grid: '#1d2842', axis: '#2c3a5a',
    breakfast: '#3986e4', dinner: '#d57703', extra: '#17a478', battery: '#a272d4',
  },
  {
    id: 'nord', name: 'Nord', mode: 'dark',
    blurb: 'Arctic frost and aurora, after the Nord palette',
    page: '#20242c', surface: '#272c36', ink: '#eceff4', ink2: '#d0d6e1',
    muted: '#9aa3b5', grid: '#353b48', axis: '#4c566a',
    breakfast: '#5492c5', dinner: '#b18c39', extra: '#b65963', battery: '#719a5b',
  },
  {
    id: 'dracula', name: 'Dracula', mode: 'dark',
    blurb: 'Purple, pink, and cyan, after Dracula',
    page: '#1f2029', surface: '#282a36', ink: '#f8f8f2', ink2: '#c8cadb',
    muted: '#8f94b3', grid: '#343746', axis: '#44475a',
    breakfast: '#9769dc', dinner: '#04a3be', extra: '#d37812', battery: '#cd5394',
  },
  {
    id: 'forest', name: 'Forest', mode: 'dark',
    blurb: 'Pine green, ember, and gold',
    page: '#0d150f', surface: '#152019', ink: '#eef5ef', ink2: '#b5c5b9',
    muted: '#829489', grid: '#1f2f25', axis: '#2e4236',
    breakfast: '#b88a06', dinner: '#b94224', extra: '#248fcc', battery: '#317f38',
  },
  {
    id: 'moonlight', name: 'Moonlight', mode: 'dark',
    blurb: 'Luna\'s own: moon gold on inky indigo',
    page: '#0c0b18', surface: '#161529', ink: '#f3f1ff', ink2: '#c2bee0',
    muted: '#8c88ab', grid: '#24223f', axis: '#353259',
    breakfast: '#b18e15', dinner: '#c25485', extra: '#1292c0', battery: '#9379d7',
  },
  {
    id: 'solarized-dark', name: 'Solarized Dark', mode: 'dark',
    blurb: 'The classic editor palette, after dark',
    page: '#00212b', surface: '#002b36', ink: '#eee8d5', ink2: '#a3b0b0',
    muted: '#7d9092', grid: '#0b3a46', axis: '#1c4b57',
    breakfast: '#0777a9', dinner: '#cc572a', extra: '#20a89b', battery: '#797dcd',
  },
  {
    id: 'contrast-dark', name: 'High Contrast Dark', mode: 'dark',
    blurb: 'Pure black, white ink, strong color',
    page: '#000000', surface: '#0a0a0a', ink: '#ffffff', ink2: '#ececec',
    muted: '#a8a8a8', grid: '#333333', axis: '#5e5e5e',
    breakfast: '#3186e9', dinner: '#b85f05', extra: '#33ac5a', battery: '#c15fc7',
  },
];

export const THEMES = [
  { id: 'auto', name: 'Auto', mode: 'auto', blurb: 'Studio or Studio Dark, following your device' },
  ...FIXED,
];

export const themeById = (id) => THEMES.find((t) => t.id === id) ?? THEMES[0];

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
    '--focus': theme.breakfast,
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
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--page').trim();
  if (persist) {
    try {
      localStorage.setItem(STORE_ID, theme.id);
      if (vars) localStorage.setItem(STORE_VARS, JSON.stringify(vars));
      else localStorage.removeItem(STORE_VARS);
    } catch { /* storage blocked: the choice lasts this visit */ }
  }
  return theme;
}
