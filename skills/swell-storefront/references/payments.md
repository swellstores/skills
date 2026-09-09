# Payments

Payment collection has three tiers. Prefer the highest one the design allows:

1. **Payment elements** — `swell.payment.createElements()` renders gateway-hosted UI (Stripe, Braintree, PayPal) configured by the store; `swell.payment.tokenize()` finalizes it and **updates the cart's billing automatically**.
2. **Direct card tokenization** — `swell.card.createToken()` for custom card forms; you set `billing.card` yourself.
3. **Raw billing shapes** — tokens obtained from a gateway SDK you drive yourself, written via `cart.update({ billing: ... })`.

A cart must exist (fetch or add an item) before rendering a card element.

## Where this code runs

**Every call in this file is browser-only.** `createElements()` calls `stripe.elements()` and mounts into `#<elementId>`; `tokenize()` throws "Stripe payment element is not defined" without that element instance; `handleRedirect()` reads `window.location`. None of them survive a Server Component or Server Action.

So in an SSR framework, split the checkout: read the cart and run `cart.update` / `applyCoupon` / `getShippingRates` server-side (`ssr.md`), and put the payment step in a client component with its own `swell.init(storeId, publicKey)` — the public key has to reach the browser (`NEXT_PUBLIC_*`).

Both clients must land on **one** session, and the seam is the `swell-session` cookie:

- The cookie lives on **your** domain, not Swell's, so the browser never sends it to `{store}.swell.store` on its own. swell-js reads it with `document.cookie` and replays it as the `X-Session` header. Setting it `httpOnly` blocks that read; the gateway then sees no `X-Session`, mints a brand-new empty session, and the element renders against a different, empty cart with no error anywhere. Match swell-js's own cookie defaults: `path=/`, `max-age=604800`, `samesite=lax`, no `httpOnly`.
- `tokenize()` writes billing from the browser, so the server's last render is stale by the time it succeeds. Submit from the element's `onSuccess`, or re-read the cart server-side first.

`swell.card.createToken()` is the one that will not stop you: it is a plain `fetch` to the vault with no browser guard, so it runs happily in a Server Action — and puts raw card numbers in your server's request path and PCI scope. Keep it in the browser.

## Failure delivery

Payments do **not** share one error convention — delivery differs per surface, and assuming `result.errors` is the most common way to lose a decline:

| Call | Failure delivery |
|---|---|
| `swell.card.createToken()` | **rejects** — `Error{ message, code, status: 402, param }` |
| `payment.createElements()` / `payment.tokenize()` | resolve `undefined`; failures go to the per-method `onError` (no handler → `console.error`, never thrown) |
| `payment.authenticate()` | resolves `{ error }` — never rejects |
| `cart.update({ billing })` | **rejects** — `Error{ status: 400, code: 'validation_error', param: 'billing.method', message }` |
| `cart.submitOrder()` | **rejects** — `Error{ status: 400, code: 'validation_error' \| 'invalid_request', param, message }`; `param` is a model field path |
| `account.createCard()` | resolves with `errors.gateway` (the vault tokenizer's key) |

Neither cart call resolves with `errors`. The storefront gateway converts the platform's validation result into a thrown `ValidationError` on `PUT /cart` and `POST /cart/order`, serializes it as HTTP 400 `{ error: { code, message, param } }`, and swell-js rethrows that as a rejected `Error`. swell-js's own `if (result.errors)` guards inside `cart.update()` and `cart.submitOrder()` are dead code — `try`/`catch` both. Only the item routes (`addItem`, `updateItem`, `setItems`, `removeItem`) and `account.createCard()` still resolve with `errors`.

The conversion keeps exactly **one** error: `Object.keys(errors).pop()` — the *last* key — becomes `param`, that error's `message` becomes the message, every other field error is discarded. Keys are model field paths, never payment-method names — `billing.method`, `giftcards.code`, `giftcards.currency`, `account_credit_amount`, `cart` (an item is no longer available), or any other field the write touched. Submit's own pre-checks reject earlier with `code: 'invalid_request'` and **no** `param` — "Order has already been submitted", "Billing information is incomplete", "Please select a shipping service", "Shipping service … is not available for this cart" — so read `err.code` before `err.param`. Writing a billing field outside the gateway's allowlist rejects sooner still, with `code: 'permission_error'` and `param` set to the path.

`cart.update({ billing })` fires a real gateway pre-authorization only on one narrow path: `capture_total > 0`, `billing.method: 'card'`, a Stripe gateway, `billing.intent.stripe.id` set, and no payment yet recorded against that intent. It voids any prior `authorized_payment_id` first, and a decline arrives as `param: 'billing.method'`. Because `tokenize()` writes exactly that billing shape itself, the decline normally surfaces through the card element's `onError` rather than from a `cart.update` you wrote.

## Elements

```js
await swell.payment.createElements({
  card: {
    elementId: 'card-element',        // default
    options: { /* passed straight to the gateway's JS SDK */ },
    onChange, onReady, onError, onSuccess,
    // or separate fields:
    // separateElements: true, cardNumber: { elementId }, cardExpiry: {...}, cardCvc: {...}
  },
  ideal: { elementId: 'idealBank-element' },
  paypal: {
    elementId: 'paypal-button',
    style: { layout, color, shape, label, tagline },
    onSuccess: () => swell.cart.submitOrder(),   // PayPal authorizes in its own flow
    onError,
  },
  apple:  { elementId: 'applepay-button',  style: {...}, require: { shipping, name, email, phone } },
  google: { elementId: 'googlepay-button', style: {...}, require: { shipping, email, phone } },
  amazon: { elementId: 'amazonpay-button', locale: 'en_US', placement: 'Checkout',
            style: { color: 'Gold' }, require: { shipping } },
});
```

Apple Pay / Google Pay require Stripe or Braintree enablement in the store's payment settings; when the store's PayPal runs through Braintree, the same `paypal` element config works and Swell loads the Braintree SDK itself. Card elements always need an explicit `tokenize()` before submit; wallet/PayPal buttons complete in their `onSuccess`.

```js
await swell.payment.tokenize({ card: { onError, onSuccess } });
// resolves undefined — never bind the result and never test `result.errors`
// success/failure arrive ONLY through the per-method onSuccess/onError; on card
// success the cart's billing is already updated, so submit the order from onSuccess
```

`createElements()` resolves `undefined` too. Both fan out to per-method instances and route each rejection to that instance's `onError` instead of propagating, so a `try/catch` around either catches nothing but a missing-params error.

`tokenize()` accepts `card`, `ideal`, `klarna`, `bancontact`, `paysafecard` and `amazon` blocks. Redirect-based methods navigate away to authorize and return to a URL the SDK built itself, carrying `?gateway=...&redirect_status=succeeded|canceled`. Finish with `swell.payment.handleRedirect({ <method>: { onSuccess: () => swell.cart.submitOrder(), onError } })` — it reads those params itself, so you do not parse them, and it **returns immediately having done nothing if the URL carries no `gateway` param**. Only `card` (Quickpay), `klarna`, `bancontact`, `paysafecard` and `amazon` implement `handleRedirect`; a block naming a method that does not is silently skipped — no `onSuccess`, no `onError`, no error. Paysafecard ignores `redirect_status` and re-reads its own intent status (`SUCCESS`/`AUTHORIZED` succeed, `CANCELED_CUSTOMER` fails).

**iDEAL has no `handleRedirect`** — calling it with an `ideal` block is a silent no-op. Its `tokenize()` already wrote `billing.method: 'ideal'`, `billing.ideal.token` and `billing.intent.stripe.id` to the cart before handing off to Stripe, so on return verify `redirect_status === 'succeeded'` yourself and call `swell.cart.submitOrder()`.

Saferpay instead finalizes via `swell.payment.updateIntent({ gateway: 'saferpay', intent: { token } })` and manual `cart.update({ billing: { card: {...} } })`. Klarna localizes its payment page from the cart billing country — keep billing and page locale consistent.

Stripe minimum-charge caveat: below the per-currency minimum (e.g. $0.50, £0.30, ¥50), `tokenize()` succeeds and stores the payment method but creates no payment intent — handle tiny totals (often credit- or discount-covered; see `checkout.md` account-credit rules) rather than assuming a charge exists.

3-D Secure: the SDK exposes `swell.payment.authenticate(payment_id)` for gateway authentication challenges, but challenge flows are gateway-configured and not fully documented — verify against the store's gateway configuration in a test environment before relying on a specific SCA behavior. Two mechanics are fixed: it **never rejects** — every internal failure is caught and returned as `{ error }`, so check the resolved object rather than wrapping the call in `try/catch` — and it is implemented **only for Stripe card payments** (it fetches the payment, updates the Stripe intent with `{ id: transaction_id, payment_method: card.token }`, runs `confirmCardPayment`, resolves `{ status }`, and always calls `resetAsyncPayment` afterward). Any other method or gateway resolves `{ error }`.

## Direct card tokenization

This one rejects from swell-js itself rather than from the gateway, so it carries `status: 402` and a card-specific `code`. Without the catch, a declined card becomes an unhandled rejection that takes down the checkout path.

```js
try {
  const res = await swell.card.createToken({
    number: '4242 4242 4242 4242', exp_month: 1, exp_year: 2099, cvc: '321',
    account_id,          // required by some gateways (Braintree) for verification
    billing: { address1, zip },
  });
  // success: { token: 't_...', brand, last4, exp_month, exp_year, cvc_check, zip_check, address_check }
  // this write rejects too, with the gateway's `validation_error` shape — see Failure delivery
  await swell.cart.update({ billing: { method: 'card', card: res } });
} catch (err) {
  // from createToken: { message, status: 402, param, code:
  //   'invalid_card_number' | 'invalid_card_expiry' | 'invalid_card_cvc' | 'invalid_card' | 'vault_error' }
  // from cart.update:  { message, status: 400, param: 'billing.method', code: 'validation_error' }
}
```

Local validation rejects before any network call; a vault/gateway decline arrives as `code: 'vault_error'` carrying only that gateway error's `message` — the check results (`cvc_check`/`zip_check`/`address_check`) are **not** carried on the thrown error. `param` is `number` | `exp_month` | `exp_cvc` (note `exp_cvc`, not `cvc`) or, for a vault error, the first key of the gateway's error object.

Local synchronous validators for form UX: `swell.card.validateNumber(str)`, `validateExpiry(month, year)` (two-digit years are NOT expanded — invalid), `validateCVC(str)`.

Raw billing shapes for externally-obtained tokens: `billing.card: { token }`, `billing.paypal: { order_id }` (direct PayPal/PPCP) or `{ nonce }` (PayPal running through Braintree), `billing.amazon: { checkout_session_id }` (Amazon Pay v2), `billing.affirm: { checkout_token }`.

The model still validates the legacy fields, so a stale shape saves cleanly and only fails later at authorization: `billing.paypal.payer_id` is the explicit trigger that routes to the deprecated PayPal REST-SDK handler, and the direct path throws "Missing PayPal order ID (billing.paypal.order_id)" without `order_id`; `billing.amazon.access_token`/`order_reference_id` is Amazon Pay v1 (MWS), honored only on stores whose amazon method lacks the `v2` flag — a v2 store errors with "Missing Amazon Pay checkout session ID".

## Saved cards (logged-in accounts)

`swell.account.createCard()` stores a tokenized card for reuse — Stripe payment methods (`{ gateway: 'stripe', token: 'pm_...', stripe_customer?, billing }`) or card tokens (`{ gateway: 'stripe', token: 'card_...', stripe_token, stripe_customer /* required if attached to a Stripe customer */ }`), and Braintree (`{ gateway: 'braintree', token, gateway_customer?, billing, $vault: true /* required */ }`). `brand`/`last4`/`exp_*` are filled by the gateway. The default card is `account.billing.account_card_id` — change via `account.update({ billing: { account_card_id } })`; deleting the default is allowed, and a card attached to an active subscription stays attached until the subscription itself is changed. To pay with a saved card at checkout, set `cart.update({ billing: { account_card_id } })`.
