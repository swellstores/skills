# Rebuilding a site as a Wave theme

The route for rebuilding an existing website as a Wave theme in code. For a Shopify store, this route (or Wave's own rebuild) is what Swell recommends, not running the Shopify theme on Proxima. Start with the questions in `SKILL.md` ("Rebuilding an existing site: ask first") and keep the answers in front of you: they decide how far each step goes. For **Recreate it closely**, every step aims at the source; for **Take its look and feel**, take the design and leave out the source's words and photos.

## 1. Capture the source

Open the source site in a browser and record, page by page (home, a category, a product, search, cart, and the header and footer):

- A screenshot at desktop and phone widths, kept to compare against at the end.
- The page as an ordered list of sections: what each shows, where its content comes from (products, categories, fixed copy) and what it does when used.
- The design: read computed styles with the browser's JavaScript (`getComputedStyle`) for background and text colors of the header, navigation, buttons, prices and sale badges; font families and weights (`document.fonts`); radii and spacing. A custom font that isn't on Google Fonts gets the closest Google font.
- The logo, the menu tree (top level and children) and the footer columns.
- Every feature that does more than display: forms, accounts, loyalty, chat, price matching, store finders, trade-ins. Sort them now (`capabilities.md`).

Read pages as a normal visitor would. If the site answers automated requests with a bot check or "verifying your connection" page, don't try to get around it: use what the browser shows and the addresses that do answer, or ask the user for an export or admin access.

## 2. Bring the data

Use the target store's test environment. `swell api` works on the store the CLI is logged in to, and writes to test unless given `--live`.

- `swell switch <store>` changes the CLI's default store for every terminal and session on the machine. Switch back when done. A store that has no CLI session yet needs `swell login --store <store>`, which completes in the browser.
- `--body` takes JSON or a path; a relative path needs `./` (`--body ./menus.json`), or it is parsed as JSON.

**Catalog.** From Shopify with admin access, follow developers.swell.is "Migrate from Shopify" (Admin API token; products, customers, orders). For the user's own Shopify store without admin access, its public catalog is enough for products: `https://<store>/collections.json` lists the collections, and `https://<store>/collections/<handle>/products.json?limit=250&page=1` lists a collection's products, 250 at a time (keep raising `page` until one comes back empty), each with its `title`, `handle`, `body_html`, `vendor`, `product_type`, `options`, `variants` (`price`, `compare_at_price`, `sku`) and `images` (`src`). Map each product:

| Swell | From |
| --- | --- |
| `name`, `slug`, `description`, `sku` | `title`, `handle`, `body_html`, the variant's `sku` |
| `price`, `sale`, `sale_price` | When `compare_at_price` is above `price`: `price` is the compare-at price, `sale: true` and `sale_price` is the price, so the theme gets `on_sale`, `compare_at` and the deal price. Otherwise: `price` only. |
| options and variants | A product with more than one variant needs Swell options and variants; see the `swell-backend-api` skill's `references/products-inventory.md`. |
| `active` | `true` to show it |
| `stock_tracking` | Decide it deliberately; see `swell-backend-api` |

**Images.** Swell doesn't fetch an image from an address. Download each image (a CDN may answer 403 without a browser `User-Agent`), resize it to what the theme shows (a `?width=1000` parameter does this on Shopify's CDN), and post it inline: `images: [{ file: { data: { $base64: '<base64>' }, content_type: 'image/jpeg', filename: 'front.jpg' } }]`. The `$base64` wrapper is required, and a request body must stay under 10 MB, which is about 7.5 MB of images once encoded; see the `swell-backend-api` skill's `references/files-media.md`. Images then live on `cdn.swell.store`, the only host theme sections can load them from.

**Categories.** Create each category (one per Shopify collection), then put products in it with `"categories": [{ "parent_id": "<category id>" }]` on the product; `category_id` sets the primary category and links it the same way. **Don't write `category_index`**: Swell derives it from the links, and writing it makes `?category=` (and so the storefront's category pages) match while the category's own product list in the dashboard stays empty. Check the links, not the filter: `GET /categories:products?where[parent_id]=<category id>` (or the category's products in the dashboard) lists them, while `?category=` also matches products that only have `category_index`. Give each category an image (`images: [{ file: … }]`) when the theme shows category tiles or circles: `CollectionData.image` comes from it.

**Content pages and policies** for footer links: create them in the dashboard or the API, so menu links and policy links have somewhere to go.

**Store settings that change what shoppers see**: the store name (or `brand.store_name` in the theme's `settings.json`), the logo (the Theme tab), the currency and locale (they decide how prices are formatted: `A$` against `$`), and payments and shipping for checkout.

## 3. Design settings

Turn the captured design into `theme/config/settings.json` (`wave.md`, "Design settings"): colors as tokens, the fonts with their faces (generated, never `"faces": []`), radius, density, width, card style and product image shape. A display font for headlines can go in `--uk-font-accent`, but ui-kit also draws every eyebrow and menu link in it, the core sections' included: set `font-family` back in your own sections where that doesn't suit. Run `swell theme check` after this step: font and token mistakes show here.

## 4. Header and footer

Compare the source's header with the core header and its settings: logo, menu, search, account and cart on one row (`layout: left`), or the menu on a row of its own (`centered`), with its own colors and an over-the-hero mode. For anything beyond that, such as a colored bar with a large search and quick links over a separate menu bar, write a header section of your own and list it in `theme/groups/header.json`, keeping the core `announcement` section for a top bar. The core footer, with `background_colour` and `text_colour` set and the `footer_menu` holding the source's columns, is often close enough; otherwise write a footer section and `groups/footer.json`.

The menus themselves are set after the first push, in step 7.

## 5. Pages

Map every source section to one of three things:

- **A core section**: `product_grid`, `collection_list`, `collection_header`, `email_signup`, `faq`, `page_content` and the rest, used as they are and restyled with tokens and their color fields.
- **A section from the Tide starter**: `hero`, `image_tiles`, `feature_list`, `story`, `testimonials`, `stats`. Restyle, rename or replace them.
- **A section of your own**, for the source's signature parts: promo banners, category circles, deal tiles with savings and end dates, product rails with badges, service tiles, a price-promise band. Built from ui-kit pieces, driven by data fields, with the source's words in the template's props and fixed words in Store text.

For a close copy, the product page is the usual gap: the core `product_details` restyles only through tokens, though its `points` field gives delivery and return promises and its `details` field adds rows. When the source has a distinctive buy box (a large price panel, badges beside the price), write a buy-box section with `ProductForm`, `Price`, `Image` and `Breadcrumbs` and use it in `product.json` in place of `product_details`. `ProductForm` keeps variant choice, quantity, purchase options and add to cart working; add what else the core section showed that this catalog uses, such as attributes, bundle items and the rating.

Keep the `home`, `product` and `collection` templates; add alternates (`page.about.json`) for content pages the source lays out differently.

## 6. Features beyond display

For each feature sorted in step 1, use an app the store can install where one exists, or build it where it belongs (`capabilities.md`): a section, Swell's own features, or an app that adds it to the storefront with a data source, an action, an embed block or app pages (the `swell-storefront-extensions` skill). Push such an app before the theme. Name it in the theme's `theme.apps` when the theme's pages are built around it.

## 7. Check, push, compare

```sh
swell theme check && swell theme build && (cd app && swell app push)
```

- The first push creates the storefront: now write its `main_menu` and `footer_menu` from the source's menus (`wave.md`, "Menus").
- Open the printed preview address. Compare each page with the source's screenshots, at desktop and phone widths, section by section: colors, type, spacing, images, prices, badges, menus.
- Use it as a shopper: the menu, a category with filters, a product, search, add to cart, the cart page.
- Fix and push again. Each push updates the same storefront's draft.

## 8. Go live

Everything above happens in the test environment, and `swell app push` reaches only test.

- Create a version of each required app and of the theme app, and install them in the live environment (the `swell-app` skill's `references/app-publishing.md`: `swell app version`, then `swell app install -e live`).
- Import the catalog, content pages and policies into live (`swell api … --live`, or the importer run with the live environment).
- In the live environment, create the storefront from the theme in the dashboard (**Online Store › Storefronts**), write its menus, and publish it in the Wave editor. On a storefront that isn't the store's live one, **Replace live site** makes it the one customers see.
- Add redirects from the old site's addresses (developers.swell.is "Redirects"), and connect the domain.

**What a theme rebuild doesn't move**, to plan with the user: customer passwords (customers reset them after a migration), gift card balances, reviews (they come with a reviews app), blog posts, past orders, and the old addresses. Wave's addresses are `/products/<slug>`, `/products` for all products, `/categories/<slug>`, `/categories`, `/pages/<slug>`, `/search?q=`, `/cart` and `/account`.

## 9. Report

Tell the user, page by page:

- what matches the source;
- what is close but simplified, and **what an exact match would take** ("the price box uses the core product details; a buy-box section of our own would match it");
- what needs them: a logo file, policy text, payments and shipping, an app to install, content to write;
- the preview address, and that nothing is live until they publish in the Wave editor.

Never present a choice you made, or something you didn't build, as a limit of Swell or Wave.

## Things that cost time in a rebuild

- `"faces": []` is refused: generate the faces.
- A literal color anywhere in `styles` is refused, `rgba()` inside `filter` or `box-shadow` included.
- `site.page.query` is the raw query string (`?q=boots`). Don't pass it to `SearchBox` as the term.
- Prices come formatted for the store's currency and locale; trim `.00` in your own sections if the source shows whole dollars.
- A list field's default doesn't apply to templates: set list props in the template.
- A `collections` query can't be empty: give a section a show/hide select for its category links.
- ui-kit draws menu links in `--uk-font-accent`; a display font there restyles them unless your section sets `font-family`.
- A display font served with `font-display: optional` can be missing on the first paint of a page.
- Add to cart opens the cart drawer and finishes updating the cart in the background: wait for the drawer to show the line before opening the cart page in a test.
