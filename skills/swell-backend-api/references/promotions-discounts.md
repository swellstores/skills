# Coupons, promotions, gift cards and purchase links

Coupons and promotions share one rule shape and differ in how they reach a cart or an order. A gift card is stored value: it pays, and it does not reduce a total. Field shapes are in `GET /:models/coupons`, `/:models/promotions`, `/:models/giftcards` and `/:models/purchaselinks`.

## Coupons and promotions

|  | Coupons | Promotions |
| --- | --- | --- |
| Attached by | `coupon_code` on the cart or order, one at a time | `promotion_ids`, several |
| Applied when | a valid code is written | the write asks for it (below) |
| Codes | the child collection `/coupons:codes` | none |
| Date window | `date_valid`, `date_expired` | `date_start`, `date_end` |
| Use ledger | `/coupons:uses` | `/promotions:uses` |

**`active` defaults to `false` on both**, whatever the dates say: a coupon inside its dates with `active: false` is refused.

A rule is an entry of `discounts`, such as `{ type: 'total', value_type: 'percent', value_percent: 10 }`. The other types (`shipment`, `product`, `category`, `buy_get`), the conditions of a rule and the use limits are in the model.

## Applying to a cart or an order

`PUT /carts/<id>` with:

```js
{ coupon_code: 'SUMMER10', $promotions: true }
```

- **Promotions are not applied unless the write asks.** They are evaluated only when the body carries `$promotions: true` or sets `promotion_ids`. A storefront cart has them because the Frontend API sends the flag with every cart change. A cart or an order created through the Backend API has none without it.
- **A cart keeps the discounts it was given.** Each entry of `discounts` holds a copy of its rule. A coupon or a promotion that was changed later, and a promotion that has ended, stay on the cart as they were through every other write. `$promotions: true` evaluates the promotions again, and a coupon is read again when `coupon_code` is written as `null` and then as the code.
- **A code is looked up in upper case with everything but letters and digits removed**, while `/coupons:codes` stores it in upper case only. A stored code with a hyphen or a space can never be applied. Keep codes, and generation patterns, to letters and digits.
- **One coupon per record.** Another code replaces it, and `coupon_code: null` removes it. A refused code is an error on `coupon_code` with code `INVALID`, so the message tells the cases apart: `Not found`, `Coupon not active`, `Coupon not valid` (before `date_valid`), `Coupon expired`, `Coupon use limit reached (N)`, `Coupon code use limit reached (N)`, `Coupon customer use limit reached (N)`, and `Coupon not applicable to customer group` or `segment`.
- **A use is recorded when an order is placed**, not on a cart or a draft order, so the limits count orders. `use_count` on the coupon and on each code follows `/coupons:uses`: read it, never write it.
- **`discount_total` is line items only.** A shipping discount is in `shipment_discount` and is already taken out of `shipment_total`. The total given away is `discount_total + shipment_discount`.

## Bulk coupon codes

For a campaign of single-use codes, set `limit_code_uses: 1` on the coupon and do not loop over `POST /coupons:codes`. `POST /coupons:generations` with:

```js
{
  parent_id: couponId,
  count: 5000,               // at most 10,000
  pattern_type: 'custom',    // or 'default'
  pattern: 'SUMMER{00000}',  // each {…} becomes that many random letters and digits
}
```

- **Generation runs in the background.** The answer has `complete: false`. Poll `GET /coupons:generations/<id>` until `complete` is true or `error` is set, then read the codes with `GET /coupons:codes?gen_id=<id>`.
- **Generated codes record no events.** React to `coupon.generation.completed`.
- **Always send `count`.** Over 10,000 the `POST` is refused with code `MAXVAL`. Left out, the `POST` succeeds with `count: 0` and the run stops with `error: 'Invalid generation count (maximum 10,000)'`. `count` is immutable, so post a new generation.
- **Give the pattern room.** After 25 collisions the run stops with `error: 'Too many duplicate codes in pattern'`.
- **A code is unique across every coupon in the store.** A code another coupon has is refused with `UNIQUE`.
- `multi_codes: true` on the coupon makes the dashboard show its codes as a list. The API does not require it.

## Gift cards

`POST /giftcards` with `{ amount: 50 }` creates a card. Without `code` the platform generates one from the pattern in the store's gift card settings. `code` is stored in upper case without separators, and `code_formatted` has the form to show. It is immutable and has 4 to 20 characters. `date_expired` is filled in only when the store's gift card settings switch expiry on.

**Spending.** Attach cards to a cart or an order as `giftcards: [{ code }]`. Each entry comes back with the card's `id` and its balance as `amount`. An unknown, disabled or expired code is an error on `giftcards.code`.

- **An order that is not a draft charges its gift cards when it is created**, with one payment of `method: 'giftcard'` per card. When the cards cover `grand_total`, `billing.method` becomes `giftcard`.
- A payment can also be posted with `method: 'giftcard'` and `giftcard_id`. It is refused above the card's balance.
- Every charge and refund is a record in `/giftcards:debits`, and `amount_spent` is their sum. The first debit fixes the card's currency.

**Writing `account_id` on a card turns it into account credit.** The whole remaining balance becomes an `/accounts:credits` record for that account, `redeemed` turns true and `balance` reads 0. Nothing undoes it. To let a customer spend a card, leave `account_id` empty and apply the code. To stop a card, write `disabled: true`. `balance`, `amount_spent` and `redeemed` are read-only.

**A gift card item issues its cards when the order becomes paid**, not when it is fulfilled. There is one card per unit, with `order_id` and `order_item_id`, for the price of the chosen value option or else the item's price. The item's options with the ids `send_email` and `send_note` set the recipient and the message. Read the cards with `GET /giftcards?order_id=<id>`.

## Purchase links

A cart template behind an address that can be shared. `POST /purchaselinks` with:

```js
{
  name: 'summer-tee',   // required and unique
  items: [{ product_id, variant_id, quantity: 1, price: 19 }],
  active: true,         // false by default
}
// the answer's id is 8 letters and digits, such as 'a7f3k2m9'
```

- **The address is `https://<store>.swell.store/buy/<id>`**, or the same path on the store's own domain, and `/buy/test/<id>` for a link in the test environment. No key is involved.
- **Every visit creates a new cart** and redirects a browser to its `checkout_url`. A request with `Accept: application/json` gets `{ checkout_url }` instead, which is how a server resolves a link.
- **An item that is no longer valid is left out without an error.** The visitor gets a cart with the rest, and the reason is in the cart's `purchase_links_errors`.
- **A missing or inactive link, and one without items, answers 404** to a JSON request and sends a browser to the store's error page.
- `coupon_id`, `promotion_ids` and `metadata` on the link carry into the cart. `items[].price` replaces the product's price, and `items[].purchase_option` starts a subscription.
- **`id` is not an ObjectID**, so paging by `id` does not follow the order of creation. Page by `date_created`.
