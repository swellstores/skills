# Discounts & Stored Value

Coupons and promotions carry the same `discounts[]` rule shape and the same discount engine; they differ only in how they attach. Gift cards are stored value, not a discount — they pay, they don't reduce totals.

## Coupons vs promotions

|                | Coupons | Promotions |
| --- | --- | --- |
| Attaches via   | `coupon_code` on the cart/order — **one at a time** | `promotion_ids` array — many |
| Applies when   | a valid code is written | the write asks (below) |
| Codes          | `/coupons:codes` child collection; `multi_codes: true` for campaigns | none |
| Date window    | `date_valid` / `date_expired` | `date_start` / `date_end` |
| Limits         | `limit_uses`, `limit_code_uses` (per code), `limit_account_uses`, `limit_subscription_uses` (invoices per subscription), `limit_account_groups`/`_segments` | `limit_uses`, `limit_account_uses`, groups/segments, plus `exclusions[]` (product/category) |
| Use ledger     | `/coupons:uses` | `/promotions:uses` |

**`active` defaults to `false` on both**, and it is independent of the date window — a coupon inside its dates with `active: false` is dead. Rule shape on both: `type` (`total | shipment | product | category | buy_get`), `value_type` (`fixed | percent`), `value_fixed`/`value_percent` (`value` is a deprecated alias for `value_fixed`), plus gates `total_min`, `price_min`, `quantity_min`, `quantity_max`, `discount_max`, `product_id`/`category_id`/`exclude_category_ids`, `purchase_option` (+ `subscription_plan_id`), and `buy_items`/`get_items` for `buy_get`.

## Applying to carts, orders & subscriptions

```js
await swell.put(`/carts/${id}`, { coupon_code: 'SUMMER10', $promotions: true });
```

- **The applied code is uppercased and stripped of every non-alphanumeric character before lookup**, while `/coupons:codes` stores the code with uppercasing only. A stored code containing `-` or a space can therefore never be applied — keep codes and generation patterns alphanumeric.
- One coupon per record. Writing a different code swaps it (removing the old `/coupons:uses` record); writing `coupon_code: null` removes it. Failures land in `errors.coupon_code` as plain messages: `Not found`, `Coupon not active`, `Coupon not valid`, `Coupon expired`, `Coupon use limit reached (N)`, `Coupon code use limit reached (N)`, `Coupon customer use limit reached (N)`, `Coupon not applicable to customer group`/`segment`.
- **Promotions are not automatic on the Backend API.** They are evaluated only when the write body carries `$promotions: true`, sets `promotion_ids` explicitly, or the record already has `promotion_ids` (or the currency changed). The storefront gateway sends `$promotions: true` on every cart mutation, so storefront carts look automatic; a cart or order you build directly gets no promotions unless you send it too. Sending it alongside an explicit `promotion_ids` array unions the two.
- Discounts are stored on the record and recomputed on write — a cart written before a promotion started keeps its old `discounts` until it is written again.
- `discount_total` is **line items only** (`sum(items.discount_total)`). Shipping discounts sit in `shipment_discount` and are already netted inside `shipment_total`. Total value given away = `discount_total + shipment_discount`.

## Bulk coupon codes

Set `multi_codes: true` on the coupon, then hand the job to the generator instead of looping POSTs:

```js
const gen = await swell.post('/coupons:generations', {
  parent_id: couponId,
  count: 5000,               // immutable, max 10,000; omit → 0 → dead run
  pattern_type: 'custom',    // or 'default'
  pattern: 'SUMMER{00000}',  // each {…} → uppercase alphanumerics of that length
});
```

Generation is **asynchronous**. The POST returns immediately with `complete: false`; a background worker writes codes one at a time and finishes by setting `complete: true`, which is what emits `coupon.generation.completed`. Poll `GET /coupons:generations/{id}` for `complete` or a populated `error`, then read the batch with `GET /coupons:codes?gen_id={genId}`. `active_generations` on the coupon links whatever is still incomplete.

- **Generated codes emit no events.** The worker writes each one with `$events: false`, so a webhook or poller watching for code creation sees nothing — watch `coupon.generation.completed`.
- The worker only picks up generations where `complete` is false **and** `error` is null. Re-saving an incomplete one resumes it: it counts existing codes for that `gen_id` and produces only the shortfall, so a stalled run restarts without duplicating. A run that ended in `error` stays parked until the error is cleared.
- Collisions retry silently; the 26th (`codeErrors > 25`) aborts the run with `error: 'Too many duplicate codes in pattern'`. Give a 5,000-code run more entropy than `{000}`.
- **The two count failures land in different places.** `count` is capped by the model, so `count: 20000` fails the POST itself — `errors.count = { message: 'Must not exceed 10000', code: 'MAXVAL' }`, no generation record created, nothing to poll. The runtime `error: 'Invalid generation count (maximum 10,000)'` only ever comes from the other half of that guard: `count` defaults to `0`, and carrying a default waives its `required`, so a POST that omits `count` succeeds and the record parks with that error on the worker's first pass. `count` is immutable either way — repost, don't patch.
- Without an explicit code, `/coupons:codes` auto-assigns five random alphanumerics plus an incrementing counter from 100001.
- **Codes are unique across every coupon in the store**, not per coupon — the lookup takes the last matching code globally.
- `use_count` on the coupon and on each code are maintained from `/coupons:uses` records by internal triggers. Read them; never write them.

## Gift cards

`amount` is required (min 0.01). Omit `code` and the platform generates one from `/settings/giftcards.code_pattern` (default `{XXXX} {XXXX} {XXXX} {XXXX}`) using an unambiguous alphabet — digits `34679` and A–Z without `I`/`O` — retrying up to 10 times on collision. A pattern with no `{…}` segment, or one yielding fewer than 5 characters, fails the create. `code` is stored normalized (uppercase, separators stripped) with the display form in `code_formatted` and `last4` derived from it; it is immutable and 4–20 characters. `date_expired` is filled from gift card settings only when `features.auto_expire` is on (`expire_count`/`expire_interval`, defaults 12 months).

Issue a batch with `$bulk_count` on a single POST:

```js
await swell.post('/giftcards', { $bulk_count: 200, amount: 50, bulk_description: 'Holiday 2026' });
```

`$bulk_count` is 1–1,000 and **includes the card created by the request itself** — 200 yields 200 cards, all sharing one `date_bulk_generated`, which is how you query the batch back out. Above 1,000 throws; split larger runs.

Spending: attach codes to a cart/order as `giftcards: [{ code }]`. Each resolves to `{ id, code, code_formatted, last4, amount }` with `amount` defaulting to the card's balance; an unknown, disabled, or expired code errors as `errors['giftcards.code'] = 'Not found'`, and a card in another currency errors on `giftcards.currency`. When gift cards cover `grand_total`, `billing.method` is set to `giftcard` automatically. Charging happens through a payment with `method: 'giftcard'` and `giftcard_id`; exceeding the card errors `Payment cannot exceed gift card balance`. Every charge, refund, and void posts a `/giftcards:debits` record, and `amount_spent` is recomputed as the sum of debits — that ledger is the audit trail. The **first debit locks the card to that currency**; a later debit in another one is rejected.

**Writing `account_id` does not assign a card to a customer — it liquidates it.** Setting it on a card that does not already have one converts the entire remaining balance into an `/accounts:credits` record for that account and sets `redeemed: true`, after which the `balance` formula (`if(redeemed, 0, amount - amount_spent)`) reads 0. There is no undo. To let a customer spend a card, leave `account_id` null and apply the code. To kill a card, write `disabled: true`. `balance`, `amount_spent`, and `redeemed` are all read-only.

Gift card items issue their own cards when the order becomes **paid**, not on any fulfillment or shipment action — a background task gated on `paid: true` + `giftcard_delivery: true` + `item_quantity_giftcard_deliverable > 0`. It posts **one `/giftcards` record per unit of quantity**, each carrying `order_id`, `order_item_id`, the order `currency`, and an `amount` resolved from a `value` option's price when the product has one, falling back to `item.price`; the item's `send_email` (defaulting to the account email) and `send_note` options ride along, and the items are then marked delivered. Watch for the cards with `GET /giftcards?order_id={id}` — waiting on a fulfillment event never fires.

## Purchase links

A pre-built cart behind a shareable URL — the tool for social/email "buy this now" flows without a storefront page.

```js
const link = await swell.post('/purchaselinks', {
  name: 'summer-tee',     // required, unique
  items: [{ product_id, variant_id, quantity: 1, price: 19 }],
  active: true,           // defaults FALSE — an inactive link only 404s
});
// → link.id === 'a7f3k2m9'
```

- **`id` is an 8-character alphanumeric string, not an ObjectID** (auto, unique, immutable). The `id: { $gt: lastId }` cursor idiom from `querying.md` sorts lexically here, not chronologically — paginate purchase links by `date_created`.
- **`active` defaults to `false`.** Toggling it emits `purchaselink.activated` / `purchaselink.deactivated`.
- The shareable URL is served from the storefront gateway root: `https://{store}.swell.store/buy/{id}`, or your configured storefront domain. No API key is involved — the store resolves from the request host. `/buy/test/{id}` follows the link against the test environment.
- Following it **creates a fresh cart on every visit** and 302s to that cart's `checkout_url`; a link is a template, not a stable cart, so two visitors get independent carts. Send `Accept: application/json` to get `{ checkout_url }` back instead of a redirect — that is how to resolve a link server-side.
- The cart is the link record minus `id`/`name`/`active`/dates, stamped with `purchase_link_ids`. **If an item or promotion fails validation the gateway drops it and retries**, so the visitor gets a partial cart with a 200 — the reasons land in `cart.purchase_links_errors`, never in an error response. Check that array when a link "works" but the cart is short.
- A missing, inactive, or empty-`items` link redirects to `custom_error_url` from `/settings/purchaselinks` (default `https://{host}/404`) and returns 404 to JSON callers, with no reason given. `/settings/purchaselinks` holds only that field and a `domains` link.
- `coupon_id` and `promotion_ids` on the link carry into the cart. `item.price` overrides list price at follow time, and `item.purchase_option` (`{ type: 'standard' | 'subscription' | 'trial', plan_id }`) lets a link start a subscription. `metadata` rides through.
