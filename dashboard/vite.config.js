// dashboard/vite.config.js
//
// Dev/preview proxy that mirrors what Caddy will do in production:
// the browser calls /api/feedingLogs on its own origin, and this config
// (running in Node, not the browser) attaches the API key before
// forwarding to API Gateway. The key never reaches browser code.
//
// Needs two lines in .env.local (no VITE_ prefix, so Vite never exposes them):
//   FEEDER_API_URL=https://<api-id>.execute-api.<region>.amazonaws.com/prod/feedingLogs
//   FEEDER_API_KEY=<dashboard key>
//
// `npm run preview` reuses this proxy, so you can test production builds locally.

import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ command, mode }) => {
  // '' loads every variable, not just VITE_ ones. They stay here on the Node side.
  const env = loadEnv(mode, process.cwd(), '');

  // Fail closed: every VITE_* value is copied into browser code, so the key must
  // never be set under that name. This stops dev, preview, and builds alike.
  if (env.VITE_API_KEY) {
    throw new Error(
      'VITE_API_KEY is set. Delete it from dashboard/.env.local: the key now goes in ' +
        'FEEDER_API_KEY, which never reaches the browser.',
    );
  }

  const ready =
    Boolean(env.FEEDER_API_URL && env.FEEDER_API_KEY) &&
    !(env.FEEDER_API_URL + env.FEEDER_API_KEY).includes('<');

  if (command === 'serve' && !ready) {
    console.warn(
      '[feeder proxy] FEEDER_API_URL / FEEDER_API_KEY not set in .env.local: ' +
        'live data will not load (mock mode still works).',
    );
  }

  const upstream = ready ? new URL(env.FEEDER_API_URL) : null;

  return {
    server: {
      proxy: upstream
        ? {
            '/api/feedingLogs': {
              target: upstream.origin,
              // API Gateway routes by hostname, so send its hostname, not localhost.
              changeOrigin: true,
              // /api/feedingLogs?days=7  ->  /prod/feedingLogs?days=7
              rewrite: (path) => path.replace(/^\/api\/feedingLogs/, upstream.pathname),
              // Sets (replaces) the header, so anything a client sends is ignored.
              headers: { 'x-api-key': env.FEEDER_API_KEY },
              // Read-only: anything other than GET gets a 404 and never leaves your machine.
              bypass: (req) => (req.method === 'GET' ? undefined : false),
            },
          }
        : undefined,
    },
  };
});