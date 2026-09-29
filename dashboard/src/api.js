// Live data: one GET to the read API. This is the dashboard's only network
// request; nothing here, or anywhere in the dashboard, writes data.

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

// Each hint says where to look, matching the Stage 1 PR's diagnosis table.
function describe(status, body) {
  const msg = body?.message ?? '';
  if (status === 403 && /Missing Authentication Token/i.test(msg)) {
    return ['The API says this URL does not exist (403 Missing Authentication Token).',
      'VITE_API_URL must be the stack\'s InvokeUrl output exactly, ending in /feedingLogs.'];
  }
  if (status === 403) {
    return ['The API rejected the key (403 Forbidden).',
      'VITE_API_KEY must be the dashboard key\'s value (API Gateway -> API keys -> luna-feeder-dashboard-key-iac -> Show), not its ID. Restart npm run dev after editing .env.local.'];
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

export async function fetchFeedings({ apiUrl, apiKey, days = 90 }) {
  const url = new URL(apiUrl);
  url.searchParams.set('days', String(days));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { headers: { 'x-api-key': apiKey }, signal: ctrl.signal, cache: 'no-store' });
  } catch {
    if (ctrl.signal.aborted) {
      throw new ApiError(`The API did not answer within ${TIMEOUT_MS / 1000} seconds.`, {
        hint: `Check ${READ_LOG_GROUP} for slow or timed-out invocations.`,
      });
    }
    // fetch() rejects the same way for a network failure and for a CORS
    // rejection; the browser hides which one from JavaScript on purpose.
    throw new ApiError('Could not reach the API (network or CORS).', {
      hint: 'Open dev tools -> Network and click the red feedingLogs request. "CORS error" with an OPTIONS row failing points at the preflight; no response at all points at the URL or your connection. The Console tab shows the browser\'s exact reason.',
    });
  } finally {
    clearTimeout(timer);
  }

  let body = null;
  try { body = await res.json(); } catch { /* non-JSON body; handled below */ }
  if (!res.ok) {
    const [message, hint] = describe(res.status, body);
    throw new ApiError(message, { status: res.status, requestId: body?.requestId ?? null, hint });
  }
  if (!body || !Array.isArray(body.items)) {
    throw new ApiError('The API answered, but not with feeding records.', {
      status: res.status, hint: 'Check that VITE_API_URL points at the feedingLogs endpoint.',
    });
  }
  return body;
}
