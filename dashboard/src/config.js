// Settings from dashboard/.env.local (gitignored; see .env.example). Vite
// inlines VITE_* values into the JavaScript it serves or builds, so anything
// here is readable by whoever loads the page. Never put a secret in a VITE_*
// variable: the API key lives in FEEDER_API_KEY, which only the proxy
// (vite.config.js on your laptop, Caddy on the server) can see.
//
// Read each variable by its full name, never through the import.meta.env
// object: a build then inlines only these six, not every VITE_* variable set.
// (The dev server still sends all of them, which is why vite.config.js
// refuses to start with VITE_API_KEY set.)

const num = (value, fallback) => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
};

export const config = {
  // Mock data exists only on the dev server. A production build is always
  // live: the mock module is not even in its output.
  dataSource: import.meta.env.DEV && import.meta.env.VITE_DATA_SOURCE !== 'live' ? 'mock' : 'live',
  mockScenario: import.meta.env.VITE_MOCK_SCENARIO || 'normal',
  // Same-origin path. The proxy forwards it to API Gateway and adds the key.
  apiUrl: (import.meta.env.VITE_API_URL || '/api/feedingLogs').trim(),
  // Default color theme (see src/themes.js); a viewer's own pick overrides it.
  theme: (import.meta.env.VITE_THEME || 'auto').trim(),
  // Match the stack's BatteryWarnVolts / BatteryCritVolts parameters.
  warnVolts: num(import.meta.env.VITE_BATTERY_WARN_VOLTS, 3.6),
  critVolts: num(import.meta.env.VITE_BATTERY_CRIT_VOLTS, 3.45),
};

// A reason live mode cannot run, or null.
export function liveConfigProblem() {
  // A path on this same origin, like /api/feedingLogs. Rejects full URLs
  // (the old direct-to-API-Gateway setup) and anything a browser resolves
  // to another host: //host, and /\host (URLs treat \ as /).
  if (!/^\/(?!\/)[^\s<>\\]*\/feedingLogs$/.test(config.apiUrl)) {
    return (
      'VITE_API_URL must be a same-origin path like /api/feedingLogs (the default), ' +
      'so delete it from dashboard/.env.local. The API Gateway URL now goes in FEEDER_API_URL.'
    );
  }
  return null;
}
