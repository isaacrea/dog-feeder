// Live data: one GET to the read API, through a same-origin proxy that adds
// the key (vite.config.js locally, Caddy on the server). This is the
// dashboard's only network request; nothing here, or anywhere in the
// dashboard, writes data.

export class ApiError extends Error {
  constructor(message, { status = null, requestId = null, hint = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.requestId = requestId;
    this.hint = hint;
  }
}

const TIMEOUT_MS = 15000;
const READ_LOG_GROUP = '/aws/lambda/luna-feeder-read-iac';
const PROXY_SETTINGS = 'dashboard/.env.local for npm run dev and preview, or the Caddy config on the server';

// Each hint says where to look, matching the Stage 1 PR's diagnosis table.
// Only for JSON answers: those come from API Gateway or the read Lambda.
function describe(status, body) {
  const msg = body?.message ?? '';
  if (status === 403 && /Missing Authentication Token/i.test(msg)) {
    return ['API Gateway says this URL does not exist (403 Missing Authentication Token).',
      `The proxy's FEEDER_API_URL must be the stack's InvokeUrl output exactly, ending in /feedingLogs (${PROXY_SETTINGS}).`];
  }
  if (status === 403 && /cannot read feedings/i.test(msg)) {
    return ['The read API refused the proxy\'s key: it is a valid key, but not the dashboard\'s (403).',
      `FEEDER_API_KEY must be the dashboard key's value, not the device key's (${PROXY_SETTINGS}). Restart the proxy after editing it.`];
  }
  if (status === 403) {
    return ['API Gateway rejected the proxy\'s key (403 Forbidden).',
      `FEEDER_API_KEY must be the dashboard key's value (API Gateway -> API keys -> luna-feeder-dashboard-key-iac-2 -> Show), not its ID (${PROXY_SETTINGS}). Restart the proxy after editing it.`];
  }
  if (status === 429) {
    return ['Too many requests (429).',
      'The dashboard usage plan allows 1 request/second (burst 5) and 500 per day. Wait a moment, or until tomorrow if the daily quota is spent.'];
  }
  if (status === 400) return [`The API rejected the request: ${msg || 'bad request'}.`, ''];
  if (status >= 500 && body?.requestId) {
    return [`The read Lambda failed (HTTP ${status}).`,
      `In CloudWatch Logs, open ${READ_LOG_GROUP} and search for request ID ${body.requestId}.`];
  }
  if (status >= 500) {
    return [`API Gateway returned HTTP ${status}${msg ? ` (${msg})` : ''}.`,
      `No request ID means the Lambda may not have run: check its resource-based policy, then ${READ_LOG_GROUP}.`];
  }
  return [`Unexpected response (HTTP ${status}).`, 'Open dev tools -> Network and inspect the feedingLogs request.'];
}

// Non-JSON answers never reached API Gateway: they come from the dev server,
// preview server, or Caddy in front of it.
function describeNonJson(status) {
  if (status >= 500) {
    return [`The proxy could not reach API Gateway (HTTP ${status}).`,
      `Check FEEDER_API_URL (${PROXY_SETTINGS}) and the server's internet connection. The npm run dev terminal, or Caddy's log, shows the proxy's error.`];
  }
  if (status < 300 || status === 404) {
    return [`The API proxy is not configured: /api/feedingLogs returned ${status === 404 ? 'Not Found' : 'a web page'}, not feeding records.`,
      'Set FEEDER_API_URL and FEEDER_API_KEY in dashboard/.env.local and restart npm run dev (it prints a [feeder proxy] warning until both are set). On the server, check the Caddy route for /api/feedingLogs.'];
  }
  return [`Unexpected response from the dashboard's server (HTTP ${status}).`, 'Open dev tools -> Network and inspect the feedingLogs request.'];
}

export async function fetchFeedings({ apiUrl, days = 90, base = globalThis.location?.href }) {
  const url = new URL(apiUrl, base); // same-origin path, resolved against the page
  url.searchParams.set('days', String(days));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  let text;
  try {
    // No x-api-key: the proxy adds it, and a plain GET skips the CORS preflight.
    res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    text = await res.text(); // inside the try, so the timeout covers the body too
  } catch {
    if (ctrl.signal.aborted) {
      throw new ApiError(`The API did not answer within ${TIMEOUT_MS / 1000} seconds.`, {
        hint: `Check the npm run dev terminal (or Caddy's log) for proxy errors, then ${READ_LOG_GROUP} for slow or timed-out invocations.`,
      });
    }
    // Same origin, so CORS cannot block this: the page's own server, or this
    // device's connection, is down.
    throw new ApiError('Could not reach the dashboard\'s server.', {
      hint: 'Data comes from /api/feedingLogs on the server this page came from (npm run dev, npm run preview, or Caddy). Check that it is still running and that this device is online.',
    });
  } finally {
    clearTimeout(timer);
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    const [message, hint] = describeNonJson(res.status);
    throw new ApiError(message, { status: res.status, hint });
  }
  if (!res.ok) {
    const [message, hint] = describe(res.status, body);
    throw new ApiError(message, { status: res.status, requestId: body?.requestId ?? null, hint });
  }
  if (!Array.isArray(body?.items)) {
    throw new ApiError('The API answered, but not with feeding records.', {
      status: res.status, hint: `Check that the proxy's FEEDER_API_URL is the stack's InvokeUrl, ending in /feedingLogs (${PROXY_SETTINGS}).`,
    });
  }
  return body;
}
