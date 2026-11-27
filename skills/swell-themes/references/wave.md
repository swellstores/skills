# Wave themes

A Wave theme is three layers, and a theme writes only the top one:

| Layer | What it is | Can you change it |
| --- | --- | --- |
| ui-kit | Components and design tokens (`--uk-*`) that sections are built from. Wave provides them at render time, so a theme never ships them. | No |
| `@swell/wave-theme-core` | The sections every storefront needs (header, footer, product details, cart, account, search, blog, policies, not found), with their blocks, templates, Store text, menu areas, and the build and checks. | No: restyle it with tokens and settings, or replace a core section in a template with one of your own |
| Your theme | Design (colors, fonts, spacing), your own sections and blocks, templates, header and footer groups, theme settings, new Store text. | Yes |

`swell theme build` copies the core's files, then the theme's files over them, checks the result and writes the theme app to `app/`. Your templates and groups replace the core's of the same name; Store text and menu areas merge with the core's.

When a storefront is created from the theme, it gets its own copy of the files. The editor, the agent and your pushes write the storefront's draft; **Publish** in the editor makes it live.

## Repo

```txt
swell.json        "type": "theme", "theme": {"storefront": {"app": "wave"}}, a semver "version"
package.json      devDependencies: {"@swell/wave-theme-core": "^1.0.0"}
theme/            the theme's OWN files only, never a copy of a core file
  sections/<type>.tsx           a section: schema + React component (+ styles)
  blocks/<type>.tsx             a block a section holds
  templates/<page>.json         a page type's sections with their props and blocks
  groups/<id>.json              section groups; header.json and footer.json replace the core's
  config/settings.json          design tokens, fonts, brand
  config/settings_content.json  the theme's own global settings (Wave's Theme tab), optional
  config/language.json          Store text: only NEW keys
  config/editor.json            menu areas (key "menus" only), optional
  layout.tsx                    wraps every page, optional
assets/           icon and preview images
DESCRIPTION.md    the Theme Store listing
app/              build output, pushed with swell app push; never edit it
```

`theme/config/version.json` is written by the build from `swell.json`; a theme never ships one.

**Page types.** Every page type must resolve to a template: `home`, `product`, `collection` (a category, and all products at `/products`), `categories`, `search`, `page` (content pages), `blog`, `blog-post`, `policy`, `cart`, `account`, `account-login`, `not-found`. The core has all but `home`, `product` and `collection`, so a theme supplies those three. An alternate template is `<base>.<name>.json` (`product.bundle.json`, `page.about.json`), name in lowercase letters, digits and single hyphens, at most 48 characters; merchants pick it with the record's Template setting.

**Core types you must not reuse** (`core_override`): sections `account_view announcement blog_header cart_items cart_summary collection_filters collection_header collection_list contact_details contact_form email_signup faq footer header login_form not_found page_content policy_text post_body post_list product_details product_grid search_results`; blocks `collection_card hotspot link_column nav_link product_card text upsell_product`. Use them in templates as they are. Type ids are `[a-z][a-z0-9_]*`, at most 40 characters, named by what they do; never `custom_…` (the agent's), `app_block` or `platform_…`, and no "wave" or "tide" in an id.

## Sections

```typescript
// theme/sections/stats.tsx
import { Container, Eyebrow, sectionColours } from 'ui-kit';

export const schema = {
  label: 'Stats',
  fields: [
    { id: 'eyebrow', type: 'text', label: 'Eyebrow' },
    { id: 'items', type: 'list', label: 'Figures', max: 4, item: [
      { id: 'value', type: 'text', label: 'Figure' },
      { id: 'label', type: 'text', label: 'Label' },
    ], default: [] },
    { id: 'background_colour', type: 'color', label: 'Background colour' },
    { id: 'text_colour', type: 'color', label: 'Text colour' },
  ],
} as const;

type Props = { eyebrow?: string; items?: { value?: string; label?: string }[]; background_colour?: string; text_colour?: string };

export default function Stats({ eyebrow, items = [], ...colours }: Props) {
  const shown = items.filter((i) => i && (i.value || i.label));
  if (!shown.length) return null;               // nothing to show: render nothing
  return (
    <section style={{ padding: 'var(--uk-section-sm) 0', ...sectionColours(colours) }}>
      <Container>
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <dl>{shown.map((i, n) => <div key={n}><dt>{i.value}</dt><dd>{i.label}</dd></div>)}</dl>
      </Container>
    </section>
  );
}
```

- **Schema**: `label` (1–80 characters, required), `fields` (at most 40), optional `blocks`, `icon` and `retired: true` (still renders, no longer offered).
- **Field types**: `text`, `textarea` (both ≤ 10,000 characters), `url`, `image` (`{url, alt, width, height, focal}` on Swell's file hosts), `select` (1–50 `options`), `color` (hex), `list` (items of scalar fields only; `max` defaults to 12, at most 50), plus the data fields below.
- **Field keys**: `id` (letters, digits, `_`, starting with a letter, ≤ 40; `key`, `ref`, `blocks`, `site` and `t` are reserved), `type`, `label` (≤ 80), `default` (a valid value), `retired`, `fill: true` (show the default where a saved instance has none; for fields added in a later version).
- **A list field's `default` applies only when a merchant adds the section in the editor.** Templates set list props themselves.
- **Props**: each field's value by its id (data fields already resolved), plus `site`, `t` and, when the section holds blocks, `blocks`. A field with no value is missing or `null`: handle undefined and empty values everywhere. A section with nothing to show returns `null`.

### What section code can use

- Imports only from `react` (named `Fragment`, `useId`, `useMemo`, `Children`; types with `import type`) and `ui-kit`.
- No event handler props (`onClick`), no browser or network globals (`window`, `document`, `fetch`, `setTimeout`…), no dynamic `import()`, no `dangerouslySetInnerHTML`. **Section code never runs in the shopper's browser**: it renders on the server. Wave's one page script handles the cart drawer, the variant picker, search suggestions and menus. Swell plans a way for themes to run scripts of their own; until it ships, interactive parts come from ui-kit components or an app's embed block (`capabilities.md`).
- Elements: standard HTML content elements and a subset of SVG. `script`, `iframe`, `style`, `link`, `meta`, `object`, `embed`, `template`, `dialog` and SVG `use` are refused.
- `style` is an object literal; colors through tokens (`var(--uk-color-accent)`) or `sectionColours`.
- **JSX text, and `alt`, `title` or `placeholder` strings, of more than three words are refused.** Shopper-facing words come from fields or Store text.
- Images and loaded resources only from `cdn.swell.store`, `cdn.schema.io` or `fonts.gstatic.com`. Upload images to the store's files first (a product's or category's images, or an `image` field); draw artwork as inline SVG.
- A form's `action` is a static path on the storefront. Attributes starting `data-section`, `data-block`, `data-app-` and `data-site-cart` are reserved.
- No TypeScript `enum`, `namespace` or `declare`. A module is at most 64 KB.
- Plain JavaScript on values is fine: `price.formatted.replace(/\.00$/, '')`, `n.toLocaleString('en')`.

### Section styles

One static stylesheet per section, for what inline styles can't do: hover and focus, media and container queries, keyframes, reduced motion.

```typescript
export const styles = `
& .tile { transition: transform .2s; }
& .tile:hover { transform: translateY(-2px); }
@media (max-width: 749px) { & .grid { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { & .tile { transition: none; } }
`;
```

- A string or template literal with no `${}` and no backslashes, at most 8 KB. A page's section styles together are at most 64 KB.
- Every selector starts with `&` (the section's wrapper) once, isn't followed directly by `+` or `~`, never names `:root`, `html` or `body`. No nesting. At-rules: `@media`, `@container`, `@supports`, `@keyframes` (names get the section type as a prefix).
- **Colors only through `var()`**, plus `transparent` and `currentColor`. A literal anywhere is refused, including inside `filter`, `box-shadow` or a gradient: `rgba(0,0,0,.3)` fails the check.
- No `@import`; `url()` only to the image and font hosts. `position: fixed` only in sections of the header group.
- **Inline styles win** over `styles`: a rule for a property the element sets inline never applies.
- Set CSS variables inline (`style={{ '--cols': columns }}`) and read them in `styles`.
- Rules in a section's `styles` reach the blocks rendered inside it, so style a block's markup from the section that holds it.

## Blocks

A block is a module at `theme/blocks/<type>.tsx` with a `schema` (the section field rules, data fields included: a block can take a `product` field) and a default component. Blocks can't hold blocks.

```typescript
// in the section's schema
blocks: { types: ['deal_tile'], max: 8 },
// the section places the slots it gets:
export default function Deals({ blocks }: { blocks: ReactElement[] }) {
  if (!blocks.length) return null;
  return <section className="uk-if-blocks"><div className="grid">{blocks}</div></section>;
}
```

- `types` (1–20), `max` (1–50, default 12), `default` (`{type, props}` entries for a new instance).
- The section gets one slot per visible block and never sees a block's props. Don't place slots inside `p`, `a`, `button`, a heading, a table or a `select`. `uk-if-blocks` on the root hides the section while no block renders anything.
- Each block renders on its own with its fields, `site` and `t`.

## ui-kit

Only these exports are stable (types are in `node_modules/@swell/wave-theme-core/types/ui-kit.d.ts`):

- **Layout and type**: `Container`, `Section`, `Grid`, `Card`, `Heading`, `Text`, `Eyebrow`, `Badge`, `Button`, `Icon`, `Image`, `RichText`, `DateText`. Colors: `sectionColours`.
- **Products**: `ProductCard`, `Price`, `ProductForm` (options, purchase options, quantity, stock states, add to cart), `QuickAdd`, `SellList`, `SwatchDot`, `SubscribeSwitch`, `ShoppableImage`, `Hotspot`.
- **Navigation and lists**: `NavMenu`, `Menu`, `Breadcrumbs`, `Pagination`, `SortSelect`, `FilterForm`, `ActiveFilters`, `SearchBox`, `LocalizationForm`.
- **Cart**: `CartLink`, `CartAmount`, `CartQuantity`, `CartTotals`, `CouponForm`, `CartNote`, `PoNumber`, `PaymentIcons`.
- **Account and sign-in**: `AccountBody`, `AccountNav`, `OrderHistory`, `OrderDetail`, `OrderLines`, `BuyAgain`, `AddressBook`, `SubscriptionList`, `SubscriptionDetail`, `StatusBadge`, `AuthForms`, `SignInForm`, `SignUpForm`.
- **Forms and messages**: `Field`, `NewsletterFields`, `Notice`, `AgeGate` (a courtesy prompt, not age verification).
- **Apps**: `AppEmbed` (places an app's block), `AppAction` (posts a form to an app's action). See "Required apps".
- **Helpers**: `safeUrl`, `telHref`, `periodText`, `pricesHiddenFor`, `SignInForPrices`, `inGroups`.
- **Types**: `ProductData`, `CollectionData`, `ProductList`, `MenuData`, `SiteInfo`, `Translate`, `IconName`, `AppFlash` and the rest, with `import type`. Derive a part of a type rather than retyping it (`ProductData['tiers'][number]`). `Icon` takes only the names in `IconName`.

Tokens every section shares: `--uk-color-*`, `--uk-font-*` (`body`, `heading`, `accent`), `--uk-text-*`, `--uk-heading-*`, `--uk-space-*`, `--uk-section-*`, `--uk-radius-*`. Use them rather than literal values, so the Theme tab and the agent can restyle the whole store. **ui-kit draws every eyebrow and menu link in `--uk-font-accent`** (`.uk-eyebrow, .uk-nav-link`), the core sections' included: a display font set there restyles all of them.

## Store data

A data field stores a reference in the template, and Wave resolves it before the section renders:

| Type | Template stores | Section receives |
| --- | --- | --- |
| `product` | a product slug, or `current` on product pages | `ProductData` or `null` |
| `collection` | a category slug, `all`, or `current` on category pages | `CollectionData` or `null` |
| `product_list` | a product query | `ProductList` |
| `collection_list` | a category query | `CollectionData[]` |
| `menu` | a menu id such as `main_menu` | `MenuData` or `null` |
| `content_page` | a page slug, or `current` | `PageData` or `null` |
| `blog` / `blog_post` / `blog_posts` | a slug, `all`, `current`, or a post query | `BlogData` / `PostData` / `PostList` |
| `policy` | `refund`, `privacy`, `terms`, or `current` | `PolicyData` or `null` |
| `cart` / `account` / `auth` | `current`, on the cart / account / sign-in page only | `CartData` / `AccountView` / `AuthView` |
| `app_data` | nothing (`{}`): the field's `app` and `source` are in the schema | `{status, value}`: see "Required apps" |

Data fields are top-level fields only, never list items. Queries:

```json
{ "from": "collection", "collection": "<slug> | all | current", "sort": "best_selling", "limit": 8 }
{ "from": "products", "products": ["<slug>", "<slug>"] }
{ "from": "related", "product": "current", "limit": 4 }          // also "up_sells" and "cross_sells"
{ "from": "all", "sort": "newest", "limit": 12 }
{ "from": "search", "limit": 24 }
{ "from": "collections", "collections": ["<slug>"] }
{ "from": "top", "limit": 6 }
{ "from": "latest", "limit": 3 }
```

`up_sells` and `cross_sells` are `from` values of their own, like `related`; cart pages have `cart_cross_sells` and `cart_products`. Sorts: `featured`, `best_selling`, `newest`, `price_asc`, `price_desc`, `name`. A `product_list` shows up to 48 items, a `collection_list` or `blog_posts` up to 24; each defaults to 12. A `collections` query needs at least one slug, up to the field's `max` (12 by default): an empty list is refused, so give a section a show/hide select instead of an empty query.

- Prices are `Money`: `{amount, currency, formatted}`. `formatted` follows the store's currency and locale (AUD on an `en-US` store shows `A$987.00`). `ProductData` has `price`, `compare_at` and `on_sale`; a product's `price` is `null` when it is priced for customer groups only.
- Descriptions are `TextBlock[]`, never HTML: render them with `RichText`.
- In lists, `variants` is empty; a product's own page has its options, variants, selected variant, attributes, purchase options, bundle items, tiers and primary category.
- In the editor, a store without data shows labelled samples (`sample: true`).

**The `site` prop** is the same for every shopper on a public page:

- `site.store`: name, storefront URL, support email and phone, country, currencies, languages, shipping countries, payment method names, the policies that have text (`{id, title, url}`; the text itself comes from a `policy` field), opt-in modes.
- `site.brand`: the logo, logo width, social links and announcement from the Theme tab.
- `site.page`: `kind`, `path`, canonical `url`, `query` and `title`. **`query` is the page's canonical query string** (`?q=boots`, `?sort=price&page=2`), absent when the page reads none, not the search term: the term is the `query` of the page's search product list (`ProductList.query`).
- `site.year`, `site.currency`, `site.locale`, `site.languages`, `site.notice`, `site.theme_settings`, `site.app_flash` (see "Required apps"), and, only on pages that read the shopper, `site.shopper` and `site.prices_hidden`.

**Data over hard-coded content.** A theme never types a fact Swell holds: store name, contacts, prices, product and category names, policies and navigation come from data fields and `site`. Headings, labels and marketing copy are section fields. A theme's schema defaults are neutral and make no claim, and missing data renders nothing, never a made-up badge, review, figure or link. A client's own copy, such as the headlines of the site being rebuilt, goes in the template's props.

## Templates

```json
{
  "title": "Home",
  "sections": [
    { "id": "hero", "type": "promo_banner", "props": { "line_one": "Summer sale", "cta_href": "/products" } },
    { "id": "best-sellers", "type": "product_grid", "props": { "heading": "Best sellers", "products": { "from": "all", "sort": "best_selling", "limit": 4 } } },
    { "id": "deals", "type": "deal_tiles", "props": {}, "blocks": [ { "id": "tv", "type": "deal_tile", "props": { "product": "<slug>" } } ] }
  ]
}
```

- **To add a section to a page type the core serves** (account, cart, search…), copy the core's template from `node_modules/@swell/wave-theme-core/theme/templates/<page>.json` into `theme/templates/` and add your section beside the core one, keeping the core section's props. Templates may sit at core paths; section files may not. The `account` template serves every account page; a section there that reads an account-scoped app source shows on all of them.
- At most 20 sections, each `{id, type, props, blocks?, hidden?}`; ids are lowercase letters, digits, `-` and `_`, ≤ 40, unique in the template. At most 80 blocks. At most 64 KB.
- Every prop must be a field of its section's schema with a valid value; `current` only on its own page type.
- **The header and footer come from their groups.** A template never holds a section of a type the header or footer group holds, and **a template section's `id` must not equal a group section's id** (`header`, `footer`, `announcement`): the group's section is silently dropped from that page. `hidden_groups` leaves a top, bottom or sidebar group off one page.

## Section groups

Every theme has exactly one header group and one footer group, shown on every page. The core's hold `announcement` + `header`, and `footer`; `theme/groups/header.json` or `footer.json` replaces them.

```json
{
  "type": "header",
  "name": "Header",
  "sections": [
    { "id": "announcement", "type": "announcement", "props": { "text": "Free returns", "link_label": "Details", "link_href": "/pages/returns" } },
    { "id": "store-header", "type": "store_header", "props": { "menu": "main_menu" } }
  ]
}
```

- Before writing a header, try the core one's settings: `layout` `left` or `centered` (the menu on a row of its own), `over_hero`, and its colors. A header of your own is a section with its own type (not `header`) listed in `groups/header.json`. It can render the logo from `site.brand.logo` (else `site.store.name`), `SearchBox`, `CartLink` and `NavMenu`; check it at phone width, where the core header folds its menu behind a button.
- The platform wraps each section in an element of its own, so `position: sticky` on an inner element can't leave it: make a header sticky on `&` in `styles`, as the core header does (`&:has(.uk-header-sticky) { position: sticky; top: 0; }`).
- Group types: `header`, `top`, `left`, `right`, `bottom`, `footer`. Other groups take `pages` (1–40 page types; a base covers its alternates); two groups of one type may not overlap.
- At most 12 groups, each with at most 8 sections and 40 blocks. A group has no page of its own, so its sections can't use `current`.

## Design settings — `theme/config/settings.json`

```json
{
  "format": 1,
  "tokens": {
    "--uk-color-bg": "#ffffff",
    "--uk-color-ink": "#111111",
    "--uk-color-accent": "#111111",
    "--uk-color-on-accent": "#ffffff",
    "--uk-color-highlight": "#ffe600",
    "--uk-color-sale": "#d0021b",
    "--uk-font-heading": "'Roboto', Arial, sans-serif",
    "--uk-font-body": "'Roboto', Arial, sans-serif",
    "--uk-font-heading-weight": 700,
    "--uk-radius-md": 4,
    "--uk-density": "tight"
  },
  "fonts": [
    { "family": "Roboto", "source": "google", "weights": [400, 700], "faces": [
      { "subset": "latin", "style": "normal", "weight": "400", "url": "https://fonts.gstatic.com/s/roboto/…woff2", "range": "U+0000-00FF, …" }
    ] }
  ],
  "brand": { "store_name": "Example Store" }
}
```

- `tokens`: Wave's token names only. Colors are hex (`--uk-color-bg`, `-surface`, `-muted-bg`, `-tile`, `-ink`, `-heading`, `-text-muted`, `-text-subtle`, `-line`, `-line-strong`, `-outline`, `-accent`, `-accent-strong`, `-accent-soft`, `-on-accent`, `-on-accent-muted`, `-accent-text`, `-highlight`, `-sale`, `-success`). Fonts are stacks (`--uk-font-body`, `--uk-font-heading`, `--uk-font-accent`). `--uk-font-heading-weight` is 100–900 in hundreds. Radii and `--uk-border-width` are whole pixels.
- Style choices: `--uk-type-scale` (regular, compact, large, display), `--uk-density` (regular, tight, airy), `--uk-width` (regular, narrow, wide, full), `--uk-button-fill` (solid, outline, text), `--uk-button-case` and `--uk-heading-case` (none, upper), `--uk-eyebrow` (caps, plain, none), `--uk-card` (flat, outline, shadow), `--uk-art` (landscape, shapes, grain, gradient, lines), `--uk-product-image` (portrait, square, landscape, tall), `--uk-product-text` (left, center), `--uk-motion` (none, subtle, lively).
- **`fonts`**: up to 3 Google Fonts families, each with 1–4 `weights` and **1 to 24 `faces`**. `"faces": []` is refused ("expected 1 to 24 faces"). A face is `{subset, style, weight, url, range}`, the fields of one `@font-face` block in Google Fonts' CSS, with the `url` on `fonts.gstatic.com`. Generate them from `https://fonts.googleapis.com/css2?family=<Family>:wght@400;700&display=swap`, requested with a browser User-Agent so it answers with woff2, keeping the `latin` blocks (more subsets for other scripts). In the Theme tab merchants pick two fonts, heading and body; a third family can sit in `--uk-font-accent` for display type.
- Wave serves theme fonts with `font-display: optional`: on a first visit before the font is cached, the page can draw in the fallback.
- `brand`: the merchant's `store_name`, `logo` (`{url, alt, width, height}` on the store's files), `logo_width`, `favicon`, `social` and announcement, normally set in the Theme tab. `theme`: values for the theme's own settings.
- At most 16 KB. A storefront's `settings.json` holds the merchant's design: your pushes write it to the storefront's draft, but a published theme update never changes a merchant's `settings.json`.

## Theme settings — `theme/config/settings_content.json`

The theme's own global settings, in the shape of a Swell app's settings file: `{label?, description?, fields}` with `field_group`s, each becoming a group in Wave's Theme tab. Field types: `toggle` (`boolean`, `checkbox`), `select` (`dropdown`), `radio`, `text`, `textarea`, `number`, `slider`, `color`, `url`. Every field needs a valid `default`; at most 50 fields in 20 groups, 32 KB. Sections read values from `site.theme_settings` (the layout gets them as `settings`). The core's sections read `sticky_header`, `card_quick_add` and `card_swatches` when a theme declares them. A field with `shopper_unless` or `prices_hidden` makes pages read the shopper and stop being cached while it is active; give it a default that keeps pages public.

## Store text — `theme/config/language.json`

Fixed shopper words (button labels, empty states, errors) are Store text, read with the `t` prop, so merchants can change and translate them.

```json
{
  "$format": 1,
  "deal": {
    "$label": "Deals",
    "$notes": { "ends": "Tag on a deal tile ({date} is filled in)" },
    "ends": "Ends {date}",
    "points": { "one": "{count} point", "other": "{count} points" }
  }
}
```

- Only new keys: a new area with a `$label`, or new keys in a core area. Never a core key or a core area's `$label`, never `$locale`, `$src` or `$auto`.
- Core areas: `cart`, `product`, `collection`, `filter`, `sort`, `search`, `pagination`, `account`, `order_status`, `address`, `login`, `common`, `navigation`, `newsletter`, `contact`, `blog`, `not_found`, `footer`, `errors`, `policy`, `age_gate`. Read core keys where they fit: `t('search.field')`, `t('cart.title')`, `t('navigation.menu')`, `t('common.email')`. The core's file is `node_modules/@swell/wave-theme-core/theme/config/language.json`.
- `t(key, vars)` returns `''` when the merchant blanked a key: guard optional words. A plural takes `count`. A literal key that isn't in Store text fails the check.

## Menus

A section shows a menu with a `menu` field (a menu id) and renders it with `NavMenu` (`levels` 1–3). Storefronts start with `main_menu` and `footer_menu`; merchants edit them in Wave's menu panel or the dashboard. `theme/config/editor.json` declares the menu areas the theme renders, so the menu panel limits each menu to what the theme can show:

```json
{ "menus": [ { "id": "main_menu", "label": "Header", "max_items": 10, "child_items": { "max_items": 16, "child_items": false } } ] }
```

`max_items` 1–50 per level, `columns` (`true` to lay the level out in columns) with `max_columns` 1–12, `item_types` from `home`, `product_list`, `product`, `category_list`, `category`, `page`, `blog`, `blog_category`, `search`, `url`, `heading`, `column`, at most 3 levels.

**Setting a storefront's menus from code** (a migration, a seed script). The menus belong to the storefront, which the first push creates. With the Backend API (or `swell api`), `GET` and `PUT` `/:storefronts/<id>/configs/menus`:

```sh
swell api get '/:storefronts?fields=name,theme_app_id'          # the storefront whose theme_app_id is your theme app's id (.swellrc)
swell api get '/:storefronts/<storefront id>/configs/menus'     # the current menus
swell api put '/:storefronts/<storefront id>/configs/menus' --body ./menus.json
```

```json
{ "$set": { "values": { "menus": [
  { "id": "main_menu", "name": "Main menu", "items": [
    { "type": "product", "name": "Shop all" },
    { "type": "category", "name": "Audio", "value": "audio", "items": [
      { "type": "category", "name": "Headphones", "value": "headphones" }
    ] },
    { "type": "url", "name": "Store locator", "value": "/pages/stores" }
  ] },
  { "id": "footer_menu", "name": "Footer", "items": [
    { "type": "column", "items": [
      { "type": "heading", "name": "Help" },
      { "type": "url", "name": "Contact us", "value": "mailto:help@example.com" }
    ] }
  ] }
] } } }
```

Each write replaces the whole list, so send every menu. A menu is `{id, name, items}`; an item is `{type, name, value?, options?, items?}`, at most 3 levels deep and 50 items a level:

- `product` and `category`: `value` is the record's slug. Without a `value`, the item links to all products or all categories.
- `page`, `blog` and `blog_category`: `value` is the record's id.
- `url`: a root path (`/pages/stores`), an `https` URL, `mailto:` or `tel:`. `options.target: "blank"` opens it in a new tab.
- `search`: `value` is the search text, with `options.query: true`.
- `home`, `heading` and `column` take no `value`; a `column` groups footer links and has no name. There is no `policy` type: link a policy page with a `url` item.

Menus written this way show in Wave's menu panel and the dashboard like any others.

## Layout — `theme/layout.tsx`

Optional. Its default export wraps every page and gets `site`, `settings` (`site.theme_settings`), `children` and `t`. On a page shared by every shopper it renders `children` exactly once. Same code rules and HTML checks as a section.

## Required apps

Features beyond display come from apps. A section uses an app in three ways, all declared by the app (the `swell-storefront-extensions` skill covers the app side):

```typescript
// 1. Data the app gives the page, rendered on the server
{ id: 'points', type: 'app_data', app: 'loyalty', source: 'points' }   // a schema field
// the prop is { status, value }: status 'ok' | 'signed_out' | 'missing_app' | 'error'

// 2. A form posted to one of the app's functions
import { AppAction } from 'ui-kit';
const flash = site?.app_flash?.app === 'loyalty' && site.app_flash.action === 'join' ? site.app_flash : null;
<AppAction app="loyalty" action="join" returnTo={site?.page?.path} flash={flash}>
  {({ values, errors }) => (<>
    <input name="email" type="email" defaultValue={values.email} />
    {errors.email ? <p role="alert">{errors.email}</p> : null}
    <button type="submit">{t('loyalty.join')}</button>
  </>)}
</AppAction>

// 3. The app's own UI, run in the page by its script
import { AppEmbed } from 'ui-kit';
<AppEmbed app="loyalty" block="rewards" props={{ layout: 'grid' }} minHeight={240}>{fallback}</AppEmbed>
```

- On any status but `ok`, the section renders its own empty state: no broken layout, no form that can't be sent; for `signed_out`, a link to `/account/login`. In the editor canvas `status` is `ok` and `value` is the source's sample.
- Name each input after the action's declared field id. Only `AppAction` may post to the action route.
- A page that shows an account-scoped source is the shopper's own and is never cached: keep account data off pages that should stay cached, such as the home page and the header group.
- A theme whose pages are built around an app lists it in `swell.json`, `theme.apps` (at most 10); sections that only add to a page when the app is there don't need it: `{ "id": "loyalty", "required": true, "min_version": "1.0.0", "why": "Points and rewards" }`. Only `required: true` entries are shown and enforced.
- **Push the app before the theme**: a theme naming an app Swell can't find is refused. On your development store, a push of a theme whose required apps aren't installed creates no test storefront and names the apps to install.

## Checks

`swell theme check` (and `build`) run compile, lint, schema, styles, template and config checks on the assembled theme. Each problem is `file: message (rule)` and its fix, errors first; `--json` gives the same list as data. Rules: `swell_json`, `json`, `version_file`, `core_override`, `type_id`, `custom_id`, `brand_name`, `core_copy`, `core_file`, `module_path`, `settings`, `settings_content`, `store_text`, `store_text_core_key`, `editor_key`, `menus`, `page_type_template`, `groups`, `missing_section`, `lint`, `compile`, `schema`, `styles`, `template`, `core_missing`, `out_dir`, `out_edited`, `out_not_build`. Warnings (`brand_mention`, `no_settings`, `store_text_label`) don't stop the build; fix them before listing a theme.

Wave runs two more checks when it receives the files: it **renders every section and block** in an isolated worker with sample data and again with an empty store and empty data fields (a section with a `product` field also gets a bare product with no variants and no guest price), and it checks the rendered HTML strictly. **A section that throws on missing data fails, and a failing section is left out of the page.** After a push, open the preview and confirm each section shows.

## Preview and testing

- The first `swell app push` of a theme creates a storefront in the test environment and prints `https://<store>--<storefront id>--preview.swell.store`. The CLI remembers that storefront for the folder, so push from the same folder each time; later pushes update its draft, which the preview shows. If the store lists two storefronts for your theme after the first push, keep using the one the push printed.
- Wave must be installed on the store before the first push. Without it, the push stops with "No compatible storefront apps found for this theme."
- Open the storefront in the Wave editor to see it as a merchant will.
- Click through as a shopper: menus, a category, a product, search, add to cart, the cart page. Checkout needs payments and shipping set up in the test environment.
- Pushes and editor saves both write the draft, and the last one saved wins: once a client edits in the editor, keep your own changes in code and push them.

## Versions and updates

The `version` in `swell.json` is semver. Merchants on a theme get a newer published version as **Theme update available** in the editor: files they didn't change take the new version, templates and groups merge section by section and prop by prop, Store text key by key, code files as a whole, and they choose for each conflict. **Never rename a section type, block type or field id** once storefronts use them: retire it with `retired: true`, give a new scalar field a default with `fill: true`, and add Store text keys rather than changing what one means.

## SEO

Wave writes every page's `<title>`, meta description, canonical link, Open Graph and Twitter tags, robots meta and JSON-LD; a theme adds none and can't render `meta`, `link` or `script`. The theme owns one `h1` per page and headings in order, real `alt` text (`""` only for decoration), link words that say where they go (never "Read more" alone), and a real subheading in the home page's first section.

## Rules every theme follows

Swell data drives the theme; every template shows the shared header and footer groups; fixed shopper words are Store text; pages load in under 0.5 seconds (use `Image`, which sizes images for the screen); everything is visible without scrolling, timers or motion (no reveals that start hidden); payment methods show as logos through `PaymentIcons`, with a footer setting to hide them; shoppers can sign in, sign up, reset a password, use their account pages and the cart (`AuthForms`, `AccountBody`, the cart components); layouts work on phones first, with filter panels folded; features beyond display live in apps; types are named by what they do. Theme Store themes are reviewed against these (`theme-store.md`).
