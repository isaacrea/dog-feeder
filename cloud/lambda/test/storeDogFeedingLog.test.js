// Unit tests for the ingest Lambda. Node's built-in runner, no dependencies:
//   node --test cloud/lambda/test/storeDogFeedingLog.test.js
//
// The AWS SDK ships with the Lambda runtime and is not installed locally, so
// both SDK modules are stubbed while the handler loads.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { inlineCode, sourceAsInlined } = require('./inlineCode');

const SRC = path.join(__dirname, '..', 'storeDogFeedingLog.js');
const DEVICE = 'device-key-id';

let sent = [];
let failWith = null;
const fakeDdb = {
  send: async (cmd) => {
    if (failWith) throw failWith;
    sent.push(cmd.input);
    return {};
  },
};

// A fresh copy of the handler. It reads its settings once, at load, so each
// environment needs its own load.
function load(deviceKeyId) {
  process.env.TABLE_NAME = 'TestTable';
  if (deviceKeyId === undefined) delete process.env.DEVICE_API_KEY_ID;
  else process.env.DEVICE_API_KEY_ID = deviceKeyId;
  const realLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === '@aws-sdk/client-dynamodb') return { DynamoDBClient: class {} };
    if (request === '@aws-sdk/lib-dynamodb') {
      return {
        DynamoDBDocumentClient: { from: () => fakeDdb },
        PutCommand: class { constructor(input) { this.input = input; } },
      };
    }
    return realLoad.call(this, request, ...rest);
  };
  delete require.cache[SRC];
  try {
    return require(SRC).handler;
  } finally {
    Module._load = realLoad;
  }
}

const handler = load(DEVICE);
const reset = () => { sent = []; failWith = null; };

// A POST as API Gateway delivers it, from the device's key unless told otherwise.
const post = (body, apiKeyId = DEVICE) => ({
  body: JSON.stringify(body),
  requestContext: { identity: { apiKeyId } },
});
const FEEDING = { eventId: 'uat-001', person: 'Tester', timestamp: '2026-08-25T13:00:00Z', meal: 'breakfast' };

// --- key check -------------------------------------------------------------

test('device key: the record is written once, first write wins', async () => {
  reset();
  const res = await handler(post(FEEDING));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { message: 'Stored.', id: 'uat-001' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].TableName, 'TestTable');
  assert.equal(sent[0].Item.person, 'Tester');
  assert.equal(sent[0].ConditionExpression, 'attribute_not_exists(id)');
});

test('dashboard key: 403 before the body is read, nothing written', async (t) => {
  reset();
  const warn = t.mock.method(console, 'warn', () => {});
  const res = await handler({ body: 'not even JSON', requestContext: { identity: { apiKeyId: 'dashboard-key-id' } } });
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).message, 'This API key cannot record feedings.');
  assert.equal(sent.length, 0);
  assert.deepEqual(warn.mock.calls[0].arguments, ['Rejected write from API key ID:', 'dashboard-key-id']);
});

test('no key ID on the request: 403', async (t) => {
  reset();
  t.mock.method(console, 'warn', () => {});
  const res = await handler({ body: JSON.stringify(FEEDING) });
  assert.equal(res.statusCode, 403);
  assert.equal(sent.length, 0);
});

test('DEVICE_API_KEY_ID unset: every request is refused (fails closed)', async (t) => {
  reset();
  t.mock.method(console, 'warn', () => {});
  const unset = load(undefined);
  for (const event of [post(FEEDING), post(FEEDING, undefined), { body: JSON.stringify(FEEDING) }]) {
    assert.equal((await unset(event)).statusCode, 403);
  }
  assert.equal(sent.length, 0);
});

// --- existing behavior, behind the check -----------------------------------

test('device key, missing fields: 400, nothing written (DEPLOYMENT.md test #8)', async () => {
  reset();
  const res = await handler(post({}));
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).message, /Missing required fields/);
  assert.equal(sent.length, 0);
});

test('device key, duplicate eventId: 200 idempotent no-op', async () => {
  reset();
  failWith = Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });
  const res = await handler(post(FEEDING));
  assert.equal(res.statusCode, 200);
  assert.match(JSON.parse(res.body).message, /idempotent/);
});

test('ageSec: the timestamp is anchored to the server clock', async () => {
  reset();
  const before = Date.now();
  await handler(post({ ...FEEDING, ageSec: 60 }));
  const stored = Date.parse(sent[0].Item.timestamp);
  assert.ok(stored <= before - 60e3 + 1000 && stored >= before - 60e3 - 1000, sent[0].Item.timestamp);
  assert.equal(sent[0].Item.timeSource, 'server-anchored');
  assert.equal(sent[0].Item.deviceTimestamp, FEEDING.timestamp);
});

// --- template drift --------------------------------------------------------

test('template inline code matches this source file', () => {
  assert.equal(inlineCode('luna-feeder-ingest-iac'), sourceAsInlined(SRC));
});
