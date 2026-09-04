# Querying

Query parameters (GET on any list endpoint; swell-node sends them as the request body): `where`, `sort`, `limit`, `page`, `search`, `expand`, `include`, `fields`, `group`, `aggregate`, plus `skip` (override the computed offset), `window` (size of the `pages` map, default = all pages), and `limit_count` (cap counting work on huge collections; values below 1000 are ignored). Any unreserved top-level key folds into `where` — `{ active: true }` ≡ `{ where: { active: true } }`.

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

`sort: '<field> <asc|desc>'` — comma-separate for multi-field precedence; the value must be a string (arrays are ignored); default `id desc` (newest first). Pagination: `limit` 1–1000 (default 15) with `page` (default 1); the envelope reports `count`, `page_count`, and a `pages` map of start/end record numbers. `page: 'all'` removes the limit and returns every match; `page: false` drops the envelope and returns a bare array. For very large sweeps, iterate with a `where: { id: { $gt: lastId } }` cursor and `sort: 'id asc'` instead of deep offsets.

## search

`search: '<text>'` is case-insensitive substring matching — every word must match within the same field, partial words match ("shirt" finds "t-shirts"), and double-quoted phrases match exactly. Dedicated search fields where defined: accounts → name/email/phone/vat_number/notes; products → name/slug/sku; variants → name/sku; carts and orders → number/billing.name/shipping.name; categories → name/slug; shipments and returns → id/order_id/tracking_code/address fields. Models without a defined set search across every string field. This is operational search — for customer-facing product search, front it with a real search engine (Algolia, Typesense, Meilisearch).

## expand

`expand: ['items.product', 'variants:50']` resolves `link` and collection fields in place. Expanded collections return **5 records by default** — raise per path with `field:limit`. Paths nest at most **5 levels**; deeper errors. On lists, expansion applies to every result — each two expanded fields add 1 to the request's rate-limit weight (nested paths count per level), so expand deliberately. `fields: 'name, slug, items.product_id'` (comma string or array, dot notation) trims response payloads.

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

`params` values name fields on the parent record; `data` is a literal query object. Each include adds rate-limit weight (its own query's weight on top of 1).

## group & aggregate

`group` is simplified aggregation on any list endpoint, combined with `where` pre-filtering. Keys map to accumulator operators (`$sum`, `$avg`, `$min`, `$max`, `$first`, `$last`, `$push`, `$addToSet`), date bucketing operators (`$year`, `$month`, `$dayOfMonth`, `$dayOfWeek`, `$hour`, …), or `field: true` to group by a field — referenced field names are written WITHOUT `$` prefixes (the API adds them):

```js
await swell.get('/orders', {
  where: { date_created: { $gte: '2026-01-01T00:00:00Z' } },
  group: { orders: { $sum: 1 }, revenue: { $sum: 'grand_total' }, month: { $month: 'date_created' } },
});
```

`aggregate` runs a real MongoDB pipeline: pass an **array** to replace the whole pipeline (your own `$match` required — `where` is ignored) or an **object of stages** to append after the `$match` generated from `where`. Inside pipelines use raw Mongo syntax with `$`-prefixed field refs; `id` in `$match` is rewritten to `_id` with ID-string conversion; date strings compare correctly against date fields. Aggregations ignore `limit`/`page`/`fields`/`expand`/`include` — shape with `$project` and cap with `$sort` + `$limit` stages; `_id` keys are flattened onto results; each `$lookup` adds rate-limit weight. Shortcut endpoints on every collection: `/:count`, `/:first`, `/:last`, and `/:group` (which returns the aggregation result without the `count`/`results` envelope).

## Reading localized & multi-currency data

- `$locale: 'fr'` (or header `X-Locale: fr`) returns records with localized fields overwriting defaults per fallback settings; `$locale: ['fr', 'de']` instead returns the raw `$locale` maps filtered to those codes.
- `$currency: 'EUR'` flattens price fields to that currency (response `currency` set, `$currency` map omitted); an array keeps the map filtered. Applies to expanded/included records too. Priced currencies use stored values (falling back to conversion only if fallback is enabled); display currencies always convert from base at rates refreshed hourly. `GET /:currencies` lists configuration (`{ base, rates, config: [{ code, type: base|priced|display, … }] }`). Reading conversion never changes stored data — transacting in a currency is a write concern (see `writes.md`).
