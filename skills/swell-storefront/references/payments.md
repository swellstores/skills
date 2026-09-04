# Payments

Payment collection has three tiers. Prefer the highest one the design allows:

1. **Payment elements** — `swell.payment.createElements()` renders gateway-hosted UI (Stripe, Braintree, PayPal) configured by the store; `swell.payment.tokenize()` finalizes it and **updates the cart's billing automatically**.
2. **Direct card tokenization** — `swell.card.createToken()` for custom card forms; you set `billing.card` yourself.
3. **Raw billing shapes** — tokens obtained from a gateway SDK you drive yourself, written via `cart.update({ billing: ... })`.

A cart must exist (fetch or add an item) before rendering a card element. Payment validation failures follow the resolve-with-`errors` convention, keyed under `gateway`.

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
});
```

Apple Pay / Google Pay require Stripe or Braintree enablement in the store's payment settings; when the store's PayPal runs through Braintree, the same `paypal` element config works and Swell loads the Braintree SDK itself. Card elements always need an explicit `tokenize()` before submit; wallet/PayPal buttons complete in their `onSuccess`.

```js
const result = await swell.payment.tokenize({ card: { onError, onSuccess } });
// then submit the order (or in onSuccess)
```

`tokenize()` accepts `card`, `ideal`, `klarna`, `bancontact`, `paysafecard` blocks. Redirect-based methods (iDEAL, Klarna, Bancontact, Saferpay, Paysafecard) navigate away to authorize; on return, read the URL params (`redirect_status`: `succeeded` / `failed` / for Klarna also `canceled`) and finish with `swell.payment.handleRedirect({ <method>: { onSuccess: () => swell.cart.submitOrder(), onError } })`. Saferpay instead finalizes via `swell.payment.updateIntent({ gateway: 'saferpay', intent: { token } })` and manual `cart.update({ billing: { card: {...} } })`. Klarna localizes its payment page from the cart billing country — keep billing and page locale consistent.

Stripe minimum-charge caveat: below the per-currency minimum (e.g. $0.50, £0.30, ¥50), `tokenize()` succeeds and stores the payment method but creates no payment intent — handle tiny totals (often credit- or discount-covered; see `checkout.md` account-credit rules) rather than assuming a charge exists.

3-D Secure: the SDK exposes `swell.payment.authenticate(payment_id)` for gateway authentication challenges, but challenge flows are gateway-configured and not fully documented — verify against the store's gateway configuration in a test environment before relying on a specific SCA behavior.

## Direct card tokenization

```js
const res = await swell.card.createToken({
  number: '4242 4242 4242 4242', exp_month: 1, exp_year: 2099, cvc: '321',
  account_id,          // required by some gateways (Braintree) for verification
  billing: { address1, zip },
});
// success: { token: 't_...', brand, last4, exp_month, exp_year, cvc_check, zip_check, address_check }
// failure: { errors: { gateway: { code, message, params } } }
await swell.cart.update({ billing: { card: res } });
```

Local synchronous validators for form UX: `swell.card.validateNumber(str)`, `validateExpiry(month, year)` (two-digit years are NOT expanded — invalid), `validateCVC(str)`.

Raw billing shapes for externally-obtained tokens: `billing.card: { token }`, `billing.paypal: { payer_id, payment_id }`, `billing.amazon: { access_token, order_reference_id }`, `billing.affirm: { checkout_token }`.

## Saved cards (logged-in accounts)

`swell.account.createCard()` stores a tokenized card for reuse — Stripe payment methods (`{ gateway: 'stripe', token: 'pm_...', stripe_customer?, billing }`) or card tokens (`{ gateway: 'stripe', token: 'card_...', stripe_token, stripe_customer /* required if attached to a Stripe customer */ }`), and Braintree (`{ gateway: 'braintree', token, gateway_customer?, billing, $vault: true /* required */ }`). `brand`/`last4`/`exp_*` are filled by the gateway. The default card is `account.billing.account_card_id` — change via `account.update({ billing: { account_card_id } })`; deleting the default is allowed, and a card attached to an active subscription stays attached until the subscription itself is changed. To pay with a saved card at checkout, set `cart.update({ billing: { account_card_id } })`.
