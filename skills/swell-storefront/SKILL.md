---
name: swell-storefront
description: Use this skill for building headless storefront experiences on the Swell e-commerce platform's Frontend API with the `swell-js` library and a store public key. Triggers include swell-js usage or `swell.init('<store-id>', 'pk_...')`; storefront implementation of product listing/detail pages, carts, checkout, payments, customer accounts and login, or subscription purchase/management; Next.js/React/Vue/Svelte e-commerce frontends backed by Swell; requests to `https://<store>.swell.store/api`; `swell-session` cookies or `X-Session` headers; and storefront localization or multi-currency work. Do NOT use for server-side secret-key integrations with swell-node or api.swell.store (use the swell-backend skill) or for building deployable Swell Apps with the `swell` CLI (use the swell-app skill).
allowed-tools: Read, Grep, Glob, Bash
---

# I. What This Covers

The Frontend API is the session-scoped, public-key-safe subset of Swell used by storefronts. `swell-js` is its universal JavaScript client — safe in browsers and on servers. It reads catalog/content/settings, owns the visitor's cart and checkout, and manages the logged-in customer's account and subscriptions. It cannot administer the store: writes are limited to session-owned resources (cart, account, subscriptions) plus custom models that declare public permissions.

Boundaries: server-side integrations with a secret key (imports, automations, order administration) belong to the **swell-backend** skill; deployable store extensions (models, functions, checkout integrations) belong to the **swell-app** skill. This skill frequently pairs with both — e.g. a storefront calling an app's route function.

# II. Client Setup & Request Model

```js
import swell from 'swell-js';
swell.init('<store-id>', '<public_key>', options);
```

Requests hit `https://<store-id>.swell.store/api/*` with `Authorization: Basic base64(public_key)`. Init options (beyond store/key): `useCamelCase` (convert responses to camelCase AND request bodies back to snake_case; default false), `url` (override base), `previewContent`, `session`, `locale`, `currency`, `getCookie`/`setCookie` (server cookie adapters), `headers`, `timeout` (ms, default 20000).

**Sessions are the identity.** There is no cart ID to track: the API returns a token in the `X-Session` response header, swell-js stores it in a `swell-session` cookie and replays it as an `X-Session` request header. `swell.session.get()` decodes the current session (`account_id`, `cart_id`); `swell.session.getCookie()`/`setCookie()` read/restore the raw encoded token for external storage.

**Server-side rule:** `swell.init()` configures a process-wide shared client — concurrent requests would leak one visitor's session into another's. On servers, create a per-request client instead:

```js
const client = swell.create('<store-id>', '<public_key>', { session: sessionToken });
// or bridge your framework's cookies:
const client = swell.create('<store-id>', '<public_key>', {
  getCookie: (name) => req.cookies[name],
  setCookie: (name, value) => res.cookie(name, value),
});
```

Without a session, every server request starts a new (empty-cart) session. `swell.cache` is shared process-wide across clients — clear it between requests if one process serves multiple stores.

**Two error modes.** Cart, account, and payment validation failures **resolve** with an `errors` object on the result (`{ [fieldOrSource]: { code, message } }` — check `result.errors` before treating the call as a success; gateway failures key on `gateway`). Most other failures **reject** with an `Error` carrying `message`, `status`, `code`, `param`. Special cases: `settings.load()` logs and resolves on failure; `products.variation()` throws synchronously.

**Generic requests.** `swell.get/put/post/delete(url, data)` hit any `/api/*` path with the same auth and session — for `get` the second argument is a query object, or a string appended as a path segment (`swell.get('/products', 'blue-shoes')`); on writes a string replaces the body, so use `swell.request(method, url, id, data)` when you need both. This is how storefronts reach app-defined public collections (`/apps/<app_id>/<collection>` paths require the model to declare public permissions — see the swell-app skill).

# III. Reading Data

List methods take `{ limit, page, where, sort, search, expand }` — defaults: limit 15 (max 1000), sort `id desc`. Unrecognized keys fold into `where`. Lists resolve to `{ count, page, limit, results }`; single-record gets resolve to the record or `null` (no error) for missing slugs, empty carts, or logged-out accounts. `expand` accepts an array (`['variants']`) or comma string. Responses are snake_case unless `useCamelCase`.

**Catalog.** `swell.products.list({ category: '<slug-or-id>', search, $filters })` / `swell.products.get('<slug-or-id>')` (get is cached per id). `search` is AND full-text over `id`, `name`, `slug`, `sku`. Local, synchronous helpers: `swell.products.variation(product, { Size: 'M' }, purchaseOption?)` resolves price/sale_price/orig_price/stock_status for chosen options (third argument `'standard'` | `'subscription'` | `{ type, plan }`; throws when the purchase option isn't active — it does not reject); `swell.products.filters(products)` derives faceting filters from a result set (fetch the full relevant set first), applied by passing `$filters: { price: [10, 20], category: [...], <attribute_id>: [...] }` to `list`. `swell.categories` and `swell.attributes` follow the standard list/get shape.

**Settings & navigation.** Call `await swell.settings.load()` once at startup — it fetches settings, menus, payment and subscription settings in one request and makes `settings.get(path, default?)`, `settings.menus(id)`, `settings.payments()`, `settings.subscriptions()` synchronous afterward (before that they return promises — always await them). `settings.menus()` with no id does not return all menus; fetch `swell.get('/settings/menus')` for the full list. `swell.cart.getSettings()` returns checkout settings (enabled countries, currencies, payment methods, account requirement policy, policies text).

**Content.** `swell.content.list('<type>', query)` / `swell.content.get('<type>', '<slug-or-id>', query?)` where type is the content collection (`pages`, `blogs`, custom models). Content responses are never cached by the library — cache in the storefront. Draft preview: init with `previewContent: true`, or pass `$preview: true` in a single `get` query (`content.list` does not send `$preview`).

**Localization & currency.** `swell.locale.list()` / `swell.currency.list()` enumerate enabled options (empty unless multi-language/multi-currency configured). `await swell.locale.select(code)` and `await swell.currency.select(code)` are async: they set a cookie and update the session AND the existing cart, so subsequent reads return localized/converted values. Readers `selected()` and `format(amount, opts?)` are synchronous; display-currency conversion uses a daily-updated rate. Selected locale is saved onto the customer record at account create/update and drives email notifications.

# IV. Cart

```js
await swell.cart.addItem({
  product_id, quantity,
  options: { Size: 'S' },            // or [{ name|id, value }] — both keys accepted
  purchase_option: { type: 'subscription', plan_id },  // or { type: 'standard' }, or { plan: 'monthly' }
});
```

`cart.get()` (null until first item), `updateItem(itemId, changes)`, `removeItem(itemId)`, `setItems(items)` (replaces all; `setItems([])` empties), `applyCoupon(code)` / `removeCoupon()` (one coupon per cart), `applyGiftcard(code)` / `removeGiftcard(cartGiftcardEntryId)` (multiple allowed; remove takes the `cart.giftcards[].id`, not the code), `cart.recover(checkout_id)` (abandoned-cart links). Active promotions apply automatically — inspect `cart.promotions` (a `{ count, results }` set), never apply them manually. Cart mutations are internally serialized by swell-js — no need to queue them yourself, but don't fire them blindly in parallel and assume ordering.

`cart.update({ account, shipping, billing, metadata })` sets checkout state — see `references/checkout.md` for the full flow. Metadata (cart, items, account) is publicly readable and deep-merges on write; arrays merge rather than replace — replace with the `$set` operator, either per-field (`metadata: { my_array: { $set: [...] } }`) or top-level (`$set: { metadata: {...} }`).

# V. Checkout & Payments

The canonical sequence — customer identity → shipping → rates → payment tokenization → `cart.submitOrder()` — plus gateway-specific element/tokenize/redirect flows live in two references:

- **Read `references/checkout.md`** for the order flow: required cart state, guest vs. logged-in semantics, shipping rates, account credit behavior, submit, and post-order retrieval.
- **Read `references/payments.md`** for payment methods: `swell.payment.createElements()` / `tokenize()` per gateway, redirect returns (`handleRedirect`, `updateIntent`), direct `swell.card.createToken()`, and saved cards.

# VI. Customer Accounts

`swell.account.login(email, password)` (or `login(email, { password_token })` — always snake_case, even under `useCamelCase`), `logout()`, `get()` (null when logged out), `create({ email, password?, first_name?, last_name?, email_optin? })` (attaches to the current session), `update(changes)`. Login flips session flags `account_logged_in: true` / `guest: false`; carts track the same flags (an email-matched account with a password but no login shows `account_logged_in: false` — prompt for login).

Password recovery is one dual-mode method: `account.recover({ email, reset_url? })` sends the email (silently succeeds even for unknown addresses; `{reset_key}` substitutes into `reset_url`; keys expire after 24 hours), then `account.recover({ password, reset_key })` performs the reset.

Sub-resources: `listAddresses()` / `createAddress` / `updateAddress` / `deleteAddress`; `listCards()` / `createCard` / `updateCard` / `deleteCard` (tokenized cards only — gateway specifics in `references/payments.md`; the default card is `account.billing.account_card_id`, changed via `account.update({ billing: { account_card_id } })`); `listOrders({ limit, page, expand })` / `getOrder(id)`.

# VII. Subscriptions

Two distinct paths:

- **Purchase through checkout**: add the product to the cart with a `purchase_option` of type `subscription` (see Cart above) and submit normally. This is the storefront-native path.
- **Direct management** (logged-in account): `swell.subscriptions.list()/get(id)/create({ product_id, variant_id?, quantity?, coupon_code?, items? })/update(id, changes)`. Pause with `update(id, { paused: true, date_pause_end })` (`null` = indefinite); cancel with `update(id, { canceled: true })`; swap plan/product via `update(id, { product_id, variant_id? })`. Invoice line items: `addItem(id, item)`, `updateItem(id, itemId, changes)`, `setItems(id, items)`, `removeItem(id, itemId)`.

# VIII. Calling App Functions

`swell.functions.request(method, appId, functionName, data?)` (plus `get/put/post/delete` helpers) invokes an app's HTTP route at `/functions/<app_id>/<name>` with the storefront's key and session. Gateway rules apply (they are the same for any external caller — detailed in the swell-app skill): with an empty body, query params arrive in the function's `req.data`; with a body, query params are dropped. Responses are not camelCased. Use this for storefront features backed by app logic (custom submissions, computed data) instead of exposing privileged operations publicly.
