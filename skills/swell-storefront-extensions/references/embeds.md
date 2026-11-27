# Embed blocks — `storefront.embeds`

An embed block is a widget a merchant places on a page, like a section. The app declares its blocks and the script that renders them; the storefront loads the script only on pages that place one of the app's blocks.

```sh
swell create block packages -y                                      # script block: frontend/public/embed.js, "integrity": "auto"
swell create block gift_card_form --render component -l "Gift card form" -y   # component block: components/GiftCardForm.tsx
```

Both add the block to `storefront.embeds` in `swell.json` (Swell CLI 2.9.41 or later). Then add its props and `swell app push`. A script block needs the app's frontend (the `swell-app` skill's `references/frontend.md`) to serve the script.

```json
{
  "storefront": {
    "embeds": {
      "version": 1,
      "script": "frontend://embed.js",
      "integrity": "auto",
      "connect": ["https://api.example.com"],
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
        }
      ]
    }
  }
}
```

| Key | Description |
| --- | --- |
| `version` | `1`, optional |
| `script` | Required when any block runs in the page: a `frontend://<path>` link (≤ 500 characters) to a file the app's frontend serves, loaded from the installation's frontend origin |
| `integrity` | `"auto"`, or a `sha256-`/`sha384-`/`sha512-` hash. With `"auto"`, push hashes the file in `frontend/public/`, sets a sha384 `integrity` and a `v` query parameter, and switches to the new script once the frontend that serves it is deployed; your `swell.json` keeps `"auto"`. An explicit hash that doesn't match the file fails the push. |
| `connect`, `img` | Up to 10 https origins each that the script calls or loads images from (`img` also takes `data:`). The app proxy is on the page's own origin and needs no entry. |
| `blocks` | 1 to 20 |

No other keys. **The declaration is read whole**: one bad block or prop leaves out all of the app's blocks, and push refuses it, naming each problem.

**Blocks**: `id` (1–40 of `a-z`, `0-9`, `_`), `label` (1–80), `description` (1–300), `icon` (1–40 of `a-z`, `0-9`, `-`), `render` (`script`, the default, or `component`), `component` (component blocks only: a top-level file in `components/`), `pages` and `props`.

- **Page types**: `home`, `product`, `category`, `category_list`, `search`, `cart`, `content` (content pages and policies), `blog`, `blog_post`, `account` (account and sign-in), `not_found`. Default: all but `account`. A block in the cart drawer counts as `cart`. On a page type the block doesn't list, the storefront refuses to place it and shows only its fallback.
- **Props**: at most 20, each `{id, type, label, description?, default?, options?, min?, max?}`, type `text`, `textarea`, `url`, `number`, `boolean` or `select` (1–50 `{value, label}` options). A prop the merchant leaves unset is absent, so the block applies its own default. Saved values are a flat JSON object of at most 4,096 bytes.

## Placing a block

Merchants place blocks from the storefront editor, which lists every installed app's blocks with one field per prop; Wave lists them under **Add section › Apps**, and its agent can place them. A theme section can place one with ui-kit's `AppEmbed`:

```typescript
<AppEmbed app="my_app" block="packages" props={{ layout: 'grid' }} minHeight={240}>
  <p>{t('packages.fallback')}</p>
</AppEmbed>
```

The children are the fallback shoppers see before the block mounts, without JavaScript, and when the app isn't installed. Either way the storefront renders one element, `<div class="uk-app-embed" data-app-embed="<app>/<block>" data-app-props="<json>">…fallback…</div>`; only the renderer writes `data-app-*` attributes. The editor canvas never runs app scripts or frames, only a labelled placeholder. A placed block whose app is uninstalled keeps showing its fallback until the merchant deletes it.

## The block script

Loaded at most once per page, on pages that hold one of its script blocks or may show one in the cart drawer. It registers its blocks and never searches the page:

```javascript
(window.SwellAppBlocks = window.SwellAppBlocks || []).push({
  app: 'my_app',
  blocks: {
    packages: {
      mount(element, context) {
        const root = element.shadowRoot || element.attachShadow({ mode: 'open' });
        // render into root with context.props
        return () => root.replaceChildren();   // optional cleanup, called when the element leaves the page
      },
    },
  },
});
```

- `mount` runs for every placed element of the block, now and added later (the cart drawer). Load order doesn't matter.
- `context`: `props`, `app`, `block`, `storefront` (`{storeId, storefrontId, currency?, mode: 'live' | 'preview'}`), `proxy` (`/.swell/apps/<app>`), `page` (`{type, id?}`; the record's id on a product, category, content page or blog post; `{type: "cart"}` in the drawer).
- Touch only your own elements: render into a shadow root, no global CSS, no globals but `SwellAppBlocks`. Keep the script small and load heavy parts on interaction.
- Theme values reach the block as CSS custom properties (use each with a fallback): `--swell-color-text`, `--swell-color-muted`, `--swell-color-background`, `--swell-color-surface`, `--swell-color-accent`, `--swell-color-on-accent`, `--swell-color-border`, `--swell-font-body`, `--swell-font-heading`, `--swell-radius`, `--swell-space`.
- Swell caches frontend files by URL: a changed script needs a new URL, which `"integrity": "auto"` handles.

**Content Security Policy.** On a page with a script block, the storefront adds exactly the script's URL to `script-src` and the declared `connect` and `img` origins. Nothing else loads: a third-party widget's own scripts are refused unless they are bundled into the app's script. On a page with a component block, the installation's frontend origin is added to `frame-src`.

## Component blocks

`"render": "component"` runs one of the app's components in a frame on the app's installation origin: the page can't see inside, and the component can't see the page. Use it for sensitive input such as card details, or state the page must not see, and only for a few instances per page. The block declares its `props` in `swell.json`; the component gets their values as `params`, the theme tokens in `context.tokens`, and calls the app with `props.fetch`. An app whose blocks are all component blocks needs no `script`. Components are the `swell-app` skill's `references/components.md`.

## Calling the app

A script block calls the app through the app proxy at `context.proxy`, on the storefront's own origin: no CORS. Swell forwards `/.swell/apps/<app>/<path>` to the app frontend's `/app-api/storefront/<path>` with a signed `Swell-Context` header, the method, query and body, and only the headers `accept`, `accept-language`, `content-type`, `if-none-match`, `idempotency-key` and `x-app-authorization`. Cookies are never forwarded.

```typescript
import { verifySwellContext, isStorefrontRequest } from '@swell/apps-sdk';

export async function GET(request: Request) {
  const context = await verifySwellContext(request.headers);
  if (!isStorefrontRequest(context)) return new Response(null, { status: 403 });
  // context.storeId, context.storefrontId, context.storefrontHost, context.accountId
}
```

The context proves the request came through one of the store's storefronts. `accountId` says who is signed in (absent for a guest), not what they may see: check that it owns any private data you return, and rate-limit, since storefront pages are public. A self-hosted frontend also passes `appId` to `verifySwellContext` (the `swell-app` skill's `references/frontend.md`). A component block calls with `props.fetch`, which on a storefront carries a token the gateway turns into the same context; that differs from a component mounted on another page with `createComponents`, whose calls are anonymous (`components.md`).

## Limits

| Limit | Value |
| --- | --- |
| Apps with embeds per store | 10 |
| Blocks per app | 20 |
| Props per block | 20 |
| Options per select prop | 50 |
| `connect` and `img` origins | 10 each |
| Saved settings per placed block | 4,096 bytes of JSON |

Another storefront app can host embed blocks with the Apps SDK; an app's declaration and block code are the same on every storefront.
