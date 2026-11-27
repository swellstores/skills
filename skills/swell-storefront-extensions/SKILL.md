---
name: swell-storefront-extensions
description: "Use this skill when a Swell app adds features to a store's storefront: embed blocks merchants place in the storefront editor (script or component blocks, swell create block, AppEmbed), data a theme renders on the server (storefront.data, app_data fields), forms a theme posts to the app's functions (storefront.actions, AppAction, cart_add), app pages at addresses the app owns (storefront.pages) and product ratings in every theme (storefront.product_rating). Covers the swell.json declarations, the public route functions behind them, who the shopper is, caching, limits, the theme side in Wave and required apps (theme.apps), and testing. Use it for features such as loyalty points, wishlists, price-match or quote forms, trade-ins, store finders, registries, bookings, reviews and an app's own chat or booking UI on a Wave storefront. Load swell-app with it whenever the app's models, functions or swell.json change and to push, and swell-themes for the theme sections that use the extensions."
allowed-tools: Read, Grep, Glob, Bash
---

# Storefront extensions

Any Swell app can add features to storefronts by declaring them under `storefront` in its `swell.json`. A storefront that supports extensions reads the declarations of the store's installed, active apps, at the version each store has installed, and merchants use them in its editor. The app stays an ordinary app: **load the `swell-app` skill as well whenever you write or change the app itself**, its models, functions, permissions and `swell.json`, and to push it. This skill covers only the `storefront` declarations and their contracts. An app that only adds storefront extensions uses the default type, `admin`, or `integration` when it connects an outside service. Not `storefront`: that type makes the app a storefront of its own.

Each storefront app decides which extensions it supports; Wave and Proxima are storefront apps like any other.

| Storefront app | Supports |
| --- | --- |
| Wave | Every extension below |
| Proxima | None. A Proxima theme can require an app but can't use its blocks, data, actions, pages or ratings. |
| A storefront app of your own | Embed blocks, hosted with the Apps SDK (developers.swell.is "Apps SDK") |

## Pick the extension

| Need | Extension | App code in the page |
| --- | --- | --- |
| The app's own interactive UI on a page, placed by merchants: a booking calendar, a configurator, the app's chat UI, a live countdown. Its code is bundled into the app's script: the page's CSP admits no other script | Embed block, `render: script` | Yes, in a shadow root |
| Input or state the page must not see, such as card details | Embed block, `render: component` | In a frame on the app's origin |
| Data a theme renders with its own markup on the server: the signed-in customer's points, quotes or registries, or a list for the whole store, which search engines also see | Data source | No |
| A form whose logic stays in the app, which may add cart lines: price match, quick order, create a registry, join a program | Action | No |
| Whole pages at addresses the app owns, rendered in every theme: `/courses`, `/trade-in`, `/stores`. Pages with an address parameter (`/courses/<course>`) can't be pushed yet: see `references/data-and-pages.md` | App pages | No |
| Stars and recent reviews on product cards and product pages in every theme | Product rating | No |

A theme section reads data with an `app_data` field, posts forms with `AppAction` and places blocks with `AppEmbed`; merchants can also place blocks themselves in Wave's **Add section › Apps**, and Wave's agent can place them. A theme whose pages are built around the app names it in `theme.apps` as a **required app**: see the `swell-themes` skill, `references/wave.md`, "Required apps".

## Declare

```json
{
  "id": "loyalty",
  "type": "admin",
  "storefront": {
    "embeds": { "version": 1, "script": "frontend://embed.js", "integrity": "auto", "blocks": [ … ] },
    "data": [ … ],
    "actions": [ … ],
    "pages": [ … ],
    "product_rating": { "average": "rating", "count": "review_count", "reviews": "reviews" }
  }
}
```

- `swell app push` validates `embeds`, `data` and `actions` (Swell CLI 2.9.39 or later; `"integrity": "auto"` and `swell create block` need 2.9.41), refuses a declaration that breaks a rule and names each problem. It warns when a declared function isn't in `functions/` or isn't a public POST route, and when a collection source isn't in `models/`.
- Storefronts read each extension on its own: a data source, action, page or rating declaration that breaks a rule is left out, and the app's others still work. An embed declaration is read whole: one bad block or prop leaves out every block.
- An app is always named by the `id` in its `swell.json`; a declaration never names its own app.
- An app can declare up to 20 data sources, 20 actions, 20 pages and 20 blocks. A storefront reads data sources and actions from up to 20 apps per store, and embeds from up to 10.

## The functions behind data, actions and pages

A function data source, an action and an app page's page-scope sources are answered by one of the app's functions, called by the storefront as a **public POST route**:

```typescript
export const config: SwellConfig = {
  description: 'Storefront action: ask for a price match',
  route: { public: true, methods: ['post'] },
};

export async function post(req: SwellRequest) {
  const body = req.body ?? {};                 // read req.body: in req.data, query keys can override it
  // body: { bridge: 1, kind: 'data' | 'action', id, page?, input?, cart_id?, locale, currency, storefront_id }
  const accountId = req.session?.account_id;   // the signed-in shopper, from the session only
  // …
}
```

**Treat every call as public.** The route is public, so anyone can call it with any body. `kind`, `id`, `page`, `input`, `cart_id` and `storefront_id` are claims; check them as a guard, never as permission. Only `req.session.account_id` says who is signed in, and it is present only where the storefront sends the session: actions, `account`-scope data sources and account-only app pages. Check that every record you return or change belongs to that account (act on `cart_id` only when the cart belongs to `req.session.account_id`, never for a guest, and prefer the `cart_add` effect), and check eligibility (a customer group, an approved business) on the app's side: a theme setting that hides prices or pages doesn't protect Swell's APIs, public routes or checkout.

Read the reference for the extension before writing it:

| File | Covers |
| --- | --- |
| `references/data-and-pages.md` | Data sources (collection and function sources, scopes, placeholders, caching, the `app_data` field), app pages, product ratings |
| `references/actions.md` | Actions: declaration, `AppAction`, the storefront's checks, the request, effects, messages and errors |
| `references/embeds.md` | Embed blocks: script and component blocks, props, the block registry, the app proxy, CSP, `AppEmbed`, limits |

## Test

1. `swell app push` the app. It deploys to the store's test environment.
2. On a storefront in the same environment, open the Wave editor: blocks are listed under **Apps**, and sections that use the data sources render their samples. Push the theme that uses the app after the app.
3. Open the storefront's preview as a shopper. Submit the forms, sign in as a test customer for anything account-scoped, and open the app pages.
4. `swell logs` shows each call the storefront makes to your functions; `swell api get '/apps/<app_id>/<collection>'` shows what they stored.
