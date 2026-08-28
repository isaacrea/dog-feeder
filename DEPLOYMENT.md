# Deploying the Luna Feeder backend

This guide deploys the complete AWS backend into your own account using only
the CloudFormation console and this repository. No hardware is required: the
ESP32 device is optional, and every test below simulates it with curl. Expect
about 15 minutes end to end, most of it reading.

## 1. What you are deploying

A serverless ingest-and-notify pipeline for dog feeding records:

```
HTTPS POST (device or curl)
  -> API Gateway  (REST, API key required, rate limited)
  -> Lambda       (validates payload, writes one record)
  -> DynamoDB     (feeding log table)
  -> DynamoDB Streams
  -> Lambda       (formats a message per new record)
  -> SNS          (fans out to up to 5 email subscribers)
```

Everything is defined in one template: `cloud/infra/luna-feeder.yaml`. It is
fully self-contained (Lambda code is inline), creates its own least-privilege
IAM roles, and removes everything it created when the stack is deleted.

## 2. Prerequisites

- **An AWS account** you control. A personal or sandbox account is ideal.
- **Permissions.** The deploying principal must be able to create and delete
  CloudFormation stacks, DynamoDB tables, Lambda functions, IAM roles,
  API Gateway resources, SNS topics/subscriptions, and CloudWatch log groups.
  Administrator access in your own account satisfies this. The deploy asks
  you to acknowledge `CAPABILITY_IAM` because the template creates two IAM
  roles; both are least-privilege and documented in the README's security
  table.
- **Region.** Any standard AWS commercial region. Verified in `us-east-1`
  and `us-east-2`. Deploy the whole stack in one region and stay in that
  region for every console check below. Only one copy of this stack can
  exist per region (several resources have fixed names).
- **An email address** you can open immediately — a confirmation click is a
  required deploy step (section 5).
- **Cost.** Nothing in this stack bills while idle: no servers, no
  provisioned capacity, no NAT. Charges are purely per-request (DynamoDB
  on-demand writes, Lambda invocations, API Gateway requests, SNS emails)
  and at test volumes round to $0.00. The CloudFormation template upload
  creates one small S3 staging bucket (`cf-templates-...`) that costs
  fractions of a cent.

## 3. Deploy the stack

1. Sign in to the AWS console and pick your region (top right).
2. Get the template file `cloud/infra/luna-feeder.yaml` from this repository
   (clone, or download the raw file).
3. Console -> **CloudFormation** -> **Create stack** -> **With new resources
   (standard)**.
4. **Choose an existing template** -> **Upload a template file** ->
   **Choose file** -> select `luna-feeder.yaml` from your files -> Next.
5. **Stack name:** anything you like, e.g. `luna-feeder`.
6. Fill in parameters (reference table in section 4). Minimum: enter your
   email as `NotificationEmail1` and accept every other default.
7. On **Configure stack options**, leave all settings as is and click Next.
   On the review page, check the box
   **"I acknowledge that AWS CloudFormation might create IAM resources."**
8. **Submit**, then watch the **Events** tab. Expect `CREATE_COMPLETE` on
   the stack in roughly 3–5 minutes.

If the stack fails: events are listed newest-first, so read from the bottom
up and find the **first** `CREATE_FAILED` row — its Status reason is the
actual cause; everything above it is rollback fallout. See section 11.

## 4. Parameters

| Parameter | Purpose | Required | Example | Constraints |
|---|---|---|---|---|
| `NotificationEmail1` | Primary notification address | **Yes** | `you@example.com` | Valid email format |
| `NotificationEmail2`–`5` | Additional notification addresses | No | `sitter@example.com` | Valid email or empty |
| `StageName` | API Gateway stage; appears in the endpoint URL | No (default `prod`) | `prod` | Alphanumeric, `_`, `-` |
| `ThrottleRateLimit` | Steady-state requests/second ceiling | No (default `5`) | `5` | Number |
| `ThrottleBurstLimit` | Burst ceiling; must be >= rate | No (default `10`) | `10` | Number |
| `QuotaLimit` | Max requests per day | No (default `500`) | `500` | Number |
| `BatteryWarnVolts` | Battery "low" alert threshold | No (default `3.60`) | `3.60` | 3.0–4.2 |
| `BatteryCritVolts` | Battery "critical" alert threshold | No (default `3.45`) | `3.45` | 3.0–4.2; keep below warn |

Each non-empty email creates its own SNS subscription. Malformed addresses
are rejected at deploy time by parameter validation.

## 5. Confirm the SNS subscription — do not skip this

> **The stack will reach `CREATE_COMPLETE` and look completely healthy while
> delivering zero emails.** CloudFormation only records that SNS accepted
> the subscription request. Each address you entered receives a confirmation
> email from `no-reply@sns.amazonaws.com` (check spam), and until its link
> is clicked that subscription sits in `PendingConfirmation` and silently
> receives nothing. There is no error anywhere when this happens — an
> unconfirmed subscriber is simply not a subscriber.

For **each** address entered:

1. Open the inbox, find "AWS Notification - Subscription Confirmation",
   click **Confirm subscription**.
2. Verify: console -> **SNS** -> **Subscriptions** -> the row for that
   address shows Status **Confirmed** (not "Pending confirmation").
   CLI equivalent:
   `aws sns list-subscriptions-by-topic --topic-arn <NotificationTopicArn>`
   — pending rows literally show `"SubscriptionArn": "PendingConfirmation"`.

Lost the email? Select the subscription -> **Request confirmation** to
resend. Unconfirmed subscriptions expire after about 3 days.

## 6. Stack outputs

CloudFormation -> your stack -> **Outputs** tab. Listed alphabetically,
matching the console's ordering.

| Output | What it is | What you do with it |
|---|---|---|
| `ApiKeyId` | The API key's **ID** (not the secret) | Feed it to the retrieval step in section 7 |
| `IngestFunctionArn` | Ingest Lambda ARN | Reference only |
| `InvokeUrl` | The complete API endpoint, including stage and path | POST to it in section 8 — use as-is, append nothing |
| `NotificationTopicArn` | SNS topic ARN | Subscription status checks (section 5) |
| `RestApiId` | API Gateway ID | Reference only |
| `TableArn` | The DynamoDB table's ARN | Reference only |
| `TableName` | The DynamoDB table's name | Verification (section 9) |
| `TableStreamArn` | The table's stream ARN | Reference only |

## 7. Retrieve the API key value

The stack output is the key **ID**; the secret value is deliberately never
exposed through CloudFormation. Retrieve it either way:

- **Console:** API Gateway -> **API keys** -> `luna-feeder-device-key-iac`
  -> click **Show** next to "API key". Copy the value.
- **CLI:**

  ```
  aws apigateway get-api-key --api-key <ApiKeyId output> --include-value --query 'value' --output text
  ```

  The `--include-value` flag is required; without it the command returns
  metadata only. No local AWS CLI setup is needed to run this: **AWS
  CloudShell** (the terminal icon in the console's top navigation bar) has
  the CLI preinstalled and already authenticated as you. Open CloudShell
  **in the same region as the stack** — the command fails with a
  not-found error if CloudShell is pointed at a different region.

## 8. Test the API

The requests and expected responses are identical from either client.

**A. Local terminal (macOS, Linux, or Windows).** curl ships with macOS and
most Linux distributions, and the commands below work verbatim. On Windows,
use `curl.exe` in PowerShell — plain `curl` there is an alias for a
different tool.

**B. AWS CloudShell — zero local setup.** Click the terminal icon in the
console's top bar, in the same region as the stack. curl and an
authenticated AWS CLI are preinstalled, so the entire loop — key retrieval
included — runs in one window.

Set two variables:

```bash
URL="<InvokeUrl output>"
KEY="<API key value from section 7>"
```

In CloudShell, `KEY` can come straight from the CLI instead of pasting:

```bash
KEY=$(aws apigateway get-api-key --api-key <ApiKeyId output> --include-value --query 'value' --output text)
```

Baseline request:

```bash
curl -i -X POST "$URL" \
  -H "x-api-key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "uat-001",
    "person": "Tester",
    "timestamp": "2026-08-25T13:00:00Z",
    "meal": "breakfast",
    "batteryVoltage": 3.94,
    "override": false,
    "timeConfidence": "synced",
    "ageSec": 10
  }'
```

Expected: `HTTP/2 200` with body `{"message":"Stored.","id":"uat-001"}`.

Request body fields:

| Field | Required | Type | Notes |
|---|---|---|---|
| `person` | **Yes** | string | Who fed the dog |
| `timestamp` | **Yes** | string | ISO-8601 UTC; the device's clock reading |
| `eventId` | No | string | Stable unique ID; enables idempotent retries. Server generates one if absent |
| `meal` | No | string | `breakfast` \| `dinner` \| `extra` |
| `batteryVoltage` | No | number | Volts; drives battery alerts |
| `override` | No | boolean | Device recency-guard override flag |
| `timeConfidence` | No | string | `synced` \| `drifting` \| `unknown` |
| `ageSec` | No | number | Seconds since the feeding occurred; the server reconstructs the timestamp from its own clock (`timeSource: server-anchored`) |

Suggested test matrix:

| # | Change from baseline | Expected |
|---|---|---|
| 1 | none | `200` `Stored.` + one email per confirmed address |
| 2 | resend the identical request | `200` `Already stored (idempotent no-op).` and **no email** — the duplicate is rejected before any write, so no stream event fires. This is correct behavior, not a missed notification |
| 3 | remove `person` | `400` `Missing required fields: person, timestamp.` |
| 4 | remove the `x-api-key` header | `403` `{"message":"Forbidden"}` |
| 5 | misspell the URL path | `403` `{"message":"Missing Authentication Token"}` — API Gateway's confusing signature for *wrong URL*, not an auth problem |
| 6 | new `eventId`, `batteryVoltage: 3.55` | `200`; email includes a battery-low line and subject tag `[battery low]` |
| 7 | new `eventId`, `batteryVoltage: 3.40` | `200`; email tagged `[battery critical]` |

## 9. Verify end to end

1. **Email:** typically arrives within seconds of a successful POST; allow
   up to a minute. Sender name "Luna Feeder". Body includes the feeder,
   meal, a Central-Time timestamp, and a battery line.
2. **DynamoDB:** console -> DynamoDB -> Tables -> `DogFeedingLogs_IAC` ->
   **Explore table items** -> Run. Your `uat-001` item should show all
   fields; with `ageSec` present, `timeSource` is `server-anchored` and
   `timestamp` is `receivedAt` minus `ageSec` seconds.
3. **Logs:** CloudWatch -> Log groups:
   - `/aws/lambda/luna-feeder-ingest-iac` — one entry per API call
   - `/aws/lambda/luna-feeder-notifier-iac` — one entry per new record

## 10. Teardown

1. CloudFormation -> select the stack -> **Delete** -> confirm. Everything
   the stack created is removed, including both log groups.
2. Expected leftovers, both harmless:
   - An SNS subscription still in `PendingConfirmation` (only if some
     address was never confirmed) — cannot be deleted by anyone and
     self-expires within ~3 days.
   - The `cf-templates-...` S3 bucket from the console upload. Delete it
     manually if you want the region empty; the console recreates it on the
     next template upload.
3. Sweep to confirm nothing else remains (all in the deploy region):
   DynamoDB tables, Lambda functions, API Gateway APIs, SNS topics,
   CloudWatch log groups, and IAM roles (global — filter for your stack
   name). All should be empty of this project.

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Stack `CREATE_FAILED`, "... already exists" | A copy of this stack (or leftovers from a prior attempt) exists in this region | Delete the old stack/resources, or use a different region. One deployment per region |
| Stack `ROLLBACK_COMPLETE` | Any create failure; the stack rolled back | Read Events bottom-up, find the first `CREATE_FAILED`, read its full Status reason. A `ROLLBACK_COMPLETE` stack cannot be updated — delete it and create again |
| `403 {"message":"Forbidden"}` | Missing or wrong `x-api-key` header | Re-check section 7; ensure the header name is exactly `x-api-key` |
| `403 {"message":"Missing Authentication Token"}` | Wrong URL (path or stage typo, or a GET in a browser) | Use the `InvokeUrl` output verbatim with POST |
| `429 Too Many Requests` | Throttle or daily quota exceeded | Wait (throttle) or until the next day / raise `QuotaLimit` (quota) |
| `400 Missing required fields` | Body lacks `person` or `timestamp`, or malformed JSON header | Compare against the baseline request |
| `500` response | Handler error | Read the newest stream in the ingest log group |
| No email, everything else works | **Subscription not confirmed** (most likely), or spam folder | Section 5. Then check the notifier log group for the invocation; then SNS -> Subscriptions status |
| Email arrives without battery line | `batteryVoltage` absent from the request | Expected: the line is omitted when no reading is sent |
| No second email on a repeated request | Duplicate `eventId` | Expected: idempotent writes produce no stream event (test #2) |

Log locations, for anything not covered: ingest problems ->
`/aws/lambda/luna-feeder-ingest-iac`; notification problems ->
`/aws/lambda/luna-feeder-notifier-iac`; deploy problems -> the stack's
Events tab.