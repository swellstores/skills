# Products, variants and inventory

How a product's variants are generated from its options, and how stock is kept. Merge rules and import flags are in `references/writes.md`, images in `references/files-media.md`, and field shapes in `GET /:models/products`.

## Variants are generated from options

**Do not create variants by hand.** Write `options` on the product and the platform creates one variant per combination in `/products:variants`. `POST /products` with:

```js
{
  name: 'Shirt',
  price: 25,
  options: [
    { name: 'Size', variant: true, values: [{ name: 'S' }, { name: 'M' }] },
    { name: 'Color', variant: true, values: [{ name: 'Red' }, { name: 'Blue' }] },
  ],
}
// 4 variants now exist
```

- **An option takes part** when it has `variant: true`, is not `active: false`, and has at least one value.
- **An option with `required: false` also adds every combination without it.** The same two options give 6 variants when Color is not required: `S`, `M` and the four pairs. This applies to options after the first, and `required` defaults to false for an option with `input_type: 'toggle'`.
- **Generated variants are active, and the whole matrix is generated.** A source catalog that sells M only in Red goes live with combinations that never existed. Read the variants back and `PUT { active: false }` on each one the source lacks. A variant posted to `/products:variants` by hand needs a `name` and defaults to `active: false`.
- **The limit is 5,000 combinations**, counted with the `required: false` branches. Over it the write is refused with an `INVALID` error on `options`, and a new product is not created.

### Matching a generated variant

To set a SKU or a price on a generated variant, read the variants back and match each to its source. The platform assigns an id to every option value (`options[].values[].id`), and a variant lists its own in `option_value_ids`. There are two keys to match on:

- **`name`** is the value names joined with `', '` in option order: `'S, Red'`. It is usually the simpler key.
- **`option_value_ids` is stored sorted**, not in option order. Compare it as a set, never by position.

```js
const { results } = await swell.get(`/products/${product.id}/variants`, {
  limit: 1000,
  archived: { $ne: true },
});
for (const variant of results) {
  await swell.put(`/products:variants/${variant.id}`, { sku: skuFor(variant.name) });
}
```

### Editing options regenerates

When a combination disappears from `options`, its variant goes one of two ways:

- **Archived (`archived: true`)** when it has stock adjustments or appears on an order. Its stock is set to zero with a `canceled` adjustment, and restored with a `returned` adjustment if the combination comes back.
- **Deleted for good** otherwise, with the SKU and prices written on it. If the combination comes back, it is a new variant with a new id.

So set SKUs and prices after the options are final.

**Change options through the `options` field itself:** a merge by id, or `{ options: { $set: [...] } }` with the options and values to keep sent as they were read, ids included. A top-level `$set` on a path inside `options` stores the change and regenerates nothing, and a value added that way gets no id.

Archived variants stay in list results: pass `archived: { $ne: true }` on any read that drives pricing or a stock sync.

### Attributes and slugs

- **Every option that takes part also writes to the store-wide `/attributes` collection.** The attribute's id is the option's `attribute_id`, or its name underscored (`Screen Size` becomes `screen_size`). The option's value names are added to that record and the product's `attributes` are filled in from them. `Color` and `Colour` become two attributes, so normalise option names before an import.
- **`slug` is unique and derived from `name` when it is not sent.** A second product with the same name is refused with code `UNIQUE` on `slug`. Work out distinct slugs before a bulk import.

## Inventory

**A product tracks no stock until `stock_tracking: true` is written on it.** The field has no default. Without it adjustments are still accepted and `stock_level` still changes, but an order takes no stock and `stock_status` stays empty.

**`stock_level` is read-only**, on a product and on a variant. Stock is a ledger of adjustments, `/products:stock`, and a level is the sum of them. `POST /products:stock` with:

```js
{ parent_id: productId, variant_id: variantId, quantity: 10, reason: 'received' }
```

- **`quantity` is the change**, negative to remove. Leave `variant_id` out for a product without variants. The values of `reason` are in `GET /:models/products`, under `fields.stock`. The answer carries `level`, the stock after the adjustment.
- **With tracking on, the platform writes adjustments itself:** `sold` when an order is created and `canceled` when it is canceled, each with the `order_id`.
- **Write options before stock.** When a product first gains variants, the stock it had without them is set to zero by a `canceled` adjustment, with no error.
- **An adjustment cannot be edited.** A `PUT` that changes `quantity` is refused with code `IMMUTABLE`. `DELETE /products:stock/<id>` removes the adjustment and the levels are worked out again. A compensating adjustment keeps the history.
- **On a product with variants, `stock_level` is the highest level among its variants, not the total.** Sum the variants' `stock_level` for what is available.
