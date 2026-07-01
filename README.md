# Luna Feeder

<img src="docs/device.png" alt="The assembled Luna Feeder prototype sitting on counter. Later to be mounted on the dog bowl area." width="480">

> The assembled Luna Feeder prototype sitting on counter. Later to be mounted on the dog bowl area.

A small wall-mounted tracker that logs who fed the dog and when, so nobody feeds her twice. It runs on an ESP32 and keeps its records on the device itself. The AWS backend is just there so I can see the history.

## Why I built it

There are five of us in the house, and the dog is very good at convincing each of us she hasn't eaten yet. The feeder helps with that. You pick your name, press the button, and it logs the feeding. If she's already been fed, it tells you before you do it again.

I also wanted a real project to go with my AWS Solutions Architect studies, something with a backend I actually had to think through instead of a tutorial I copied.

## What it runs on

<p align="left">
  <img src="docs/internals.png" alt="ESP32 Feather V2 wired to the DS3231 RTC and OLED" width="480">
</p>

> ESP32 Feather V2 wired to the DS3231 RTC and OLED

- Adafruit ESP32 Feather V2 (Arduino framework)
- DS3231 real-time clock
- Small OLED for status and the current time
- On-device storage: LittleFS for the feeding log, NVS for config and counters
- AWS: API Gateway → Lambda → DynamoDB, with CloudWatch for logs


## How it fits together

![Architecture: the ESP32 device with its inputs and local store, and the AWS side behind it](docs/architecture.png)

> Architecture: the ESP32 device with its inputs and local store, and the AWS side behind it

The device handles everything that matters on its own. You interact with it through the selector and button, it stores the feeding locally, and it shows status on the OLED. When it can reach the internet it sends a copy up to AWS. When it can't, it holds onto the feeding and sends it later.

The device is the source of truth, and the cloud is a bonus. If AWS is down, the WiFi drops, or the whole account disappears, the feeder works exactly the same — you just don't get the remote view until it reconnects. I'd rather lose visibility than lose the ability to record a feeding. A missed cloud write is nothing; a missed feeding means the dog gets overfed.

## Deciding the meal (and blocking double-feeds)

<p align="left">
  <img src="docs/closeup.png" alt="Closeup of the device's screen" width="480">
</p>

> Closeup of the device's screen

![Feeding logic: button press runs through the double-feed and recency checks before logging](docs/feeding-logic.png)

> Feeding logic: button press runs through the double-feed and recency checks before logging

When you press the button, the device runs a couple of checks before it logs anything:

1. Has she already been fed twice today? If so, block it.
2. Was the last feeding less than three hours ago? If so, block it.
3. Otherwise, work out which meal it is. I don't use clock times for that: the first feeding of the day is breakfast, the second is dinner. Just counting in order.

Then it logs the feeding, queues it for sync, and shows the confirmation on screen.

The three-hour guard is set the way it is on purpose. A false warning is mildly annoying, you wait a bit or override it. A *missed* double-feed means the dog's been overfed. Those aren't the same size of mistake, so I tuned it to lean toward the annoying one.

## Getting it to the cloud

![Sync Sequence Diagram: write locally first, enqueue, then POST if the cloud is reachable or retry with backoff](docs/sync-sequence.png)

> Sync Sequence Diagram: write locally first, enqueue, then POST if the cloud is reachable or retry with backoff

Sync is intentionally simple and hard to break. Once a feeding is confirmed it's written locally first, then dropped into a queue. If the cloud is reachable it POSTs to AWS and moves on. If not, the entry stays in the queue and gets retried later with backoff. Nothing gets lost, because the local write already happened before any of this runs.

## Security

The only thing exposed to the internet is the API Gateway endpoint. The device itself can't be reached from outside.  It sits behind home NAT and never listens for incoming connections, it only makes outbound ones. So there's nothing on the device side to attack remotely.

A few specifics:

- **The API key isn't authentication.** It's rate-limiting and blast-radius control. Fine for household feeding data; not something I'd rely on for anything sensitive.
- **A usage plan caps the damage** if the key ever leaks I have rate, burst, and monthly quota so no one can run up cost or hammer the endpoint.
- **The API is small on purpose.** One resource, POST and OPTIONS only.
- **Secrets stay out of git.** WiFi and API credentials live in a gitignored `config.h`. The risk I actually care about is committing them to a public repo, which is easy to do by accident, not someone pulling them off the flash chip, which needs the device in hand. So I guard against the first and accept the second.

The Lambda can do exactly one thing:

| Role | Policy | What it can do | Where |
|---|---|---|---|
| Lambda execution role | `AWSLambdaBasicExecutionRole` | write logs | CloudWatch |
| Lambda execution role | `DB-write-policy` (custom) | `dynamodb:PutItem` only | `DogFeedingLogs` table |

No read, no delete, no scan, and it can't reach anything else.

## Reliability

The queue-and-backoff setup means a flaky connection never costs a record. Feedings pile up locally and drain when the network comes back. On boot the device checks the clock is alive and syncs time over NTP. Writes are idempotent, so a retry can't create a duplicate.
