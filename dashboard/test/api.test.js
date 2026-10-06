// dashboard/test/api.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchFeedings } from '../src/api.js';

const BASE = 'http://dashboard.test/';
const get = () => fetchFeedings({ apiUrl: '/api/feedingLogs', days: 7, base: BASE });

// Answer every fetch with this response.
const respond = (t, body, status = 200, type = 'application/json') =>
  t.mock.method(globalThis, 'fetch', async () => new Response(body, { status, headers: { 'Content-Type': type } }));

test('fetchFeedings calls the same-origin proxy path and sends no API key', async (t) => {
  let seen;
  // Stand-in for the network: record the request, then stop. Only the
  // outgoing request matters here, not how the response gets parsed.
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    seen = { url: String(url), init };
    throw new Error('stop after capturing the request');
  });

  await fetchFeedings({
    apiUrl: '/api/feedingLogs',
    days: 7,
    base: 'http://dashboard.test/',
  }).catch(() => {});

  assert.ok(seen, 'fetch was never called');
  assert.equal(seen.url, 'http://dashboard.test/api/feedingLogs?days=7');
  assert.equal(new Headers(seen.init?.headers).has('x-api-key'), false);
});

test('returns the API body on success', async (t) => {
  respond(t, JSON.stringify({ items: [{ id: 'a' }], latest: null, unparseable: 0 }));
  assert.deepEqual((await get()).items, [{ id: 'a' }]);
});

test('proxy not configured: the SPA fallback page is reported as such, not as a parse error', async (t) => {
  respond(t, '<!doctype html><html></html>', 200, 'text/html');
  await assert.rejects(get(), (e) => {
    assert.match(e.message, /proxy is not configured/);
    assert.match(e.hint, /FEEDER_API_URL and FEEDER_API_KEY/);
    return true;
  });
});

test('proxy cannot reach API Gateway: an empty 502 is blamed on the proxy, not the Lambda', async (t) => {
  respond(t, '', 502, 'text/plain');
  await assert.rejects(get(), (e) => {
    assert.match(e.message, /proxy could not reach API Gateway \(HTTP 502\)/);
    assert.doesNotMatch(e.hint, /resource-based policy/);
    return true;
  });
});

test('403 from API Gateway: says the proxy\'s key was rejected', async (t) => {
  respond(t, JSON.stringify({ message: 'Forbidden' }), 403);
  await assert.rejects(get(), (e) => {
    assert.match(e.message, /rejected the proxy's key/);
    assert.match(e.hint, /FEEDER_API_KEY/);
    assert.doesNotMatch(e.hint, /VITE_/);
    return true;
  });
});

test('403 Missing Authentication Token: points at FEEDER_API_URL', async (t) => {
  respond(t, JSON.stringify({ message: 'Missing Authentication Token' }), 403);
  await assert.rejects(get(), (e) => {
    assert.match(e.hint, /FEEDER_API_URL/);
    assert.doesNotMatch(e.hint, /VITE_/);
    return true;
  });
});

test('the request timer is cleared on every path', async (t) => {
  const live = new Set();
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  // Track only the 15 s request timer; fetch internals may use their own.
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...rest) => {
    const id = realSet(fn, ms, ...rest);
    if (ms === 15000) live.add(id);
    return id;
  });
  t.mock.method(globalThis, 'clearTimeout', (id) => {
    live.delete(id);
    return realClear(id);
  });
  const answers = [
    () => { throw new TypeError('network down'); },
    () => new Response('<!doctype html>', { status: 200 }),
    () => new Response('', { status: 502 }),
    () => new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 }),
    () => new Response(JSON.stringify({ items: [] }), { status: 200 }),
  ];
  for (const answer of answers) {
    t.mock.method(globalThis, 'fetch', async () => answer());
    await get().catch(() => {});
  }
  assert.equal(live.size, 0, `${live.size} request timer(s) left running`);
});

test('times out after 15 seconds, including a body that stalls after the headers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // Headers arrive at once; the body never finishes unless the request is aborted.
  t.mock.method(globalThis, 'fetch', async (url, { signal }) => new Response(new ReadableStream({
    start(controller) { signal.addEventListener('abort', () => controller.error(signal.reason)); },
  })));
  const pending = get();
  await new Promise((resolve) => setImmediate(resolve)); // let fetch resolve and the body read start
  t.mock.timers.tick(15000);
  await assert.rejects(pending, /did not answer within 15 seconds/);
});
