# Writes, Operators, Batch & Transactions

There is no rollback for updates. Run any multi-record or operator-based write against test records first.

## PUT is a deep merge

Updating a record merges the body into the stored record — fields you don't send are preserved, and this recurses into nested objects. **Arrays deep-merge too**: elements match by their `id` when present (matched elements merge, new ids append), and elements without ids append — a plain write can never remove or reorder array elements, only grow or amend them. This is platform-wide (records, `$app` extension data, cart/order items alike).

To replace values outright, use `$set` — top-level with dotted paths, or nested on the field itself:

```js
await swell.put('/products/{id}', { id, $set: { 'attributes.materials': ['cotton'] } });
await swell.put('/products/{id}', { id, tags: { $set: ['a', 'b'] } });   // field-level array replace
```

The merge-by-id behavior is also the idiom for targeted element updates: `{ options: [{ id: optionId, name: 'New label' }] }` amends one element in place. Supplied ids (in `$set` payloads or new nested objects) must be BSON ObjectID-formatted where the platform would otherwise generate one.

## Update operators

Passed at the top level of a PUT body, MongoDB-style, with dot notation and numeric array indexes:

- `$set` — set/replace value (the array-replace tool above).
- `$unset` — remove field; on array elements, replaces the matched element with `null`.
- `$inc` — increment (negative to decrement); sets the value if absent.
- `$push` / `$addToSet` — append to array (with/without allowing duplicates); `$each` adds multiple.
- `$pull` — remove all elements matching a condition (query operators allowed: `$pull: { 'attributes.allergens': { $regex: 'nut', $options: 'i' } }`).
- `$rename` — rename a field (silently removes an existing field with the target name).
- `$[]` — apply the operator across all elements of an array (`$pull: { 'options.$[].values': { id: { $exists: false } } }`).

## Linked collections through the parent

Records in linked child collections update through the parent by including their `id`: `PUT /accounts/{id}` with `addresses: [{ id, phone }]` updates `accounts:addresses` records; single links work too (`PUT /orders/{id}` with `account: { billing: {...} }` writes through to the linked account). Child collections also have their own endpoints (`/accounts:addresses`, `/products:variants`, …) for direct CRUD.

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

Up to **1,000 operations**, run **10 at a time**, each independent — one failure doesn't stop the rest; the failed slot carries `{ $error: '...' }` while others apply, so check every entry. Operations without a `method` inherit the batch request's method. The named-object form (`{ products: { url, data }, ... }`) keys the response identically and lets top-level `$locale`/`$currency` apply to all operations. Collection-scoped form: `/:batch/products` resolves operation urls relative to the collection (an op url can be a bare id). Rate-limit cost = sum of operations.

## Transactions — atomic

```js
const result = await swell.post('/:transaction', [
  { method: 'post', url: '/orders', data: {...} },
  { method: 'put', url: '/accounts/{id}', data: {...} },
]);
```

Up to 10 operations, all-or-nothing: any failure rolls back the whole set. Errors carry stable codes (`transaction_conflict`, `transaction_throttled`, `transaction_timeout`, `transaction_op_failed`) plus `op_index` identifying the failed operation. Child operations fire no per-record webhooks or app functions — a successful transaction emits a single `transaction.committed` event for the bundle. Use transactions when consistency matters (order + inventory + credit together); use batch for throughput. Rate-limit cost = operations + 1.
