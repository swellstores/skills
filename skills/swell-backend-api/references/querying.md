# Querying

Reads on the Backend API: filtering, sorting, paging, counting, search, related records, aggregation, and localized or multi-currency values. Every list endpoint takes the same parameters. How a client sends them, and how a missing record or an error reaches the code, is in `references/clients.md`. Examples use `swell` for whichever client the code has.

## Parameters

| Parameter | Does |
| --- | --- |
| `where` | Filters the records |
| `sort` | Orders them |
| `limit`, `page` | Page size, 1 to 1000 with a default of 15, and page number |
| `search` | Text search |
| `fields` | Keeps only the named fields in each record |
| `expand` | Resolves linked records in place |
| `include` | Attaches the result of another query to each record |
| `group`, `aggregate` | Aggregate instead of listing |
| `$locale`, `$currency` | Return localized values, or prices in a currency |

A top-level key that is not one of these parameters is a filter: `{ active: true }` is `{ where: { active: true } }`.

## where

MongoDB-style conditions. Several keys must all match, and one field can carry several operators (`price: { $gt: 10, $lt: 50 }`).

- **Comparison:** `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$regex` with `$options: 'i'`, `$exists`, `$type`.
- **Logical:** `$and`, `$or`, `$nor`, `$not`.
- **Arrays:** `$all`, `$size`, and `$elemMatch` for several conditions on the same element.

Dot notation reaches nested fields and the elements of an array. An app's fields on a standard record are filtered by their path, `'$app.<app_id>.<field>'`.

```js
await swell.get('/products', {
  where: {
    'attributes.material': 'cotton',
    'purchase_options.subscription': { $exists: true },
  },
});
await swell.get('/orders', {
  where: { items: { $elemMatch: { product_id: '...', quantity: { $gte: 2 } } } },
});
```

Values in `where` are converted to the field's type: write a date as an ISO string and an id as a string.

## Sort and paging

`sort: '<field> <asc|desc>'`, with several fields separated by commas (`'price desc, name asc'`). The value must be a string; an array is ignored. The default is `id desc`, newest first.

A list answers with `{ count, results, page, limit, page_count }`. `count` is the total number of matches, not the size of the page.

- **`pages` is present only when there is more than one page.** It maps page numbers to the record numbers they start and end at, for ten pages around the current one. Test for it before reading it.
- **`limit` above 1000 fails with status 400.**
- **`page: 'all'` returns every match in one answer, and fails with status 400 when there are more than 1000.** Use it only where the number of matches is known to stay small.
- **`page: false` returns a bare array with no envelope.** It still returns one page: 15 records unless `limit` says otherwise.

To read a whole collection, do not page by number through tens of thousands of records. Sort by `id` and continue from the last one read:

```js
let last;
for (;;) {
  const { results } = await swell.get('/orders', {
    where: last ? { id: { $gt: last } } : {},
    sort: 'id asc',
    limit: 1000,
  });
  if (!results.length) break;
  // …process results
  last = results[results.length - 1].id;
}
```

## Counting

- **How many match.** `count` of any list answer, or `GET /<collection>/:count` with the same filter, which answers with the bare number.
- **How many per value of a field.** `group` with the field and a sum:

```js
const { results } = await swell.get('/orders', {
  where: { date_created: { $gte: '2026-01-01T00:00:00Z' } },
  group: { status: true, orders: { $sum: 1 } },
});
// [{ status: 'complete', orders: 3508 }, { status: 'canceled', orders: 217 }, …]
```

## Search

`search: '<text>'` matches case-insensitive substrings. Every word must be found in the same field, and part of a word matches: `shirt` finds "t-shirts". A phrase in double quotes is matched as one piece, spaces included, and still as a substring: `"red shirt"` finds "Bright red shirt".

Models that define search fields are searched in those only:

| Collection | Fields searched |
| --- | --- |
| accounts | name, email, phone, vat_number, notes |
| products | name, slug, sku |
| variants | name, sku |
| carts, orders | number, billing.name, shipping.name |
| categories | name, slug |
| purchaselinks | name |
| shipments, returns | id, order_id, tracking_code and address fields |

Every other model, app collections included, is searched across all its string fields. This is search for back-office work. For a shopper-facing product search, put a search engine in front.

## fields and expand

`fields: 'name, slug, items.product_id'` keeps only those fields, as a comma-separated string or an array, with dot notation. `id` always comes back.

`expand: ['account', 'items.product', 'variants:50']` replaces links with the records they point to. On a list it applies to every record.

- **A link to one record** becomes that record.
- **A link to many records** becomes a list envelope of its own, `{ count, results, … }`, holding **5 records by default**. Raise the number per path with `<field>:<limit>`.
- **A path can be at most 5 levels deep.** A deeper one fails the request.

## include

Attaches the result of another query to each record under a name of your choice:

```js
await swell.get('/accounts', {
  include: {
    open_orders: {
      url: '/orders',
      params: { account_id: 'id' },        // the order's account_id equals this account's id
      data: { where: { paid: false } },    // a fixed query for the included call
      conditions: { balance: { $gt: 0 } }, // optional: run it only for accounts that match
    },
  },
});
```

Each key of `params` is a filter on the included query, and its value names the field of the parent record to take the value from. `data` is a query as written, and `conditions` is tested against the parent record. The value under `open_orders` is whatever that query answers: a list envelope here, a number for a `/:count` url. A record that does not meet `conditions` gets `null`.

## group and aggregate

`group` aggregates the records that `where` selects. Each key is one of three things:

- **A field to group by:** `status: true`.
- **An accumulator:** `$sum`, `$avg`, `$min`, `$max`, `$first`, `$last`, `$push`, `$addToSet`.
- **A date part to group by:** `$year`, `$month`, `$dayOfMonth`, `$dayOfWeek`, `$hour`.

Field names inside `group` are written without a `$` prefix.

```js
await swell.get('/orders', {
  where: { date_created: { $gte: '2026-01-01T00:00:00Z' } },
  group: { month: { $month: 'date_created' }, orders: { $sum: 1 }, revenue: { $sum: 'grand_total' } },
});
// { count: 10, results: [{ month: 1, orders: 310, revenue: 28411.5 }, …] }
```

With accumulators only there is nothing to group by, and the answer is `{ results: [{ … }] }` with a single entry and no `count`.

`aggregate` runs a MongoDB pipeline, in MongoDB's own syntax with `$`-prefixed field references. It takes two forms:

- **An object of named stages** adds them, in the order written, after the filter from `where`. The names are labels of your choice, and each value is one stage:

  ```js
  await swell.get('/orders', {
    where: { date_created: { $gte: '2026-01-01T00:00:00Z' } },
    aggregate: {
      by_status: { $group: { _id: '$status', orders: { $sum: 1 } } },
      sorted: { $sort: { orders: -1 } },
    },
  });
  ```

  Writing the stage operators as the keys, `{ $group: …, $sort: … }`, fails with a database error.

- **An array** is the whole pipeline. `where` is ignored, so the pipeline needs its own `$match`, and values in it are not converted to field types: an ISO date string matches nothing in a date field and gives an empty result with no error. Write the date as `{ $date: '2026-01-01T00:00:00Z' }`, or keep the filter in `where` and use the object form. `id` in a `$match` is the exception and is converted.

An `aggregate` answers with `{ count, results }`, where `count` is the number of rows. The keys of an object `_id` become fields of the row, and any other `_id` comes back as `id`.

`sort`, `limit`, `page` and `fields` do not apply to the rows of a `group` or an `aggregate`, and `expand` and `include` are not available on them. To order, cut or trim the rows, use `aggregate` with `$sort`, `$limit` and `$project` stages.

Every collection also has `/:first` and `/:last`, which answer with the oldest and the newest record that matches the query.

## Localized and multi-currency reads

- **`$locale: 'fr'`** returns each record with its French values in place of the defaults, where they exist. An array, `$locale: ['fr', 'de']`, leaves the default values in place and returns the `$locale` map with those languages.
- **`$currency: 'EUR'`** returns price fields in that currency and sets the record's `currency`. An array leaves the base prices in place and returns the `$currency` map with those currencies. Expanded and included records follow.
- A currency the store prices in uses its stored prices. A display currency is converted from the base price at a rate that is refreshed hourly. `GET /:currencies` returns the base currency, the rates and the store's currency configuration.

Reading in a currency changes nothing that is stored. Selling in a currency is a write: `references/writes.md`.
