// Applies the saved color theme before first paint, so the page never flashes
// the default colors. A plain script (served as-is from public/, not bundled)
// that only copies CSS custom properties saved by src/themes.js.
try {
  var vars = JSON.parse(localStorage.getItem('luna.themeVars') || 'null');
  if (vars) {
    for (var k in vars) {
      if (/^(--[a-z0-9-]+|color-scheme)$/.test(k) && typeof vars[k] === 'string') {
        document.documentElement.style.setProperty(k, vars[k]);
      }
    }
  }
} catch (e) { /* storage blocked or unreadable: default theme */ }
