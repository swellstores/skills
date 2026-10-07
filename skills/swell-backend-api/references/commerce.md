# Commerce Lifecycles

Products, variants, inventory and accounts. Orders, payments, refunds, returns, invoices and subscriptions are in `references/orders-payments.md`. Verify shapes against `GET /:models/<collection>` for the exact store.

Read-only and immutable fields do not throw. A write to one resolves 200 with `{ errors: { <field>: { code: 'READONLY' | 'IMMUTABLE', ... } } }` and no effect — an import loop that doesn't check `result.errors` reports success while writing nothing. `immutable` only rejects a *change*: setting a field that is currently unset or null is allowed, so these fields accept a value on insert and refuse it forever after.

## Products & Variants

**Do not create variants by hand.** Write `options` on the product and the platform generates one variant per combination into `/products:variants` — the cartesian product of the participating options, plus the omit branches described below. An option participates only when it is `variant: true`, `active !== false`, and has at least one entry in `values`:

```js
const product = await swell.post('/products', {
  name: 'Shirt',
  price: 25,
  options: [
    { name: 'Size',  variant: true, values: [{ name: 'S' }, { name: 'M' }] },
    { name: 'Color', variant: true, values: [{ name: 'Red' }, { name: 'Blue' }] },
  ],
});
// → 4 variant records now exist
```

An option with **`required: false` also generates every combination with that option omitted** — a branch added to the matrix, not a factor multiplied into it: the same two 2-value options give 4 combinations when both are required and **6** when Color is not (`S`, `M`, `S, Red`, `S, Blue`, `M, Red`, `M, Blue`). The omit branch applies only to options after the first, and `required` defaults to **false** for any option with `input_type: 'toggle'` — so a toggle inflates the matrix without ever saying so.

Each `options[].values[].id` is auto-assigned an ObjectID; generated variants reference them through `option_value_ids`. To price or SKU a generated variant, read it back and match — never invent ids. Two matching keys, and the obvious one is the trap: **`option_value_ids` is stored sorted**, not in option order, so compare it as a set (`[...ids].sort().join('|')`) and never positionally. The generated `name` is the chosen value names joined with `', '` **in option order** (`'Small, Red'`), which is usually the simpler key to match a source variant on.

```js
const { results } = await swell.get('/products/{id}/variants', {
  id: product.id,
  limit: 1000,
  archived: { $ne: true },
});
for (const v of results) {
  await swell.put('/products:variants/{id}', { id: v.id, sku: skuFor(v.option_value_ids) });
}
```

Generated variants are created **active** — the generator posts `active: true` explicitly. The `active: false` default on the variants model applies only to a variant you POST to `/products:variants` yourself. So a generated catalog is sellable the moment it exists, and the generator always builds the *whole* matrix: a source catalog with a sparse matrix (Size M sold only in Red) goes live selling combinations that never existed. Read the variants back and `PUT { active: false }` on every combination your source did not have. `name` is required on a variant (the generator supplies it). The combination cap is **5,000**, counted *after* the `required: false` branches — exceed it and the write returns `Too many variant combinations (calculated: N, max: 5000)` as an `INVALID` error on `options`, and a brand-new product is rolled back (deleted) rather than left half-built.

Editing `options` regenerates. A combination that disappears is **archived (`archived: true`) only if it carries stock-ledger history or appears on an order** — its stock is zeroed with a `canceled` adjustment and restored with a `returned` adjustment if the combination comes back. A combination with neither is **hard-deleted**, so re-shaping `options` mid-import destroys untouched variant rows outright rather than parking them. Archived variants stay in ordinary list results — the sub-model declares no default filter — so pass `archived: { $ne: true }` on any read that drives pricing or a stock sync. Suppress the generator for a write with `$generate_variants: false` in the body; force regeneration when options did not change with `$generate_variants: true`.

Every `variant: true` option also writes into the store-wide `/attributes` collection as a side effect. The attribute id is the option's `attribute_id` or the **underscored option name** (`Screen Size` → `screen_size`); the option's value names are merged into that record (created with `variant: true, filterable: true, searchable: true`), then written back onto `product.attributes` by a follow-up `PUT /products/{id}` the platform issues itself. Normalize option names before a bulk import — `Color` and `Colour` become two attributes — and expect contention on the same handful of shared attribute records when importing products in parallel.

**`stock_level` is read-only on both products and variants** (as are `stock_level_in_locations` and `stock_locations`). Import inventory as ledger adjustments, not as a field — see Inventory below.

`slug` is unique, required, and auto-derived from `name` when omitted. Two source products with the same name collide on the second insert — pre-compute and deduplicate slugs before a bulk import rather than discovering it 400 records in.

## Inventory

**`stock_tracking` has no default and nothing sets it for you.** An API-created product tracks no stock until you write `stock_tracking: true` on the product record itself. Without it the failure is silent and total: adjustments still post and `stock_level` still computes, but orders never consume stock, carts never block on availability, and `stock_status` never reaches `in_stock`/`out_of_stock`. The store setting `settings/products.features.stock_tracking` (default true) is a red herring — it only decides whether the dashboard renders the inventory panel. Set the per-product flag on every product you import and intend to sync.

Stock is an **adjustment ledger**, children of products: `POST /products:stock` with `parent_id` (product), `quantity` (positive = add, negative = remove), optional `variant_id`, `reason` (`received | returned | canceled | sold | missing | damaged | transfer_remove | transfer_add`, with `location`/`transfer_location` for multi-location moves), `reason_message`, `order_id`. Each adjustment records the computed `level` after application (`prev.level + quantity`). With stock tracking enabled, sales and cancellations write adjustments automatically (`reason: sold` / `canceled`).

**Write options before stock.** The first time a product gains variant options, the platform zeroes that product's own variant-less stock with a `canceled` adjustment (`reason_message: 'Updating stock_level due to variant generation'`) before recomputing from the variants. A two-pass import that stocks a product and then adds options loses that stock silently, with no error.

`DELETE /products:stock/{id}` **is supported** and re-derives the product's and variant's `stock_level`. `PUT` is accepted, but the ledger values — `quantity`, `parent_id`, `variant_id`, `number`, `prev_id`, and `level` (also read-only) — are `immutable`, and an update fires no recalculation at all; only insert and delete do. So a PUT that appears to succeed changes no stock level. Prefer a compensating adjustment over a delete for auditability.

Trap: on products with variants, `product.stock_level` is the **maximum** single variant's stock, not the sum — sum `variants[].stock_level` for true availability totals.

## Accounts, Auth & Credit

Accounts carry child collections `addresses`, `cards`, `credits`. `email` is required and unique; `balance` is read-only and follows the credit ledger.

### Verifying a password

`GET /accounts/:login` with `{ email, password }` returns the full account record on a match and **`null` on a miss** — no error, no 401, no distinction between a wrong password and a nonexistent email, so a truthiness check is the only way to tell. The comparison is bcrypt against the stored hash, and a match stamps `date_last_login`. (This is exactly what the storefront gateway calls behind `swell.account.login`.)

### Passwords on import

`password` is `format: 'password'`, which bcrypt-hashes it on write (cost 6). A value that already matches `$2a$`/`$2b$`/`$2x$`/`$2y$` plus a cost prefix is detected and stored **verbatim, not re-hashed** — a migration from any other bcrypt-based platform can carry hashes across directly and customers keep their passwords. Hashes in any other scheme (argon2, scrypt, PBKDF2, MD5) cannot be imported; those accounts need a reset flow.

### One-time login tokens (SSO handoff)

To log a customer into the storefront from your own system without their password, ask the platform for a token by writing **null**:

```js
const acct = await swell.put('/accounts/{id}', { id, password_token: null });
// → acct.password_token, a fresh 32-character alphanumeric string
```

The storefront then calls `swell.account.login(email, { password_token })`. The gateway looks the account up by that token, establishes the session, and `$unset`s the token — **strictly single use**. Nothing expires it, so treat an unredeemed token as a live credential: mint it at the moment of redirect, never in advance or in bulk. The mint guard reads **the value you send, not the value stored** — so every PUT carrying `password_token: null` mints a fresh token and overwrites any outstanding one, invalidating an unredeemed link and breaking an in-flight redirect. The call is not idempotent: mint exactly once per redirect and never retry it blindly.

### Deleting an account

`DELETE /accounts/{id}` **refuses** while the account has any linked `contacts`, `carts`, `orders`, `invoices`, or `subscriptions`, returning `{ errors: { orders: { message: "Unable to delete account when 'orders' are linked" } } }`. Any customer who ever built a cart is undeletable this way — the plain delete only works on genuinely untouched records.

The override is a `$force_delete: true` body on the DELETE, and it is bigger than it looks: it skips the guard **and** cascades, issuing real deletes for the account's carts, orders, invoices, and subscriptions. That destroys the store's financial history for that customer, irreversibly. Use it for test-data cleanup only. For a real erasure request, anonymize in place instead — overwrite `name`, `first_name`, `last_name`, `phone`, `email`, `notes`, `metadata`, and the `addresses`/`cards` children — remembering `email` is unique and required, so each account needs a distinct placeholder address rather than a shared one.

### Credit

Account credit accrues via `/accounts:credits` records (positive or negative `amount`) and pays orders through payments with `method: 'account'`. Refund-to-credit is a refund with `method: 'account'`.

An order spends the customer's credit by itself when it is created: `references/orders-payments.md` has the rule and the field that overrides it.
