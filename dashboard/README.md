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
(the stack's `InvokeUrl` output), and `VITE_API_KEY` (the dashboard key's
value). Restart `npm run dev` after any edit.

```bash
npm test          # analytics, mock generator, and Central-time unit tests
npm run build     # production build in dist/ (always live data)
```

## Layout

| Path | What it does |
|---|---|
| `src/analytics.js` | Every number on the page, as pure functions (unit-tested) |
| `src/time.js` | Central-time date math (DST-safe) and formatting |
| `src/api.js` | The one GET, with error messages that say where to look |
| `src/mock.js` | Dev-only mock data that follows the firmware's rules |
| `src/sections/` | One renderer per card |
| `src/charts.js`, `src/ui.js` | uPlot glue, DOM helpers, tooltip, section states |
