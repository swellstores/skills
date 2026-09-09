---
name: swell-storefront
description: Use this skill for building headless storefront experiences on the Swell e-commerce platform's Frontend API with the `swell-js` library and a store public key. Triggers include swell-js usage or `swell.init('<store-id>', 'pk_...')`; storefront implementation of product listing/detail pages, carts, checkout, payments, customer accounts and login, or subscription purchase/management; Next.js/React/Vue/Svelte e-commerce frontends backed by Swell; customer-facing features that read or write store data from the browser (product reviews, wishlists, storefront search) — pair with swell-app when the feature also needs a custom model, hook, or route function; calling an app's route function via `swell.functions`; storefront GraphQL against `/graphql/v2` or the `/playground`; requests to `https://<store>.swell.store/api`; `swell-session` cookies or `X-Session` headers; and storefront localization or multi-currency work. Do NOT use for server-side secret-key integrations with swell-node or api.swell.store (use the swell-backend skill), for building deployable Swell Apps with the `swell` CLI (use the swell-app skill), or for another e-commerce platform's storefront that only mentions Swell in passing.
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

Requests hit `https://<store-id>.swell.store/api/*` with `Authorization: Basic base64(public_key)`. Init options (beyond store/key): `useCamelCase` (convert responses to camelCase AND request bodies back to snake_case; default false), `url` (override base), `previewContent`, `session`, `locale`, `currency`, `getCookie`/`setCookie` (server cookie adapters), `headers`, `timeout` (ms, default 20000 — it only aborts **vault** requests: `swell.card.createToken()` and gateway tokenization. Ordinary `/api/*` calls are issued with no abort signal and no timer, so impose your own deadline if you need one).

**Sessions are the identity.** There is no cart ID to track: the API returns a token in the `X-Session` response header, swell-js stores it in a `swell-session` cookie and replays it as an `X-Session` request header. `await swell.session.get()` is an API round-trip returning the decoded session (`account_id`, `cart_id`, plus `locale`/`currency`), not a local decode; `swell.session.getCookie()`/`setCookie()` are the synchronous local accessors for the raw encoded token.

**Server-side rule:** `swell.init()` configures a process-wide shared client — concurrent requests would leak one visitor's session into another's. On servers, create a per-request client instead:

```js
const client = swell.create('<store-id>', '<public_key>', { session: sessionToken });
// or bridge your framework's cookies:
const client = swell.create('<store-id>', '<public_key>', {
  getCookie: (name) => req.cookies[name],
  setCookie: (name, value) => res.cookie(name, value),
});
```

Without a session, every server request starts a new (empty-cart) session — and swell-js's default cookie accessors are no-ops on the server, so the returned `X-Session` token is silently dropped unless you pass `session` or wire `setCookie` yourself. `swell.create()` also overwrites library-level module globals: `swell.cache` is one object for the whole process, and the vault key/URL behind `swell.card.createToken()` (`card` is a single shared object hung on every client) plus the options `products.variation()` reads always come from the **most recently created** client. In a multi-store or mixed-`useCamelCase` process that is a silent cross-store mix-up.

**Read `references/ssr.md`** for per-request clients, cookie bridging, and the caches that leak across visitors.

**Three failure surfaces.**

1. **Resolve with `errors`.** Cart **item** mutations (`addItem`, `updateItem`, `setItems`, `removeItem`), `account.create`/`update`, the address and card sub-resources, and every `swell.subscriptions` write return **field validation** as a resolved `{ errors: { [fieldOrSource]: { code, message } } }` — a 200 you must inspect (gateway failures key on `gateway`). The checkout-proxied cart calls do the opposite and **reject**: `cart.update`, `removeCoupon`, `removeGiftcard`, `getShippingRates` and `submitOrder` throw `Error{ status: 400, code: 'validation_error', param, message }` built from the **last** error key alone, discarding the others; `applyCoupon`/`applyGiftcard` throw a fixed `invalid_coupon_code` / `invalid_giftcard_code` that never tells you why. One `swell.cart` namespace, two branches — a handler written for either one is wrong on the other.
2. **Reject with an `Error`** carrying `message`, `status`, `code`, `param` — including every logged-out call to an account-scoped endpoint (`code: 'UNAUTHORIZED'`). Two shapes break naive handlers: an HTTP failure whose body isn't JSON rejects with `code: 'connection_error'` and **no `status`**, so an `err.status >= 500` branch misses it entirely; a network failure rejects with the browser's own `TypeError`, which has none of these fields.
3. **Neither.** `settings.load()` logs and resolves on failure; `products.variation()` throws synchronously; `swell.payment.authenticate()` resolves `{ error }` instead of rejecting; and `payment.createElements()` for a method the store has disabled logs to the console, drops that method, and resolves normally — nothing renders and no error reaches your code (see `references/payments.md`).

**Generic requests.** `swell.get/put/post/delete(url, data)` hit any `/api/*` path with the same auth and session — for `get` the second argument is a query object, or a string appended as a path segment (`swell.get('/products', 'blue-shoes')`); on writes a string replaces the body, so use `swell.request(method, url, id, data)` when you need both.

This is how storefronts reach app-defined collections: `/apps/<app_id>/<collection>`. The model must declare `public_permissions` or every verb is refused, and what it declares is exactly what the storefront gets. Public **writes** need an owner — either `scope: 'account'` so records are customer-owned, or no `input` at all and submissions routed through an app route function that checks `req.session?.account_id` (§VIII). App extension fields (`$app.<app_id>.*`) on standard models are not reachable from the Frontend API at all. Read `references/app-data.md` before exposing any app data to a storefront.

Two undocumented query features:

```js
// Attach a related collection in one round trip instead of N+1
await swell.get('/products', {
  limit: 24,
  include: {
    reviews: {
      url: '/apps/<app_id>/reviews',
      params: { product_id: 'id' },      // maps a parent field into the sub-query
      data: { limit: 3, sort: 'date_created desc' },
    },
  },
});

await swell.account.listOrders({ expand: ['shipments:5'] });  // :n caps an expanded set
```

`include` sub-queries are permission-checked in their own right, so they can only reach models that are themselves public. Expanding a field the model doesn't publish rejects with `You can only expand public fields (<field>)`; `limit` above 1000 rejects with `Query limit cannot exceed 1000`. `carts`, `accounts`, and `payments` are blocked on the generic routes entirely — use `swell.cart.*` and `swell.account.*`.

**TypeScript.** `swell-js` ships its own declarations (`types/index.d.ts`, wired through both `types` and `exports`) — never install an `@types/swell-js`. `SwellClient` is the type of a `swell.create()` client; `InitOptions` covers the init options above. Every model interface extends **both** spellings (`interface Cart extends CartSnake, CartCamel`, the camel half generated by `ConvertSnakeToCamelCase`), with every field optional — so both spellings compile whatever `useCamelCase` is set to, and the compiler will not tell you which one the runtime wants or flag a name it doesn't have. `account.login(email, { passwordToken })` type-checks and fails at runtime; only `password_token` is read. The declarations are hand-maintained, so cast rather than redesigning working code around them:

- **Absent entirely:** `swell.cache` and `swell.functions.delete`, both present at runtime.
- **`currency.format`'s second argument is typed required** though it defaults to `{}`, so `format(19.99)` alone won't compile; `card.validateExpiry` is typed for strings only though it coerces with `String()`.
- **`products.get` and `content.get` are typed non-nullable**, but a missing slug resolves `null` (§III) — the optional chain you need is the one the compiler won't ask for.

**GraphQL.** The same Frontend API is also exposed as GraphQL, behind the same store public key and the same `X-Session` handling in both directions:

- `https://<store-id>.swell.store/graphql/v2` — **the current endpoint.**
- `https://<store-id>.swell.store/graphql` and `/graphql/v1` — the **deprecated** first-generation schema. Never use the bare path.
- `https://<store-id>.swell.store/playground` — an interactive playground, wired to v2.

The schema is generated per store from that store's own public models (custom content models included) and cached for an hour; send `Cache-Control: no-cache` to force a rebuild after adding a model. Fields are camelCase, and `$`-prefixed query params become `_`-prefixed arguments (`$filters` → `_filters`, `$preview` → `_preview`). It covers queries for session, cart, account, products, categories, attributes, orders, subscriptions, settings, and content, plus the full mutation set for cart, checkout submission, coupons, gift cards, accounts, addresses, cards, and subscriptions. **It has no shipping-rate query and no payment tokenization** — those reach a separate vault service only `swell-js` speaks, so a GraphQL storefront still loads `swell-js` to check out. It is a proxy over the same REST Frontend API, so choose it for query ergonomics, not for speed.

# III. Reading Data

List methods take `{ limit, page, where, sort, search, expand }` — defaults: limit 15 (max 1000), sort `id desc`. Unrecognized keys fold into `where`. Lists resolve to `{ count, page, limit, results }`; single-record gets resolve to the record or `null` (no error) for missing slugs, empty carts, and `account.get()` when logged out — but the rest of the account-scoped surface **rejects** instead of resolving null (§VI). `expand` accepts an array (`['variants']`) or comma string. Responses are snake_case unless `useCamelCase`.

**Catalog.** `swell.products.list({ category: '<slug-or-id>', search, $filters })` / `swell.products.get('<slug-or-id>')`. `search` is AND full-text over `name`, `slug`, `sku` — every word must match within one field, and record `id` is **not** searched (fetch by id with `products.get(id)` or `where: { id }`). Local, synchronous helpers: `swell.products.variation(product, { Size: 'M' }, purchaseOption?)` resolves price/sale_price/orig_price/stock_status for chosen options (third argument `'standard'` | `'subscription'` | `{ type, plan_id }` — unlike the cart, `plan`/`plan_id` here matches the plan's **id** only, never an interval alias like `'monthly'`; omit it to price the first plan. Throws synchronously when the purchase option or named plan isn't active — it does not reject); `swell.products.filters(products)` derives faceting filters from a result set (fetch the full relevant set first), applied by passing `$filters: { price: [10, 20], category: [...], <attribute_id>: [...] }` to `list`. `swell.categories` and `swell.attributes` follow the standard list/get shape.

`products.get`, `categories.get`, `attributes.get`, `content.get`, `subscriptions.get`, and `invoices.get` route through `swell.cache`, **but it never serves a value you didn't put there yourself** with `swell.cache.set(...)` — every call issues a request. What actually dedupes repeat reads is the storefront API's own 5-second server-side cache on product and category routes. Memoize in your own data layer if you need more. **Read `references/catalog.md`** for variant resolution, `stock_status` semantics, and facet construction.

**Settings & navigation.** Call `await swell.settings.load()` once at startup — it fetches settings, menus, payment and subscription settings in one request and makes `settings.get(path, default?)`, `settings.menus(id)`, `settings.payments()`, `settings.subscriptions()` synchronous afterward (before that they return promises — always await them). `settings.menus()` with no id does not return all menus; fetch `swell.get('/settings/menus')` for the full list. `swell.cart.getSettings()` returns checkout settings (enabled countries, currencies, payment methods, account requirement policy, policies text).

**Content.** `swell.content.list('<type>', query)` / `swell.content.get('<type>', '<slug-or-id>', query?)` where type is the content collection (`pages`, `blogs`, custom models). Draft preview: init with `previewContent: true` (injected on `get` only, and ahead of your query object — a `$preview` in the query wins), or pass `$preview: true` per call. `content.list` doesn't inject it, but a `$preview: true` you put in the list query is forwarded and honored: list and get share one gateway handler that drops the `published: true` filter whenever `$preview` is truthy.

**Localization & currency.** `swell.locale.list()` / `swell.currency.list()` enumerate enabled options (empty unless multi-language/multi-currency configured). `await swell.locale.select(code)` and `await swell.currency.select(code)` are async: they set a cookie and update the session, which copies the change onto the existing cart (`cart.currency`, `cart.display_locale`), so subsequent reads return localized/converted values. That cart copy is what localizes checkout and order email notifications — the locale is **not** written to the customer record, and `account.create/update` reject `locale` outright since it is not in the accounts public write whitelist. Readers `selected()` and `format(amount, opts?)` are synchronous, and display-currency conversion applies the store's configured display rate, which the platform refreshes hourly.

**Never format a price before settings are loaded.** `currency.selected()` falls back to `settings.get('store.currency')`, which is a *pending promise* until the first settings request resolves. `set()` then stores that promise as the currency code and writes it to the cookie as `swell-currency=[object Promise]`, which is replayed as an `X-Currency` header on every later request; `format()` falls through its `Intl.NumberFormat` catch and returns the raw unformatted number. A later `settings.load()` does not repair it — the `if (!this.code)` guard short-circuits. `await swell.settings.load()` before the first `format()`, and reset a poisoned client with `swell.currency.select(code)`.

# IV. Cart

```js
await swell.cart.addItem({
  product_id, quantity,
  options: { Size: 'S' },            // or [{ name|id, value }] — both keys accepted
  purchase_option: { type: 'subscription', plan_id },  // or { type: 'standard' }, or { plan: 'monthly' }
});
```

`cart.get()` (null until first item), `updateItem(itemId, changes)`, `removeItem(itemId)`, `setItems(items)` (replaces all; `setItems([])` empties), `applyCoupon(code)` / `removeCoupon()` (one coupon per cart), `applyGiftcard(code)` / `removeGiftcard(cartGiftcardEntryId)` (multiple allowed; remove takes the `cart.giftcards[].id`, not the code), `cart.recover(checkout_id)` (abandoned-cart links). Active promotions apply automatically — inspect `cart.promotions` (a `{ count, results }` set), never apply them manually. Cart mutations are internally serialized by swell-js — no need to queue them yourself, but don't fire them blindly in parallel and assume ordering.

`cart.update({ account, shipping, billing, metadata })` sets checkout state — see `references/checkout.md` for the full flow. Metadata (cart, items, account) is publicly readable and deep-merges on write; arrays merge rather than replace (objects carrying an `id` align by id, elements without one merge positionally by index). To replace one array in place use the per-field form, `metadata: { my_array: { $set: [...] } }`. The top-level form `$set: { metadata: {...} }` is a **shallow overwrite** — it replaces the whole metadata object and silently drops every key you don't resend, so reach for it only when that is what you want.

# V. Checkout & Payments

The canonical sequence — customer identity → shipping → rates → payment tokenization → `cart.submitOrder()` — plus gateway-specific element/tokenize/redirect flows live in two references:

- **Read `references/checkout.md`** for the order flow: required cart state, guest vs. logged-in semantics, shipping rates, account credit behavior, submit, and post-order retrieval.
- **Read `references/payments.md`** for payment methods: `swell.payment.createElements()` / `tokenize()` per gateway, redirect returns (`handleRedirect`, `updateIntent`), direct `swell.card.createToken()`, and saved cards.

# VI. Customer Accounts

`swell.account.login(email, password)` (or `login(email, { password_token })` — always snake_case, even under `useCamelCase`; the token is single-use and is unset on success), `logout()`, `get()` (null when logged out), `create({ email, password?, first_name?, last_name?, email_optin? })` (attaches to the current session), `update(changes)`.

**`login()` resolves `null` on wrong credentials.** It does not throw and does not return an `errors` object, so a `try`/`catch` or an `if (result.errors)` check treats a failed login as a success. Branch on the return value:

```js
const account = await swell.account.login(email, password);
if (!account) { /* wrong email or password */ }
```

`create()` **throws** when a session is already logged in (`You must be logged out to create an account`), and masks duplicate emails: a taken address comes back as `errors.email` with `code: 'INVALID'` and a deliberately generic message, never `UNIQUE` — do not build "that email is already registered" UX on it. Creating an account attaches it to the session either way, but the cart's `account_logged_in` flag is set only when a password was supplied (an email-matched account with a password but no login shows `account_logged_in: false` — prompt for login). Writable fields are `email`, `password`, `first_name`, `last_name`, `name`, `phone`, `email_optin`, `type`, `vat_number`, `metadata`, `shipping`, `billing`, `addresses`, `cards`, `password_reset_url`; anything else is rejected.

**Login and logout mutate the cart.** Logging in claims the visitor's guest cart for the account and re-runs promotions; if the session has no cart, the account's last active cart is adopted instead. There is no merge — with a guest cart present, the account's older cart is left behind. Logging out keeps the cart and its items but detaches the account, clears `shipping.account_address_id` and `billing.account_card_id`, re-runs promotions (totals can change), and returns `{ success: true }`. Re-read the cart after both and drop any UI holding a saved address or card id.

**Most account reads reject when logged out.** Only `account.get()` follows the resolve-to-`null` rule. `update()`, `listOrders()`/`getOrder()`, `listAddresses()`/`listCards()` and their create/update/delete siblings, and everything under `swell.subscriptions`, are hard-gated and **reject with `code: 'UNAUTHORIZED'`** when the session has no `account_id`. Check `await swell.account.get()` (or `(await swell.session.get())?.account_id`) before rendering an authenticated view; don't infer logged-out from an empty result set. The gate is the session's `account_id`, not the cart — a guest cart carrying a customer's email is not logged in.

Password recovery is one dual-mode method: `account.recover({ email, reset_url? })` sends the email (silently succeeds even for unknown addresses; `{reset_key}` substitutes into `reset_url`; keys expire after 24 hours), then `account.recover({ password, reset_key })` performs the reset (`password_reset_key` is accepted as an alias).

Sub-resources: `listAddresses()` / `createAddress` / `updateAddress` / `deleteAddress`; `listCards()` / `createCard` / `updateCard` / `deleteCard` (tokenized cards only — gateway specifics in `references/payments.md`; the default card is `account.billing.account_card_id`, changed via `account.update({ billing: { account_card_id } })`); `listOrders({ limit, page, expand })` / `getOrder(id)`.

# VII. Subscriptions

Two distinct paths:

- **Purchase through checkout**: add the product to the cart with a `purchase_option` of type `subscription` (see Cart above) and submit normally. This is the storefront-native path.
- **Direct management** (logged-in account): `swell.subscriptions.list()/get(id)/create({ product_id, variant_id?, quantity?, coupon_code?, items? })/update(id, changes)`. Every subscription route requires a logged-in session and rejects with `code: 'UNAUTHORIZED'` otherwise. Writable fields are a fixed whitelist — `paused`, `date_pause_end`, `canceled`, `cancel_at_end`, `coupon_code`, `quantity`, `options`, `product_id`, `variant_id`, `plan_id`, `billing`, `billing_schedule`, `shipping`, and `items.{id,product_id,variant_id,quantity,options}` — and anything outside it is rejected, not ignored. Pause with `update(id, { paused: true, date_pause_end })` (`null` = indefinite). **Cancel by always sending the pair:** `{ canceled: true, cancel_at_end: false }` cancels immediately, `{ canceled: true, cancel_at_end: true }` cancels at the end of the paid period — a portal should offer the second. The platform branches on the request *merged over the stored record*, so a bare `{ canceled: true }` inherits whatever `cancel_at_end` or `cancel_at_schedule` the record already carries and defers silently — and `cancel_at_schedule` is neither readable nor writable from a storefront key, so you cannot see it coming. `cancel_at_end` **on its own cancels nothing, ever**: the entire cancellation path is gated on `canceled` being truthy, and the write still returns 200 with the flag stored. Swap plan with `plan_id`, product with `product_id` (+ `variant_id?`). Invoice line items: `addItem(id, item)`, `updateItem(id, itemId, changes)`, `setItems(id, items)`, `removeItem(id, itemId)`.

**Building the portal.** Subscriptions accept a fixed `expand` set — `product`, `variant`, `orders`, `invoices`, `payments` — and anything else rejects with `You can only expand public fields`. Append `:n` to cap an expanded set: `swell.subscriptions.list({ expand: ['product', 'invoices:5', 'payments:5'] })`.

Billing history also has its own namespace, `swell.invoices.list(query)` / `swell.invoices.get(id)` — present and typed in the library but absent from developers.swell.is. It is account-scoped: results are auto-filtered to the logged-in customer and it rejects when logged out. Narrow to one subscription with `swell.invoices.list({ subscription_id })`. Orders accept `expand: ['shipments', 'payments', 'refunds']` on `account.listOrders()` / `getOrder()` — what an order-detail or tracking view needs.

# VIII. Calling App Functions

`swell.functions.request(method, appId, functionName, data?)` (plus `get/put/post/delete` helpers) invokes an app's HTTP route at `/functions/<app_id>/<name>` with the storefront's key and session. Gateway rules apply — the same for any external caller, detailed in the swell-app skill's `references/functions-routes.md`, §"Calling routes from outside Swell (hosted gateway)": with an empty body, query params arrive in the function's `req.data`; with a body, query params are dropped; a route that isn't marked public needs a secret key, which a storefront must never carry. Case conversion is disabled in **both** directions for function calls: your payload is sent exactly as written (never snake_cased) and the response comes back exactly as the function produced it (never camelCased), even on a `useCamelCase: true` client. Use this for storefront features backed by app logic (custom submissions, computed data) instead of exposing privileged operations publicly.
