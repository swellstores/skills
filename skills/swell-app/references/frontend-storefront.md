# Storefront frontend

The store's own site, written in code: the `frontend/` of a `storefront` app. Swell builds it, hosts it and serves it at the storefront's address. Read `references/frontend.md` first — the scaffold, the connection to Swell, `/app-api` endpoints, local development and deployment are the same for every frontend. This reference covers what is specific to a storefront.

## Check that this is the right kind of storefront

| Situation | Where it belongs |
| --- | --- |
| A storefront written in code and hosted by Swell | A `storefront` app with a frontend — this reference |
| A Liquid theme, `swell theme *` commands, the dashboard theme editor | Theme authoring — not covered by this skill |
| A storefront hosted somewhere else (the developer's own server or another platform) | No app: build it on the Frontend API directly — the `swell-frontend-api` skill |
| Pages for store users inside the dashboard | An `admin` or `integration` app — `references/frontend-dashboard.md` |

**There is no visual editor.** The dashboard's theme editor works on themes. In a code-based storefront, layout and content change in code and ship with a push.

**Template.** Use `swell-vinext`. Product and category pages render on the server, so they arrive complete for shoppers and search engines, and the same server code can read the shopper's cart. `swell-react` renders in the browser only and is meant for dashboard apps.

## Set up

```bash
swell create app <id> -t storefront --frontend swell-vinext -y
```

```json
{
  "id": "my_shop",
  "name": "My Shop",
  "type": "storefront",
  "version": "1.0.0",
  "permissions": [],
  "frontend": { "hosting": "managed" }
}
```

Nothing else is declared. Run `swell app push` once before the first preview: it installs the app in the test environment, Swell creates a storefront for it, and the push prints the storefront's address. The scaffold's demo page is what goes up; that is fine in the test environment.

The scaffold's README and demo page are written for every app type. Their `--store-user` advice does not apply here: the flag is refused for storefront apps.

## The storefront

A storefront is a record in the store: it has a name and an address, and it is served by one app at one version. The app is the code; the storefront is where that code is live.

- **Created for you.** Installing a `storefront` app creates its first storefront in that environment. The merchant can add more storefronts on the same app from the Storefronts page of the dashboard.
- **Per environment.** The storefront that `swell app push` updates lives in the test environment. The live environment gets its own when a released version of the app is installed there — see `references/app-publishing.md`.
- **Its address.** In the test environment a storefront answers at `https://<storeId>--<storefrontId>.swell.store`. In the live environment the store's primary storefront answers at `https://<storeId>.swell.store` and on the merchant's domain, and any other storefront at an address with its own id. Which storefront is primary and which domain it uses are the merchant's settings in the dashboard, not something the app declares.
- **Give people the storefront's address.** The same build also answers at the app address every frontend has, `https://<storeId>--<installedAppId>--app.swell.store`, but that is not the storefront: domains, the primary setting and the storefront's version do not apply there. The dashboard lists the storefront under Storefronts.
- **It follows the installed version.** A storefront serves the version of the app installed in its environment, unless the merchant selects another version for that storefront in the dashboard.
- **Link to pages by path.** The same build serves every storefront on the app, in every environment and on any domain. Use relative links, and when an absolute address is needed take it from `request.url` in a route handler (the `Host` header is not passed on); never hardcode a storefront address. `context.storefrontId` says which storefront a request is for.

## Who is viewing

Every request to the storefront comes from a shopper: a visitor, or a customer once they log in. At the storefront's address `context.storeUser` is `null`, and `requireStoreUser` has no place in a storefront. Tools for the merchant belong in a separate `admin` app.

- **The session is a cookie that both clients share.** `getStorefront()` on the server and `useSwell()` in the browser read and write the same session, so a cart filled in the browser is the cart the server reads on the next request.
- **A page render can read the session but cannot save it.** A shopper's first page arrives without a session cookie. The session Swell starts for that render is not kept; the one that lasts is started by the browser client's first call, or by a route handler or server action. So: read on the server, change in the browser.
- **Changes go in event handlers and effects** with `useSwell()` — add to cart, update quantities, log in, log out — or in a route handler or server action, which can save cookies. Never change the cart or the account while rendering.
- **Find out who the customer is from the session, never from request parameters.** On the server, `(await getStorefront()).account.get()` returns the logged-in customer or `null`. An account id in a path, query or body is input anyone can type.
- **A customer's own data comes from the Storefront client too.** Their account, addresses, orders and subscriptions are read through the same session, which is what limits them to that customer. A customer-only page is a server component that reads the account first and redirects a visitor to the login page.
- **The Backend client is the app, not the shopper.** It returns the same data to everyone, and every storefront page is public. Show shoppers only what the Storefront client returns. Use `getBackend()` only in a server handler, for work the Storefront client cannot do, after establishing the customer from the session and narrowing the query to their own records.
- **Swell does not screen a shopper's writes.** The origin rule that protects store users does not cover the shopper's session: a POST sent from another site reaches a storefront handler with the session cookie whenever the browser attaches it, and browsers treat every `*.swell.store` address as one site. A route handler that changes the cart or the account refuses a request whose `Origin` header is not the origin of `request.url`; the two match under `swell app dev` as well.
- **Nothing is shared between shoppers.** Pages render on each request and Swell sends every page and endpoint with `Cache-Control: private, no-store`. Keep server state inside the request as well: no module-level client, cart or account.

## Adapt the starter

The scaffold's home page is a demonstration of three patterns. A storefront keeps the helpers, copies from two of the patterns and deletes the demonstration:

| Scaffold file | In a storefront |
| --- | --- |
| `lib/swell.ts` | Keep unchanged. `getStorefront()`, `getPublicConfig()` and `getBackend()` are the connection; `requireStoreUser` stays unused |
| `app/layout.tsx`, `components/swell-provider.tsx` | Keep. Set the site's own `metadata`; add the header, footer and cart indicator here |
| `components/swell-image.tsx` | Keep for product and content images |
| `components/catalog-card.tsx` | The pattern for every server read — product lists, product pages, categories, content. Copy from it, then delete it |
| `components/cart-card.tsx` | The pattern for every browser change — cart, account forms — including how a refused change is returned. Copy from it, then delete it |
| `components/store-user-card.tsx`, `components/card.tsx`, `app/app-api/hello/route.ts` | Delete: dashboard patterns and demo parts |
| `app/page.tsx` | Replace with the storefront's home page |

- **Pages are App Router routes**: `app/products/[slug]/page.tsx`, `app/categories/[slug]/page.tsx`. Read the record in the server component with `getStorefront()`.
- **Nothing found is `null`, not an error.** A product that does not exist, the account of a visitor who is not logged in, and the cart of a shopper who has not added anything all come back as `null`. For a missing record call `notFound()` from `next/navigation`.
- **One browser client, one cart.** `useSwell()` returns the client that `SwellProvider` created. Hold the cart in one client context inside that provider: read it once with `cart.get()` in an effect, and replace it with the cart each change returns. The header count, the add-to-cart button and the cart page are all views of that context, so the count updates without a reload.
- **Account pages are the storefront's to build.** Login, sign-up and password recovery are forms on the account methods of the browser client. After a login or logout, reload the page so server-rendered parts and the cart context read the new session.
- **Checkout is Swell's.** Send the shopper to the cart's `checkout_url`; do not build payment forms into the storefront unless the task asks for a custom checkout.
- **Swell owns some paths**, `/checkout/` among them; the list is in `references/frontend.md`. Put the storefront's own endpoints under `/app-api` and choose other names for pages.
- **Commerce operations are not documented here.** Which methods exist, what they take, what a cart, product or order contains, pricing, variants, accounts, subscriptions and localization are covered by the `swell-frontend-api` skill; this reference only places those calls on the right side of the server/browser line.

## Preview and verify

```bash
swell app dev     # from the app root: preview through Swell, as a visitor
swell app push    # build and deploy to the test environment
```

`swell app dev` serves the local frontend at `https://<storeId>--<storefrontId>--local.swell.store`, connected to the app's storefront in the test environment. `--store-user` is refused for storefront apps. When the app runs more than one storefront, pick one with `--storefront-id <id>` or `--storefront-select`.

Check each of these before calling a storefront page done:

1. `swell app dev`, in a private browser window: the page renders on a first visit, with no session cookie yet.
2. Add a product to the cart: the header count changes without a reload and is the same after one.
3. Open a customer-only page as a visitor: it sends you to the login page. Log in as a customer: it shows that customer's data. Log out: it sends you to the login page again.
4. Open a product address that does not exist: the not-found page, not an error page.
5. `swell app push`, then open the storefront's address and repeat 1–4 against the deployed build.
