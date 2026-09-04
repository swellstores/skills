# Events & Webhooks

## The event log

Every mutation writes to the store's event history: `GET /events` (standard list querying) and `GET /events/{id}`. Event records carry `model` (collection name, e.g. `orders`), `type` (trigger, e.g. `order.paid`), `data` (payload), `date_created`, `app_id` (when app-generated), `req_id`, `user_id`, and webhook delivery state (`webhooks_pending`, `webhooks`). Read-only — there is no POST to `/events`.

**Payload shape**: `.created` and `.deleted` events carry a full record snapshot in `data`; `.updated` events carry `data.id` plus only the changed fields. Treat webhook payloads as change notices, not state — re-fetch the record by `data.id` before acting on anything beyond the changed fields.

**Type naming**: `<singular-root>.<event>` — `product.created`, `order.paid`, `subscription.invoiced`, `setting.updated`. Child-collection events insert the child root: `account.address.created`, `product.variant.updated` (event record `model` is `accounts:addresses` style, with `parent_id` in the data). Every model, custom ones included, has `created`/`updated`/`deleted`; richer domain events exist per model — notable ones: `cart.abandoned`, `cart.converted`, `order.submitted`/`paid`/`delivered`/`canceled`, `payment.succeeded`/`failed`/`refund.succeeded`, `product.stock_adjusted`, `invoice.refund_succeeded`, `coupon.generation.completed`, and the subscription set (`activated`, `canceled`, `paused`, `resumed`, `invoiced`, `paid`, `trial_will_end`, `trial_ended`). Custom model events are declared in the model's `events.types` (see data-models docs); a webhook can subscribe with the bare type, or the model-qualified form `orders/order.paid` when roots collide.

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

Standard CRUD applies (`GET`/`PUT`/`DELETE /:webhooks/{id}`). Webhooks for custom-model events must be created via API (the dashboard covers standard models). Delivery history lives at `/events:webhooks`. Apps configure their own webhooks via the swell-app file contract instead.

## Delivery contract

- POST, JSON body, one event per request: `{ id, date_created, model, type, data }` (thin payloads — see above). HTTPS endpoints get certificate validation.
- Respond **2xx within 10 seconds** — anything else counts as failure. Queue long work; don't process inline.
- **Verification is by source IP only** — there is no payload signature or HMAC header. Allowlist Swell's published webhook IPs (see the webhooks docs page for the current list) and treat the payload as untrusted input regardless: act on re-fetched records, not payload contents.
- **Retries**: after a failure, the first retry comes ~1 minute later, then exponentially spaced attempts (roughly 10 per day), with a ~12-hour gap before each new day's cycle. After ~4 consecutive days of failures with no success, the webhook is auto-disabled (`auto_disabled: true`, warning emails along the way). Re-enable with `PUT /:webhooks/{id} { enabled: true }` — pending undelivered events then retry (`retry_disabled_events` governs this).
- No ordering guarantee — deliveries can arrive out of order relative to the mutations that caused them; design handlers to be idempotent and to tolerate stale notices (fetch current state, compare, act).

## Consuming without webhooks

For batch or catch-up processing, poll `/events` with a cursor instead of standing infrastructure:

```js
const events = await swell.get('/events', {
  where: { type: { $in: ['order.paid'] }, id: { $gt: lastSeenId } },
  sort: 'id asc', limit: 100,
});
```

Persist the last processed id. This also backfills gaps after webhook endpoint downtime.
