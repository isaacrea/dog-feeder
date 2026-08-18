// Ingest for the Luna Feeder: validates the device payload and
// writes one feeding record.
//
// Deployed inline via the CloudFormation template (cloud/infra/luna-feeder.yaml).
// This file is the source of truth; the template's ZipFile block is a copy.

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME;

exports.handler = async (event) => {
  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;

    if (!body || !body.person || !body.timestamp) {
      return resp(400, { message: 'Missing required fields: person, timestamp.' });
    }

    const id = body.eventId
      ? String(body.eventId)
      : new Date().toISOString() + '_' + Math.random().toString(36).slice(2);

    const receivedMs = Date.now();
    const ageSec = Number.isFinite(body.ageSec) ? body.ageSec : null;
    const timestamp = ageSec != null
      ? new Date(receivedMs - ageSec * 1000).toISOString()
      : body.timestamp;

    const item = {
      id,                                            // partition key (table is keyed on `id`)
      person:          body.person,
      timestamp,                                     // authoritative: server-anchored when possible
      deviceTimestamp: body.timestamp,               // what the device's clock claimed (audit)
      timeSource:      ageSec != null ? 'server-anchored' : 'device',
      meal:            body.meal ?? null,            // "breakfast" | "dinner" | "extra"
      override:        body.override ?? false,
      timeConfidence:  body.timeConfidence ?? null,  // "synced" | "drifting" | "unknown"
      batteryVoltage:  body.batteryVoltage ?? null,
      receivedAt:      new Date(receivedMs).toISOString(),  // server clock, for auditing skew
    };

    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: item,
      ConditionExpression: 'attribute_not_exists(id)', // first write wins
    }));

    return resp(200, { message: 'Stored.', id });
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return resp(200, { message: 'Already stored (idempotent no-op).' });
    }
    console.error('Error:', err);
    return resp(500, { message: 'Error storing feeding log.', error: err.message });
  }
};

const resp = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj),
});