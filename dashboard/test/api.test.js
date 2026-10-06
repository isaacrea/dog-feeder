// dashboard/test/api.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchFeedings } from '../src/api.js';

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