// Read API for the Luna Feeder: returns the feeding records from the last
// N Central-time calendar days, for the dashboard.
//
// Deployed inline via the CloudFormation template (cloud/infra/luna-feeder.yaml).
// This file is the source of truth; the template's ZipFile block is a copy.

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME;
const TZ = process.env.DISPLAY_TIMEZONE || 'America/Chicago';
const DASHBOARD_KEY_ID = process.env.DASHBOARD_API_KEY_ID;

const ALLOWED_DAYS = [7, 30, 90];
const DEFAULT_DAYS = 30;

// Attributes returned to clients. deviceTimestamp and receivedAt are audit
// fields and stay in the table.
const FIELDS = ['id', 'person', 'meal', 'timestamp', 'override',
                'batteryVoltage', 'timeConfidence', 'timeSource'];

// Wall-clock parts of an instant in TZ. The IANA zone name keeps DST
// correct; h23 avoids "24" for midnight.
const wallClock = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

const zonedParts = (ms) => {
  const p = {};
  for (const { type, value } of wallClock.formatToParts(ms)) p[type] = value;
  return p;
};

// TZ's offset from UTC at an instant, in ms (negative in the Americas).
const offsetMs = (ms) => {
  const p = zonedParts(ms);
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return wall - Math.floor(ms / 1000) * 1000;
};

// The instant a local calendar date begins. Two passes because the offset
// at the first guess can differ across a DST change. US changes happen at
// 2 AM, so local midnight always exists exactly once.
const localMidnight = (y, m, d) => {
  const wall = Date.UTC(y, m - 1, d);
  const guess = wall - offsetMs(wall);
  return wall - offsetMs(guess);
};

// Start of the window: local midnight (days - 1) calendar days before today,
// so days=7 is today plus the six days before it. Stepping calendar days
// rather than days * 24 h keeps a week spanning a DST change correct.
const windowStart = (nowMs, days) => {
  const p = zonedParts(nowMs);
  const d = new Date(Date.UTC(+p.year, +p.month - 1, +p.day - (days - 1)));
  return localMidnight(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
};

const parseDays = (raw) => {
  if (raw == null || raw === '') return DEFAULT_DAYS;
  const n = Number(raw);
  return ALLOWED_DAYS.includes(n) ? n : null;
};

// localDate is the Central calendar day the feeding belongs to. Grouping by
// the UTC date instead would move most dinners to the next day.
const toRecord = (item, ms) => {
  const p = zonedParts(ms);
  return {
    id:             item.id,
    person:         item.person ?? null,
    meal:           item.meal ?? null,
    timestamp:      item.timestamp,
    localDate:      p.year + '-' + p.month + '-' + p.day,
    localTime:      p.hour + ':' + p.minute,
    override:       item.override === true,
    batteryVoltage: Number.isFinite(item.batteryVoltage) ? item.batteryVoltage : null,
    timeConfidence: item.timeConfidence ?? null,
    timeSource:     item.timeSource ?? null,
  };
};

// Items with an unparseable timestamp are counted, not placed. The window
// has no upper bound: a device clock running slightly fast must not hide a
// feeding that just happened.
const build = (items, days, nowMs) => {
  const fromMs = windowStart(nowMs, days);
  const inRange = [];
  let latest = null;
  let unparseable = 0;
  for (const item of items) {
    const ms = Date.parse(item.timestamp);
    if (!Number.isFinite(ms)) { unparseable++; continue; }
    if (!latest || ms > latest.ms) latest = { item, ms };
    if (ms >= fromMs) inRange.push({ item, ms });
  }
  inRange.sort((a, b) => a.ms - b.ms);
  return {
    timezone:    TZ,
    days,
    from:        new Date(fromMs).toISOString(),
    generatedAt: new Date(nowMs).toISOString(),
    count:       inRange.length,
    unparseable,
    // Most recent record overall, even outside the window, so a silent
    // device still shows when it last reported.
    latest:      latest ? toRecord(latest.item, latest.ms) : null,
    items:       inRange.map((r) => toRecord(r.item, r.ms)),
  };
};

// Scan reads every item; the table has no sort key to Query by time. Each
// page stops at 1 MB, so follow LastEvaluatedKey or results go missing once
// the table outgrows one page. The projection trims the payload, not the
// read units consumed.
const scanAll = async () => {
  const names = {};
  FIELDS.forEach((f, i) => { names['#f' + i] = f; });
  const items = [];
  let startKey;
  do {
    const page = await ddb.send(new ScanCommand({
      TableName: TABLE,
      ProjectionExpression: Object.keys(names).join(', '),
      ExpressionAttributeNames: names,
      ExclusiveStartKey: startKey,
    }));
    items.push(...(page.Items ?? []));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return items;
};

exports.handler = async (event, context) => {
  // API keys aren't method-scoped: API Gateway accepts any key on the stage
  // here, the device's included. Only the dashboard's key may read. Compare
  // the key's ID; never log identity.apiKey, which is the key itself.
  const keyId = event?.requestContext?.identity?.apiKeyId;
  if (!DASHBOARD_KEY_ID || keyId !== DASHBOARD_KEY_ID) {
    console.warn(JSON.stringify({ rejectedApiKeyId: keyId ?? null }));
    return resp(403, { message: 'This API key cannot read feedings.' });
  }
  const days = parseDays(event?.queryStringParameters?.days);
  if (days == null) {
    return resp(400, { message: 'days must be one of ' + ALLOWED_DAYS.join(', ') + '.' });
  }
  try {
    const items = await scanAll();
    const body = build(items, days, Date.now());
    console.log(JSON.stringify({ days, scanned: items.length, returned: body.count, unparseable: body.unparseable }));
    return resp(200, body);
  } catch (err) {
    // Details stay in CloudWatch; the request ID locates them.
    console.error('Error:', err);
    return resp(500, { message: 'Error reading feeding logs.', requestId: context?.awsRequestId });
  }
};

const resp = (statusCode, obj) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  },
  body: JSON.stringify(obj),
});

// Exposed for unit tests (cloud/lambda/test).
exports._internals = { parseDays, windowStart, build };
