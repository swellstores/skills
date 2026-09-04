# Querying

Query parameters (GET on any list endpoint; swell-node sends them as the request body): `where`, `sort`, `limit`, `page`, `search`, `expand`, `include`, `fields`, `group`, `aggregate`, plus `skip` (override the computed offset), `window` (number of entries in the `pages` map, default 10), and `limit_count` (cap counting work on huge collections; values below 1000 are ignored). Any unreserved top-level key folds into `where` — `{ active: true }` ≡ `{ where: { active: true } }`.

## where

MongoDB-style. Comparison/evaluation: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$regex` (+ `$options: 'i'`), `$type`, `$exists`. Logical: `$and`, `$or`, `$nor`, `$not` — multiple keys AND implicitly, and one field can carry multiple operators (`price: { $gt: 10, $lt: 50 }`). Array: `$all`, `$elemMatch`, `$size`. Dot notation reaches nested fields and array elements:

```js
await swell.get('/products', {
  where: {
    'attributes.material': 'cotton',
    'purchase_options.subscription': { $exists: true },
  },
});
await swell.get('/orders', {
  where: { items: { $elemMatch: { product_id: '...', 'purchase_option.type': 'subscription' } } },
});
```

## sort, pagination

`sort: '<field> <asc|desc>'` — comma-separate for multi-field precedence; the value must be a string (arrays are ignored); default `id desc` (newest first). Pagination: `limit` 1–1000 (default 15) with `page` (default 1); the envelope reports `count`, `page_count`, and a `pages` map of start/end record numbers (centred on the current page, omitted entirely when everything fits on one page). `page: 'all'` drops the limit, but returns every match only while the match count is ≤ 1000 — above that the whole request fails with `400 Query results cannot exceed 1000`, so reach for it only on result sets you know are small. `page: false` removes the envelope, not the limit: it returns a bare array of at most the default 15 unless you pass `limit` explicitly. For very large sweeps, iterate with a `where: { id: { $gt: lastId } }` cursor and `sort: 'id asc'` instead of deep offsets.

## search

`search: '<text>'` is case-insensitive substring matching — every word must match within the same field, partial words match ("shirt" finds "t-shirts"), and a double-quoted phrase is kept together as one contiguous substring (spaces included) instead of being split into separate words. Quoting never makes a match exact — `"red shirt"` still matches "Bright red shirt". Dedicated search fields where defined: accounts → name/email/phone/vat_number/notes; products → name/slug/sku; variants → name/sku; carts and orders → number/billing.name/shipping.name; categories → name/slug; purchaselinks → name; shipments and returns → id/order_id/tracking_code/address fields. Models without a defined set search across every string field. This is operational search — for customer-facing product search, front it with a real search engine (Algolia, Typesense, Meilisearch).

## expand

`expand: ['items.product', 'variants:50']` resolves `link` and collection fields in place. Expanded collections return **5 records by default** — raise per path with `field:limit`. Paths nest at most **5 levels**; deeper errors. On lists, expansion applies to every result. Rate-limit weight: every two expanded levels add 1 (a dotted path counts each level; a comma string is split and counted the same as the array), but the first 3 points of combined expand + include weight are free — ordinary expands cost nothing extra, only wide fan-outs do. `fields: 'name, slug, items.product_id'` (comma string or array, dot notation) trims response payloads.

## include

Attach related sub-queries as named fields on each result:

```js
await swell.get('/accounts', {
  include: {
    open_orders: {
      url: '/orders',
      params: { account_id: 'id' },       // parent-record field substitution
      data: { where: { paid: false } },   // literal query for the included call
      conditions: { balance: { $gt: 0 } } // optional: only run for matching parents
    },
  },
});
```

`params` values name fields on the parent record; `data` is a literal query object. Each include costs 1 point plus the weight of its own nested `expand`/`include`, drawn against the same free-first-3 allowance as expand.

## group & aggregate

`group` is simplified aggregation on any list endpoint, combined with `where` pre-filtering. Keys map to accumulator operators (`$sum`, `$avg`, `$min`, `$max`, `$first`, `$last`, `$push`, `$addToSet`), date bucketing operators (`$year`, `$month`, `$dayOfMonth`, `$dayOfWeek`, `$hour`, …), or `field: true` to group by a field — referenced field names are written WITHOUT `$` prefixes (the API adds them):

```js
await swell.get('/orders', {
  where: { date_created: { $gte: '2026-01-01T00:00:00Z' } },
  group: { orders: { $sum: 1 }, revenue: { $sum: 'grand_total' }, month: { $month: 'date_created' } },
});
```

`aggregate` runs a real MongoDB pipeline: pass an **array** to replace the whole pipeline (your own `$match` required — `where` is ignored) or an **object of stages** to append after the `$match` generated from `where`. Inside pipelines use raw Mongo syntax with `$`-prefixed field refs; `id` in `$match` is rewritten to `_id` with ID-string conversion, but nothing else is coerced — only `where` converts strings to the model's field types, so an ISO date string in a raw pipeline `$match` matches nothing against a date field and returns an empty result with no error. Keep date filters in `where` and pass your stages as an object so they append after the generated `$match`, or write the value as EJSON `{ $date: '2026-01-01T00:00:00Z' }` inside the pipeline. Aggregations ignore `limit`, `page`, and `fields` — shape with `$project` and cap with `$sort` + `$limit` stages; `_id` keys are flattened onto results. `expand`/`include` are not skipped, but have nothing to bind to: aggregated documents drop the link fields `expand` resolves and the parent fields an include's `params` substitute, so treat both as unavailable here. Each `$lookup` in an array pipeline adds 1 to rate-limit weight, and that point is not discounted. Shortcut endpoints on every collection: `/:count`, `/:first`, `/:last`, and `/:group` (which returns the aggregation result without the `count`/`results` envelope).

## Reading localized & multi-currency data

- `$locale: 'fr'` returns records with localized fields overwriting defaults per fallback settings; `$locale: ['fr', 'de']` instead returns the raw `$locale` maps filtered to those codes. `X-Locale`/`X-Currency` are Frontend-API headers: the backend API parses no locale or currency header at all, so on api.swell.store these are query parameters only and a header is silently ignored.
- `$currency: 'EUR'` flattens price fields to that currency (response `currency` set, `$currency` map omitted); an array keeps the map filtered. Applies to expanded/included records too. Priced currencies use stored values (falling back to conversion only if fallback is enabled); display currencies always convert from base at rates refreshed hourly. `GET /:currencies` lists configuration (`{ base, rates, config: [{ code, type: base|priced|display, … }] }`). Reading conversion never changes stored data — transacting in a currency is a write concern (see `writes.md`).
