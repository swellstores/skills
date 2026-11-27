# Data sources, app pages and product ratings

## Data sources — `storefront.data`

A data source gives a theme data from the app. The storefront reads it on the server while it renders the page, and the theme renders it with its own markup: no app script runs in the page, and the content is in the HTML.

```json
{
  "storefront": {
    "data": [
      {
        "id": "points",
        "label": "Your points",
        "description": "The signed-in customer's points and tier",
        "scope": "account",
        "from": {
          "collection": "members",
          "where": { "account_id": "$account.id" },
          "fields": ["points", "tier"],
          "limit": 1
        },
        "sample": [{ "points": 1250, "tier": "Gold" }]
      },
      {
        "id": "terms",
        "label": "Payment terms",
        "scope": "account",
        "from": { "function": "storefront-terms" },
        "cache": 60,
        "sample": { "net_days": 30, "credit_limit": 5000 }
      }
    ]
  }
}
```

| Key | Description |
| --- | --- |
| `id` | 1–40 of `a-z`, `0-9`, `_`; unique among the app's sources |
| `label` | The editor's name for it, 1–80 characters. `description` optional, 1–300 |
| `scope` | `store` (the same for every shopper), `account` (the signed-in customer's own; a guest gets `signed_out`), `product` (the page's product; product pages only), `category` (the page's category; category pages only), `page` (an app page's params; function sources only; see "Page-scope sources can't be pushed yet" below) |
| `from` | Exactly one of `{collection, where?, fields?, sort?, limit?}` or `{function}` |
| `cache` | Seconds, 0–3600. Default 60, and 0 for an `account` source read from a collection |
| `sample` | Required JSON of at most 8 KB in the shape the source returns. The editor canvas renders it and never calls the app. |

**Collection source** — the recommended one for records a page shows. It reads one of the app's own models, named as in `models/`, at `/apps/<app>/<collection>` on the server with the storefront app's own credentials (Wave's token), not the public key: the model needs no public permissions for this, so don't open it to storefronts to make a source work.

- `where`: a flat object of at most 10 fields; values are strings (≤ 200 characters), numbers, booleans or placeholders. No operators.
- `fields`: 1–30 names, dotted paths up to five levels. `sort`: a field, optionally `asc` or `desc`. `limit`: 1–100, default 20.
- Placeholders, filled by the storefront and never from page or shopper input: `$account.id` (scope `account`), `$product.id` (`product`), `$category.id` (`category`), `$storefront.id` (any).
- **An `account` source must filter on `$account.id`.** The value is the read's `results` array.

**Function source** — for data that must be computed. Names one of the app's functions (1–60 of `a-z`, `0-9`, `-`), which must be a public POST route. The body is `{bridge: 1, kind: "data", id, page: {type, product_id, category_id}, locale, currency, storefront_id}`; for an `account` source the function gets the shopper's session (`req.session.account_id`), other scopes none. It returns the JSON value itself, and gets no query string or form input: a search a shopper types needs an action or an embed block. It runs on every uncached render and adds time to the page: prefer a collection source for records, and keep `cache` above 0 where the data allows, but at 0 for data a form changes, so the page shown after the form has the change.

**Limits and caching.** A value is plain JSON of at most 32 KB. The storefront waits at most 3 seconds; a slower, larger, non-JSON or error answer is `error`. Values are kept for `cache` seconds per source and per account, product or category, in the storefront's memory only. **A page that shows an `account` source is the shopper's own**: never kept in a shared cache, sent `Cache-Control: private`. Keep account sources off pages that should stay cached, such as the home page or the header.

**In a theme** (Wave and other ui-kit themes), a section field `{ "id": "points", "type": "app_data", "app": "loyalty", "source": "points" }` gives the prop `{status, value}`:

| `status` | Meaning |
| --- | --- |
| `ok` | The source answered; `value` holds it. In the editor canvas, `value` is the `sample`. |
| `signed_out` | An `account` source and a guest |
| `missing_app` | The app isn't installed, or doesn't declare the source |
| `error` | The read failed, timed out or was too large, or the page has no product or category for the scope |

On anything but `ok`, the section renders its own empty state, such as a sign-in link for `signed_out`. The editor shows "Needs the <app> app" on sections whose app is missing and warns about them on publish.

## App pages — `storefront.pages`

Page types of the app's own, at addresses it owns, rendered in every theme. The storefront routes them, caches them, keeps account pages private and lists public ones in its sitemap.

```json
{
  "storefront": {
    "data": [
      { "id": "catalog", "label": "All courses", "scope": "store", "from": { "function": "storefront-catalog" }, "cache": 60,
        "sample": { "title": "Courses", "items": [{ "title": "Intro to pottery", "url": "/courses/intro-to-pottery" }] } },
      { "id": "course_list", "label": "Course addresses", "scope": "store", "from": { "function": "storefront-course-list" }, "cache": 300,
        "sample": [{ "course": "intro-to-pottery", "label": "Intro to pottery" }] },
      { "id": "course", "label": "Course", "scope": "page", "from": { "function": "storefront-course" }, "cache": 60,
        "sample": { "title": "Intro to pottery", "body": "<p>Six lessons at the wheel.</p>" } }
    ],
    "pages": [
      { "id": "index", "label": "All courses", "path": "/courses", "data": ["catalog"], "primary": "catalog" },
      { "id": "course", "label": "Course", "path": "/courses/:course", "params": { "course": "slug" },
        "data": ["course"], "primary": "course", "list": "course_list", "sample": { "course": "intro-to-pottery" } }
    ]
  }
}
```

| Key | Description |
| --- | --- |
| `id`, `label` | 1–40 of `a-z`, `0-9`, `_`; 1–80 characters |
| `path` | `/` then a first segment the app owns (lowercase words joined by `-`, ≤ 40), then literal segments or `:param`. At most 5 segments and 3 params, no trailing `/` |
| `params` | Each param's type: `slug` (1–100 of `a-z`, `0-9`, `-`; default) or `id` (24-character hex) |
| `requires` | `none` (default) or `account`: only a signed-in shopper can open it |
| `data` | Up to 10 of the app's sources, of scope `store` or `page` (or `account` on an account page) |
| `primary` | The source whose answer decides whether the page exists. Required with params |
| `list` | With params: a `store` source returning the param sets (`[{course, label}]`). Used to pick records in the editor, link pages from menus and list them in the sitemap (up to 500 per page type) |
| `sample` | Required with params: a value for each param, for the editor's preview. Without it the page is left out |
| `index` | Default `true`: indexable and in the sitemap. Can't be `true` on an account page |

- **Addresses.** The storefront refuses a page whose first segment it uses itself (`products`, `cart`, `account`, and in Wave `categories`, `collections`, `pages`, `blogs`, `policies` and the like), one that reads as a language tag (`es`, `pt-br`), two pages of one app that could answer the same address, and another installed app's first segment. Params are checked against their types before anything is called; an address that doesn't fit gets the 404 page. App pages work under a language prefix (`/es/courses/…`).
- **Page-scope sources** are function sources that get the checked params in `page.params` (`{type: "app", app, id, params}`). A collection source can't use them: prove in the function that the record exists and that the shopper may see it. On an account page the function also gets the shopper's session.
- **The primary source's answer**: `{"status": "not_found"}` and `{"status": "forbidden"}` show the 404 page (on an account page, a signed-out shopper is asked to sign in first and comes back); anything else is the page's data. An optional `seo` object sets `title` (≤ 200), `description` (≤ 400), `image` (https) and `noindex: true`. An error, a timeout or an answer over 32 KB gets a 503 page.
- **Layout.** Wave uses a theme's own template for the page when it has one (named `app.<app>.<page>`; see developers.swell.is "Storefront extensions", Storefront support), else its general app page layout, which shows the answer's `title`, `body`, `image` and `items` (at most 100 `{title, url, text, image}`, `url` a storefront path). Answer in that shape and the page looks right in every theme.
- **Caching.** A public page is cached like a product page, per address, language and currency, unless one of its sources has a `cache` under 60. Account pages are private, never cached or indexed.
- An app can declare up to 20 pages. A newly installed app's pages can take up to a minute to appear.
- `swell app push` doesn't check `pages` or `product_rating`: a broken one is dropped silently. Check the editor's page list after pushing.
- Embed blocks can't be placed on app pages (an app page isn't one of their page types).

**Page-scope sources can't be pushed yet.** Wave reads `scope: "page"`, but Swell CLI 2.9.44 refuses it at push ("scope must be store, account, product or category"), and so does Swell when it receives the app. A page with params needs a page-scope source to find its record, so **app pages with params (`/courses/:course`) can't be deployed today**. Pages at fixed addresses (`/courses`) answered by `store` sources work. Until the CLI and Swell accept `page`, give a record-per-page feature fixed pages, content pages, or a query parameter read by a `store` source's function. Tell the user this rather than designing around a page that can't ship.

## Product ratings — `storefront.product_rating`

A reviews app gives every theme its stars, review counts and recent reviews, with no theme code:

```json
{
  "storefront": {
    "data": [
      { "id": "reviews", "label": "Recent reviews", "scope": "product",
        "from": { "collection": "reviews", "where": { "product_id": "$product.id", "status": "approved" },
          "fields": ["rating", "title", "body", "name", "date_published"], "sort": "date_published desc", "limit": 10 },
        "sample": [{ "rating": 5, "title": "Love it", "body": "Fits well.", "name": "Sam", "date_published": "2026-11-20" }] }
    ],
    "product_rating": { "average": "rating", "count": "review_count", "reviews": "reviews" }
  }
}
```

- `average` and `count` name two fields the app keeps on each product, read as `$app.<app>.<field>`: the average (0–5, shown to one decimal) and the number of reviews. Keep both current whenever a review is approved, edited or removed, as public fields of the app's product model. A product has no rating when either is missing or not a number, or the count is 0.
- `reviews` (optional) names a `product`-scope data source whose rows carry `rating` (1–5), `title`, `body`, `name` and `date_published`, newest first. The storefront uses at most 10 and skips rows without a numeric `rating` or a `body`.
- Shoppers see stars and the count on product cards and product pages ("Rated 4.3 out of 5, 128 reviews"), and the product page's structured data gets `aggregateRating` and `Review` entries. When several installed apps declare `product_rating`, the first installed wins. A theme shows ratings once it's republished with a version of Wave that has them.
