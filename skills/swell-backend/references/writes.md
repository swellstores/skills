# Writes, Operators, Batch & Transactions

A completed write cannot be undone — there is no request-level undo and no version history. Run any multi-record or operator-based write against test records first. The one exception is `/:transaction` (below), which rolls back its whole op set when an op fails with a *request* error.

## PUT is a deep merge

Updating a record merges the body into the stored record — fields you don't send are preserved, and this recurses into nested objects. This is platform-wide (records, `$app` extension data, cart/order items alike).

**Arrays merge too, but only objects carrying an `id` merge by id.** Elements with an `id` are aligned against the stored array by id: a match merges in place, and an id the record doesn't have appends — unless the same-index slot holds an id-less object, which it merges into instead. Elements *without* an `id` — including every scalar array, such as `tags` — merge **by position**: body element 0 lands on record element 0, element 1 on element 1 — a scalar replaces the slot, an id-less object merges into it. The array never shrinks; it grows only where the body is longer than the record.

```js
// stored: tags === ['new', 'summer', 'x']
await swell.put('/products/{id}', { id, tags: ['sale'] });
// → ['sale', 'summer', 'x']   — NOT ['new','summer','x','sale']
```

To replace values outright, use `$set` — top-level with dotted paths, or nested on the field itself:

```js
await swell.put('/products/{id}', { id, $set: { 'attributes.materials': ['cotton'] } });
await swell.put('/products/{id}', { id, tags: { $set: ['a', 'b'] } });   // field-level array replace
```

The same nested form edits arrays in place: `{ items: { $unset: [0, 2] } }` splices those indexes out (an index may also be `':first'` / `':last'`, or a comma-separated string), and `{ items: { $push: {...} } }` appends (`$post` is an alias).

`$app` extension data merges the same way but takes a different operator grammar, and the nested `{ field: { $set: … } }` form is **never** interpreted inside `$app` — it will corrupt the value (`{ tags: { $set: ['a'] } }` stores `{ 0: 'a' }`). Inside `$app`: replace one app's whole subdocument with `{ $app: { $set: { <app_slug>: {...} } } }` (other apps untouched); delete fields with `{ $app: { $unset: ['<app_slug>.nested.field'] } }` — the dotted path is required, a bare app slug is silently ignored, so an entire app cannot be unset this way. Object-level `$set` / `$unset` also work at any depth inside an app's own subdocument.

The merge-by-id behavior is also the idiom for targeted element updates: `{ options: [{ id: optionId, name: 'New label' }] }` amends one element in place. Supplied ids (in `$set` payloads or new nested objects) must be BSON ObjectID-formatted where the platform would otherwise generate one.

## Update operators

Passed at the top level of a PUT body, MongoDB-style, with dot notation and numeric array indexes:

- `$set` — set/replace value (the array-replace tool above).
- `$unset` — remove a field. On an array element path it follows MongoDB and leaves `null` in the slot rather than shrinking the array; the nested `{ field: { $unset: [i] } }` form above is what actually splices elements out.
- `$inc` — increment (negative to decrement); sets the value if absent.
- `$push` / `$addToSet` — append to array (with/without allowing duplicates); `$each` adds multiple.
- `$pull` — remove all elements matching a condition (query operators allowed: `$pull: { 'attributes.allergens': { $regex: 'nut', $options: 'i' } }`).
- `$rename` — rename a field (silently removes an existing field with the target name).
- `$[]` — apply the operator across all elements of an array (`$pull: { 'options.$[].values': { id: { $exists: false } } }`).

## Linked collections through the parent

Records in linked child collections update through the parent by including their `id`: `PUT /accounts/{id}` with `addresses: [{ id, phone }]` updates `accounts:addresses` records; single links work too (`PUT /orders/{id}` with `account: { billing: {...} }` writes through to the linked account). Child collections also have their own endpoints (`/accounts:addresses`, `/products:variants`, …) for direct CRUD.

**The `id` is what makes it an update.** A linked element with no `id` — and no value for the child model's secondary field — is POSTed as a **new** child record and linked to the parent, so `PUT /accounts/{id}` with `addresses: [{ phone: '…' }]` adds an address rather than editing one. Linked writes execute as separate serial requests, so a failure part-way leaves the earlier ones applied.

## Suppressing side effects on bulk writes

Every write fires the store's events, and through them webhooks, app functions, and notifications. For imports and backfills that is usually wrong — you do not want 40,000 order-confirmation emails.

`$events: false` in the request body suppresses event capture for that write:

```js
await swell.put('/orders/{id}', { id, $events: false, metadata: { erp_id: 'X-1' } });
```

`$events: true` forces capture; an object merges into the request's event scope. Child requests inherit the parent's scope, so a `/:batch` op honors `$events: false` placed inside its own `data` and otherwise takes whatever the batch request carried.

It only silences the event pipeline — model features still run, so an order write still consumes stock and a payment still updates its order's balance. Inside `/:transaction` the flag does **not** stop activity/billing capture: the platform ignores it there so revenue tracking can't be bypassed (per-record events are already suppressed for transaction children regardless). To suppress notifications as well, you need `$migrate`.

## Migrating records between stores

**A supplied value beats a platform-generated one.** `id`, `date_created`, and the `number` sequences on orders/invoices/returns are auto-assigned only when the field is absent, so an export can be replayed with its keys intact:

```js
await swell.post('/orders', {
  id: '5f8a1c2e3d4b5a6c7d8e9f01',        // must be BSON ObjectID hex
  number: '100042',
  date_created: '2025-11-03T14:22:00Z',
  account_id, items,
});
```

Preserving ids keeps every foreign key in the export valid, so collections can be imported in any order. `number` is `immutable`, which rejects a *change*, not a first assignment — you may set it on insert and never afterward.

`$migrate: true` is the heavy tool for a bulk restore, and it turns nearly everything off:

- field validation is skipped entirely — read-only, immutable, required, enum, and rule checks all pass
- **formulas are not computed** — every derived total, balance, and status keeps exactly the value you supply, or stays empty
- model/feature event handlers do not run, notifications are not sent, and no events are captured
- linked-record writes are skipped, so nested child data does not propagate to child collections
- a `$migrate` POST stamps `migrated: true` on the new record, so migrated rows stay identifiable

App-extension field types are still applied, so `$app` data still lands typed. That combination lets you land a record exactly as it existed elsewhere — and equally lets you land an internally inconsistent one that no later write repairs, because the formulas that would have fixed it never ran. Reserve it for a full restore where you control every field; for anything short of that, use ordinary writes plus `$events: false`. `$restore: true` turns off the same machinery and additionally waives external validation (the read-only and `$validate` header checks), but two of the above are `$migrate`-only: `$restore` does **not** stamp `migrated: true`, and it does **not** apply app-extension field types, so `$app` data written under it lands untyped. Use `$migrate` for any import you need to identify later.

Nothing in the request path gates these two flags to internal callers, but confirm the behavior on the test environment before committing a live migration to them.

## Writing localized & multi-currency values

- `$locale: { fr: { name: 'Chaise' } }` beside regular fields on POST/PUT sets per-locale values; for nested fields, put `$locale` on the **nearest parent object**. All locale content is optional via the API even when the dashboard requires it.
- `$currency: { EUR: { price: 14 } }` sets explicit per-currency prices anywhere price fields live (product root, purchase_options/plans, options, variants, `prices` entries). Write responses include the full `$currency` map.
- Transacting in a currency means setting the **`currency` field** on the cart/order (not `$currency`): a priced currency re-prices items (each needs a price in it), a display currency records `display_currency` while transacting in base. The currency can't change after a payment exists; `currency_rate` snapshots at write time (`currency_rate: null` recomputes it).

## Batch — parallel, independent

```js
const results = await swell.post('/:batch', [
  { url: '/products', method: 'post', data: {...} },
  { url: '/products/5c8f.../', method: 'put', data: {...} },
]);
```

Up to **1,000 operations**, run **10 at a time**, each independent — one failure doesn't stop the rest. A failed slot carries the failure instead of a record, in one of **two shapes**: `{ $error: 'Resource not found /products/x' }` for routing, permission and not-found failures, and `{ errors: { field: { code, message } } }` for validation failures. Check both keys on every entry — code that only looks for `$error` reads a rejected write as a success. Operations without a `method` inherit the batch request's method. The named-object form (`{ products: { url, data }, ... }`) keys the response identically and lets top-level `$locale`/`$currency` apply to all operations. Collection-scoped form: `/:batch/products` resolves operation urls relative to the collection (an op url can be a bare id). Rate-limit cost = sum of operations.

## Transactions — atomic

```js
const result = await swell.post('/:transaction', [
  { method: 'post', url: '/orders', data: {...} },
  { method: 'put', url: '/accounts/{id}', data: {...} },
]);
```

Up to 10 operations, **write methods only** — every op must be `post`, `put`, or `delete`. A `get` op is rejected with 400 `Transaction supports write methods only (got 'get' at index N)` before anything runs, as is an empty op array; read what you need *before* opening the transaction. An op omitting `method` inherits the parent request's method (`post`).

**Rollback is not total.** Ops that fail with a *request* error — not found, permission denied, bad URL, write conflict, timeout — abort the whole set. **Field-validation failures do not abort**: that op writes nothing, its result slot carries `{ errors: { field: { code, message } } }`, `transaction.committed` still fires, and every other op still commits. Inspect every entry of the returned array for an `errors` key before treating a 200 as fully applied.

| code | HTTP | Retryable | Trigger |
|---|---|---|---|
| `transaction_conflict` | 409 | yes | write conflict after the retry budget (~2s) |
| `transaction_throttled` | 429 | yes | per-tenant in-flight transaction cap reached |
| `transaction_timeout` | 408 | no | per-op or commit time budget exceeded |
| `transaction_op_failed` | the op's own status | no | an op's request error — the **only** code carrying `op_index` |
| `transaction_error` | 503, or the original 4xx | no | cluster/driver failure, or a body-level rejection (bad method, bad op shape, >10 ops, empty array) |

Disambiguate `transaction_error` by its `status`. Do not read `op_index` unconditionally — only `transaction_op_failed` sets it.

Child operations are invisible to the event system: no `/events` record is written for them, so no webhook and no app function fires — including **before** hooks, which means app-side defaulting and `throw req.reject(...)` validation are bypassed for ops inside a transaction. A successful commit emits one `transaction.committed` event (model `transactions`, data `{ correlation_id, app_id, ops }`) that webhooks and functions can subscribe to. Activity/billing capture is deferred to post-commit and dropped on abort.

Transactions are for short write bundles, not bulk work: ops run **sequentially** inside one session under per-op and per-commit time budgets on the order of seconds, so latency is additive across all 10, and write conflicts retry only briefly before surfacing as `transaction_conflict`. Use transactions when consistency matters (order + inventory + credit together); use batch for throughput. Rate-limit cost = operations + 1.
