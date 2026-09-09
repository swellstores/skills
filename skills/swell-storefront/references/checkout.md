# Checkout Flow

The cart accumulates checkout state across requests (it lives on the session); `swell.cart.submitOrder()` converts it to an order. Every step is validated as it is written, not at submit: field validation runs per write, and writing `billing` for a card method backed by a Stripe payment intent fires a real gateway pre-authorization (voiding any prior authorization first). What submit adds is the completeness check and the capture.

## How checkout failures arrive

**Every call on this page rejects — none of them resolve with `errors`.** `cart.update`, `applyCoupon`, `removeCoupon`, `applyGiftcard`, `removeGiftcard`, `getShippingRates` and `submitOrder` are proxied through the gateway's checkout handler, which throws on any `errors` result, serializes it as HTTP 400 `{ error: { code, message, param } }`, and swell-js rethrows that as `Error{ message, status, code, param }`. Only the cart **item** routes (`addItem`, `updateItem`, `setItems`, `removeItem`) still resolve with `{ errors }`. An `if (result.errors)` branch on the calls below never fires — and inside a Next.js Server Action the unhandled rejection turns a declined card or a bad coupon into a 500 instead of a message. `try`/`catch` each one and branch on `err.code` / `err.param`:

| `err.code` | Raised by |
|---|---|
| `permission_error` | A field outside the cart write allowlist: ``You are not allowed to update `<path>` ``, `param` = that path. `cart.update` accepts only `account.email`, `account.email_optin`, `account.password`, `account.sms_optin`, `billing`, `shipping`, `shipment_rating`, `comments`, `coupon_code`, `location`, `metadata`, `items.*` and `$taxes` — `account.first_name` or a top-level `email` is rejected before the platform sees it. |
| `invalid_request` | `submitOrder()` pre-checks, ahead of any validation, with **no `param`**: `Order has already been submitted`, `Billing information is incomplete` (`grand_total > 0` and `billing` empty), `Please select a shipping service`, `Shipping service <name> is not available for this cart` — the last two only when `cart.shipment_delivery` is true, and the selected `shipping.service` must still match an id in `cart.shipment_rating.services`. |
| `invalid_coupon_code` / `invalid_giftcard_code` | *Any* `applyCoupon` / `applyGiftcard` failure. The gateway substitutes fixed text (`Your coupon code was not found or no longer valid`) and `param` `coupon_code` / `code`; the real reason — expired, usage limit reached, conditions unmet — is discarded. |
| `validation_error` | Everything else, gateway declines included. `param` is a model field path: `billing.method` (`Payment authorization failed (...)` on a billing write, `Payment capture failed (...)` at submit), `giftcards.code`, `cart` (an item is no longer purchasable). |

The conversion keeps exactly one error — `Object.keys(errors).pop()`, the **last** key, becomes `param` and its message becomes `err.message`, and every other field error is dropped. Branch on `err.param`, not on message text.

Payment collection itself is browser-only (`createElements`/`tokenize`/`handleRedirect` mount DOM and read `window`), so in an SSR framework only steps 1–5 and 7 below can run server-side — see `references/payments.md` §"Where this code runs" for the split and the session seam between the two clients.

## Canonical sequence

```js
// 1. Items (see SKILL.md Cart section)
await swell.cart.addItem({ product_id, quantity, options, purchase_option });

// 2. Customer identity — accounts attach to carts by email
await swell.cart.update({ account: { email, email_optin? } });

// 3. Shipping address (country is the minimum needed for rating)
await swell.cart.update({ shipping: { name, address1, address2?, city, state, zip, country /* 2-letter ISO */, phone? } });

// 4. Shipping service — resolves cart.shipment_rating: { services[], errors[] }
const rating = await swell.cart.getShippingRates();   // requires shipping.country
if (!rating?.services?.length) {
  // No zone covers this address (common mid-typing) — ask for a different one
  return;
}
await swell.cart.update({ shipping: { service: rating.services[0].id } });

// 5. Discounts — BEFORE tokenization, never after
await swell.cart.applyCoupon(code);       // one per cart
await swell.cart.applyGiftcard(code);     // multiple allowed

// 6. Payment last — see references/payments.md. Elements/tokenize update cart
//    billing automatically; direct tokens are set manually:
await swell.cart.update({ billing: { card: { token } } });   // or method-specific shapes

// 7. Submit
const order = await swell.cart.submitOrder();
```

**Step 2 — write the email by itself first.** `password` is the only other key that reaches the identity logic, and it is conditional: when the email matches an account that **has** a password and the session is not logged in, sending it rejects with `Account must be logged in to update properties (password)` (`param: 'password'`) — the returning-customer case, and the one an agent hits by copying a guest snippet. Write `{ email }` alone, read `account_logged_in` off the returned cart, then decide: unset means a passwordless guest you may upgrade by writing `password`, `false` means prompt for `swell.account.login()`. A brand-new email accepts `password` immediately.

**Step 4 — you never read `rating.errors` yourself.** A non-empty `shipment_rating.errors` array *is* the failed result the gateway throws on, so the call rejects with `code: 'validation_error'`, `message` = the last rating error's message and `param` = its array **index** (`'0'`, `'1'`), not a field path. It fires when shipping settings are incomplete (`Shipment carriers not defined` / `services` / `locations`), an item exceeds a service's package weight, or a real-time carrier API fails. An address with no matching zone is the *other* case: it resolves normally with `services: []` and no errors. `getShippingRates()` also resolves `undefined` when the cart has no rating at all, so optional-chain the result.

**Steps 5/6 — tokenize last.** `swell.payment.tokenize()` mints the Stripe PaymentIntent for `capture_total + auth_total` **as they stand at that moment** (`capture_method: 'manual'`), and the `billing` write it performs immediately after creates a real authorization for `capture_total`. The authorization trigger fires only on writes whose input carries `billing`, so applying or removing a coupon, switching shipping service, or editing a quantity afterwards silently leaves the authorization at the old amount — and a second `billing` write reusing the same intent id is skipped (the platform refuses to authorize an intent that already has a payment), so it cannot repair it. At submit the platform captures the **final** amount due against that frozen authorization; if the total went up, capture fails with `Payment capture failed (...)` on `billing.method` and the order is canceled. If anything changes the total after tokenization, call `tokenize()` again to mint a fresh intent.

Billing address fields mirror shipping; pass both in one `cart.update` when identical. `applyCoupon(code)` tries the code as a **gift card first** and only falls back to the coupon field, and it uppercases the code and strips non-alphanumerics — so one "promo code" input can serve both, but a gift card applied that way lands in `cart.giftcards`, not `cart.coupon`. Checkout configuration comes from `swell.cart.getSettings()` — use its `countries` (only codes with shipping zones), `currencies`, `payment_methods`, `fields` (a per-field display-mode map, not a list of optional fields — defaults `{ name: 'last', company: 'optional', phone: 'optional', address2: 'optional', note: 'hidden' }`; render each field in its mode and skip `hidden` ones), and `accounts` policy (whether login is `optional`, `disabled`, or `required`) to drive the UI instead of hardcoding.

## Guest vs. logged-in

Accounts bind to carts by email. `account_logged_in` is the discriminator — three states on the cart:

| `account_logged_in` | Meaning |
| --- | --- |
| `true` | Logged in via `swell.account.login()`; saved addresses/cards become usable. |
| `false` | The email matched a password-protected account that is not logged in — prompt for login, or let them check out as themselves without account access. |
| unset (`undefined`/`null`) | The matched/created account has no password: pure guest checkout; writing `account.password` upgrades it. |

The platform sets `false` only when the attached account actually has a password; a passwordless account leaves the flag unset. Do **not** branch on `guest` — it is a derived roll-up (`if(not(account.password), true, and(defined(account_logged_in), not(account_logged_in)))`) that is true in *both* the passwordless case and the not-logged-in password case, so treating `guest: true` as "no password, skip the login prompt" skips it for real password-protected customers.

## Account credit

The platform applies account credit automatically at payment time, but only when three things hold: the cart has an `account_id` and `account_logged_in` is not `false`, the `account` payment method is enabled, and the `auto_apply_credit` feature is on (Orders settings — Subscriptions settings for a subscription cart). With either setting off, credit is applied only when a caller writes an explicit `account_credit_amount` server-side. Do not render a "credit applied" line from the account balance alone; read it off the cart.

- `cart.grand_total` does **not** subtract `account_credit_amount`. Read the pay-now figure from `cart.capture_total` (`grand_total − giftcard_total − account_credit_amount − trial amount`, floored at 0) — that is the same number swell-js sends to the gateway. Subtracting credit from `grand_total` yourself silently drops gift cards and trial amounts.
- `account_credit_amount` is **not writable** through the Frontend API — the platform computes it (adjust credit server-side via the Backend API or an app function if you need control).
- An order fully covered by credit submits with `billing.method: 'account'` and needs no payment gateway or tokenization step.
- Submit strips applied credit when `account_logged_in` isn't true (`account_credit_applied: false`, `account_credit_amount: 0`), so a not-logged-in cart showing a credit line pays the full amount.

## After submit

`submitOrder()` resolves with the created order, already filtered to the public order fields with `account`, `coupon`, `promotions`, `items.product` and `items.variant` expanded. Two things are not on it:

- **`checkout_id` is a cart field, never an order field** — it does not exist on the orders model at all, so `order.checkout_id` is `undefined` and a `/order/${order.checkout_id}` redirect lands on `/order/undefined`. Read `cart.checkout_id` off the cart **before** submitting if you want that link.
- **The cart is gone.** The session still holds its id, but the gateway fetches the session cart filtered to `order_id: null`, so `cart.get()` resolves `null` after submit and the next `addItem` opens a fresh cart.

Retrieval: `swell.cart.getOrder(checkout_id)` fetches by the public checkout id — the token used in confirmation links (`/order/{checkout_id}`) and abandoned-cart recovery. `swell.cart.getOrder()` with no argument reads `last_checkout_id`, which submit writes into the **session**, so it only works from a client that persisted the `X-Session` token the submit response returned (submit from the browser or a Server Action; a Server Component cannot write the cookie and that id is lost). Either way the order is fetched with account authentication skipped: anyone holding the checkout id reads it, guest or not — an unguessable link, not an authorization.

`getOrder()` never resolves `null`. All three miss cases reject, so use `try`/`catch`, not `if (!order) notFound()`:

- no argument and no session id → `` Missing `checkout_id`, the cart cannot be loaded `` (400, `invalid_request`, `param: 'checkout_id'`)
- unknown id → `Cart not found` (404, `not_found_error`)
- a cart that was never converted → `Order not found` (404)

The logged-in customer's history is `swell.account.listOrders()` / `swell.account.getOrder(id)` — keyed by order id, account-scoped, and rejecting with `UNAUTHORIZED` when logged out.

## Hosted checkout alternative

Every cart also carries a `checkout_url`, set automatically once the cart has `items`, `shipping`, or `billing` details. It is `https://{storefront-domain}/checkout/{checkout_id}` served by Swell's hosted checkout **only by default**: when Checkout settings have `custom_checkout` enabled with a `custom_checkout_url`, the URL is built from the merchant's own template (`{checkout_id}` placeholder, else appended as a path segment), falling back to the external storefront's `custom_url`; the field can also be written explicitly per cart. Check `settings/checkout.custom_checkout` before treating the redirect as a replacement for steps 2–7 — with custom checkout on it points back at the storefront you are building. Abandoned-cart emails use the same URL via `checkout_id`.
