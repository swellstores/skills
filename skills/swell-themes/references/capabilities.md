# What a Wave storefront can do, and how

Before telling a user that something can't be done, find it here. Most features of a modern storefront have a route on Swell: in the theme, in Swell itself, or in an app that adds it to the storefront. Say which route, and that it is possible, even when you aren't building it now.

**Where a feature belongs:**

- **Theme section**: anything that displays store data or merchant copy, in any layout. Sections render on the server, with no code in the shopper's browser.
- **Swell**: commerce the platform already has: sale prices, subscriptions, bundles, customer groups and their prices, gift cards, promotions and coupons, multiple currencies and languages, redirects, hosted checkout.
- **An app** (the `swell-storefront-extensions` skill): anything that keeps records, runs logic on a server, calls an outside service, checks who the customer is, or needs code running in the page. It reaches the theme as a **data source** (server-rendered data), an **action** (a form the storefront posts to the app's function, which can add cart lines), an **embed block** (the app's own script or framed component in the page), **app pages** (pages at addresses the app owns) or **product ratings**. A theme built around an app names it as a required app.

## Common features

| Feature | Route |
| --- | --- |
| Hero banners, promo tiles, deal tiles, category circles, service tiles | Theme sections. Images come from an `image` field or from the products and categories they show, on Swell's file hosts. |
| Carousels and sliders | A theme section shows slides in a strip that shoppers swipe or scroll, with CSS scroll-snap, and arrows and dots as links to each slide's `id` (ids from `useId`, `href="#<id>-s2"`). Tried on a Wave storefront: a click moves the strip to that slide, and Wave keeps the ids and links. A link also scrolls the page to the slider (set `scroll-margin-top` on the slides) and adds the slide to the address, and dots can't mark the current slide, since no code runs in the page. **Slides that advance on their own** aren't a theme-section feature: CSS `@keyframes` could move them, but Wave's theme rules, which apply to client themes too, keep content visible without timers or motion, and a timed slider needs a pause control to be accessible. Code in the page comes only from an app's embed block, which needs the app to have a frontend and takes its slides as props (text, URL, number, boolean, select; there is no image prop). |
| Mega menu | `NavMenu` renders up to 3 levels; `editor.json` sets the levels, columns and links each menu area takes. Menu items carry no images: a menu with images or promo panels is a header section of your own that renders the `MenuData` of its `menu` field beside images and links from its own list field (or products from a `product_list` field), opening panels with CSS (`:hover`, `:focus-within`) instead of script. Check it at phone width. |
| Sticky header | The core header stays in view unless the theme declares a `sticky_header` setting and the merchant turns it off. A header of your own: `position: sticky; top: 0` on `&` in its `styles`, since the platform wraps each section and an inner element can't stick past the wrapper. `position: fixed` is allowed only in header-group sections. |
| Search with suggestions | `SearchBox`; Wave's page script runs the suggestions. Results: the core `search` template or a section with a `{ "from": "search" }` product list. |
| Filters and sorting | `product_grid` with `filters`, or `FilterForm`, `ActiveFilters` and `SortSelect`, from the product attributes the catalog has. |
| Sale prices, "was" and ticket prices, savings | Swell's `price`, `sale` and `sale_price` on the product; sections read `on_sale`, `compare_at` and `price`, and compute a saving from them. |
| Badges (on sale, sold out, exclusive) | From product data only: `on_sale`, `stock`, or a product attribute or tag the merchant sets. Never a made-up badge. |
| "Ends on" dates on deals | A text field in the section or block, or a date the app or catalog holds. A live countdown that ticks needs an app's embed block. |
| Countdowns, live stock tickers, anything that updates in the open page | An app's embed block (script). |
| Big price box, custom buy box | A product section of your own built with `ProductForm` (variant choice, quantity, purchase options, add to cart) and `Price`, used in `product.json` instead of the core `product_details`. Delivery and return promises don't need one: the core section's `points` field shows them. |
| Quick add on cards | `QuickAdd`, or the core cards' `card_quick_add` theme setting. |
| Subscriptions | Swell's purchase options. `ProductForm` shows them on the product page; `SubscribeSwitch` switches a cart line to a subscription. |
| Wholesale or members-only prices | Swell's customer groups and group prices; a theme setting with `prices_hidden` hides prices for shoppers outside the groups. Enforce who may order in the app or checkout, not the theme. |
| Gift cards | A Swell product of type `giftcard`. |
| Newsletter sign-up | The core `email_signup` section or `NewsletterFields`. |
| Contact and enquiry forms | The core `contact_form`; a form with its own logic or records is an app's action. |
| Price match ("seen it cheaper?"), quote requests, call-back requests | An app's action: the form posts to the app's function, which stores the request and answers with a message. |
| Loyalty points and member tiers | An app: a model for points, functions that add points on orders, a data source with `scope: account` for the signed-in customer's balance, and customer groups for tiers. No action effect applies a discount, so redeeming points creates a coupon code (shown in the action's message or the account section) or store credit. |
| Trade-in | An app: a trade-in app page with data sources for device values, an action for the quote, and store credit or a gift card for the payout. A page per device (`/trade-in/:device`) needs app pages with params, which can't be pushed yet (`swell-storefront-extensions`, `references/data-and-pages.md`). |
| Warranty and protection add-ons | Products of their own, offered as up-sells or cross-sells, or an app's action that adds them to the cart. |
| Store finder, locations | Content pages for a few fixed locations. For many, an app page listing them from a `store` data source. A search by postcode or "near me" needs code in the page (an embed block with a map, placed on a content page): data source functions get no query string, and embed blocks can't be placed on app pages. A page per location needs app pages with params, which can't be pushed yet (`swell-storefront-extensions`, `references/data-and-pages.md`). |
| Live chat | An app's embed block. Theme code can't load scripts, and on a page with a script block the storefront's Content Security Policy admits only the app's own script and the origins it declares in `connect` and `img`: bundle the chat service's client into the app's script, or run it in a component block's frame on the app's origin. |
| Product reviews and star ratings | A reviews app that declares `product_rating`: stars and counts show on cards and product pages in every theme. |
| Wishlists and saved items | An app: a data source for the customer's list and an action to add and remove. |
| Marketplace with outside sellers | The shopping side is an app: models for sellers and their products, app pages for seller pages, data sources and actions for listings. Checkout charges the store's own payment gateway, so paying sellers their share is the app's job, through an outside service such as the payment provider's transfers after each paid order. |
| Blog, news and guides | The core blog templates and `post_list`, `post_body`. |
| Custom pages (services, about, financing) | Content pages, with alternate `page.<name>.json` templates for their own layouts. |
| Multiple languages and currencies | Store text translations, Swell's localized records, `LocalizationForm`. |
| Old addresses after a migration | Storefront redirects, with `*` patterns. |
| Age confirmation | `AgeGate` from the layout, behind a theme setting. A courtesy prompt, not age verification. |

## Hard limits of theme code

These are the real limits. Everything else in the table above is a choice of route.

- Section and block code renders on the server: no event handlers, no browser globals, no timers, no `script`, `iframe`, `style` or `link` elements, no fetching.
- Images and other resources load only from `cdn.swell.store`, `cdn.schema.io` and `fonts.gstatic.com`.
- Core sections can't be changed or overridden, only restyled with tokens and their settings, or replaced in a template by a section of your own.
- Wave writes the page's `title`, meta tags and structured data; a theme can't add `meta`, `link` or `script`.
- At most 20 sections per page, 12 section groups, 64 KB per module, 8 KB of `styles` per section and 64 KB per page, and `position: fixed` only in the header group.
- Up to 3 Google Fonts families; merchants pick two in the Theme tab.
