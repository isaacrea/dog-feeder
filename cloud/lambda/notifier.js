// luna-feeder-notifier v2 - stream consumer for the Dog Feeding Tracker.
// CommonJS build (ZipFile constraint). Canonical .mjs lives in the repo.
// NOTE: this file must stay UTF-8 - it contains emoji in the Message
// strings. Emoji are legal in the SNS Message body, NEVER in Subject.

const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

const sns = new SNSClient({});
const TOPIC_ARN = process.env.TOPIC_ARN;
const TZ = process.env.DISPLAY_TIMEZONE || 'America/Chicago';
const WARN_V = Number(process.env.BATTERY_WARN_VOLTS);
const CRIT_V = Number(process.env.BATTERY_CRIT_VOLTS);

// Data stays UTC in the table; presentation converts at the edge.
// IANA zone name (not a fixed offset) so DST is handled for free.
const centralTime = (iso) => {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return iso || 'an unknown time';
  return d.toLocaleString('en-US', {
    timeZone: TZ,
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZoneName: 'short',
  });
};

// 1S Li-ion: 4.2 full -> long flat plateau ~3.9-3.6 -> knee ~3.5 ->
// fast dropoff. Voltage is a poor fuel gauge mid-plateau (millivolts
// per percent) but a good EDGE detector, so we alert on edges rather
// than estimate percent.
const batteryStatus = (v) => {
  if (v == null || !Number.isFinite(v)) return { line: null, subjectTag: '' };
  const s = v.toFixed(2) + ' V';
  if (v <= CRIT_V) return {
    line: '\u{1FAAB} Battery critical: ' + s + ' - charge today. Below ~3.3 V a WiFi burst can brown out the board.',
    subjectTag: ' [battery critical]',
  };
  if (v <= WARN_V) return {
    line: '\u{1F50B} Battery low: ' + s + ' - worth charging in the next day or two.',
    subjectTag: ' [battery low]',
  };
  if (v >= 4.15) return { line: 'Battery: ' + s + ' (full or on charger)', subjectTag: '' };
  return { line: 'Battery: ' + s, subjectTag: '' };
};

exports.handler = async (event) => {
  for (const record of event.Records ?? []) {
    try {
      // Only new feedings notify. MODIFY (console edits) and REMOVE
      // (deletions) are invoked but skipped here.
      if (record.eventName !== 'INSERT') continue;

      // Stream records arrive in low-level DynamoDB JSON - the
      // Document client's conveniences do not apply here.
      const item = unmarshall(record.dynamodb.NewImage);

      const name = item.person ?? 'Someone';
      const meal = item.meal ?? 'a meal';
      const when = centralTime(item.timestamp ?? item.receivedAt);
      const batt = batteryStatus(item.batteryVoltage);

      const lines = ['\u{1F415} Luna was fed ' + meal + ' by ' + name + ' at ' + when + '.'];
      if (item.override) lines.push('\u26A0\uFE0F Recency override was used for this feeding.');
      if (batt.line) lines.push(batt.line);

      await sns.send(new PublishCommand({
        TopicArn: TOPIC_ARN,
        // Subject MUST be ASCII (<=100 chars, no line breaks). An
        // emoji here fails the publish with InvalidParameter, and
        // because this handler logs-and-continues, the symptom would
        // be "notifications silently stopped".
        Subject: 'Luna fed: ' + meal + ' by ' + name + batt.subjectTag,
        Message: lines.join('\n'),
      }));
    } catch (err) {
      // Log-and-continue by design: throwing makes the event source
      // mapping retry the batch until records expire (24h), so one
      // bad record would block every notification behind it.
      console.error('Notify failed for record', record.eventID, err);
    }
  }
};
