# Orders, payments and subscriptions

How an order is paid, shipped, returned and refunded, and how subscriptions and their invoices bill. Merge rules and import flags are in `references/writes.md`, what an event carries in `references/events-webhooks.md`, and the events of each model in `GET /:models/<collection>`. Coupons and gift cards are in `references/promotions-discounts.md`, stock in `references/products-inventory.md`, and account credit in `references/accounts.md`.

## State is derived

`status`, `paid`, `delivered`, `refunded`, the totals and the balances are computed by the platform. Code changes them by writing a flag or by creating a related record.

| To make | Write |
| --- | --- |
| An order paid | A payment with the order's `order_id`, or `payment_marked: true` on the order |
| An order delivered | A shipment for its items, or `delivery_marked: true` |
| An order refunded | A refund on its payment, or `refund_marked: true` |
| An order, return or subscription canceled | `canceled: true` on it |
| An invoice paid | A payment with the invoice's `invoice_id` |

- **A write to a computed field is refused whole.** `PUT /orders/<id>` with `{ paid: true }` answers with `errors.paid` of code `READONLY`, and nothing else in that body is written either. How a refused write reaches the code is in `SKILL.md`, "Errors, Rate Limits, Retries".
- **Some fields take a value once.** `canceled` on an order and `void` on a payment or an invoice cannot be changed back: the write is refused with code `IMMUTABLE`. A shipment, a return and a subscription can be restored with `canceled: false`.
- **Branch on the flags, not on `status`.** `status` is a label worked out from the flags, and a store can change the list. `GET /:models/orders` has the store's values and the condition of each under `fields.status.enum`.
- **Nothing checks a payment, a shipment or a return against the order.** A payment above what is owed, a shipment or a return of more units than the order has, and a payment on a canceled order are all accepted, and the counters go negative. Read the order's balance and counters first.

## Orders

`POST /orders` takes `account_id`, `items: [{ product_id, variant_id, quantity }]`, `shipping` and `billing: { method }`.

- **Items are priced from the product.** A `price` sent on an item is kept in place of it.
- **A subscription item** takes `purchase_option: { type: 'subscription', plan_id }`. The subscription record is created a few seconds after the order is paid: see "Subscriptions".

### What creating an order sets off

An order created without `draft: true` is submitted at once, and the platform acts on it in the same request:

- **Stock is taken** for products that track it, whether the order is paid or not.
- **The customer's account credit is spent.** When the customer has a balance and the store has the `account` payment method and the order setting `auto_apply_credit` on, which is the default, the platform pays as much of the order as the balance covers. Send `account_credit_amount: 0` to keep the credit, or a positive number to spend exactly that much: an amount above the balance refuses the order.
- **The billing method is charged for the rest.** A card or another gateway method in `billing` is authorized before the order is stored and captured right after. A failed authorization refuses the order with an error on `billing.method`. A manual method such as cash or a bank transfer creates no payment: record one when the money arrives.
- **The shipping address, `billing` and a card are saved to the account.** `account_info_saved: false` on the order leaves the account as it is.
- **`order.submitted` is recorded and the order emails are sent**, unless the write carries the import flags in `references/writes.md`.

**A draft is an order nothing has acted on.** With `draft: true` none of the above happens and `paid`, `delivered` and `refunded` stay `false`. `PUT { draft: false }` submits it. `order.submitted` is also recorded while an order is still a draft, so a handler reads the order and tests `draft` before acting.

### Paid, delivered, refunded

- **`payment_balance` is what is owed now**: payments, less refunds, less the order's total, plus the value of returns. Negative means the customer owes, positive means the customer is owed.
- **`paid` turns true** when payments cover `grand_total`, or with `payment_marked: true`. **It stays true afterwards.** A later refund, void or return does not clear it, so read `payment_balance` to know whether money is owed in either direction. `paid` is `false` on a canceled order.
- **`payment_marked: true` is for an order paid elsewhere**, such as an imported one. No payment record exists and the balance stays negative.
- **`hold: true` changes `status` and stops nothing.** Payments and shipments are still accepted.

Each item has counters for what can still be done with it, such as `quantity_deliverable` and `quantity_returnable`. The full list is in `GET /:models/orders`.

### Canceling

Cancel with `PUT /orders/<id>` and `{ canceled: true }`.

- **It cannot be undone**, and `DELETE` removes the order for good.
- **It returns the stock of units not yet delivered** and sets `paid` to `false`.
- **It refunds nothing.** Payments stay as they are, and so do shipments and any subscription the order created. Refund the payments and cancel the rest in separate writes.
- **To cancel part of an order**, write the count to the item: `items: [{ id, quantity_canceled: 1 }]`. The totals and the balance are recomputed and the stock comes back. No money moves.

## Shipments

A shipment says which units of an order went out, and is what makes an order `delivered`: `POST /shipments` with `order_id` and `items: [{ order_item_id, product_id, quantity }]`.

- **`order_item_id` is what ties a line to the order**: the `id` of the entry in the order's `items`. A line without it is stored and counts for nothing.
- **Only items with `delivery: 'shipment'` are shipped.** The value comes from the product. Gift card and subscription items are delivered by the platform once the order is paid.
- **`draft: true` prepares a shipment that does not count yet.** `PUT { draft: false }` confirms it.

## Payments

A payment is money taken, or to be taken, for an order or an invoice: `POST /payments` with `order_id` or `invoice_id`, `amount` and `method`.

- **`method` must be one the store has.** `GET /settings/payments` lists them under `methods`, each with its `id`. Any other is refused with `Payment method '<name>' is not enabled`.
- **A manual method, such as cash or a bank transfer, is recorded as successful at once and moves no money.** `account` takes the amount from the customer's account credit and is refused above the balance. `card` charges the store's gateway with `account_card_id` for a saved card or `card: { token }`, and `giftcard` takes the amount from the gift card in `giftcard_id`.
- **A payment fails in one of two ways.** A payment that cannot be attempted is refused like any write, with `errors`, and nothing is stored: a method that is not enabled, a balance that is too low, a card that is not found. A charge the gateway declines is stored with `success: false` and the reason in `error.code` and `error.message`. Check both `errors` and `success`.
- **To authorize now and capture later**, create the payment with `captured: false`. It counts for nothing on the order until `PUT /payments/<id>` with `{ captured: true }`.
- **`void: true` releases a payment that was authorized and not captured.** Money that was captured goes back with a refund, and a payment cannot be voided after one.
- **Some gateway payments settle later.** The payment has `async: true` and no `success` until the gateway answers. Wait for `payment.succeeded` or `payment.failed`.

## Refunds

A refund is a child record of the payment it gives back: `POST /payments/<id>/refunds` with `amount` and `reason`.

- **`amount` defaults to all that is left**, which is the payment's `amount_refundable`. More than that is refused with `Refund cannot exceed payment amount`.
- **`method` defaults to the payment's method.** `method: 'account'` refunds any payment as account credit.
- **A refund records `payment.refund.succeeded`.** `order.refunded` is recorded only when refunds reach the total of payments.

## Returns

A return records goods coming back. **It moves no money**: refund the payment separately. `POST /returns` takes `order_id` and `items: [{ order_item_id, product_id, quantity }]`.

- **`order_item_id` is what ties a line to the order**, as with a shipment.
- **Creating the return counts the units as returned at once**, in the order item's `quantity_returned` and the order's `return_total`. `payment_balance` then shows the refund due.
- **A return has no `status`.** Its progress is two counts per line. `quantity_received` is how many units arrived, and `quantity_restocked` how many went back on sale. Write them by the line's `id`: `PUT /returns/<id>` with `{ items: [{ id: <return item id>, quantity_received: 1, quantity_restocked: 1 }] }`.
- **`quantity_restocked` is what puts stock back.** Goods that arrive damaged are received and not restocked.
- **Everything has arrived when `item_quantity_receivable` is `0`.** `received` is read-only.

## Invoices

An invoice is an amount an account owes. A subscription creates one for each billing period. Code creates one with `account_id` and `items: [{ description, price, quantity }]`, or for an order with `order_id` and `items: [{ id: <order item id>, quantity }]`, where the prices come from the order.

- **Creating an invoice charges nothing.** Collect with `POST /payments` and its `invoice_id`. The invoice is `paid` when `payment_due` reaches `0`.
- **`closed: true` stops collection**, and the invoice reads `unpaid` in place of `pending`. The platform no longer retries it. `closed: false` opens it again.
- **`void: true` withdraws the invoice.** It cannot be undone, and it is refused with `Cannot void if payment has been applied` once a payment exists: refund the payment or close the invoice.
- **Due dates are yours to keep.** The platform does not act on `date_due` or `net_days`, and nothing sets `pastdue`. Find overdue invoices by `status: 'pending'` and your own terms.

## Subscriptions

`POST /subscriptions` takes `account_id`, `product_id` and `plan_id`, one of the product's `purchase_options.subscription.plans`. Without `plan_id` the product's first plan is used. The plan gives `price` and `billing_schedule`.

- **Creating a subscription charges at once.** The platform creates the first invoice and pays it, from the customer's account credit first and then from the billing method: the subscription's own `billing`, or else the account's. When there is nothing to charge, the subscription is refused with `Billing method is not defined` under `errors.account`. When the charge fails, it is refused with the reason under a key that starts with `invoices.payments`. Nothing is kept in either case.
- **A trial puts the first charge off.** Send `date_trial_end`, or use a plan with `trial_days`. No invoice exists until the trial ends, so a customer without a way to pay can start one. The date also sets the day of the month for later periods.
- **`draft: true` creates a subscription that does nothing** until `draft: false`.
- **A subscription for a shipped product creates an order each period in place of an invoice.** The order has the subscription's `subscription_id`, is paid in the same way and is fulfilled like any order.
- **A subscription bought on an order** is created once that order is paid, with `order_id` and `order_item_id`. The order paid its first period, so the first invoice comes with the second.

### Reading one

- **`active` says whether it is running.** `status` adds why: `trial`, `active`, `pastdue` after a failed payment, `unpaid` once the platform has stopped retrying, `paused`, `canceled`, `complete`.
- **`date_period_end` is the next billing date**, and `grand_total` the amount of the next invoice.
- **`invoice_total` and `payment_total` are sums over every invoice and payment so far**, not the last period's.

### Changing one

- **`items` are extra lines.** A line with `recurring: true` is billed every period. Any other line is billed on the next invoice and then removed. A negative `price` is a credit on that invoice.
- **A change of plan, product, variant or price is prorated.** The platform adds two one-time lines for the next invoice: a credit for the unused time and a charge for the remaining time. Send `prorated: false` with the change to skip them.
- **A change to a plan with another interval starts a new period at once**, with a new invoice.

### Pausing and canceling

`PUT /subscriptions/<id>` with `{ canceled: true, cancel_at_end: false }` cancels now, and with `{ canceled: true, cancel_at_end: true }` when the paid period ends.

- **Always send `cancel_at_end` with `canceled`.** The update merges into what is stored, and `cancel_at_end` stays on the record after a cancellation is undone. Without it in the body, a value left by an earlier request decides whether the subscription stops now or later.
- **`canceled` is the intent and `active` the effect.** A cancellation for later sets `canceled: true` and records `subscription.canceled` at once, and `active` stays `true` until the subscription stops. Test `active` before taking away what the customer paid for.
- **Canceling refunds nothing.**
- **`canceled: false` undoes it.** On a subscription that is still running it withdraws the cancellation. On one that has stopped it starts a new period from now and charges for it at once.
- **Pausing has the same two forms**: `paused: true` with `pause_at_end: false` stops it now, and with `pause_at_end: true` when the paid period ends. `paused: false` resumes it, and resuming a subscription that has stopped starts a new period and charges for it.

### A renewal that fails

- **The invoice stays `pending` with the reason in `payment_error`**, and the subscription reads `pastdue`. The platform retries on the schedule in the store's subscription settings, and when the retries run out the subscription becomes `unpaid` by default.
- **To collect by hand**, create a payment with the open invoice's `invoice_id`. The subscription's `pending_invoices` link lists them.
