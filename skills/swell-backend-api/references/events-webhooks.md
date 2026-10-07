# Events and webhooks

How the Backend API records what happens in a store and how a webhook delivers it: the event log, what an event carries, which events a change records, creating a webhook, what its endpoint receives, retries, and what to check when a webhook is silent. What a write sets off, and the flags an import uses to switch that off, are in `references/writes.md`. An app declares its webhooks and event functions as files: see the `swell-app` skill. Examples use `swell` for whichever client the code has.

## Events

A change to a record is recorded as an event in `/events`, a collection that is read like any other.

```json
{
  "id": "6ac623b745d71900129ee627",
  "model": "products",
  "type": "product.updated",
  "data": { "id": "6ac623b6fcbdb7001343d51a", "price": 11 },
  "date_created": "2026-10-07T10:49:27.695Z"
}
```

- **`model`** is the collection's path: `products`, `accounts:addresses` for a child collection, `apps/<app id>/<collection>` for an app's collection.
- **`type`** is `<root>.<event>`, the root being the singular of the collection: `product.created`, `order.submitted`. A child collection adds its own root: `account.address.created`.
- **`app_id`** is set when the collection or the event type belongs to an app.
- **An app id in an event is the app's record id**, 24 hexadecimal characters, in `model` and in `app_id` alike. It is never the `id` from the app's `swell.json`.
- **`user_id`** is set when a dashboard user made the change, and `req_id` identifies the request.

### What `data` holds

| Event | `data` |
| --- | --- |
| `created`, `deleted` | The whole record |
| `updated` | `id` and the fields that changed, nothing else. On a child record `parent_id` is absent |
| Any other, such as `order.submitted` or `payment.succeeded` | The record's `id` only. A few add a value or two: `order.paid` has `payment_id`, `product.stock_adjusted` has `stock_level` and `prev_stock_level`. An app's event carries the `fields` its declaration lists |
| `transaction.committed` | The operations of the transaction: `references/writes.md` |

An event is a notice that something changed, not the record. Read the record by `data.id` before acting on anything the event does not carry.

### Which types a model has

`created`, `updated` and `deleted` are the default. A model that declares its own list replaces it, so do not assume them: `payments` has `succeeded`, `failed` and `voided`, and no `payment.created`.

- **Read the list from the store.** `GET /:models/<collection>` has it under `events`, app-declared events included: `root` is the first part of the type and each entry of `types` has the second part as its `id`. A child collection's list is on its field in the parent model (`fields.addresses.events`). The definition of an app's collection also has the app's record id, as `app_id`.
- **Standard models have events beyond the three.** Orders: `submitted`, `paid`, `payment_failed`, `refunded`, `delivered`, `canceled`. Carts: `converted`, `abandoned`. Products: `stock_adjusted`. Subscriptions: `activated`, `invoiced`, `paid`, `payment_failed`, `paused`, `resumed`, `canceled`, `trial_will_end` and more.
- **A type that has `hooks` in its declaration records no event.** `payment.charge`, `payment.refund`, `order.shipping` and `order.taxes` are points where an app extends the platform. A webhook subscribed to one never fires.

### Which events a change records

- **An update that changes nothing records nothing**, and neither does one that changes only `date_updated`.
- **A change the platform makes as a result of another write records the event named for it, and no `updated`.** A payment that settles an order records `payment.succeeded` for the payment and `order.paid` for the order. No `order.updated` reports that `paid` or `payment_total` changed. A stock adjustment records `product.stock_adjusted` and no `product.updated`. Subscribe to the event named for the change: a handler that waits for `order.updated` and tests `paid` misses it.
- **Some collections record no events at all:** `products:stock`, `coupons:uses` and `promotions:uses`. Their changes show as events of the parent, such as `product.stock_adjusted`.
- **A write sent with `$events: false` and the operations of a transaction record no events of their own.** Both are in `references/writes.md`.

## Creating a webhook

A webhook is a record in `/:webhooks`: an address, and the event types to send there. The dashboard manages them under Developer > Webhooks.

```js
const webhook = await swell.post('/:webhooks', {
  url: 'https://example.com/hooks/swell',
  events: ['order.submitted', 'payment.succeeded'],
  enabled: true,
  alias: 'order-sync',
});
```

- **`enabled` is `false` unless the body sets it.** A webhook created without it is stored, receives nothing and reports no error.
- **`events` is not checked.** Any string is stored. A misspelled type, a type with the `before:` or `after:` prefix of an app's hook, or one that records no event, never fires and nothing says so. After creating a webhook, make the change once on a test record and look for its delivery row: see "A webhook that is silent".
- **A store can have 20 webhooks enabled at once**, or the number its plan sets. The write that would enable one more is refused with `Your account can't have more than <n> webhooks enabled at once`. Webhooks that belong to apps are not counted.
- **A new or changed webhook can take a few seconds to apply.**

### Entries of `events`

| Entry | Matches |
| --- | --- |
| `order.submitted` | That type on any collection |
| `orders/order.submitted` | That type on one collection: `<model>/<type>`, with the `model` of the event |
| `$app.<app id>.<model>/<type>` | That type on one collection, for an event that has an `app_id` |
| `transaction.committed` | Every committed transaction |

The plain type is enough unless two collections, or two apps, use the same type name.

**The longer forms must repeat the event's own `model` and `app_id` exactly.** For an app's collection the model is `apps/<app id>/<collection>` with the app's record id, so the entries are `apps/<app id>/reviews/review.created` and `$app.<app id>.apps/<app id>/reviews/review.created`. An entry written with the app's `swell.json` id, or with the collection's short name, is stored and never matches. Copy both values from an event the store has recorded.

## What the endpoint receives

One `POST` per event, with the event as a JSON body:

```json
{
  "id": "6ac623b745d71900129ee627",
  "model": "products",
  "type": "product.updated",
  "data": { "id": "6ac623b6fcbdb7001343d51a", "price": 11 },
  "date_created": "2026-10-07T10:49:27.695Z",
  "$type": "products/product.updated",
  "$delivery": { "attempts": 0 }
}
```

- **The body is the event record plus `$type` and `$delivery`.** `$type` is `<model>/<type>`, with `$app.<app id>.` in front when the event has an `app_id`. It is the value that tells apart two events with the same type name.
- **`$delivery.attempts` is `0` on the first delivery.** On a retry it counts the attempts already made, and `$delivery.date_first_failed` is present.
- **An event can arrive more than once, and events can arrive out of order.** Recognize a repeat by the event's `id`, and read the record for its current state.
- **The environment is in the `Swell-Env` header**, `test` for the test environment. The header is absent for the live environment, and the body does not name the environment.
- **Nothing in the request names the store.** An endpoint that serves several stores needs an address per store.
- **The request is not signed.** There is no signature or secret header to verify. Check that it comes from one of the addresses Swell publishes at <https://developers.swell.is/backend-api/webhooks>, put a secret of your own in the webhook's address, or both. In any case use the body as a notice and read the record by `data.id`.
- **Answer with a 2xx status within 10 seconds.** Any other status, or no answer in time, is a failed delivery. The body of a 2xx answer is ignored. Do long work after answering.
- **An `https` address must have a valid certificate.**

## Retries

- **A failed delivery is sent again after about a minute, then at intervals that grow** from about ten minutes to two or three hours. After every tenth failure the next attempt is 12 hours later.
- **The intervals follow the webhook's failures in a row, not the event's.** While an endpoint is down, a new event that fails does not start at one minute: it waits the interval the webhook has reached, which can be hours. One successful delivery resets the count, so after an outage the deliveries arrive spread over hours and out of order.
- **Two answers stop the retries of one event:** status 410, or a failure status with a JSON body that contains `"retry": false`. Neither counts as a failure of the webhook.
- **After 4 days of failures without one success, the webhook is switched off**: `enabled` becomes `false` and `auto_disabled` becomes `true`. The store's administrators are emailed a warning after every tenth failure, at most once a day, and again when the webhook is switched off.

## A webhook that is silent

Check in this order.

1. **Is it on?** `GET /:webhooks/<id>`. `enabled: false` without `auto_disabled` means it was never enabled or someone switched it off. `auto_disabled: true` means the platform switched it off after 4 days of failures.
2. **Was the event recorded?** Look in `/events` for the type and the record's id (`where: { type, 'data.id': id }`). When there is none, see "Which events a change records".
3. **Is there a delivery?** `/events:webhooks` has one row for each event and each webhook it goes to. A webhook has no row for an event when it was off, or when none of its `events` entries matched, at the moment the event was recorded. Compare the entries with the event's `type`, `model` and `app_id`.
4. **What does the row say?** See the table below.

```js
const rows = await swell.get('/events:webhooks', {
  where: { webhook_id: webhook.id },
  sort: 'date_sent desc',
  expand: 'parent', // the event
  limit: 25,
});
```

`parent_id` is the event's id, so `where: { parent_id }` lists every delivery of one event. A row is updated in place at each attempt: `attempts` counts them, and only the last `status` and `response` are kept. `where: { pending: true }` lists the rows that still wait for a delivery or a retry. The collection also holds the deliveries to app functions, with `function_id` in place of `webhook_id`.

| `status` | `response` | Meaning |
| --- | --- | --- |
| 2xx | `null` | Delivered |
| 4xx or 5xx | `Unexpected response: <body> - status: <n>` | The endpoint answered with a failure. `date_retry` is the next attempt |
| 410, or a failure with `"retry": false` | The endpoint's answer | `terminated: true`. No more attempts |
| `null` | `Request failed: <reason>` | No answer arrived: the host name did not resolve, the certificate or the connection failed, or 10 seconds passed (`Timed out`) |
| `null` | `Webhook has been disabled` | The webhook was switched off after the event was recorded and before this attempt. The row waits with `date_retry: null` |

The webhook's own record has the state across events:

- **`attempts_failed`** counts failures in a row over all events. A success sets it back to 0.
- **`date_first_failed`** is the start of the current run of failures, and `date_last_success` the last delivery that worked.
- **`date_final_attempt`** is `date_first_failed` plus 4 days: the earliest moment the webhook can be switched off. It is a projection, set as soon as the first failure happens.

### Switching it back on

`PUT /:webhooks/<id>` with `{ enabled: true }`.

- **For a webhook the platform switched off**, the same write clears `auto_disabled` and sends again, a few seconds apart, the deliveries that were waiting. Add `retry_disabled_events: false` to switch it on without them. The value is stored, so it also applies the next time.
- **For a webhook switched off by hand**, nothing is sent again. The deliveries that were waiting are never sent.
- **Events recorded while a webhook was off are never delivered to it**, in either case. To catch up, read them from `/events` as below.
- **`attempts_failed` is kept** until a delivery succeeds. If the endpoint still fails, the next retry can be hours away.

## Reading events without a webhook

For a job that runs on a schedule, or to catch up after an outage, read `/events` from where the last run stopped:

```js
const { results } = await swell.get('/events', {
  where: {
    type: { $in: ['order.submitted', 'payment.succeeded'] },
    id: { $gt: lastSeenId },
  },
  sort: 'id asc',
  limit: 100,
});
```

Store the `id` of the last event handled and pass it to the next run.
