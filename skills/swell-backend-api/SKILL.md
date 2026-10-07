---
name: swell-backend-api
description: "Use this skill for Swell Backend API operations: querying, writes, batch requests and transactions, commerce lifecycles, files, events, errors and rate limits. Applies inside Swell apps through function and workflow clients or the Apps SDK Backend client, and to independent integrations using swell-node, explicitly configured Apps SDK clients, direct HTTP or one-off swell api commands. Pair with swell-app for app packaging, runtime setup, models, triggers, permissions and deployment; reuse the client that runtime supplies. Shopper-session operations belong to swell-frontend-api. Proxima / Liquid theme authoring and other platforms are outside scope."
allowed-tools: Read, Grep, Glob, Bash
---

# I. Scope & Authentication

This skill owns Backend API operations in both Swell apps and independent integrations. `swell-app` owns app scaffolding, runtime context, resource declarations, permissions and deployment. Use both when an app performs Backend operations. Shopper-session operations belong to `swell-frontend-api`.

**Choose the client first.** Read `references/clients.md` before writing a call: it covers each client's setup and methods, how a missing record, a refused write and an HTTP error reach the code, calling an app function, retries and rate limits. Inside an app, use the client the runtime supplies.

The Backend API provides privileged store operations within the caller's credential scope; it does not apply shopper-session ownership. For standalone secret-key HTTP access, use `https://api.swell.store`, HTTP Basic auth with the store ID as username and the secret key as password:

```bash
curl https://api.swell.store/products -u my-store:sk_test_...
```

Keys live in the dashboard under Developer > API keys. The key alone selects the environment, and its prefix is the only visible marker: a **live** secret key is a bare `sk_` plus 32 random characters, a test key is `sk_test_…`, and a key minted in a custom environment carries that environment's slug (`sk_staging_…`). **There is no `sk_live_` prefix** — no environment segment means live, so a guard that greps for `sk_live_` never matches a real key. Public keys follow the same rule (`pk_…` / `pk_test_…`). Environments are not a test/live binary: a store can create arbitrarily named ones. There is no environment header or parameter — mint a key in the environment you target. Secret keys must never reach browsers, storefront bundles, or client-visible config; anything customer-facing belongs on the Frontend API (swell-frontend-api skill).

# II. Data Model & Discovery

Swell is schema-driven: every collection (standard and custom) is described by a live model definition. Discover instead of guessing:

- `GET /:models` — list model definitions; `GET /:models/<name>` — full definition with `fields` (types, required, enums, formulas, links), `events`, and query defaults. This is the authoritative field reference for the exact store, including app-installed extensions.
- Custom models can be created via this endpoint or the dashboard (Developer > Models); model JSON semantics (field types, `public_permissions`, `events.types`, `formula`, `rules`, `increment`) follow the data-models documentation. Apps define models through the swell-app skill's file contract instead.

Records address by `id`, and many collections also by a secondary field usable in the URL: products/categories/pages/`content/blogs`/`content/blog-categories` → `slug`, orders/carts/invoices/payments/shipments/returns/subscriptions → `number`, accounts/contacts → `email`, gift cards and `coupons:codes` → `code`, coupons/promotions/purchase links → `name`. The lookup is generic, not a fixed list — read `secondary_field` on any model's `/:models/<name>` definition.

List responses use the envelope `{ count, results, page, limit, page_count }`, plus a `pages` map of per-page start/end record numbers **only when the result spans more than one page** — with the default `limit: 15`, any query returning 15 or fewer records has no `pages` key at all, so `res.pages` is `undefined` and any indexing into it (`res.pages[1]`, `Object.keys(res.pages)`) throws — guard before use. Single gets return the record. `page=all` drops the page limit but the result set must still fit under the 1000-record query maximum: more than 1000 matches fails outright with HTTP 400 `Query results cannot exceed 1000` (and omits `pages`), so export by paging with `limit: 1000` or narrowing with `where`. `page=false` returns a bare array with no envelope. Fields are snake_case; dates are ISO-8601 strings.

The commerce object graph in one pass: **products** (with `variants`, options, `purchase_options` for subscriptions, `bundle_items`, stock) are organized by **categories** and **attributes**; **accounts** own `addresses`, `cards`, `credits`; **carts** convert into **orders**, which connect to **payments** (and their **refunds**), **shipments**, **returns**, and **invoices**; **subscriptions** bill on a schedule, generating invoices and optionally orders; **coupons**, **promotions**, and **gift cards** apply discounts and stored value; **content** and **pages** hold structured content; **purchaselinks** define shareable pre-built carts.

Read `references/files-media.md` before uploading or serving images and files — the `/:files` collection, the `file` field type, and the base64 wire formats.

# III. Querying

Read `references/querying.md` before writing any non-trivial read — it covers the full `where` operator set, sort/pagination details, text search behavior and per-model search fields, `expand` (default 5 per collection, 5 levels max), `include` sub-queries, `group`/`aggregate` pipelines, and reading localized (`$locale`) and multi-currency (`$currency`) data.

# IV. Writing

Read `references/writes.md` before any write — Swell's PUT is a **deep merge** (arrays of objects merge by element `id`, id-less elements positionally by index, and neither shrinks on a plain write; `$set` is the replace operator), update operators (`$inc`, `$push`, `$pull`, `$unset`, …) apply at the top level of the body, linked child records update through the parent, and there is **no rollback** for updates. The reference also covers batch requests (`/:batch`, non-atomic) and transactions (`/:transaction`, atomic against request errors only — validation failures do not roll the rest back), and writing localized/multi-currency values.

# V. Events & Webhooks

Read `references/events-webhooks.md` when reacting to store activity: the `/events` log and its payload shapes, event type naming (singular roots — `product.created`, `order.paid`), configuring `/:webhooks` via API (created disabled by default), delivery/retry/auto-disable behavior, and endpoint verification (IP allowlist — there are no payload signatures).

# VI. Commerce Lifecycles

Read `references/commerce.md` before scripting orders, payments, subscriptions, or inventory — statuses are mostly **derived** from flags and related records (you rarely write `status` itself), payments auto-update their orders/invoices, subscription creation can charge immediately, and stock is an append-only adjustment ledger.

Read `references/promotions-discounts.md` before scripting discounts or stored value — coupons (including bulk code generation), gift cards, promotions, and purchase links.

# VII. Errors, Rate Limits, Retries

Read `references/clients.md` — the clients do not report failures the same way. Batch and transaction results are in `references/writes.md`.

# VIII. Operating Guardrails

- Point scripts at the test environment (`sk_test_…`) first; run bulk updates against test records before live. Before any bulk write, print the loaded key's prefix and confirm the environment segment — a bare `sk_` is **live**, not test. `GET /:clients/:self/keys` lists only the keys belonging to the environment the current credentials resolve to, a second way to confirm before writing. There is no undo for update operators or merges.
- `DELETE` is permanent (orders and subscriptions included). Canceling is a write (`canceled: true`), not a delete — see `references/commerce.md`.
- Writes fire the store's events — functions, webhooks, and notifications react to script-driven mutations exactly as to dashboard activity. For bulk backfills, consider what each write will trigger. The exception is `/:transaction`: its child ops fire **no** per-record hooks, functions, webhooks, or notifications — only one `transaction.committed` event for the bundle.
