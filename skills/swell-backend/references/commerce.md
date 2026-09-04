# Commerce Lifecycles

The rule that shapes everything here: **statuses are derived**. Write the underlying flags and related records; the platform computes `status`, `paid`, `delivered`, totals, and balances. Verify shapes against `GET /:models/<collection>` for the exact store.

Read-only and immutable fields do not throw. A write to one resolves 200 with `{ errors: { <field>: { code: 'READONLY' | 'IMMUTABLE', ... } } }` and no effect — an import loop that doesn't check `result.errors` reports success while writing nothing. `immutable` only rejects a *change*: setting a field that is currently unset or null is allowed, so these fields accept a value on insert and refuse it forever after.

## Orders

`status` (auto): `pending | draft | payment_pending | delivery_pending | hold | complete | canceled`. The lifecycle booleans behind it are all read-only and all **forced false on a draft**:

- `paid` — `not(draft) AND not(canceled) AND (payment_marked OR (payment_total > 0 AND payment_balance >= 0))`. The field description's "always true when `payment_marked=true`" is wrong: a draft or canceled order is never `paid` regardless of flags.
- `delivered` — `not(draft) AND (delivery_marked OR (item_quantity_delivered > 0 AND item_quantity_deliverable <= 0))`.
- `refunded` — `not(draft) AND (refund_marked OR (refund_total > 0 AND refund_total >= payment_total))`.

`payment_balance` is `payment_total - refund_total - grand_total + return_total`: negative = customer owes, positive = refund due, zero = settled. Refunds and returns feed back into it, and therefore into `paid`. `hold` and `closed` are writable (`closed` is forced false whenever `paid`).

- Create directly with `account_id` + `items[{ product_id, quantity }]` (plus billing/shipping/coupon_code) — or convert carts by checkout. Draft orders double as editable carts (`draft: true`).
- **Cancel by writing `canceled: true`** (with `cancel_reason`) — there is no `/cancel` endpoint. `DELETE /orders/{id}` is permanent removal, not cancellation. `canceled` is **immutable on orders**: once set it can never be cleared, so cancellation is irreversible (subscriptions differ — their `canceled` flag is mutable and reversible while still active). With stock tracking enabled, order placement and cancellation create stock adjustments automatically.
- **Billing/shipping propagate to the account, but not the way the field descriptions claim.** On a *submitted* (non-draft) order the platform POSTs the address and card as **new** `accounts:addresses` / `accounts:cards` child records. It overwrites `account.billing` / `account.shipping` only when the account has none yet, or when the order sets `billing.default: true` / `shipping.default: true`. Editing `billing` on an order whose account already has a billing object leaves the account untouched — set `default: true` if a rewrite is what you want. `account_info_saved: false` on the order suppresses all of it.
- Item `price` is settable at add time (overrides list/sale price) and never changes afterward unless explicitly edited; `orig_price` preserves the pre-override value. `send_email` and `send_note` are special item **option ids** on gift card products (the platform reads them by id when delivering the card). Subscription line items are configured through `items[].purchase_option` — `{ type: 'standard' | 'subscription' | 'trial', plan_id }`, carrying `billing_schedule` and `order_schedule`. The `subscription_interval` / `subscription_interval_count` / `subscription_trial_days` fields on order items, products, variants, and option values are all marked `deprecated` in the model; new code must not write them.
- Shipping rates: with `shipping.country` set, `shipment_rating` holds available services; write `shipping.service` from `shipment_rating.services[].id` (service name/price follow). Gift cards apply via `giftcards: [{ code }]` and are drawn in order until payment completes.
- Per-item derived counters drive what shipments/returns/invoices may still be created — read them instead of recomputing. There is **no `quantity_shipped`**; the real set on `items[]` is `quantity_delivered` / `quantity_deliverable`, `quantity_shipment_deliverable`, `quantity_giftcard_deliverable`, `quantity_subscription_delivered` / `_deliverable`, `quantity_invoiced` / `_invoiceable`, `quantity_credited` / `_creditable`, `quantity_canceled` / `_cancelable`, `quantity_returned` / `_returnable`, `quantity_restocked`, `quantity_consumed`, `quantity_total`. Most — not all — have an order-level roll-up under an `item_` prefix (`item_quantity_deliverable`, `item_quantity_invoiceable`, `item_quantity_returnable`, `item_quantity_cancelable`, …), and the deliverable/invoiceable roll-ups zero out on a canceled order.

## Payments & Refunds

Payment `status` (auto, condition-derived): `pending | void | error | success | authorized` (from the flags `success`, `authorized`, `void`; `error` populates `error.code`/`error.message`). Payments attach to orders/invoices via `order_id`/`invoice_id`, and **automatically update the parent's payment totals and balance** — never write order payment totals directly.

- Create: `account_id`, `amount` (min 0.01), `method` (`card`, `account` — pays from customer account credit, `amazon`, `paypal`, or a manual method defined in payment settings), plus `card.token` / `account_card_id` / `giftcard_id` as the method requires.
- Authorize-then-capture: create with `authorized: true`, capture later via `PUT /payments/{id}` `{ captured: true }`. Async gateway payments set `async: true` with `success` undefined until resolution (`date_async_update` says when it will be checked).
- Refunds are child records: `POST /payments/{id}/refunds` with `amount` up to the payment's `amount_refundable`; `method` defaults to the original payment method (`reason`, `reason_message` optional). The payment's `amount_refunded` and the order's `refunded` state follow automatically.

## Returns

A return records goods coming back and the credit owed for them. **It moves no money** — issue the refund separately (`POST /payments/{id}/refunds`, above) or apply account credit. Filing the return and stopping there leaves the customer unpaid.

Create against an order. `order_id` is required and immutable, `items` is required, and each item needs at least `product_id` and `quantity` (add `order_item_id` and `variant_id` to bind it to the exact line):

```js
await swell.post('/returns', {
  order_id,
  items: [{ order_item_id, product_id, variant_id, quantity: 1 }],
  reason_code: 'damaged',
});
// → number 'R100001', assigned automatically (unique, auto, immutable)
```

**There is no `status` field on a return.** Progress is two per-item counters plus their sums:

- `items[].quantity_received` — how many of that line physically arrived. `quantity_receivable` is the formula `quantity - quantity_received`; `item_quantity_received` / `item_quantity_receivable` are the return-level sums.
- `items[].quantity_restocked` — how many go back into sellable inventory. `quantity_restockable`, `item_quantity_restocked`, `item_quantity_restockable` mirror it.

**`received` is read-only** — formula `if(and(item_quantity_received > 0, quantity_receivable <= 0), true, false)`. Writing `{ received: true }` yields a `READONLY` entry in `result.errors`. Mark receipt by writing the per-item counts and let the flag flip itself:

```js
await swell.put('/returns/{id}', {
  id: returnId,
  items: [{ id: returnItemId, quantity_received: 1, quantity_restocked: 1 }],
});
```

(`items` deep-merges by element `id` like every array, so this amends one line rather than replacing the list.)

`quantity_restocked` is what actually moves inventory: it propagates to the order item's `quantity_restocked`, and the order's stock recalculation emits a `/products:stock` adjustment with `reason: 'returned'`. Received-but-not-restocked (damaged goods) is the normal case for `quantity_received > quantity_restocked` — do not mirror the two by reflex. Note the order item's `quantity_returned` aggregates each return line's `quantity`, not its `quantity_received`, so an unreceived return already counts as returned on the order. Bundle items count as returned only once every constituent product has come back.

Money on the return is advisory, not charged: `credit_total` is `shipment_total + extra_credit - restock_fee`, where `extra_credit` is goodwill compensation and `restock_fee` is what you keep; `credit_tax` follows `shipment_tax`. Cancel with `{ canceled: true }` — canceled returns drop out of the order's aggregation.

Events: `return.created` / `.updated` / `.deleted`, plus `return.received` when the record first crosses into fully received, and `return.canceled`.

## Invoices

Invoices are generated by subscriptions (`subscription_id`) and, less often, attached to orders (`order_id`); both keys are immutable. `source_model` is a formula resolving to `'orders'` or `'subscriptions'`, so `expand: ['source']` pulls whichever applies without branching. `number` is auto-assigned and immutable.

`status` is read-only and derived, with **its own four-value enum, not the order enum**:

| status | condition |
| --- | --- |
| `pending` | `paid: false`, `closed: false`, `void: null` |
| `paid` | `paid: true` (i.e. `payment_due <= 0`) |
| `unpaid` | `paid: false`, `closed: true` |
| `void` | `void: true` |

(The field's own inline description lists only three and omits `void` — the enum above is what the platform evaluates.)

`paid` is the read-only formula `payment_due <= 0`, and `payment_due` is `grand_total - credit_total - payment_total`, forced to 0 once void. Collect by creating a payment against `invoice_id`; the payment maintains these totals. `payment_total` and `credit_total` are read-only — never write them.

There is **no `canceled` flag on an invoice**. Two different levers, and picking the wrong one is the usual mistake:

- **`closed: true`** — stop trying to collect. Dunning halts and the invoice reads `unpaid`. This is "give up on this one".
- **`void: true`** — the invoice should never have existed. `void` is **immutable**: settable once, never reversible. It also carries a rule that rejects the write with `Cannot void if payment has been applied` when `payment_total > 0` — refund the payment first, or close it instead.

`pastdue`, `date_due`, and `net_days` are declared on the model but **inert** — `pastdue` is read-only with no formula and nothing computes it, and no platform code reads `date_due` or `net_days`. A dunning query on `pastdue: true` returns empty forever and raises no error, so track overdue invoices yourself from `date_created` plus your own terms. Failed collection *does* populate `payment_error`, `payment_retry_count`, `payment_retry_resolve`, and `date_payment_retry`; the retry schedule comes from the store's subscription settings, not from the invoice.

Events declared on the model: `invoice.created` / `.updated` / `.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`.

## Subscriptions

`status` (auto, condition-derived): `pending | draft | complete | paused | active | trial | pastdue | unpaid | canceled` (`paid` is a read-only boolean flag — `not(trial) AND payment_balance >= 0` — not a status). Key semantics:

- **Creating a subscription bills immediately** — `POST /subscriptions` with `account_id` + `product_id` charges the customer's default card on the spot unless `trial_days` / `date_trial_end` is set; a failed charge returns a validation error and creates no invoice. Plan changes (`product_id`/plan updates) prorate by adding a line item charged/credited on the next invoice — disable with `prorated: false`.
- `billing_schedule` (`interval`, `interval_count`, `trial_days`, `limit` cycles) drives invoicing; `order_schedule` separately drives order generation for physical products (subscriptions auto-generate orders when the plan involves physical items). **`date_trial_end` is also the billing anchor** — set it to the 1st of next month to align monthly billing to the 1st, trial or not.
- Pause: `{ paused: true, date_pause_end }` (`null` = indefinite) or schedule with `pause_at_end` / `date_pause_at` / `pause_skip_cycles`.
- **Cancel: `{ canceled: true, cancel_at_end: false }` cancels immediately.** A bare `{ canceled: true }` is *not* reliably immediate — the platform merges the request over the stored record, so a subscription already carrying `cancel_at_end: true` or a stored `cancel_at_schedule` defers instead. Schedule deliberately with `cancel_at_end: true`, `cancel_at_schedule`, or `date_cancel_at`. Cancellation is reversible: writing `{ canceled: false }` un-schedules a pending cancellation on a still-active subscription, or reactivates an already-canceled one (stamping `date_uncanceled` and starting a new billing period). Canceling a `draft` or `complete` subscription is rejected with a validation error on `canceled`. `DELETE` is permanent removal — use cancel.
- Items: `recurring: true` items bill every cycle; non-recurring items bill once on the next invoice and drop off. A **negative item `price` credits** the customer on their next invoice — the idiom for one-off adjustments. `proration: true` marks platform-generated proration items.
- Money fields read differently than they look: `grand_total` is the **next** invoice's total; `invoice_total` is the **last** billed period. Failed payments retry per store subscription settings (`date_payment_retry`), then mark the subscription `unpaid`; expand `invoices`, `pending_invoices`, `payments`, `orders` to audit history.

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

At checkout the platform applies available credit automatically only when **all** of these hold: the order has an `account_id`, `account_logged_in` is not `false`, the `account` payment method is enabled in `/settings/payments/methods`, and `auto_apply_credit` is on in `/settings/orders/features` (or `/settings/subscriptions/features` for subscription orders). Both settings default to on, so a store that has never touched them auto-applies. Override per order with `account_credit_amount`: a positive value caps the amount and bypasses the settings check entirely; `0` or `null` opts out.
