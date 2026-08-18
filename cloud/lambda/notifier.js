// Notifier for the Luna Feeder: consumes the feeding table's
// stream and publishes one message per new feeding.
//
// Deployed inline via the CloudFormation template (cloud/infra/luna-feeder.yaml).
// This file is the source of truth; the template's ZipFile block is a copy.

const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

const sns = new SNSClient({});
const TOPIC_ARN = process.env.TOPIC_ARN;
const TZ = process.env.DISPLAY_TIMEZONE || 'America/Chicago';
const WARN_V = Number(process.env.BATTERY_WARN_VOLTS);
const CRIT_V = Number(process.env.BATTERY_CRIT_VOLTS);

// Timestamps are stored in UTC; convert for display. The IANA zone
// name keeps DST correct.
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

// 1S li-ion holds a long plateau around 3.9-3.6 V with a knee near
// 3.5 V. Voltage is a poor fuel gauge mid-plateau but a reliable
// edge detector, so thresholds alert on the edges.
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
      // New feedings only; MODIFY and REMOVE events are skipped.
      if (record.eventName !== 'INSERT') continue;

      // Stream records arrive as DynamoDB JSON.
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
        // SNS Subject must be ASCII; emoji stay in the body.
        Subject: 'Luna fed: ' + meal + ' by ' + name + batt.subjectTag,
        Message: lines.join('\n'),
      }));
    } catch (err) {
      // Per-record handling: one bad record must not block the shard.
      console.error('Notify failed for record', record.eventID, err);
    }
  }
};