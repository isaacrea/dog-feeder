// Settings from dashboard/.env.local (gitignored; see .env.example). Vite
// inlines every VITE_* value into the JavaScript it serves or builds, so
// anything here is readable by whoever loads the page.

const env = import.meta.env;

const num = (value, fallback) => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
};

export const config = {
  // Mock data exists only on the dev server. A production build is always
  // live: the mock module is not even in its output.
  dataSource: env.DEV && env.VITE_DATA_SOURCE !== 'live' ? 'mock' : 'live',
  mockScenario: env.VITE_MOCK_SCENARIO || 'normal',
  apiUrl: (env.VITE_API_URL || '').trim(),
  apiKey: (env.VITE_API_KEY || '').trim(),
  // Match the stack's BatteryWarnVolts / BatteryCritVolts parameters.
  warnVolts: num(env.VITE_BATTERY_WARN_VOLTS, 3.6),
  critVolts: num(env.VITE_BATTERY_CRIT_VOLTS, 3.45),
};

// A reason live mode cannot run, or null.
export function liveConfigProblem() {
  if (!/^https:\/\/.+\/feedingLogs$/.test(config.apiUrl) || config.apiUrl.includes('<')) {
    return 'VITE_API_URL is not set to your InvokeUrl (https://..../feedingLogs) in dashboard/.env.local.';
  }
  if (!config.apiKey || config.apiKey.includes('<')) {
    return 'VITE_API_KEY is not set in dashboard/.env.local.';
  }
  return null;
}
