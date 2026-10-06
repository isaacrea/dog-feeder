# Luna Feeder dashboard

Mobile-first analytics for the feeder's read API (`GET /feedingLogs?days=90`).
Vanilla JavaScript, [uPlot](https://github.com/leeoniya/uPlot) for the two
time-series charts, [Vite](https://vite.dev) for the dev server and build.

## Run it locally

Needs Node.js 20.19+ or 22.12+.

```bash
cd dashboard
npm ci                       # exact versions from package-lock.json
cp .env.example .env.local   # gitignored; mock mode needs no edits
npm run dev                  # http://localhost:5173
```

**Mock data** is the default: generated in the browser, no network calls, and
not included in production builds. Try `VITE_MOCK_SCENARIO=empty`, `error`,
or `slow` in `.env.local` to see each state.

**Live data**: in `.env.local`, set `VITE_DATA_SOURCE=live`, `VITE_API_URL`
(the stack's `InvokeUrl` output), and `FEEDER_API_KEY` (the dashboard key's
value). Restart `npm run dev` after any edit.

```bash
npm test          # analytics, mock generator, Central-time, and theme contrast tests
npm run build     # production build in dist/ (always live data)
```

## Color themes

The **Theme** button (top right) opens a picker with live previews: **Auto**
(the default: Sunset by day, Moonlight by night, following the device),
**Sunset**, **Studio**, **Moonlight**, and **Studio Dark**. The choice applies
instantly and is saved in that browser; `public/theme-boot.js` re-applies it
before first paint so there is no flash. Set a default for everyone with
`VITE_THEME` in `.env.local`.

Themes live in `src/themes.js`. Auto is plain CSS, so its tokens are also the
defaults at the top of `src/styles.css`; a test fails if the two drift. Each
theme's breakfast, dinner, and extra colors were chosen as a set against that
theme's own background, so they stay distinguishable with color-blindness and
readable (marks at least 3:1). `test/themes.test.js` re-checks text, mark, and
focus-ring contrast whenever a color changes.

## Layout

| Path | What it does |
|---|---|
| `src/analytics.js` | Every number on the page, as pure functions (unit-tested) |
| `src/time.js` | Central-time date math (DST-safe) and formatting |
| `src/api.js` | The one GET, with error messages that say where to look |
| `src/mock.js` | Dev-only mock data that follows the firmware's rules |
| `src/sections/` | One renderer per card |
| `src/charts.js`, `src/ui.js` | uPlot glue, DOM helpers, tooltip, section states |
| `src/themes.js`, `src/themePicker.js` | Color themes and the picker dialog |
