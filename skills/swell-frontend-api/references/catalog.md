# Catalog & Variants

Storefront product reads are computed per request by the gateway — stock status, per-account pricing and attribute expansion are applied to the response, not stored. Nothing below survives being frozen into a build.

## What you render

- `options[]` — `{ id, name, variant, price, values: [{ id, name, price, color, image, images }] }`. `variant: true` marks an option that defines variants; every other option is an add-on whose selected value's `price` is added to the line.
- `variants` — `{ count, results }`, each `{ id, name, option_value_ids[], price, sale, sale_price, currency, images, purchase_options, stock_level }`. A variant is identified by the **exact set** of `option_value_ids`.
- `purchase_options` — `{ standard: { price, sale, sale_price, orig_price }, subscription: { plans: [{ id, name, price, billing_schedule, ... }] } }`. The platform copies price fields down to the top level at write time by walking `standard` → `subscription` → `trial`, **each active, priced type overwriting the fields it defines**. A product priced under both therefore reports `subscription.plans[0]`'s `price` at top level while keeping `standard`'s `sale_price` (subscription plans carry only `price`). Read `purchase_options`, not the top-level fields, on any product with more than one purchase type.
- **Top-level `sale_price` is not in the default public field set** — `sale` is, `sale_price` is not, so `product.sale_price` comes back `undefined` on the Frontend API. Read `purchase_options.standard.sale_price` (which is what `variation()` does) or add `sale_price` to the public key's `products` field permissions.
- Inactive options, purchase options and plans are filtered out before the response reaches you — render what is present rather than checking `active`.
- `attributes` are always expanded (the gateway forces it). `categories` are populated only when the query scopes or expands them — see Facets.

## `get` expands variants, `list` does not

`swell.products.get(idOrSlug)` always includes variants: the gateway forces the sub-query (limit 1000, active, non-archived) with `currency, name, option_value_ids, price, sale, sale_price, purchase_options, stock_level, images`. Widen that set with `include: { variants: { data: { fields: [...] } } }` — only `fields` merges; url, params and limit are overwritten.

`swell.products.list()` returns no variants unless asked: `expand: ['variants']` (the public variant field set — which does **not** include `sale`/`sale_price`) or `$variants: true` (the same set `get` uses). Both cost a sub-query per product; skip them on a listing page and price from the product record.

**`products.variation()` on a product whose variants were not expanded throws a raw `TypeError`** — it dereferences `product.variants.results` — the moment the selection touches a variant option. It throws synchronously; there is no rejected promise to catch.

## Resolving a selection

```js
const product = await swell.products.get('blue-shoes');       // variants included
const selection = { Size: 'M', Color: 'Blue' };               // or [{ id|name, value }]
const variation = swell.products.variation(product, selection); // local, synchronous
if (!variation.variant_id) { /* incomplete selection — keep add-to-cart disabled */ }
const cart = await swell.cart.addItem({ product_id: product.id, quantity: 1, options: selection });
if (cart.errors) { /* server rejected it — cart state is unchanged, surface the message */ }
```

- Options and values match by `id` **or** `name`, as an object map or an array; every form normalizes to `{ id, value }`.
- `variation()` matches names and values as raw strings; the server lowercases and trims both. `{ Size: 'm' }` therefore resolves no variant locally while `addItem` resolves it fine — normalize casing to the strings in `product.options` before gating a button on `variation.variant_id`.
- Matching is an exact set match over the variant options. A partial or unknown selection matches nothing and `variation()` quietly returns the **parent** product's price, images and stock. A price coming back is not proof a variant resolved — gate on `variation.variant_id`. The server is stricter about the same selection: see below.
- Non-variant option values add their `price` to `price`, `sale_price` and `orig_price`. Never price a configured item from `product.price`.
- `variation.images` is the variant's own images when it has any, otherwise the product's.
- Third argument selects the purchase option: `'standard'`, `'subscription'`, `{ type }`, `{ plan_id }` or `{ plan }`. It **throws synchronously** — `Product purchase option '<type>' not found or not active`, `Subscription purchase plan '<plan>' not found or not active`. Only non-`standard` types throw; a missing or inactive `standard` option falls back silently to the product's own `price`/`sale_price`/`orig_price`, so a try/catch around the default call buys nothing. Plans match on plan **id**, not name; omitting the plan selects `plans[0]`. A variant that lacks the chosen purchase option silently falls back to the parent's pricing.

`options` are validated server-side. Failures resolve as an `errors` object on the response — they are never a thrown request — and the SDK leaves `swell.cart` state untouched when `errors` is present, so branch on the object `addItem`/`updateItem`/`setItems` returns, not on the cart you already hold:

- Unknown option **name** → silently kept on the line and priced at parent. This is the only selection that falls through.
- Known option, unknown **value** → `errors['items.options']`: `Product option value is not available (<value>)`.
- Any variant option matched but no complete variant found — a partial selection, or a combination no variant covers → `errors['items.options']`: `Product variant is not available for selected options`. The lookup is the same exact set match `variation()` does (`option_value_ids` `$all` + `$size`).
- Neither `variant_id` nor `options` on a product that has variant options → `errors['items.variant_id']`: `<name> should be purchased with a variant_id or options`. An unresolvable `variant_id` gives the same key with `Product variant is not available`.

## Stock

`stock_status` resolves in strict precedence: `discontinued` → `preorder` → `backorder` → (`stock_tracking` ? `in_stock` / `out_of_stock` : `null`).

- **`null` means the product does not track stock.** It is always purchasable — render it as available, never as unknown or out of stock.
- The first three states come from the *product*, so every variant of a preorder product reads `preorder`. Per-variant `stock_status` is only computed when the product tracks stock, so on an untracked product `variation.stock_status` is `undefined`. Read `variation.stock_status ?? product.stock_status`.
- `stock_level` on a product with variants is the level of the variant with the **maximum** stock, not the sum — it is not a total and must never be shown as one. After a variant match `variation.stock_level` is that variant's level; with no match it is the product's max-variant number.
- `discontinued`, `stock_preorder` and `stock_backorder` are stripped from responses under the default public field set — they are fetched only to compute `stock_status`. `stock_status`, `stock_level`, `stock_tracking` and `stock_purchasable` are public.
- Stock only blocks a purchase when `stock_tracking` is on and `stock_purchasable` is off; subscription products are never stock-checked. The block surfaces at submit as `errors.order`: `<name> is not currently available`.

## Facets

`swell.products.filters(results)` is local and synchronous, and accepts a list response, an array, or a single product:

| filter | shape |
| --- | --- |
| `price` | `type: 'range'`, `options: [{ value: min }, { value: max }]`, plus `interval`. Bounds are `Math.floor` of the lowest price and `Math.ceil` of the highest, and the filter is **omitted only when those two collide** — that is, when every product shares one whole-number price. A set priced entirely at 10.50 still yields a 10–11 range. Derived from `price` only, ignoring sale prices. |
| `category` | `type: 'select'`, option values are **slugs, not ids**. Absent from the returned array unless the records carry `categories` — not present-but-empty, so branch on presence. |
| one per attribute | `type: 'select'`, `id` = attribute id, options = the values present in the set. |

`filters()` keeps every attribute it finds. For a facet UI use `await swell.products.filterableAttributeFilters(results)` instead — same shapes, but it fetches `attributes.list({ filterable: true })` and keeps only those. (`swell.attributes.list()` returns only visible or filterable attributes, sorted by name.) `products.priceRange()`, `products.categories()` and `products.attributes()` expose the same derivations individually.

Because these derive from the set you passed, they describe that page, not the catalog. Apply selections through `$filters` and let the API do the filtering:

```js
await swell.products.list({
  limit: 24,
  page: 2,
  $filters: { price: [10, 50], category: ['sale'], stock_status: ['in_stock'], size: ['M', 'L'] },
});
```

- `price: [min, max]` matches `price` **or** (`sale: true` and `sale_price`) within range.
- `category` values **OR** together: every value is `+`-prefixed into one set that collapses to a single `category_index.id $in [...]` clause, so adding a second value **widens** the result — it never narrows it. They also match those categories **exactly**; unlike the `categories` query param, descendants are not included. The `+` group as a whole ANDs against any `categories` param passed alongside it.
- `stock_status` (alias `stock`) matches the listed statuses, and also matches untracked products when `in_stock` is listed.
- Every other key is treated as an attribute: `attributes.<id> $in [values]`.

Category facets need `categories` on the records, which arrives only with `category`/`categories` in the query or `expand: ['categories']`. `$filters: { category: [...] }` does **not** count — the gateway derives the expansion from the top-level params only, so a list filtered that way comes back with no `categories` to build the next level from. What lands there is each product's categories **rolled up to top level** — or, when the list is scoped to a category, that category's direct children, which is what a drill-down facet wants.

## Listing performance

- `limit` defaults to 15 and is capped at 1000; above that the request rejects with `Query limit cannot exceed 1000`. Page with `{ limit, page }` and read `count` from the response.
- Storefront GETs are served from a 5-second stale-while-revalidate cache keyed by store, environment, path and query, so identical PLP requests across visitors are cheap. Pass `$cache: false` on a read that must not be stale.
- `category: '<id-or-slug>'` (singular) resolves one category by id **or** slug and scopes to that category alone (`category_index.id = <id>`) — descendants are not included. `categories: [...]` also takes ids or slugs and **does** include every descendant. Either param resolving to nothing returns an empty result set, not the full catalog. Singular `category` additionally applies that category's configured `sorting` unless you pass an explicit `sort`.
- A `fields` param on a storefront read is **discarded** — the gateway overwrites it with the public field allowlist, so you cannot trim a payload that way (widening variant fields through `include` is the one exception, because an include carrying no `url` skips that validation). Narrow by not expanding: no `expand: ['variants']` or `$variants` on a listing, and reserve variant expansion for the PDP, where `get` gives it to you anyway.
