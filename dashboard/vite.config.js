// dashboard/vite.config.js
//
// Dev-server proxy that mirrors what Caddy will do in production:
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

export default defineConfig(({ mode }) => {
  // '' loads every variable, not just VITE_ ones. They stay here on the Node side.
  const env = loadEnv(mode, process.cwd(), '');
  const upstream =
    env.FEEDER_API_URL && env.FEEDER_API_KEY ? new URL(env.FEEDER_API_URL) : null;

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
              // Read-only: anything other than GET gets a 404 and never leaves your laptop.
              bypass: (req) => (req.method === 'GET' ? undefined : false),
            },
          }
        : undefined,
    },
  };
});
