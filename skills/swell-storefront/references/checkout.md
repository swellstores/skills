# Checkout Flow

The cart accumulates checkout state across requests (it lives on the session); `swell.cart.submitOrder()` converts it to an order. Nothing is validated until submit — every step below resolves with `result.errors` on validation failure, so check it after each mutating call.

## Canonical sequence

```js
// 1. Items (see SKILL.md Cart section)
await swell.cart.addItem({ product_id, quantity, options, purchase_option });

// 2. Customer identity — accounts attach to carts by email
await swell.cart.update({ account: { email, email_optin?, password? } });

// 3. Shipping address (country is the minimum needed for rating)
await swell.cart.update({ shipping: { name, address1, address2?, city, state, zip, country /* 2-letter ISO */, phone? } });

// 4. Shipping service
const rating = await swell.cart.getShippingRates();   // requires shipping.country
await swell.cart.update({ shipping: { service: rating.services[0].id } });

// 5. Payment — see references/payments.md. Elements/tokenize update cart billing
//    automatically; direct tokens are set manually:
await swell.cart.update({ billing: { card: { token } } });   // or method-specific shapes

// 6. Discounts (any time before submit)
await swell.cart.applyCoupon(code);       // one per cart
await swell.cart.applyGiftcard(code);     // multiple allowed

// 7. Submit
const order = await swell.cart.submitOrder();
if (order.errors) { /* surface and stop */ }
```

Billing address fields mirror shipping; pass both in one `cart.update` when identical. Checkout configuration comes from `swell.cart.getSettings()` — use its `countries` (only codes with shipping zones), `currencies`, `payment_methods`, `fields` (which optional checkout fields the store wants), and `accounts` policy (whether login is `optional`, `disabled`, or `required`) to drive the UI instead of hardcoding.

## Guest vs. logged-in

Accounts bind to carts by email. Three states, readable on the cart: `guest: true` — the matched/created account has no password (pure guest checkout; `account.password` in step 2 upgrades it). `account_logged_in: false` — the email belongs to a password-protected account that is not logged in: prompt for login before continuing, or the customer checks out as themselves without account access. `account_logged_in: true` — logged in via `swell.account.login()`; saved addresses/cards become usable.

## Account credit

For logged-in customers with account credit, the platform applies credit automatically at payment time:

- `cart.grand_total` does **not** subtract `account_credit_amount` — credit is deducted when payment is made, so display "credit applied / amount due" yourself from `account_credit_amount` if you show a pay-now figure.
- `account_credit_amount` is **not writable** through the Frontend API — the platform computes it (adjust credit server-side via the Backend API or an app function if you need control).
- An order fully covered by credit submits with `billing.method: 'account'` and needs no payment gateway or tokenization step.

## After submit

`submitOrder()` resolves with the created order. Later retrieval: `swell.cart.getOrder()` returns the last order of the current session; `swell.cart.getOrder(checkout_id)` fetches by the public checkout id — the token used in confirmation links (`/order/{checkout_id}`) and abandoned-cart recovery. The logged-in customer's history is `swell.account.listOrders()` / `getOrder(id)`.

## Hosted checkout alternative

Every cart also carries a `checkout_url` (set automatically once the cart has items or address details) pointing at Swell's hosted checkout. For storefronts that only build catalog + cart, redirecting to `cart.checkout_url` replaces steps 2–7 entirely; abandoned-cart emails use the same mechanism via `checkout_id`.
