# Cart and Checkout

The cart belongs to the session: there is no cart id to keep. Each write is validated when it is made; `swell.cart.submitOrder()` adds the completeness checks, takes the payment and turns the cart into an order. Collecting a payment method is in `payments.md`.

## How failures arrive

Wrap every cart call in `try`/`catch`, and also test the answer of an item call for `errors`.

- **Checkout calls reject.** `cart.update`, `applyCoupon`, `removeCoupon`, `applyGiftcard`, `removeGiftcard`, `getShippingRates`, `submitOrder` and `getOrder` never resolve with `errors`. They throw an `Error` with `status`, `code`, `param` and `message`.
- **Item calls do both.** `addItem`, `updateItem` and `setItems` resolve with `{ errors }` in place of the cart when Swell refuses the line itself: the selection (`catalog.md`, "Resolving a selection") or the purchase option. They reject for a product or item id that does not exist and for a field they do not accept. Either way the cart is unchanged.

| `err.code` | When |
| --- | --- |
| `permission_error` | A field the call does not accept, named in `param`. Also a `password` for an account that already has one. |
| `invalid_request` | `submitOrder()` on an incomplete cart, without `param`: `Billing information is incomplete`, then `Please select a shipping service` or `Shipping service <id> is not available for this cart`. |
| `invalid_coupon_code`, `invalid_giftcard_code` | Any failure of `applyCoupon()` or `applyGiftcard()`, with one fixed message. The reason (expired, used up, conditions not met) is not given. |
| `validation_error` | The rest. `param` is the field: `account.email`, `shipping.country`, `coupon_code`, `billing.method` for a refused payment, `cart` for an item that can no longer be bought. |
| `not_found_error` | Status 404: an unknown product, cart item or `checkout_id`. |

One rejection carries one error: when several fields fail, only the last is reported. Branch on `code` and `param`; the message is needed only to tell the `invalid_request` cases of `submitOrder()` apart. In a server action an uncaught rejection becomes an error page, so catch there too.

## The cart

`swell.cart.get()` resolves with the cart, with `null` before the first item, and with an empty value again once the cart has become an order.

- `addItem({ product_id, quantity, options, variant_id, purchase_option, metadata })`. The same product with the same options and purchase option raises the quantity of the line already there.
- `updateItem(itemId, changes)` and `removeItem(itemId)` take the line's `id` from `cart.items`, not the product id. `setItems(items)` replaces every line; `setItems([])` leaves an empty cart.
- **A subscription needs `purchase_option: { type: 'subscription', plan_id }`.** Without `plan_id` the first plan is used. Without `purchase_option`, a product sold only by subscription is still added, as a line with no purchase option. A type the product does not sell resolves with `errors['items.purchase_option']`, an unknown plan with `errors['items.purchase_option.plan_id']`.
- **Stock is not checked when a line is added.** A quantity above the stock is accepted; the refusal comes from `submitOrder()`.
- **Promotions apply by themselves.** Read them from `cart.promotions.results`, and the amounts from `cart.discounts`.
- `applyCoupon(code)` sets the cart's one coupon and `removeCoupon()` clears it. The code is tried as a gift card first, with letters uppercased and other characters removed, so one "promo code" field serves both; a gift card entered there lands in `cart.giftcards`.
- `applyGiftcard(code)` adds a card, and a cart takes several. `removeGiftcard(id)` takes the entry's `id` from `cart.giftcards`, or its code.

**Metadata.** `metadata` on the cart and on each item is free-form and readable by whoever holds the session. A write merges into it: objects key by key, arrays position by position. Replace an array with `metadata: { tags: { $set: [...] } }`. A `$set` at the top of the body is ignored.

## The checkout sequence

```js
// 1. Who is buying: the email alone
let cart = await swell.cart.update({ account: { email } });

// 2. Where to (country is a two-letter code)
cart = await swell.cart.update({
  shipping: { name, address1, address2, city, state, zip, country, phone },
});

// 3. How it ships
const rating = await swell.cart.getShippingRates();
if (!rating?.services?.length) { /* nothing ships to this address */ }
cart = await swell.cart.update({ shipping: { service: rating.services[0].id } });

// 4. Discounts, before payment
cart = await swell.cart.applyCoupon(code);

// 5. Payment: payments.md. An element writes billing itself; a token is written by hand
cart = await swell.cart.update({
  billing: { name, address1, city, state, zip, country, card: { token } },
});

// 6. Submit
const order = await swell.cart.submitOrder();
```

Every call resolves with the whole cart, except `getShippingRates()`, which resolves with the rating, and `submitOrder()`, with the order. Shipping and billing can go in one `cart.update`.

**What `cart.update` accepts**: `account.email`, `account.email_optin`, `account.sms_optin`, `account.password`, `shipping`, `billing`, `coupon_code`, `comments`, `metadata`, `items`, `location`, `shipment_rating` and `$taxes`. Anything else is refused with `permission_error`: `account.first_name`, a top-level `email`, any total. Swell takes the customer's name from the address `name`.

**Step 1: the email first, alone.** The cart attaches to the account with that email, or to a new one, and `account_logged_in` on the answer says which case this is ("Guest and logged in"). A `password` sent for an account that has one is refused. Sent in the same call as a new email, it is saved without logging the shopper in. Sent in a later call, it sets the password of an account that has none and logs the session in.

**Step 3: rates.** `getShippingRates()` resolves with `{ services: [{ id, name, price, description }] }`, and with `null` when the cart has no rating. An address that no service covers gives `services: []`; a rating that failed, on the store's carrier settings or a carrier's API, rejects. `shipping.service` is not checked when it is written: an id that is not in the cart's rating is stored, and `submitOrder()` refuses it.

**Step 4 before step 5.** A card authorization made in step 5 is for the amount due at that moment (`payments.md`). A coupon or another shipping service afterwards leaves it at the old amount.

**Step 6: what submit needs.**

- `billing` must not be empty while `grand_total` is above 0, also when gift cards or account credit cover all of it. The billing address is enough then, and Swell sets the method.
- A cart with items to ship needs a `shipping.service` from its current rating.
- For a manual method, one with `manual: true` in the checkout settings, write `billing: { method: '<id>' }`. The order is created unpaid, with status `payment_pending`.
- A refused payment rejects with `param: 'billing.method'`, and an item that went out of stock with `param: 'cart'` and `<name> is not currently available`. The cart stays as it was.
- A second `submitOrder()` on the session resolves with the order already created.

## Guest and logged in

| `account_logged_in` | Meaning |
| --- | --- |
| `true` | The session is logged in. `cart.account` carries the customer's `addresses` and `cards`. |
| `false` | The email belongs to an account with a password and nobody is logged in. Offer `swell.account.login()`, or let the order go through as it is. |
| not set | The account has no password: a guest checkout. |

Do not branch on `cart.guest`: it is `true` in both of the last two cases. A cart that is not logged in shows only the account's name and email.

## What is left to pay

- **`capture_total` is the amount due now**: `grand_total` less gift cards and account credit. `grand_total` subtracts neither.
- **`giftcard_total` and `giftcards[].amount` are the cards' balances**, not the part this cart uses: a card of 100 on a cart of 20 reads 100. Show `capture_total`, not a subtraction of your own.
- **Swell applies account credit itself** when the customer is logged in, the store has the `account` payment method and its order settings apply credit automatically. `account_credit_amount` is the credit this cart uses. It is set by the next `cart.update`, not on the read that follows a login, and it cannot be written.
- **Do not show credit from the account.** `balance` on `cart.account` and from `account.get()` reads `0` whatever the customer has. The submitted order's `account.balance` is right.

## Checkout settings

`await swell.cart.getSettings()` answers what the checkout form should offer, so nothing is hardcoded:

- `payment_methods`: the enabled methods, each `{ id, name, gateway, mode, manual }`.
- `accounts`: `optional`, `required` or `disabled`, the store's rule for logging in at checkout.
- `fields`: a display mode per form field, by default `{ name: 'last', company: 'optional', phone: 'optional', address2: 'optional', note: 'hidden' }`. Render each field in its mode and leave out a `hidden` one.
- `countries`: the countries the store's shipping zones cover, empty when it has none. `currencies` and `locales` are empty for a store with one of each.
- `coupons` and `giftcards`: whether the store has any, to show or hide the code field.
- `email_optin`, `sms_optin`, `taxes`, and the store's `name`, `currency` and `support_email`.

## After submit

`submitOrder()` resolves with the order: its public fields, with `account`, `coupon`, `promotions`, `items.product` and `items.variant` expanded. An order paid in full has `paid: true`; one waiting for a manual payment has `status: 'payment_pending'`.

- **The order has no `checkout_id`.** It is a cart field. Read `cart.checkout_id` before submitting if the confirmation page is addressed by it.
- **The cart is gone.** `cart.get()` is empty, and the next `addItem()` opens a new cart.
- `swell.cart.getOrder(checkout_id)` reads the order of that cart. **Anyone who has the id reads the order**, with the customer's email and addresses, logged in or not: it is a link that cannot be guessed, not a permission.
- `swell.cart.getOrder()` without an argument reads the session's last order. It needs the session token that the submit answered with (`clients-sessions.md`).
- **`getOrder()` never resolves empty.** It rejects with status 400 and `param: 'checkout_id'` when there is no id, and with status 404 for an unknown id (`Cart not found`) and for a cart that has not become an order (`Order not found`).

A logged-in customer's order history is `swell.account.listOrders()` and `swell.account.getOrder(id)`, which reject when nobody is logged in.

## Hosted checkout

Every cart with items carries a `checkout_url`. By default it is the address of Swell's hosted checkout for that cart, and sending the shopper there replaces steps 1 to 6. When the store's checkout settings name a custom checkout, the address is built from the merchant's own URL, which may be the storefront being built: do not redirect to it from that storefront's own checkout. `swell.cart.recover(checkout_id)` attaches an open cart to the session, which is what the link in an abandoned-cart email needs.
