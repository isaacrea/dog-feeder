// Unit tests for the read Lambda. Node's built-in runner, no dependencies:
//   node --test cloud/lambda/test/readFeedingLogs.test.js
//
// The AWS SDK ships with the Lambda runtime and is not installed locally, so
// both SDK modules are stubbed before the handler loads.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { inlineCode, sourceAsInlined } = require('./inlineCode');

let pages = [];
let sent = [];
let failWith = null;
const fakeDdb = {
  send: async (cmd) => {
    if (failWith) throw failWith;
    sent.push(cmd.input);
    return pages.shift() ?? {};
  },
};

const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@aws-sdk/client-dynamodb') return { DynamoDBClient: class {} };
  if (request === '@aws-sdk/lib-dynamodb') {
    return {
      DynamoDBDocumentClient: { from: () => fakeDdb },
      ScanCommand: class { constructor(input) { this.input = input; } },
    };
  }
  return realLoad.call(this, request, ...rest);
};

process.env.TABLE_NAME = 'TestTable';
process.env.CORS_ALLOW_ORIGIN = 'http://localhost:5173';
process.env.DASHBOARD_API_KEY_ID = 'dashboard-key-id';
delete process.env.DISPLAY_TIMEZONE;   // exercise the America/Chicago default

const SRC = path.join(__dirname, '..', 'readFeedingLogs.js');
const { handler, _internals: { parseDays, windowStart, build } } = require(SRC);
Module._load = realLoad;

const iso = (ms) => new Date(ms).toISOString();
const HOUR = 3600e3;
const DAY = 24 * HOUR;

const reset = () => { pages = []; sent = []; failWith = null; };

// A GET as API Gateway delivers it, from the dashboard's key unless told otherwise.
const get = (query, apiKeyId = 'dashboard-key-id') => ({
  queryStringParameters: query,
  requestContext: { identity: { apiKeyId } },
});

// --- days parameter --------------------------------------------------------

test('days: 7, 30, 90 accepted; missing defaults to 30; anything else rejected', () => {
  assert.equal(parseDays('7'), 7);
  assert.equal(parseDays('30'), 30);
  assert.equal(parseDays('90'), 90);
  assert.equal(parseDays(undefined), 30);
  assert.equal(parseDays(''), 30);
  for (const bad of ['14', '0', '-7', 'abc', '7days', '1e1']) {
    assert.equal(parseDays(bad), null, bad);
  }
});

// --- window start (Central calendar days) ----------------------------------

test('window starts at Central midnight, not UTC midnight', () => {
  // 10 PM CDT on June 22 is already June 23 in UTC. Today (Central) is the
  // 22nd, so a 7-day window starts at midnight CDT on June 16.
  const now = Date.parse('2026-06-23T03:00:00Z');
  assert.equal(iso(windowStart(now, 7)), '2026-06-16T05:00:00.000Z');
});

test('window spanning spring-forward starts at CST midnight', () => {
  // DST began 2026-03-08. Today is March 10 (CDT); the window starts at
  // midnight CST on March 4, which is 06:00Z rather than 05:00Z.
  const now = Date.parse('2026-03-10T15:00:00Z');
  const start = windowStart(now, 7);
  assert.equal(iso(start), '2026-03-04T06:00:00.000Z');
  // Six full local days before today's midnight: 6 * 24 - 1 hours.
  const todayMidnight = windowStart(now, 1);
  assert.equal((todayMidnight - start) / HOUR, 6 * 24 - 1);
});

test('window spanning fall-back starts at CDT midnight', () => {
  // DST ended 2026-11-01. Today is November 3 (CST); the window starts at
  // midnight CDT on October 28.
  const now = Date.parse('2026-11-03T18:00:00Z');
  const start = windowStart(now, 7);
  assert.equal(iso(start), '2026-10-28T05:00:00.000Z');
  const todayMidnight = windowStart(now, 1);
  assert.equal((todayMidnight - start) / HOUR, 6 * 24 + 1);
});

test('90-day window crosses month boundaries by calendar', () => {
  const now = Date.parse('2026-09-29T15:00:00Z');
  assert.equal(iso(windowStart(now, 90)), '2026-07-02T05:00:00.000Z');
});

// --- response shaping ------------------------------------------------------

test('records carry the Central date and time, not the UTC date', () => {
  const now = Date.parse('2026-06-24T12:00:00Z');
  const body = build([{
    id: 'feeder1-000040', person: 'Isaac', meal: 'dinner',
    timestamp: '2026-06-23T01:16:04.334Z', override: true,
    batteryVoltage: 3.91, timeConfidence: 'synced', timeSource: 'server-anchored',
  }], 7, now);
  assert.deepEqual(body.items[0], {
    id: 'feeder1-000040', person: 'Isaac', meal: 'dinner',
    timestamp: '2026-06-23T01:16:04.334Z',
    localDate: '2026-06-22', localTime: '20:16',
    override: true, batteryVoltage: 3.91,
    timeConfidence: 'synced', timeSource: 'server-anchored',
  });
});

test('filters to the window, sorts oldest first, counts unparseable, keeps latest', () => {
  const now = Date.parse('2026-09-29T15:00:00Z');   // 10 AM CDT
  const items = [
    { id: 'c', timestamp: iso(now - 2 * HOUR) },
    { id: 'old', timestamp: iso(now - 40 * DAY) },
    { id: 'a', timestamp: iso(now - 3 * DAY) },
    { id: 'bad', timestamp: 'not a date' },
    { id: 'none' },
    { id: 'b', timestamp: iso(now - 1 * DAY) },
    { id: 'fast-clock', timestamp: iso(now + 30e3) },
  ];
  const body = build(items, 7, now);
  assert.deepEqual(body.items.map((r) => r.id), ['a', 'b', 'c', 'fast-clock']);
  assert.equal(body.count, 4);
  assert.equal(body.unparseable, 2);
  assert.equal(body.latest.id, 'fast-clock');
  assert.equal(body.days, 7);
  assert.equal(body.timezone, 'America/Chicago');
  assert.equal(body.from, '2026-09-23T05:00:00.000Z');
  assert.equal(body.generatedAt, iso(now));
});

test('latest is reported even when nothing falls in the window', () => {
  const now = Date.parse('2026-09-29T15:00:00Z');
  const body = build([{ id: 'x', timestamp: iso(now - 20 * DAY), batteryVoltage: 3.5 }], 7, now);
  assert.equal(body.count, 0);
  assert.deepEqual(body.items, []);
  assert.equal(body.latest.id, 'x');
  assert.equal(body.latest.batteryVoltage, 3.5);
});

test('missing optional attributes normalize to null / false', () => {
  const now = Date.parse('2026-09-29T15:00:00Z');
  const [r] = build([{ id: 'x', timestamp: iso(now - HOUR) }], 7, now).items;
  assert.equal(r.person, null);
  assert.equal(r.meal, null);
  assert.equal(r.override, false);
  assert.equal(r.batteryVoltage, null);
  assert.equal(r.timeConfidence, null);
  assert.equal(r.timeSource, null);
});

test('empty table', () => {
  const body = build([], 30, Date.parse('2026-09-29T15:00:00Z'));
  assert.equal(body.count, 0);
  assert.equal(body.latest, null);
});

// --- handler ---------------------------------------------------------------

test('handler follows LastEvaluatedKey across pages', async () => {
  reset();
  const now = Date.now();
  pages = [
    { Items: [{ id: 'p1', timestamp: iso(now - HOUR) }], LastEvaluatedKey: { id: 'p1' } },
    { Items: [{ id: 'p2', timestamp: iso(now - 2 * HOUR) }] },
  ];
  const res = await handler(get({ days: '7' }), { awsRequestId: 'r1' });
  assert.equal(res.statusCode, 200);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].ExclusiveStartKey, undefined);
  assert.deepEqual(sent[1].ExclusiveStartKey, { id: 'p1' });
  assert.equal(sent[0].TableName, 'TestTable');
  // timestamp is a DynamoDB reserved word, so every field goes through a name placeholder.
  assert.ok(Object.values(sent[0].ExpressionAttributeNames).includes('timestamp'));
  assert.ok(!/\btimestamp\b/.test(sent[0].ProjectionExpression));
  const body = JSON.parse(res.body);
  assert.deepEqual(body.items.map((r) => r.id), ['p2', 'p1']);
});

test('handler: CORS and no-store headers on success', async () => {
  reset();
  const res = await handler(get(null), {});
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'http://localhost:5173');
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(JSON.parse(res.body).days, 30);
});

test('handler: invalid days is a 400 with CORS header and no Scan', async () => {
  reset();
  const res = await handler(get({ days: '14' }), {});
  assert.equal(res.statusCode, 400);
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'http://localhost:5173');
  assert.match(JSON.parse(res.body).message, /7, 30, 90/);
  assert.equal(sent.length, 0);
});

test('handler: DynamoDB failure is a generic 500 carrying the request ID', async (t) => {
  reset();
  const errors = t.mock.method(console, 'error', () => {});
  failWith = Object.assign(new Error('User is not authorized to perform: dynamodb:Scan'),
                           { name: 'AccessDeniedException' });
  const res = await handler(get({ days: '7' }), { awsRequestId: 'req-123' });
  assert.equal(res.statusCode, 500);
  const body = JSON.parse(res.body);
  assert.equal(body.requestId, 'req-123');
  assert.ok(!res.body.includes('not authorized'), 'internal error detail must not reach the client');
  assert.equal(errors.mock.callCount(), 1);
  reset();
});

test('handler: the device key gets a 403 before any Scan', async (t) => {
  reset();
  const warn = t.mock.method(console, 'warn', () => {});
  const res = await handler(get({ days: '7' }, 'device-key-id'), {});
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).message, 'This API key cannot read feedings.');
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'http://localhost:5173');
  assert.equal(sent.length, 0);
  assert.match(warn.mock.calls[0].arguments[0], /device-key-id/);
});

test('handler: a request with no key ID gets a 403', async (t) => {
  reset();
  t.mock.method(console, 'warn', () => {});
  const res = await handler({ queryStringParameters: { days: '7' } }, {});
  assert.equal(res.statusCode, 403);
  assert.equal(sent.length, 0);
});

// --- template drift --------------------------------------------------------

test('template inline code matches this source file', () => {
  assert.equal(inlineCode('luna-feeder-read-iac'), sourceAsInlined(SRC));
});
