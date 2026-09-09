# Events & Webhooks

## The event log

Most mutations write to the store's event history: `GET /events` (standard list querying) and `GET /events/{id}`. Event records carry `model` (collection name, e.g. `orders`), `type` (trigger, e.g. `order.paid`), `data` (payload), `date_created`, `app_id` (when app-generated), `req_id`, `user_id`, and webhook delivery state (`webhooks_pending`, `webhooks`).

**Four ways a write emits nothing** — each one silently kills the webhook you were counting on:

- Operations inside `/:transaction` — child ops emit no per-record events; one `transaction.committed` covers the bundle.
- Models with `events.enabled: false` — `products:stock`, `coupons:uses` and `promotions:uses` ship this way, so stock adjustments surface only as `product.stock_adjusted` on the parent product, never as an event on the collection you wrote to.
- An update that changes nothing, or changes only `date_updated`.
- `$events: false` in the request body (also `$restore` and `$migrate`) — the escape hatch for bulk backfills. Ignored inside a transaction.

`POST /events` is accepted, and inserting an event record is exactly what fans deliveries out to matching webhooks and app functions — that's how a custom model event gets triggered manually. Treat GET as the read path; don't hand-forge standard-model events to "replay" a delivery, because subscribers can't tell yours from the platform's.

**Payload shape** — three cases, not two:

- `.created` / `.deleted` — full record snapshot in `data`.
- `.updated` — `data.id` plus only the changed fields (`date_updated` is stripped from the diff).
- **Every other (domain) event — `order.paid`, `subscription.invoiced`, `payment.succeeded`, `cart.abandoned` — carries `data.id` and nothing else**, unless the model's `events.types[]` entry declares `fields` (essentially none do) or the platform attaches extras: `credit.refund_succeeded` adds `payment_id`/`payment_refund_id`, `subscription.payment_failed` adds `payment_error`. An `order.paid` payload is literally `{ id }`.

Treat webhook payloads as change notices, not state — re-fetch the record by `data.id` before acting on anything beyond the changed fields.

**Type naming**: `<singular-root>.<event>` — `product.created`, `order.paid`, `subscription.invoiced`, `setting.updated`. Child-collection events insert the child root: `account.address.created`, `product.variant.updated`, `payment.refund.succeeded`, `coupon.generation.completed` (event record `model` is `accounts:addresses` style; `parent_id` rides in `data` only on `.created`/`.deleted`, since `.updated` carries changed fields alone).

`created`/`updated`/`deleted` are the *default* types, not a guarantee — a model that declares its own `events.types` replaces them wholesale. `payments` declares `succeeded`/`failed`/`voided` and no `payment.created`; `coupons:generations` declares only `completed`. Types carrying `hooks` (`payment.charge`, `payment.refund`, `order.shipping`, `order.taxes`) are extension hook points and never produce event records at all, so no webhook can subscribe to them.

Get a model's real event list from `GET /:models/<collection>` (`events.types`) rather than assuming — that is the only source that reflects the store, app-declared events included. The domain events worth knowing exist beyond CRUD: carts emit `abandoned` and `converted`, orders `submitted`/`paid`/`payment_failed`/`refunded`/`delivered`/`canceled`, products `stock_adjusted`, and subscriptions carry the richest set (`activated`, `paused`, `resumed`, `invoiced`, `trial_will_end`, …).

⚠ The dashboard's webhook event picker still offers `invoice.refund_succeeded` / `invoice.refund_failed`. Those types do not exist — refunds emit `credit.refund_succeeded` / `credit.refund_failed` on the credits model. A webhook subscribed to the invoice form is stored happily and never fires.

Custom model events are declared in the model's `events.types` (see data-models docs). A webhook subscribes in one of four accepted forms: the bare type (`order.paid`), the model-qualified form (`orders/order.paid`) when roots collide, the app-qualified form (`$app.<app_id>.<model>/<root>.<type>`) for app-defined events, and the bare platform event `transaction.committed` — the only event a transaction produces, on model `transactions`, with `data: { correlation_id, app_id, ops: [{ method, collection, data }] }`.

## Configuring webhooks

Via dashboard (Developer > Webhooks) or the system collection `/:webhooks`:

```js
await swell.post('/:webhooks', {
  url: 'https://example.com/hooks/swell',
  events: ['order.created', 'order.paid'],
  enabled: true,           // ⚠ defaults to FALSE — set it or the webhook never fires
  api: 'com',              // the store API
  alias: 'order-sync',
});
```

Standard CRUD applies (`GET`/`PUT`/`DELETE /:webhooks/{id}`). Webhooks for custom-model events must be created via API (the dashboard covers standard models). Delivery history lives at `/events:webhooks` (schema and queries under *Diagnosing a webhook that stopped*). Apps configure their own webhooks via the swell-app file contract instead.

Two traps on write:

- **A store is capped at 20 *enabled* non-app webhooks** (plan-dependent — the account plan's `features.webhooks` raises it). The cap is enforced on the `enabled: true` write itself, which errors with `Your account can't have more than N webhooks enabled at once`. App-owned webhooks don't count against it.
- **`events` is not validated.** The field is a plain required array of strings with no enum — a misspelled, retired, or hook-only type is stored without complaint and the webhook simply never fires. Confirm against `/events` traffic (or `/events:webhooks` delivery rows) after creating one; silence is the only symptom.

## Delivery contract

- POST, JSON body, one event per request. HTTPS endpoints get certificate validation (`rejectUnauthorized`) — a self-signed cert fails every delivery.
- **Body** = the whole event record (`id`, `date_created`, `model`, `type`, `data`, plus `app_id`/`req_id`/`user_id` when set — thin payloads, see above) with two keys added at send time:
  - `$type` — the fully qualified `model/type` (`orders/order.paid`), or `$app.<app_id>.<model>/<type>` for app events. The only reliable way to disambiguate app-defined events with colliding roots.
  - `$delivery: { attempts, date_first_failed }` — `attempts` is `0` on the first delivery, so `attempts > 0` means you are seeing a retry. Key your idempotency off `id`, not off receipt order.
- A `Swell-Env` request header carries the originating environment id when the source request had one — use it to keep test-environment events out of live handlers. No other Swell-specific headers are sent, and webhook records expose no way to add your own.
- Respond **2xx within 10 seconds** — anything else counts as failure. Queue long work; don't process inline.
- **Verification is by source IP only** — there is no payload signature or HMAC header. Allowlist Swell's published webhook IPs (see the webhooks docs page for the current list); the `User-Agent` is `Swell/1.0 (+https://developers.swell.is)` but is trivially forged. Treat the payload as untrusted input regardless: act on re-fetched records, not payload contents.
- **Retries** are spaced by the *webhook configuration's* cumulative `attempts_failed`, not per event — the counter resets to `0` on any success. Failure #1 retries ~1 minute later, #2–#9 back off as roughly `(n+1)²` minutes with jitter, and every 10th failure adds a ~12-hour gap — about 10 attempts a day. During a sustained outage, later events inherit the already-escalated schedule instead of starting at 1 minute, so a freshly emitted event can sit 12 hours before its first retry.
- **Two responses stop retries permanently for that event** and are recorded as successes, so they don't push the webhook toward auto-disable: HTTP `410 Gone`, or any error response whose JSON body contains `"retry": false`. The delivery row gets `terminated: true` and `date_retry: null`. Note the body form only applies on a failure status — a 2xx is a success and never inspected.
- After ~4 days of failures with no success in that window, the webhook is auto-disabled — the platform writes `enabled: false` **and** `auto_disabled: true` together; a warning email goes out on every 10th cumulative failure, at most once a day. Recovery below.
- No ordering guarantee — deliveries can arrive out of order relative to the mutations that caused them; design handlers to be idempotent and to tolerate stale notices (fetch current state, compare, act).

## Diagnosing a webhook that never fired, or stopped

**Never fired at all — no deliveries, no failures?** Check `enabled` before anything else. A webhook created through the API is stored with `enabled: false` unless the create body set it, so it subscribes correctly and dispatches nothing. Silence with an empty delivery history is that default until proven otherwise; `PUT /:webhooks/{id} { enabled: true }` is the fix. Second most likely: `events` accepts any string, so a misspelled or retired type is stored happily and never matches.

**Fired before and stopped?** Two records, in this order.

**1. The config** — `GET /:webhooks/{id}` holds the failure state; the delivery rows don't.

- `enabled` / `auto_disabled` — `auto_disabled: true` means the platform switched it off after sustained failures. `enabled: false` with `auto_disabled` unset means either a human disabled it or it was never enabled after an API create.
- `attempts_failed` — cumulative across *all* events, incremented once per failed delivery, zeroed only by a delivery that succeeds. This is the counter the retry backoff reads.
- `date_first_failed` — start of the current failure streak; nulled by any success and by re-enabling.
- `date_last_success` / `date_last_warned` — the disable clock and the alert-email throttle.
- `date_final_attempt` — read-only formula `date_first_failed + 4 days`. A projection, not a log: it shows a future date the instant a first failure lands. Auto-disable is evaluated only when the *next* delivery fails, and needs ≥4 days since `date_first_failed` **and** ≥4 days since `date_last_success` — so a webhook whose events dried up drifts past this date still enabled.

**2. The deliveries** — `/events:webhooks`, a child collection of `/events` (`parent_id` = the event id). One row per event × subscriber, created when the event is inserted and **mutated in place on every attempt**: `attempts` counts tries on that same row and only the latest `status`/`response` survive. There is no per-attempt history.

```js
const deliveries = await swell.get('/events:webhooks', {
  webhook_id: '<webhook id>',
  sort: 'date_sent desc',
  expand: 'parent',        // the event record: type, model, data
  limit: 25,
});
```

Row fields: `webhook_id` | `function_id` | `integration_id` (exactly one — app model-event functions and integrations record here too), `type`, `attempts`, `status`, `response`, `date_sent`, `date_first_failed`, `date_retry`, `retry_enabled`, `terminated`, `date_scheduled` (cron-scheduled app functions only), and the read-only formula `pending` (`or(not(date_sent), date_retry)`). Add `pending: true` to list only unfinished work. `response` is the captured error text, with the endpoint's body truncated at ~75 KB.

Read the outcome off `status` + `response`:

| `status` | `response` | meaning |
| --- | --- | --- |
| 2xx | `null` | delivered; `date_retry` cleared |
| `null` | `Webhook has been disabled` (or `Function`/`Integration`/`App has been disabled`) | the config was off when the event fired — parked with `retry_enabled: true`, `date_retry: null` |
| `null` | `Request failed: …` | never reached you: DNS, TLS (self-signed cert), connection refused, or the 10s timeout |
| 4xx/5xx | `Unexpected response: <body> - status: N` | your endpoint answered and rejected |
| 410, or any status whose JSON body has `"retry": false` | as above | `terminated: true`, `date_retry: null`, and counted as a success so it never pushes toward auto-disable |

**Recovering an auto-disabled webhook** — `PUT /:webhooks/{id} { enabled: true }`. That one write clears `auto_disabled`, nulls `date_first_failed`, and replays every parked row (matching `webhook_id`, `date_retry: null`, `retry_enabled: true`) by scheduling them 3 seconds apart. Four traps:

- Replay is conditioned on the stored record carrying `auto_disabled: true`. A webhook *you* disabled parks its events identically, but re-enabling it replays nothing — those rows sit at `date_retry: null` forever. Backfill them from `/events` instead (below).
- `attempts_failed` survives the re-enable — only a delivery that succeeds (or terminates) clears it. If a replayed event fails, the backoff resumes from the old escalated count, so attempt #2 can land ~12 hours out.
- Send `retry_disabled_events: false` on the re-enabling PUT to reset the config without firehosing the backlog at your endpoint. It is a stored field, so it keeps suppressing replay on every later re-enable until you clear it.
- App model-event functions carry the same fields at `/:functions` and recover the same way (`PUT /:functions/{id} { enabled: true }`, replaying their `function_id` rows). Three differences: a function whose deployed worker is missing is disabled on the *first* failure; a function running the raised timeout disables after 2 days instead of 4, with no `date_last_success` grace; and rows recorded while the *app* itself was uninstalled or inactive are written with `retry_enabled: false`, so reinstalling never replays them.

## Consuming without webhooks

For batch or catch-up processing, poll `/events` with a cursor instead of standing infrastructure:

```js
const events = await swell.get('/events', {
  where: { type: { $in: ['order.paid'] }, id: { $gt: lastSeenId } },
  sort: 'id asc', limit: 100,
});
```

Persist the last processed id. This also backfills gaps after webhook endpoint downtime.
