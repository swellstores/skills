# Server-Side Rendering

`swell-js` runs on servers, but its defaults assume a browser: one shared client, cookie accessors that silently no-op, and module-level state owned by the library rather than the client. Each is a cross-visitor bug under concurrency.

## One client per request

`swell.init()` configures the single default instance — every concurrent request shares its `session`, `locale`, and `currency`. Use `swell.create('<store-id>', '<public_key>', options)` for anything session-scoped (cart, account, subscriptions, checkout); it returns a fully independent client with its own options, settings state, and locale/currency state.

**The session is dropped unless you bridge cookies.** The default `getCookie`/`setCookie` return early when `window` is undefined, so the `X-Session` token is thrown away and every render starts a fresh, empty-cart session. (The API sets that response header only when it mints or changes a session — with no session ever sent, that is every response.) Passing `session` alone fixes reads but not writes: swell-js only calls `setCookie` when the returned token *differs* from the one sent, so a brand-new or rotated session still vanishes.

Three cookies are read and replayed as headers — `swell-session` → `X-Session`, `swell-locale` → `X-Locale`, `swell-currency` → `X-Currency`. The explicit `session` / `locale` / `currency` options take precedence over the cookie of the same name; bridge all three or a locale/currency switch won't survive a server-rendered navigation.

## Next.js App Router

A Server Component **cannot write cookies** — only Route Handlers and Server Actions can — so a component that starts a new session cannot persist it. Read in the component, mutate in an action or handler.

```js
// lib/swell.js — one client per request, both directions bridged
import { cookies } from 'next/headers';
import swell from 'swell-js';

export async function getSwell() {
  const store = await cookies();
  return swell.create(process.env.SWELL_STORE_ID, process.env.SWELL_PUBLIC_KEY, {
    getCookie: (name) => store.get(name)?.value,
    // Match the browser defaults so server- and client-set cookies don't diverge
    setCookie: (name, value) => {
      try {
        store.set(name, value, { path: '/', sameSite: 'lax', maxAge: 604800 });
      } catch {
        // Server Component render — cookies are read-only here
      }
    },
  });
}
```

```js
// app/cart/actions.js — every mutation lives here, where setCookie actually works
'use server';
import { getSwell } from '@/lib/swell';

export async function addItem(productId) {
  const client = await getSwell();
  const cart = await client.cart.addItem({ product_id: productId, quantity: 1 });
  if (cart.errors) { /* surface and stop */ }
  return cart;
}
```

The `try`/`catch` is load-bearing: without it the first server-rendered read that mints a session throws. With it, the session that a read-only render creates is discarded (an empty session, so nothing is lost) and the first mutation establishes the real one.

## Three cache layers, and only one of them dedupes

| Layer | Scope | Key | Leaks across visitors |
| --- | --- | --- | --- |
| `swell.cache` (swell-js) | module singleton — **shared by every `create()` client** | `model` + `id` only, 5s | Only once you prime it yourself |
| Frontend API gateway (SWR) | per store + environment; `/products`, `/categories`, `/settings` only | client + env + path params + the resolved query — on product routes that query carries `$locale`, `$currency` and the session's `$pricing.account_id` | No |
| Your framework's data cache | whatever you configure | whatever you configure | Yes, if it caches a session-scoped read |

**`swell.cache` is inert until you write to it.** `products.get`, `categories.get`, `attributes.get`, `content.get`, `subscriptions.get`, and `invoices.get` route through it, but a fetched record lands in a slot the reader never consults — the slot `get()` returns is filled only by `swell.cache.set({ model, id, value })`, which no library code calls. Every one of those calls issues a real request, and list methods (`content.list` included) never touch the cache at all. The moment you *do* prime it — an optimistic post-write patch, say — that record is served from the process-wide singleton to **every** client for 5s on a `model`+`id` key that ignores locale, currency, and account. Don't do that on a server handling more than one visitor; if a dependency does, `swell.cache.options.enabled = false` once at startup, or `swell.cache.clear(model, id)`.

`swell.create()` also overwrites the module-global options object `products.variation()` reads. **Keep `useCamelCase` identical across every client in a process** — `variation()` snake/camel-cases its input and output against the most recently constructed client, so a mismatch either throws (it cannot see `purchase_options` on a product in the other case) or hands back a variation keyed in the wrong case.

**The gateway cache is the one that actually dedupes repeat reads**: 5s stale-while-revalidate, and only on `/products`, `/categories`, and `/settings`. Cart, account, subscription, order, and content reads always reach the platform. Bypass it with `$cache: false` after a write you must read back immediately, or for draft preview:

```js
await client.products.get(slug, { $cache: false });   // products and categories only
```

The gateway strips `$cache` from the query and substitutes a unique `__cache_<timestamp>` no-op condition, which changes the cache key and forces a fetch. Two limits. It only reaches routes that resolve a query through the permission layer, so **`/settings` ignores it** — that key is client + env + storefront + locale + currency, and `settings.refresh()` can still be handed a 5s-stale payload. And `client.cart.clearCache()`, which makes the next `cart.get()` send `$cache: false`, is a no-op against Swell: the cart route builds its own query and never caches. It matters only behind your own proxy or CDN.

## Settings cost one request per client

Settings state lives on the client instance, so a per-request client starts empty: `await client.settings.load()` has to run again in every render that needs settings, menus, payment settings, or `currency.format()`. With no readable `swell-currency` cookie — a first visit, or a client without the bridge above — calling `currency.selected()` or `format()` first caches the still-pending settings promise as the currency code *and writes it to the `swell-currency` cookie*, degrading formatting to a bare number for the life of that client. Either budget the extra call, or keep a long-lived anonymous client for settings and catalog and a per-request client for session work.

## Static generation

Catalog and content reads need no session, so `generateStaticParams` and build-time fetches can share one plain client. Three constraints:

- **`limit` tops out at 1000.** Above that the API rejects the query with `Query limit cannot exceed 1000`. Page with `{ limit: 1000, page: n }` until `page * limit >= count`.
- **Prices are per-account.** Every product read is priced against the session's `account_id` (`null` when anonymous), so a statically generated page carries anonymous pricing. If the store uses customer-group or account pricing, re-price client-side or render that page dynamically — never ship the built price as final.
- **`stock_status` is computed at response time**, not stored. Treat statically rendered stock as a hint and re-check before add-to-cart.

Cart, account, and subscription reads must never be statically generated or framework-cached. swell-js calls global `fetch` with only method, headers, and body, so there is no way to pass per-request cache hints (`cache: 'no-store'`, `next.revalidate`) through it — control caching at the route segment instead. Reading `cookies()` already opts a route out of static rendering; use `export const revalidate = <seconds>` for catalog pages and `export const dynamic = 'force-dynamic'` for anything session-scoped.
