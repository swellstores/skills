# Storefront app blocks

An app block is a widget merchants place on their storefront pages, like a section: a booking calendar, a packages list, a loyalty balance, a gift card form. The app declares its blocks in `swell.json` under `storefront.embeds`. Any storefront that supports app blocks (Wave does) lists them under **Add section → Apps**, renders each field of its props schema in the inspector, and loads the block on its pages. Nothing is set up per store: every store that installs the app gets its blocks on every storefront.

## Choose: a block, which mode, or no block

Decide this first. It sets the files, the security model and the cost.

| The feature | Build |
| --- | --- |
| Interactive UI on a page that shows store or app data and lets shoppers act (book, add to cart, subscribe, check a balance) | `script` block (default) |
| The same widget several times on a page, or page-wide UI: a chat launcher, a sticky bar, an overlay | `script` block |
| UI that collects card details, passwords or other sensitive input, embeds a third-party SDK that must not share the page, or holds state the page must never see | `component` block |
| A small piece of data on every product card or line (rating, badge, delivery estimate), or content search engines must index | **No block**: publish the data (an app collection with `public_permissions`, a `public` route) and let the storefront render it with the theme's markup |
| A whole page or site for shoppers | A `storefront` app — `references/frontend-storefront.md` |

The two modes differ in where the app's code runs:

- **`script`**: one script per app, loaded once in the storefront page, renders into each block's element. It matches the theme through CSS custom properties, each extra instance costs a function call, and it can open overlays. The merchant trusts it with the whole page, so it must stay inside its own elements.
- **`component`**: an App Component in an iframe on the app installation's own origin. The page can't see into it, and it can't see the page. Each instance is a separate document plus a config request, so use it for one or two per page. It can't use the page's fonts, and its own cookies and storage are third-party (Safari partitions them).

When unsure, choose `script`. Changing a block's mode later changes only the app's code and the block's `render` key. Blocks merchants already placed keep working.

## Declare

```json
"storefront": {
  "embeds": {
    "version": 1,
    "script": "frontend://embed.js",
    "integrity": "auto",
    "connect": [],
    "img": [],
    "blocks": [
      {
        "id": "packages",
        "label": "Packages",
        "description": "Your treatment packages, as cards or a compact strip.",
        "icon": "package",
        "pages": ["home", "product", "content"],
        "props": [
          { "id": "layout", "type": "select", "label": "Layout", "default": "grid",
            "options": [{ "value": "grid", "label": "Cards" }, { "value": "compact", "label": "Compact strip" }] },
          { "id": "limit", "type": "number", "label": "Packages shown", "min": 1, "max": 24 }
        ]
      },
      { "id": "gift_card_form", "label": "Gift card form", "render": "component", "component": "GiftCardForm" }
    ]
  }
}
```

Scaffold with `swell create block <id> [--render script|component] -y`. Do not hand-write what it produces. Push validates the declaration. Hosts read it strictly: **one invalid key, block or prop removes every block of the app**, with no partial result.

- `script`: required when any block is `script` mode. A `frontend://<path>` link to a file the app's frontend serves, at most 500 characters, no spaces or quotes. `"integrity": "auto"` makes push pin the hash of the built file, so stores run the bytes that were released. Set it for a self-hosted frontend.
- `connect` / `img`: at most 10 `https://host` origins each, and only for third-party origins (`img` also takes `"data:"`). The app's own backend goes through the app proxy and needs no entry. An undeclared origin is blocked by the page's CSP.
- A block: `id` `[a-z0-9_]{1,40}`, `label` 1–80 characters, optional `description` (1–300) and `icon` (`[a-z0-9-]{1,40}`), `render` (`script` default, or `component` with `component` naming a top-level file in `components/`), `pages`, `props`. At most 20 blocks.
- `pages`: `home`, `product`, `category`, `category_list`, `search`, `cart`, `content`, `blog`, `blog_post`, `account`, `not_found`. Absent means every page type except `account`. Blocks in a cart drawer count as the `cart` page's.
- `props`: at most 20 editor fields `{id, type, label, description?, default?, options?, min?, max?}`. `id` `[A-Za-z][A-Za-z0-9_]{0,39}`. Types: `text`, `textarea`, `url`, `number` (`min`/`max`), `boolean`, `select` (`options` 1–50 `{value, label}`). There are no list or record-picker types. A prop the merchant leaves unset is **absent**, so the app applies its own default. The saved values are at most 4 KB of JSON.
- Never declare the app's id or name. The host takes them from the installation.

## Write a `script` block

Register with the host's block registry. **Do not search the page or run a MutationObserver**: the host mounts every placed element, including ones added later (cart drawer, client navigation), and calls the cleanup when an element leaves the page.

```ts
(window.SwellAppBlocks = window.SwellAppBlocks || []).push({
  app: '<app_id>',
  blocks: {
    packages: {
      mount(element, { props, proxy, storefront, publicKey }) {
        const shadow = element.attachShadow({ mode: 'open' });
        // render into shadow; read props.layout ?? 'grid'
        return () => { /* unmount */ };
      },
    },
  },
});
```

- `context`: `props` (saved values), `app`, `block`, `storefront` `{ storeId, storefrontId, locale?, currency?, mode }` (`locale` and `currency` absent when they are the store's own), `proxy` (the app proxy's base path), `publicKey` (for Storefront API calls with swell-js).
- Render into a shadow root, with styles in `adoptedStyleSheets`. Touch nothing outside the element: no global CSS, no globals other than `SwellAppBlocks`, no reading other parts of the page.
- Match the theme with the custom properties the host sets on the element. They inherit into the shadow root, so always give a fallback: `--swell-color-text`, `--swell-color-muted`, `--swell-color-background`, `--swell-color-surface`, `--swell-color-accent`, `--swell-color-on-accent`, `--swell-color-border`, `--swell-font-body`, `--swell-font-heading`, `--swell-radius`, `--swell-space`.
- Every shopper downloads the script. Keep it small and load heavy parts (a checkout SDK, a calendar) when the shopper interacts. A block must not cost the page more than 10 Lighthouse performance points.
- The editor canvas never runs app code: merchants see a labelled placeholder. Verify on the storefront itself.

## Write a `component` block

A component in `components/` (`references/components.md`) whose config opts into the storefront place:

```tsx
import type { ComponentProps } from '@swell/apps-sdk/components';
export const config = { targets: [{ id: 'storefront.block' }] };
export default function GiftCardForm({ params, context, fetch }: ComponentProps) { /* … */ }
```

`params` are the block's saved props, `context.storefront` and `context.tokens` the storefront and the theme values above, and `fetch` calls the app's own origin with a storefront component token. Scaffold with `swell create block <id> --render component -y`, which writes the component and the declaration together.

## Call the app's backend

**Never keep a list of allowed origins.** Merchants add storefronts, preview hosts and custom domains at any time, and an origin list refuses each new one. Swell tells the app which store and storefront a request came from.

- From a `script` block, call `context.proxy`, e.g. `/.swell/apps/<app_id>/packages`. It's same-origin for the page, so there is no CORS. Swell forwards it to the frontend's `/app-api/storefront/packages` with a signed `Swell-Context`.
- From a `component` block, call `props.fetch`. The token it adds becomes the same verified context.
- In the endpoint:

  ```ts
  import { verifySwellContext, isStorefrontRequest } from '@swell/apps-sdk';
  const context = await verifySwellContext(request.headers);
  if (!isStorefrontRequest(context)) return new Response(null, { status: 403 });
  // context.storeId, context.storefrontId, context.storefrontHost, context.accountId
  ```

- The context proves the request came through one of the store's storefronts. It doesn't prove who the shopper is, because storefront pages are public. Rate-limit storefront endpoints. `accountId` is the logged-in customer or `null`: check that they own any private data returned.
- `public` route functions stay reachable at `/functions/<app_id>/<name>` on the store's addresses (`references/functions-routes.md`), with the same storefront fields in their context.

## Test

- `swell app dev --blocks` opens a conformance page. It mounts every block with its defaults and with edge values in light and dark themes, adds and removes blocks as a cart drawer would, flags changes outside the block's element, calls the proxy, and reports the performance cost.
- After `swell app push`, install the app on a test store, place the block from the storefront editor's **Add section → Apps**, publish, and check the live page.

## Errors

| Symptom | Cause |
| --- | --- |
| The app's blocks are missing from **Add section → Apps** | The declaration broke a rule, so the host dropped the whole app (the editor and `swell app push` name the rule). Or the app is not installed and active on that store |
| Placed block shows only its fallback on the site | The app is uninstalled or disabled, the page type isn't in `pages`, or the script failed. Check the console |
| `Refused to connect` / `Refused to load the image` in the console | A third-party origin missing from `connect` or `img` |
| 403 from the app's own endpoint on a new storefront | The endpoint checks origins instead of `isStorefrontRequest` |
| Block renders twice, or not after the cart drawer opens | The script mounts elements itself instead of registering with `SwellAppBlocks` |
