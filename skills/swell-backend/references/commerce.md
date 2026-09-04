# Commerce Lifecycles

The rule that shapes everything here: **statuses are derived**. Write the underlying flags and related records; the platform computes `status`, `paid`, `delivered`, totals, and balances. Verify shapes against `GET /:models/<collection>` for the exact store.

## Orders

`status` (auto): `pending | draft | payment_pending | delivery_pending | hold | complete | canceled`. The lifecycle booleans behind it: `paid` (true when `payment_marked`, else derived from the sum of payments), `delivered` (from shipments/giftcards/subscriptions, or `delivery_marked`), `refunded` (from refunds, or `refund_marked`), `hold`, `closed`, `canceled`. `payment_balance` reads negative = customer owes, positive = refund due, zero = settled.

- Create directly with `account_id` + `items[{ product_id, quantity }]` (plus billing/shipping/coupon_code) — or convert carts by checkout. Draft orders double as editable carts (`draft: true`).
- **Cancel by writing `canceled: true`** (with `cancel_reason`) — there is no `/cancel` endpoint. `DELETE /orders/{id}` is permanent removal, not cancellation. With stock tracking enabled, order placement and cancellation create stock adjustments automatically.
- **Billing/shipping writes propagate**: updating an order's `billing` or `shipping` also updates the customer account's corresponding object (they default from the account in the first place). Don't "fix one order" through those objects expecting isolation — pass only what you mean to change.
- Item `price` is settable at add time (overrides list/sale price) and never changes afterward unless explicitly edited; `orig_price` preserves the pre-override value. Special item option ids carry behavior: `subscription_interval` / `subscription_interval_count` / `subscription_trial_days` on subscription products, `send_email` / `send_note` on gift card products.
- Shipping rates: with `shipping.country` set, `shipment_rating` holds available services; write `shipping.service` from `shipment_rating.services[].id` (service name/price follow). Gift cards apply via `giftcards: [{ code }]` and are drawn in order until payment completes.
- Per-item derived counters (`quantity_shipped`... via `item_quantity_deliverable`, `_invoiceable`, `_returnable`, etc.) drive what shipments/returns/invoices may still be created — read them instead of recomputing.

## Payments & Refunds

Payment `status` (auto, condition-derived): `pending | void | error | success | authorized` (from the flags `success`, `authorized`, `void`; `error` populates `error.code`/`error.message`). Payments attach to orders/invoices via `order_id`/`invoice_id`, and **automatically update the parent's payment totals and balance** — never write order payment totals directly.

- Create: `account_id`, `amount` (min 0.01), `method` (`card`, `account` — pays from customer account credit, `amazon`, `paypal`, or a manual method defined in payment settings), plus `card.token` / `account_card_id` / `giftcard_id` as the method requires.
- Authorize-then-capture: create with `authorized: true`, capture later via `PUT /payments/{id}` `{ captured: true }`. Async gateway payments set `async: true` with `success` undefined until resolution (`date_async_update` says when it will be checked).
- Refunds are child records: `POST /payments/{id}/refunds` with `amount` up to the payment's `amount_refundable`; `method` defaults to the original payment method (`reason`, `reason_message` optional). The payment's `amount_refunded` and the order's `refunded` state follow automatically.

## Subscriptions

`status` (auto, condition-derived): `pending | draft | complete | paused | active | trial | pastdue | unpaid | canceled` (`paid` is a boolean flag, not a status). Key semantics:

- **Creating a subscription bills immediately** — `POST /subscriptions` with `account_id` + `product_id` charges the customer's default card on the spot unless `trial_days` / `date_trial_end` is set; a failed charge returns a validation error and creates no invoice. Plan changes (`product_id`/plan updates) prorate by adding a line item charged/credited on the next invoice — disable with `prorated: false`.
- `billing_schedule` (`interval`, `interval_count`, `trial_days`, `limit` cycles) drives invoicing; `order_schedule` separately drives order generation for physical products (subscriptions auto-generate orders when the plan involves physical items). **`date_trial_end` is also the billing anchor** — set it to the 1st of next month to align monthly billing to the 1st, trial or not.
- Pause: `{ paused: true, date_pause_end }` (`null` = indefinite) or schedule with `pause_at_end` / `date_pause_at` / `pause_skip_cycles`. Cancel: `{ canceled: true }` immediately, or `cancel_at_end: true` / `date_cancel_at` to schedule. `DELETE` is permanent removal — use cancel.
- Items: `recurring: true` items bill every cycle; non-recurring items bill once on the next invoice and drop off. A **negative item `price` credits** the customer on their next invoice — the idiom for one-off adjustments. `proration: true` marks platform-generated proration items.
- Money fields read differently than they look: `grand_total` is the **next** invoice's total; `invoice_total` is the **last** billed period. Failed payments retry per store subscription settings (`date_payment_retry`), then mark the subscription `unpaid`; expand `invoices`, `pending_invoices`, `payments`, `orders` to audit history.

## Inventory

Stock is an **append-only adjustment ledger**, children of products: `POST /products:stock` with `parent_id` (product), `quantity` (positive = add, negative = remove), optional `variant_id`, `reason` (`received | returned | canceled | sold | missing | damaged | transfer_remove | transfer_add`, with `location`/`transfer_location` for multi-location moves), `reason_message`, `order_id`. Each adjustment records the computed `level` after application; there are no update/delete endpoints — correct mistakes with a compensating adjustment. With stock tracking enabled, sales and cancellations write adjustments automatically (`reason: sold` / `canceled`).

Trap: on products with variants, `product.stock_level` is the **maximum** single variant's stock, not the sum — sum `variants[].stock_level` for true availability totals.

## Accounts & Credit

Accounts carry child collections `addresses`, `cards`, `credits`. Account credit accrues via `/accounts:credits` records (positive or negative `amount`) and pays orders through payments with `method: 'account'` — at checkout the platform applies available credit automatically for logged-in customers. Refund-to-credit is a refund with `method: 'account'`.
