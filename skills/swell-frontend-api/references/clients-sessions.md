# Clients and Sessions

Setting up a Frontend API client outside a Swell app, keeping the shopper's session on a server, and what may be cached. Every client sends the same requests, so the other references apply to all of them.

## Which client

| Where the code runs | Client |
| --- | --- |
| A Swell app frontend | The scaffold's helpers, which already follow every rule here; see the `swell-app` skill, `references/frontend-storefront.md`. Do not create a second client. |
| A browser, outside an app | `swell.init('<store-id>', '<public_key>')` once. swell-js keeps the session cookie itself. |
| A server, outside an app | `swell.create('<store-id>', '<public_key>', options)` once per request, with a cookie adapter ("On a server"). `createStorefrontClient` from `@swell/apps-sdk/storefront` (install the `next` tag) builds the same swell-js client from `{ storeId, publicKey }` and an adapter of the same kind. |
| No JavaScript client | `https://<store-id>.swell.store/api/<path>` with `Authorization: Basic base64(<public_key>)` and the session headers below. |

## The session

There is no cart id or login state to track: the session is a token that carries the cart id, the logged-in account id, the locale and the currency. Swell answers with a new token in the `X-Session` response header when a request arrives without one and whenever a request changes what the token carries: the first item in a cart, a login, a logout, a locale or currency change, and sometimes a read of the cart. The client keeps the token in the `swell-session` cookie and sends it as the `X-Session` request header.

Two more cookies travel the same way: `swell-locale` as `X-Locale` and `swell-currency` as `X-Currency`. The `session`, `locale` and `currency` options, when set, are sent instead of the cookie of the same name.

- **Save the token after every call, reads included.** A token that is not saved takes with it what the call changed: the new cart, the login.
- **A call without a token starts a new session.** Two calls from a client that cannot read back the token it was given are two sessions: the item the first adds is not in the cart the second reads, and nothing reports it.
- **Logging out does not cancel earlier tokens.** `account.logout()` answers with a new token that has no account; a copy of the token from before the logout still reads the account and its orders. Keep the token in its cookie only: never in a URL, a log or the page's markup.
- **Give the client the decoded cookie value.** The token contains a `:`, which swell-js writes into the cookie as `%3A`. Sent to Swell still encoded, it reads as a visitor with no cart and no account, without an error, and writes answer with status 500; cut short, it fails every call with status 400. Swell never replaces a damaged value: delete the cookie.

`await swell.session.get()` is a request that answers with what the token carries (`cart_id`, `account_id`, `locale`, `currency`).

## On a server

**One client per request.** `swell.init()` configures a single client for the whole process, so concurrent requests would share one shopper's session, locale and currency. Call `swell.create()` inside the request for anything that touches the cart, the account, subscriptions or checkout. Clients from `create()` share nothing with each other from swell-js 5.9.0; upgrade an older install first.

**Without a cookie adapter nothing is kept.** On a server swell-js's own cookie functions do nothing: the token is dropped and every call starts a session. The `session` option alone sends a token and still drops the new one that a login or a first cart item returns. Pass both functions:

```js
// lib/swell.js: Next.js App Router
import { cookies } from 'next/headers';
import swell from 'swell-js';

export async function getSwell() {
  const jar = await cookies();
  return swell.create(process.env.SWELL_STORE_ID, process.env.SWELL_PUBLIC_KEY, {
    getCookie: (name) => jar.get(name)?.value,
    setCookie: (name, value) => {
      try {
        jar.set(name, value, { path: '/', sameSite: 'lax', maxAge: 604800 });
      } catch {
        // A page render cannot set cookies: the write is skipped.
      }
    },
  });
}
```

The rules, for any framework:

- **`getCookie` returns what `setCookie` wrote earlier in the same request.** If the framework's reader shows only the incoming cookies, keep the written values in a map for the request and read from it first.
- **A page render can read the session and cannot save it.** Where a render cannot set cookies, skip the write as above; without the `try`, a first visit throws. Each call of that render is then its own empty session, which is enough for catalog reads.
- **Change the cart or the account in a route handler or server action, or in the browser.** A change made while rendering is lost with its token.
- **`createStorefrontClient` takes the pair as `cookies.get` and `cookies.set`.** Skip the write inside `set` the same way: with `set` left out, a first visit throws.
- **Keep the cookie readable by a browser client.** swell-js in the browser reads `swell-session` from `document.cookie` and writes it with path `/`, `SameSite=Lax` and one week. A server that sets it `HttpOnly` gives the browser a second session and an empty cart.

## Caching

- **Swell caches product, category and settings reads for five seconds**, and serves the old copy once more while it fetches the new one. The first read after a change returns the record as it was. Cart, account, subscription, order and content reads are never cached.
- **Send `$cache: false` when a read must see a change that was just made**: a page rebuilt from a product webhook, a draft preview. `swell.products.get('<slug>', { $cache: false })` works on product and category reads, lists included, and not on settings.
- **swell-js caches nothing itself.** Two `products.get()` calls for one record are two requests; share the result through the framework (`cache()` from React) when a render reads a record in several places.
- **Never let the framework cache a session read.** swell-js passes no cache hint to `fetch`, so set caching on the route: in Next.js, `export const dynamic = 'force-dynamic'` for cart, account and subscription pages and `export const revalidate = <seconds>` for catalog pages.
- **A client made for the request starts without settings**: `await client.settings.load()` before `settings.get()`, the menus or `currency.format()`.

## Static generation

Catalog and content reads need no session. For pages built ahead of time or revalidated, use one client without a cookie adapter, created at module level with `swell.create('<store-id>', '<public_key>')`: reading the request's cookies, as `getSwell()` does, makes a Next.js route dynamic.

- **`limit` stops at 1000.** A larger value is refused with status 400 and `Query limit cannot exceed 1000`. Read a whole catalog with `{ limit: 1000, page }` until `page * limit >= count`.
- **Prices are the session's.** A product is priced for the session's account, so a built page carries the prices of a visitor who is not logged in. In a store with customer-group or account prices, render the page on request or price it again in the browser.
- **`stock_status` is worked out when the product is read.** On a built page it is a hint: read the product again before adding it to the cart.
