# Catalog, Content and Settings

Reading products, categories, content, settings, locales and currencies. These reads need no session, but Swell prices a product and works out its stock for the session at the moment of the read; `clients-sessions.md` owns caching, `$cache: false`, the 1000 limit and built pages.

## Reading products

`swell.products.list(query)` takes `{ limit, page, sort, where, search, expand }`; `swell.products.get('<slug-or-id>', query)` reads one.

- **Only active records are returned**: products, variants, options, purchase options, plans and categories. An inactive product reads like a missing one, and `where: { active: false }` is ignored.
- **`fields` is ignored.** Every read returns the fields the public key allows. Keep a listing small by not expanding.
- **`search` matches the start of words in `name`, `slug` and `sku`**, and every word must match. Ids and descriptions are not searched; read by id with `get`.
- **`get` includes `variants`, `list` does not.** Add `expand: ['variants']` to a list only when the page resolves selections: it costs a query per product. On `get` and on `list` it also adds each variant's `sku` and `attributes`.

## What a product carries

- **`price` is what this shopper pays**: the sale price and the price for the logged-in customer's group are already applied. `orig_price` is present only when the price was lowered, and `sale` says a sale is on. There is no top-level `sale_price`.
- `options[]`: `{ id, name, variant, required, input_type, values: [{ id, name, price }] }`. `variant: true` marks an option that selects a variant; a value of any other option adds its `price` to the line.
- `variants`: `{ count, results }`, each `{ id, name, option_value_ids, price, orig_price, purchase_options, stock_status, stock_level, images }`. A field without a value is absent.
- `purchase_options`: `{ standard: { price, sale, sale_price, orig_price }, subscription: { plans: [{ id, name, price, billing_schedule }] } }`, only the types the product sells. On a product with more than one type, the top-level `price` belongs to one of them: take the price from `variation()` with the type the shopper chose.
- `attributes`: always present, an object keyed by attribute id, each `{ name, type, value, visible, filterable }`.
- `categories`: absent unless asked for ("Categories and facets").

## Resolving a selection

```js
const product = await swell.products.get('blue-shoes');
const selection = { Size: 'M', Color: 'Blue' };           // or [{ id | name, value }]
const variation = swell.products.variation(product, selection);
// variation.variant_id is set only when the selection names one variant
const cart = await swell.cart.addItem({ product_id: product.id, quantity: 1, options: selection });
// cart.errors is set when Swell refused the selection
```

`variation()` is local and synchronous. It returns the product with `price`, `orig_price`, `sale_price`, `stock_status`, `stock_level` and `images` replaced by the variant's, plus `variant_id`.

- **It needs `variants` on the product.** On a product from a list without `expand: ['variants']` it throws a `TypeError`.
- **A selection that names no variant returns the product's own values**, without an error: an incomplete selection, an unknown value, a combination no variant covers. A price coming back proves nothing: on a product with variant options, enable the button on `variation.variant_id`.
- **Names and values match exactly.** Options and values are matched by `id` or `name`, case included. The cart ignores case, so `{ size: 'm' }` adds the right variant while `variation()` finds none: use the strings from `product.options`.
- **Add-on values are added to `price`, `orig_price` and `sale_price`.** Never price a configured item from `product.price`.
- **The third argument chooses the purchase option**: `'standard'`, `'subscription'` or `{ type: 'subscription', plan_id }`. A plan is matched by its `id`; without one the first plan is used. A type or plan the product does not sell throws at once, except `'standard'`, which falls back to the product's price.

What `cart.addItem()` answers to a selection on a product with variants:

| Selection | Answer |
| --- | --- |
| No `options` and no `variant_id` | Resolves with `errors['items.variant_id']` |
| An unknown value, an incomplete selection or a combination with no variant | Resolves with `errors['items.options']` |
| An option name the product does not have | Accepted: a line without a variant, at the product's price |
| A `variant_id` that does not exist | Rejects with status 404 |

A call that resolves with `errors` changed nothing in the cart.

## Stock

`stock_status` is the first that applies of `discontinued`, `preorder`, `backorder`, then `in_stock` or `out_of_stock` when the product tracks stock, and `null` when it does not.

- **`null` means the product does not track stock.** It can always be bought: show it as available.
- **A variant has its own `stock_status` only on a product that tracks stock.** Read `variation.stock_status ?? product.stock_status`.
- **`stock_level` on a product with variants is the highest variant's level, not the sum.** Never show it as a total; a variant's own level is on the variant.
- Stock stops a purchase only when the product tracks stock and the store does not sell beyond it. The refusal comes when the order is submitted, so read the product again before checkout.

## Categories and facets

`swell.categories.list()` and `swell.categories.get('<slug-or-id>')` read categories; `get` carries `children` and `parent`.

Scope a product list with one of two parameters:

- `category: '<slug-or-id>'`: that category alone, in the order the merchant set for it unless `sort` is passed.
- `categories: [...]`: those categories and every category below them.

A category that does not exist gives an empty list.

`swell.products.filters(results)` builds facets, locally, from a list answer, an array or one product:

| Filter `id` | Shape |
| --- | --- |
| `price` | `type: 'range'`, `options: [{ value: min }, { value: max }]` and `interval`. The bounds are rounded outward to the interval and come from `price`. Absent when every product has the same price. |
| `category` | `type: 'select'`, option values are slugs. Absent unless the products carry `categories`. |
| an attribute id | `type: 'select'`, the values present in the products. |

`await swell.products.filterableAttributeFilters(results)` answers the same, with only the attributes the merchant marked as filterable. Both describe the products passed in, not the catalog. Apply the shopper's choices with `$filters` and let Swell filter:

```js
await swell.products.list({
  category: 'shirts',
  limit: 24,
  page: 2,
  $filters: { price: [10, 50], category: ['sale'], stock_status: ['in_stock'], color: ['Red', 'Blue'] },
});
```

- `price: [min, max]` matches a product whose price or sale price is in the range.
- `category`: any of the listed categories, without the categories below them, and only inside the `category` or `categories` scope of the same query. A value that is no category is ignored and does not empty the list.
- `stock_status`: the listed statuses. `in_stock` also matches a product with `stock_tracking: false`, and misses one where tracking was never set. For an "available only" switch use `where: { stock_status: { $ne: 'out_of_stock' } }`, which keeps every product that does not track stock.
- Any other key is an attribute id: any of the listed values, case included. Several attributes must all match.

**Products carry `categories` only when the query asks.** `expand: ['categories']` adds each product's top-level categories. A list scoped with `category` or `categories`, without that expand, carries the scoped category's direct children instead, which is what a drill-down facet needs. `$filters: { category }` adds none.

## Content

`swell.content.list('<type>', query)` and `swell.content.get('<type>', '<slug-or-id>', query)` read a content collection: `pages`, `blogs` or a custom content model.

- **`list` returns published records only.** Pass `$preview: true` to include drafts.
- **`get` returns a draft like a published record.** swell-js sends `$preview` with every `content.get()`, and Swell reads any value, `false` included, as a request for drafts. Check the record's `published` before rendering it; the `previewContent` option changes nothing here.
- **A missing record or an unknown type resolves with an empty string**, not `null` and not an error. Test the answer for truth before reading `results` or a field.

## Settings and menus

`await swell.settings.load()` once per client fetches the store's settings, menus, payment methods and subscription settings in one request. After it, `settings.get('<path>', default)`, `settings.menus('<id>')`, `settings.payments()` and `settings.subscriptions()` are synchronous; before it they return promises.

- `settings.get('store')` has the store's `name`, `currency`, `locale`, `country`, `url` and support contacts.
- `settings.menus()` without an id does not return the menus. Read them all with `swell.get('/settings/menus')`.

## Locale and currency

- `swell.locale.list()` and `swell.currency.list()` answer with the store's languages and currencies, and with an empty array for a store that has only one.
- `await swell.locale.select(code)` and `await swell.currency.select(code)` save the choice in the session and its cookie. Later reads answer in that language and with prices converted at the store's rate, and the cart takes the choice with it to checkout and to order emails. The code is not checked: offer only codes from `list()`.
- `swell.currency.selected()` and `swell.currency.format(amount, { code, locale, decimals })` are synchronous. Format every price with `format()` after `settings.load()`; without options it uses the session's currency.
