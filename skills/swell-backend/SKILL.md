---
name: swell-backend
description: Use this skill for server-side integration with the Swell e-commerce platform's Backend API — reading and writing store data with a secret key via the swell-node library or direct HTTP against api.swell.store. Triggers include swell-node usage or `swell.init('<store-id>', 'sk_...')`; data imports, migrations, sync jobs, reporting, or automation scripts against a Swell store; questions about Swell querying (`where`, `expand`, `include`, pagination, aggregation), update operators, batch requests, or transactions; consuming Swell events or configuring webhooks outside a Swell App; order, payment, subscription, or inventory lifecycle scripting; and general questions about the Swell platform's data model or API behavior when no other Swell skill clearly applies. Do NOT use for browser storefront code with swell-js and a public key (use the swell-storefront skill) or for building deployable Swell Apps with the `swell` CLI (use the swell-app skill — though app functions' `req.swell` follows the same query and write semantics documented here).
allowed-tools: Read, Grep, Glob, Bash
---

# I. Scope & Authentication

The Backend API is Swell's full-privilege server-side API: every collection, no session scoping, authenticated with a **secret key**. Base URL `https://api.swell.store`, HTTP Basic auth with the store ID as username and the secret key as password:

```bash
curl https://api.swell.store/products -u my-store:sk_test_...
```

Keys live in the dashboard under Developer > API keys. The key selects the environment: `sk_test_…` keys route to the store's test environment, `sk_live_…` to live. There is no environment header or parameter — mint a key in the environment you target. Secret keys must never reach browsers, storefront bundles, or client-visible config; anything customer-facing belongs on the Frontend API (swell-storefront skill).

**swell-node** (v6+) is a thin HTTPS client over this API:

```js
const { swell } = require('swell-node');
swell.init('my-store', 'sk_...', { timeout?, retries? /* default 0 */, headers? });
const products = await swell.get('/products', { limit: 25, active: true });
```

`get/post/put/delete(url, data)` resolve with the raw response body (the list envelope or record — there is no wrapper object). Query/body data is always sent as a JSON request body, GET included, so complex `where` objects need no URL encoding. Failures throw an `ApiError` with `message`, `code`, `status`, `headers`. `retries` only re-attempts connection-level failures (refused/reset/timeout), never HTTP errors. Multiple stores in one process: `swell.createClient(storeId, key)`. For non-Node stacks, plain HTTPS with the same paths and Basic auth is equivalent. Older swell-node major versions (<6) used a proprietary TCP protocol on port 8443 — if firewall or protocol questions arise around port 8443, that's the legacy client; v6+ is ordinary HTTPS.

If the `swell` CLI is installed and authenticated, `swell api get|post|put|delete '<path>' [--body '{...}']` performs the same operations with CLI credentials — useful for one-off inspection without writing a script.

# II. Data Model & Discovery

Swell is schema-driven: every collection (standard and custom) is described by a live model definition. Discover instead of guessing:

- `GET /:models` — list model definitions; `GET /:models/<name>` — full definition with `fields` (types, required, enums, formulas, links), `events`, and query defaults. This is the authoritative field reference for the exact store, including app-installed extensions.
- Custom models can be created via this endpoint or the dashboard (Developer > Models); model JSON semantics (field types, `public_permissions`, `events.types`, `formula`, `rules`, `increment`) follow the data-models documentation. Apps define models through the swell-app skill's file contract instead.

Records address by `id`, and some collections also by a secondary field usable in the URL: products/categories/pages → `slug`, orders/carts/invoices/payments/shipments/returns → `number`, accounts → `email`, gift cards → `code`, purchase links → `name`. List responses use the envelope `{ count, results, page, limit, page_count, pages }`; single gets return the record. `page=all` returns everything unpaginated; `page=false` returns a bare array with no envelope. Fields are snake_case; dates are ISO-8601 strings.

The commerce object graph in one pass: **products** (with `variants`, options, `purchase_options` for subscriptions, `bundle_items`, stock) are organized by **categories** and **attributes**; **accounts** own `addresses`, `cards`, `credits`; **carts** convert into **orders**, which connect to **payments** (and their **refunds**), **shipments**, **returns**, and **invoices**; **subscriptions** bill on a schedule, generating invoices and optionally orders; **coupons**, **promotions**, and **gift cards** apply discounts and stored value; **content** and **pages** hold structured content; **purchaselinks** define shareable pre-built carts.

# III. Querying

Read `references/querying.md` before writing any non-trivial read — it covers the full `where` operator set, sort/pagination details, text search behavior and per-model search fields, `expand` (default 5 per collection, 5 levels max), `include` sub-queries, `group`/`aggregate` pipelines, and reading localized (`$locale`) and multi-currency (`$currency`) data.

# IV. Writing

Read `references/writes.md` before any write — Swell's PUT is a **deep merge** (arrays merge by element `id` and never shrink on a plain write; `$set` is the replace operator), update operators (`$inc`, `$push`, `$pull`, `$unset`, …) apply at the top level of the body, linked child records update through the parent, and there is **no rollback** for updates. The reference also covers batch requests (`/:batch`, non-atomic) and transactions (`/:transaction`, atomic), and writing localized/multi-currency values.

# V. Events & Webhooks

Read `references/events-webhooks.md` when reacting to store activity: the `/events` log and its payload shapes, event type naming (singular roots — `product.created`, `order.paid`), configuring `/:webhooks` via API (created disabled by default), delivery/retry/auto-disable behavior, and endpoint verification (IP allowlist — there are no payload signatures).

# VI. Commerce Lifecycles

Read `references/commerce.md` before scripting orders, payments, subscriptions, or inventory — statuses are mostly **derived** from flags and related records (you rarely write `status` itself), payments auto-update their orders/invoices, subscription creation can charge immediately, and stock is an append-only adjustment ledger.

# VII. Errors, Rate Limits, Retries

**Two failure modes.** Invalid PUT/POST/DELETE requests resolve normally (HTTP 200 through the libraries) with a validation object: `{ errors: { <field>: { code, message, params? } } }` — always check `result.errors` after writes before treating them as applied. Other failures are HTTP errors (thrown by swell-node): 400 malformed/limit exceeded, 402 store plan expired, 403 credentials not authorized for the resource, 404 no resource at path, 405 method unsupported, 429 rate limited. Transactions return typed codes (`transaction_conflict`, `transaction_timeout`, …) and roll back fully; batch failures put an `$error` string in the failed slot while other operations still apply.

**Rate limits** are per store and per environment, on both throughput and concurrency; exact numbers are plan-dependent and unpublished (test environments always use the lower tier). Weighting: a request costs 1, +1 per two expanded fields (nested paths count each level) and +1 per include (first 3 combined expand/include points free), +1 per `$lookup` stage; a batch costs the sum of its operations; a transaction costs operations+1. Cheap catalog/cart reads draw from a separate pool. Over-limit requests are **queued**, not rejected — a 429 means a request waited over 60 seconds, i.e. sustained overload: back off with increasing delays, reduce expand weight, and batch work rather than hammering. There are no rate-limit response headers to parse.

# VIII. Operating Guardrails

- Point scripts at the test environment (`sk_test_…`) first; run bulk updates against test records before live. There is no undo for update operators or merges.
- `DELETE` is permanent (orders and subscriptions included). Canceling is a write (`canceled: true`), not a delete — see `references/commerce.md`.
- Writes fire the store's events — functions, webhooks, and notifications react to script-driven mutations exactly as to dashboard activity. For bulk backfills, consider what each write will trigger.
- Check `result.errors` on every write; a script that ignores validation objects "succeeds" while writing nothing.
