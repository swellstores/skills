# Payments

Collecting a payment method for the cart. The cart calls around it, and what `submitOrder()` needs, are in `cart-checkout.md`.

## Which way to collect

Read the store's enabled methods, and the `gateway` of each, from `swell.cart.getSettings()`.

| Way | When |
| --- | --- |
| A payment element: `swell.payment.createElements()`, then `swell.payment.tokenize()` | swell-js has an element for the method on that gateway. It writes the cart's billing itself. |
| Your own card form: `swell.card.createToken()` | The card gateway has no element. You write `billing.card`. |
| A token from the gateway's own SDK | You drive the gateway yourself and write its token into `billing`. |
| Nothing to collect | Gift cards or account credit cover the cart, or the method is a manual one: `cart-checkout.md`, "The checkout sequence". |

**Card elements exist for Stripe, Quickpay and ConvesioPay only.** On any other card gateway `createElements({ card })` renders nothing: Braintree, Authorize.Net, and Swell's `test` gateway, which a new store starts with. Use `card.createToken()` there. The other elements: `paypal` (direct or through Braintree), `apple` and `google` (Stripe, Braintree, Authorize.Net, ConvesioPay), `ideal` and `bancontact` (Stripe), `klarna`, `paysafecard`, `amazon` and `sezzle`.

## Where it runs

- **Elements need a browser.** `createElements()`, `tokenize()` and `handleRedirect()` mount into the page and read `window`; none of them works in a server component, a route handler or a server action.
- **Inside a Swell app, use the scaffold's browser client**, `useSwell()`. It shares the session with the server helper. Do not call `swell.init()` for the payment step.
- **Outside an app, the payment step is a client component with a browser client** (`clients-sessions.md`), and the server's cookie adapter must leave `swell-session` readable by it. With an `HttpOnly` cookie the element is created for a new, empty cart, and nothing reports it.
- **The server's copy of the cart is old once the browser has tokenized.** Submit from the method's `onSuccess`, or read the cart again on the server first.
- **`card.createToken()` runs on a server too**, which puts card numbers through your server. Call it in the browser.

## How failures arrive

| Call | A failure |
| --- | --- |
| `payment.createElements()`, `payment.tokenize()`, `payment.handleRedirect()` | They resolve with `undefined` whatever happened. A method's failure goes to that method's `onError`; without one it is only logged. |
| `payment.authenticate()` | Resolves with `{ error }`. It never rejects. |
| `card.createToken()` | Rejects with `status: 402`. |
| `cart.update({ billing })`, `cart.submitOrder()` | Reject (`cart-checkout.md`). A refused payment has `code: 'validation_error'` and `param: 'billing.method'`. |
| `account.createCard()` | Resolves with `errors.gateway`. |

Never test the answer of `createElements()` or `tokenize()`, and do not expect a `try`/`catch` around them to see a decline: it catches a missing argument and nothing else.

**A method the store has not enabled, or one without an element on the store's gateway, is skipped**: `console.error` gets `<id> payments are disabled` or `Unsupported payment method: <id> (<gateway>)`, nothing renders, and neither `onError` nor `onSuccess` runs. Offer only the methods from `getSettings()`.

## Elements

```js
await swell.payment.createElements({
  card: {
    elementId: 'card-element',                 // the id of an element on the page
    options: { /* passed to the gateway's SDK */ },
    onError: (err) => showMessage(err.message),
    onSuccess: () => swell.cart.submitOrder(),   // the cart's billing is written by now
  },
  paypal: {
    elementId: 'paypal-button',
    onSuccess: () => swell.cart.submitOrder(),   // PayPal authorizes in its own window
    onError,
  },
});

// when the shopper presses Pay
await swell.payment.tokenize({ card: { onError, onSuccess } });
```

- **A card element needs `tokenize()` before the order is submitted.** PayPal and the wallet buttons finish in their own `onSuccess`.
- **Tokenize last.** With Stripe, `tokenize()` creates a payment intent for the amount due at that moment, and the billing write that follows authorizes it. A coupon, a gift card, another shipping service or a quantity changed afterwards leaves the authorization at the old amount, and when the total went up the capture fails at submit. After any change to the total, call `tokenize()` again.
- **A redirect method leaves the page inside `tokenize()`** and comes back to an address swell-js built, with `gateway` and `redirect_status` in the query. Call `swell.payment.handleRedirect({ <method>: { onSuccess, onError } })` when the page loads: it reads the query itself, and returns at once, having done nothing, when the address has no `gateway` parameter.
- **`handleRedirect()` exists for `klarna`, `bancontact`, `paysafecard`, `amazon` and a Quickpay `card`.** A block for any other method is skipped without a callback. iDEAL has no `handleRedirect()`: its `tokenize()` has already written the cart's billing, so on return check `redirect_status === 'succeeded'` in the query yourself and submit.
- **`swell.payment.authenticate(paymentId)`** runs a 3-D Secure challenge for a Stripe card payment and resolves with `{ status }` or `{ error }`. For any other method or gateway it resolves with `{ error }`. Try the store's gateway in its test mode before relying on a challenge flow.

## Your own card form

```js
try {
  const card = await swell.card.createToken({
    number, exp_month, exp_year, cvc,          // exp_year in four digits
    account_id,                                // Braintree needs it
    billing: { address1, zip },
  });
  // card: { token, brand, last4, exp_month, exp_year, cvc_check, zip_check, address_check }
  await swell.cart.update({ billing: { card } });
} catch (err) {
  // createToken: status 402, code 'invalid_card_number' | 'invalid_card_expiry' | 'invalid_card_cvc' | 'vault_error'
  // cart.update: status 400, as in cart-checkout.md
}
```

- **The card is checked locally first**, and a failure rejects before any request: `param` is `number`, `exp_month` or `exp_cvc`. A refusal from the gateway has `code: 'vault_error'` and the gateway's message only.
- **An expiry more than 50 years ahead is invalid**, so a placeholder year such as `2099` fails `validateExpiry()` and `createToken()`. A two-digit year fails too. For a test card use a year a few years ahead.
- **A token is not checked when it is written to the cart.** One the gateway does not know is stored, and `submitOrder()` rejects.
- `swell.card.validateNumber()`, `validateExpiry(month, year)` and `validateCVC()` are synchronous, for the form.

## A token from elsewhere

Write the gateway's token into `billing` under the method's name:

| Method | Body |
| --- | --- |
| Card | `card: { token }` |
| PayPal | `paypal: { order_id }`, or `paypal: { nonce }` when PayPal runs through Braintree |
| Amazon Pay | `amazon: { checkout_session_id }` |
| Affirm | `affirm: { checkout_token }` |
| Stripe iDEAL, Klarna | `method: '<id>'`, `<id>: { token: '<payment method id>' }`, `intent: { stripe: { id } }` |

`paypal: { payer_id, payment_id }` and `amazon: { access_token, order_reference_id }` are the shapes of older integrations. They are stored without an error and fail at authorization on a store set up today.

## Saved cards

A logged-in customer's cards are on `cart.account.cards` and in `swell.account.listCards()`. Pay with one by writing `billing: { account_card_id }`.

`swell.account.createCard()` saves a card that is already tokenized:

| Gateway | Body |
| --- | --- |
| Stripe, a payment method | `{ gateway: 'stripe', token: 'pm_…', stripe_customer, billing }` |
| Stripe, a card token | `{ gateway: 'stripe', token: 'card_…', stripe_token, stripe_customer }` |
| Braintree | `{ gateway: 'braintree', token, gateway_customer, billing, $vault: true }`; `$vault` is required |

The gateway fills `brand`, `last4` and the expiry. The customer's default card is `account.billing.account_card_id`, changed with `account.update({ billing: { account_card_id } })`.
