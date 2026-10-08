# Accounts and Subscriptions

The session carries the login (`clients-sessions.md`), so these calls act on whoever is logged in.

## How failures arrive

- **Logged out, every call rejects** with `code: 'UNAUTHORIZED'`, except `account.get()`, which resolves with `null`, and `create`, `login`, `logout` and `recover`.
- **`login()` resolves with `null`** for a wrong email or password. It neither rejects nor returns `errors`.
- **Writes do both.** They resolve with `{ errors: { <field>: { code, message } } }` for a value that fails validation, and reject with `permission_error` for a field they do not accept (`param` names it) and with status 404 for an unknown subscription or product.
- **A missing record resolves with an empty string**, not `null`: `account.getOrder()`, `subscriptions.get()` and `invoices.get()`, for an unknown id and for another customer's record.

## Sign up and log in

```js
const account = await swell.account.login(email, password);
if (!account) { /* wrong email or password */ }
```

- `account.create()` logs the new customer in, and rejects when the session is already logged in.
- **A taken email reads as `errors.email` with `code: 'INVALID'`** and a general message. Do not build "already registered" on it.
- **Without a `password`, `create()` on a session that has a cart resolves with `null`** and nobody is logged in: the account exists and the cart carries it as a guest (`cart-checkout.md`, "Guest and logged in").
- `locale` and `group` are not among the fields `create` and `update` accept.
- `login(email, { password_token })` takes a token a server wrote to the account, once. The key is never camelCased.

**Login and logout change the cart.** A login gives the session's guest cart to the account and leaves the account's older cart behind, unmerged. Without a guest cart, the session takes the account's last open one. A logout keeps the cart and its items and clears the account, `shipping.account_address_id` and `billing.account_card_id`. Promotions are applied again both times, so read the cart again.

## Password recovery

- `account.recover({ email, reset_url })` sends the email and resolves with `{ success: true }`, for an unknown address too. The key replaces `{reset_key}` in `reset_url`, or is added as a last path segment. **On a server `reset_url` is required**: the call rejects without it, where a browser falls back to the page's address. A key lasts 24 hours, and a new request cancels the one before.
- `account.recover({ password, reset_key })` sets the password and resolves with `{ success, account_id, email }`. It rejects for a used, unknown or expired key, and it does not log the customer in: call `login()` with that email next.

## Profile, addresses and orders

- `account.get()` leaves out what is empty, and its `balance` is always `0` (`cart-checkout.md`, "What is left to pay").
- `createAddress()` does not make an address the default. `account.update({ shipping })` sets the default and saves the address to the list too. Saved cards are in `payments.md`.
- `listOrders({ expand })` takes `shipments`, `payments` and `refunds`, with `:n` to cap one (`'payments:5'`). `getOrder(id)`, by id or order number, takes no query and always includes `shipments`.

## Subscriptions

- **Bought through checkout** (`cart-checkout.md`, "The cart"), the record appears a few seconds after `submitOrder()`, with the order in `order_id`. That order is its first payment: there is no invoice yet.
- **`subscriptions.create({ product_id, plan_id })`** charges the account's default card at once. Without one it resolves with `errors.account`.
- **Pause** with `update(id, { paused: true, date_pause_end })`, `null` for no end date. `{ paused: false }` resumes.
- **A new `plan_id` or `product_id` applies at once**, with a credit and a charge for the rest of the period. `plan_name` keeps the old plan's name: find the name by `plan_id` in `subscription.product.purchase_options.subscription.plans`.

**Cancel with both fields, always:**

| Body | Result |
| --- | --- |
| `{ canceled: true, cancel_at_end: false }` | Canceled now. |
| `{ canceled: true, cancel_at_end: true }` | Runs to `date_period_end`: `status` stays `active`, with `canceled: true`. |
| `{ canceled: false, cancel_at_end: false }` | Undoes a scheduled cancel. On a canceled subscription it starts a new period and charges for it. |

A field left out keeps its stored value: `{ canceled: true }` alone may cancel later, `{ cancel_at_end: false }` alone cancels a scheduled one at once, and `{ cancel_at_end: true }` alone cancels nothing.

**Billing history.** A subscription includes `product` and `variant`; `expand` adds `orders`, `invoices` and `payments`, and any other name rejects. `swell.invoices.list({ subscription_id })` reads the customer's invoices, although developers.swell.is does not list it. Show the first order with them.
