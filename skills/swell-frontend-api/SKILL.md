---
name: swell-frontend-api
description: "Use this skill for Swell Frontend API operations: catalog and content, shopper sessions, carts, checkout, payments, customer accounts, subscriptions, localization and public app data. Applies inside Swell app frontends through the Apps SDK Storefront client and swell-js, and to independent storefronts using explicitly configured clients or direct API requests. Also covers storefront GraphQL and calls to app route functions. Pair with swell-app for app scaffolding, runtime setup, models, hosting and deployment; reuse its supplied clients and session helpers. Privileged store operations belong to swell-backend-api. Proxima / Liquid theme authoring and other platforms are outside scope."
allowed-tools: Read, Grep, Glob, Bash
---

# I. What This Covers

The Frontend API is the session-scoped, public-key-safe subset of Swell used by storefronts. `swell-js` is its universal JavaScript client — safe in browsers and on servers. It reads catalog/content/settings, owns the visitor's cart and checkout, and manages the logged-in customer's account and subscriptions. It cannot administer the store: writes are limited to session-owned resources (cart, account, subscriptions) plus custom models that declare public permissions.

This skill owns Frontend API operations in both Swell apps and independent storefronts. `swell-app` owns app scaffolding, runtime context, resource declarations, hosting and deployment. Use both for a Swell storefront app or when a storefront feature needs an app model or function. Privileged store operations belong to `swell-backend-api`.

**Keep the supplied client in a Swell app.** Use the scaffold's Storefront helpers (`getStorefront()` on the Vinext server and `useSwell()` in the browser) and session wiring, as described in the `swell-app` frontend references. Do not replace them with standalone `swell.init()` or hand-built cookie adapters. Identify whether the call uses the SDK Storefront client or swell-js before applying a method signature or error rule; the swell-js-specific details below are not a complete SDK client contract. Read the installed `@swell/apps-sdk` README for SDK-specific behavior.

Outside apps, swell-js and explicitly configured Apps SDK clients can connect directly to the API. An independently configured SDK client does not require app packaging; follow its installed README for setup.

# II. swell-js Setup & Request Model

The explicit initialization below is for an independently configured swell-js client. In an app, use the existing client and its runtime-provided configuration.

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

Without a session, every server request starts a new (empty-cart) session — and swell-js's default cookie accessors are no-ops on the server, so the returned `X-Session` token is silently dropped unless you pass `session` or wire `setCookie` yourself.

**Read `references/clients-sessions.md`** for client setup outside an app, per-request clients, cookie adapters, and what may be cached.

**Three failure surfaces.**

1. **Resolve with `errors`.** Account, address, card and subscription writes return **field validation** as a resolved `{ errors: { [fieldOrSource]: { code, message } } }` — a 200 you must inspect: `references/accounts-subscriptions.md`, "How failures arrive". `swell.cart` has both branches, by call: `references/cart-checkout.md`, "How failures arrive".
2. **Reject with an `Error`** carrying `message`, `status`, `code`, `param` — including every logged-out call to an account-scoped endpoint (`code: 'UNAUTHORIZED'`). Two shapes break naive handlers: an HTTP failure whose body isn't JSON rejects with `code: 'connection_error'` and **no `status`**, so an `err.status >= 500` branch misses it entirely; a network failure rejects with the browser's own `TypeError`, which has none of these fields.
3. **Neither.** `settings.load()` logs and resolves on failure; `products.variation()` throws synchronously; `swell.payment.authenticate()` resolves `{ error }` instead of rejecting; and `payment.createElements()` for a method the store has disabled logs to the console, drops that method, and resolves normally — nothing renders and no error reaches your code (see `references/payments.md`).

**Generic requests.** `swell.get/put/post/delete(url, data)` hit any `/api/*` path with the same auth and session — for `get` the second argument is a query object, or a string appended as a path segment (`swell.get('/products', 'blue-shoes')`); on writes a string replaces the body, so use `swell.request(method, url, id, data)` when you need both.

This is how storefronts reach app-defined collections: `/apps/<app_id>/<collection>`. The model must declare `public_permissions` or every verb is refused, and what it declares is exactly what the storefront gets. Public **writes** need an owner — either `scope: 'account'` so records are customer-owned, or no `input` at all and submissions routed through an app route function that checks `req.session?.account_id` (§VI). Standard-model app fields are absent from store-key reads by default; installed-app keys are a different access context. Read `references/app-data.md` before exposing any app data to a storefront.

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

List methods take `{ limit, page, where, sort, search, expand }` — defaults: limit 15 (max 1000), sort `id desc`. Unrecognized keys fold into `where`. Lists resolve to `{ count, page, limit, results }`; single-record gets resolve to the record or `null` (no error) for missing slugs (an empty string for content), empty carts, and `account.get()` when logged out — but the rest of the account-scoped surface **rejects** instead of resolving null (§V). `expand` accepts an array (`['variants']`) or comma string. Responses are snake_case unless `useCamelCase`.

**Read `references/catalog.md`** for products, variants and `products.variation()`, stock, categories and facets with `$filters`, content, settings and menus, locales, currencies and price formatting. The rules from it that change a design:

- Only active products are returned, and a `fields` parameter is ignored.
- A product's `price` is already what this shopper pays; `orig_price` is present when it was lowered.
- `products.get()` includes variants and `products.list()` does not; `products.variation()` needs them and throws synchronously without them.
- `content.list()` returns published records only, while `content.get()` returns drafts too.
- `await swell.settings.load()` comes before `settings.get()`, the menus and `currency.format()`.

# IV. Cart and Checkout

The cart belongs to the session. `swell.cart` adds and changes items, takes the customer's email, addresses, shipping service, coupon and gift cards, and `cart.submitOrder()` turns the cart into an order.

- **Read `references/cart-checkout.md`** for the cart, the checkout sequence, guest and logged-in carts, account credit, the checkout settings and reading the order afterwards.
- **Read `references/payments.md`** for collecting a payment method: payment elements and `tokenize()`, redirect methods, `swell.card.createToken()` and saved cards.

The rules from them that change a design:

- Checkout calls reject, and item calls can also resolve with `errors`: handle both.
- Payment elements run only in a browser, and a card element exists only for some gateways; the others need a card form of your own.
- Collect the payment method last: a card authorization is for the amount due when it is made.
- `capture_total` is the amount to pay. `grand_total` does not subtract gift cards or account credit.
- An order is read back by its cart's `checkout_id`, which the order does not carry, and anyone who has that id can read the order.

# V. Accounts and Subscriptions

`swell.account` signs a customer up and in and holds the profile, addresses, saved cards and order history. `swell.subscriptions` and `swell.invoices` hold what a logged-in customer is billed for.

**Read `references/accounts-subscriptions.md`** for sign-up, login and logout, password recovery, addresses, order history, and creating, pausing, changing and canceling a subscription. The rules from it that change a design:

- `account.login()` resolves with `null` for wrong credentials. It does not reject.
- Logged out, `account.get()` resolves with `null` and every other account, subscription and invoice call rejects.
- A login or a logout changes the cart: read it again.
- A write resolves with `errors` for a bad value and rejects for a field it does not accept.
- A subscription is canceled, and a cancellation undone, with `canceled` and `cancel_at_end` together.

# VI. Calling App Functions

`swell.functions.request(method, appId, functionName, data?)` (plus `get/put/post/delete` helpers) invokes an app's HTTP route at `/functions/<app_id>/<name>` with the storefront's key and session. Gateway rules apply — the same for any external caller, detailed in the swell-app skill's `references/functions-routes.md`, §"Calling routes from outside Swell (hosted gateway)": with an empty body, query params arrive in the function's `req.data`; with a body, query params are dropped; a route that isn't marked public needs a secret key, which a storefront must never carry. Case conversion is disabled in **both** directions for function calls: your payload is sent exactly as written (never snake_cased) and the response comes back exactly as the function produced it (never camelCased), even on a `useCamelCase: true` client. Use this for storefront features backed by app logic (custom submissions, computed data) instead of exposing privileged operations publicly.
