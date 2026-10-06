---
name: swell-backend-api
description: "Use this skill for Swell Backend API operations: querying, writes, batch requests and transactions, commerce lifecycles, files, events, errors and rate limits. Applies inside Swell apps through function and workflow clients or the Apps SDK Backend client, and to independent integrations using swell-node, explicitly configured Apps SDK clients, direct HTTP or one-off swell api commands. Pair with swell-app for app packaging, runtime setup, models, triggers, permissions and deployment; reuse the client that runtime supplies. Shopper-session operations belong to swell-frontend-api. Proxima / Liquid theme authoring and other platforms are outside scope."
allowed-tools: Read, Grep, Glob, Bash
---

# I. Scope & Authentication

This skill owns Backend API operations in both Swell apps and independent integrations. `swell-app` owns app scaffolding, runtime context, resource declarations, permissions and deployment. Use both when an app performs Backend operations. Shopper-session operations belong to `swell-frontend-api`.

**Choose the client before applying its setup or error rules.** In an app function or workflow, keep `req.swell`; in an app frontend, keep the scaffold's Backend helper. Their runtime contracts are in the `swell-app` skill's `references/functions.md`, `references/functions-workflows.md` and `references/frontend.md`. A workflow has fewer methods and allowed endpoints than an ordinary function. The frontend Backend client throws `SwellError` on validation failures; swell-node returns validation objects. Protocol-level query and write rules do not make these clients interchangeable.

Outside apps, choose swell-node, direct HTTP, or an explicitly configured Apps SDK Backend client. For the latter, use the installed `@swell/apps-sdk` README for construction and the matching SDK client contract; using the SDK alone does not require a Swell app. The setup and error details below describe swell-node and direct HTTP unless a different client is named.

The Backend API provides privileged store operations within the caller's credential scope; it does not apply shopper-session ownership. For standalone secret-key HTTP access, use `https://api.swell.store`, HTTP Basic auth with the store ID as username and the secret key as password:

```bash
curl https://api.swell.store/products -u my-store:sk_test_...
```

Keys live in the dashboard under Developer > API keys. The key alone selects the environment, and its prefix is the only visible marker: a **live** secret key is a bare `sk_` plus 32 random characters, a test key is `sk_test_…`, and a key minted in a custom environment carries that environment's slug (`sk_staging_…`). **There is no `sk_live_` prefix** — no environment segment means live, so a guard that greps for `sk_live_` never matches a real key. Public keys follow the same rule (`pk_…` / `pk_test_…`). Environments are not a test/live binary: a store can create arbitrarily named ones. There is no environment header or parameter — mint a key in the environment you target. Secret keys must never reach browsers, storefront bundles, or client-visible config; anything customer-facing belongs on the Frontend API (swell-frontend-api skill).

**swell-node** (v6+) is a thin HTTPS client over this API:

```js
const { swell } = require('swell-node');
swell.init('my-store', 'sk_...'); // 3rd arg options: { url, timeout, headers, retries } — retries defaults to 0
const products = await swell.get('/products', { limit: 25, active: true });
```

`get/post/put/delete(url, data)` resolve with the raw response body (the list envelope or record — there is no wrapper object). Query/body data is always sent as a JSON request body, GET included, so complex `where` objects need no URL encoding. Failures throw an `ApiError` with `message`, `code`, `status`, `headers` — but `code` is the uppercased HTTP status text (`NOT_FOUND`, `CONFLICT`, `BAD_REQUEST`), never the platform's own error code, and `message` collapses to the literal string `[object Object]` whenever the platform returns a coded JSON error body. Branch on `err.status`, not `err.code`; to read a coded body, call the endpoint over plain HTTPS. `retries` only re-attempts connection-level failures (refused/reset/timeout), never HTTP errors. Multiple stores in one process: `swell.createClient(storeId, key)`. For non-Node stacks, plain HTTPS with the same paths and Basic auth is equivalent. Older swell-node major versions (<6) used a proprietary TCP protocol on port 8443 — if firewall or protocol questions arise around port 8443, that's the legacy client; v6+ is ordinary HTTPS.

If the `swell` CLI is installed and authenticated, `swell api get|post|put|delete '<path>'` performs the same operations with CLI credentials — useful for one-off inspection without writing a script. It targets the store's **test** environment unless you pass `--live`, so a command that looks like it read or wrote production did neither. `--body '{...}'` or `--body ./file.json` exists on `post` and `put` only; `--api frontend` swaps in public-key auth.

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

**swell-node and direct HTTP have two failure modes.** A field-validation failure can arrive in an HTTP 200 response (resolved by swell-node) with a validation object: `{ errors: { <field>: { code, message, ...details } } }` — detail values sit directly on the error, not under a `params` wrapper, e.g. `{ 'items.0.quantity': { code: 'MINVAL', message: 'Must be at least 1', min: 1 } }`, and `MAXLENGTH`/`MINLENGTH` carry `maxlength`/`minlength`, `ENUM` carries `values`, `MAXVAL` carries `max`. Field keys are dotted paths for nested and related fields. Always check `result.errors` after writes before treating them as applied.

Other failures are HTTP errors (thrown by swell-node): 400 malformed/limit exceeded, **401 invalid credentials** — wrong store ID, or a bad or revoked key, the most common wiring failure — 402 store plan canceled or trial expired, 403 authenticated but not authorized (inactive account, or insufficient role permissions), 404 no resource at path, 405 method unsupported, 429 rate limited. **Transactions roll back only against *request* errors** — not found, permission denied, bad URL, write conflict, timeout — which abort the whole set and return a typed code: `transaction_conflict` 409, `transaction_timeout` 408, `transaction_throttled` 429, `transaction_op_failed` (the failing op's own status, 400 default, the only code carrying `op_index`), `transaction_error` 503. A child op's **field-validation failure does not abort**: that op writes nothing, its result slot carries `{ errors: {...} }`, `transaction.committed` still fires, and every other op commits — so inspect every entry of the returned array before treating a 200 as fully applied. The typed codes travel in a JSON error body `{ error: { code, message, status, op_index } }` that swell-node discards (see §I): branch on `err.status`, retrying 409 and 429 with backoff, or call `/:transaction` over plain HTTPS to read the body. Inside app functions the SDK's `SwellError.code` and `SwellError.isRetryable` do expose the typed code. Batch failures land in the failed slot in one of **two shapes** — `{ $error: '...' }` for routing/permission/not-found, `{ errors: {...} }` for validation — while the other operations still apply; check both keys on every entry, because code that only looks for `$error` reads a rejected write as a success.

**Rate limits** are per store and per environment, on both throughput and concurrency; exact numbers are plan-dependent and unpublished (test environments always use the lower tier). Weight: a request costs 1, plus `floor(total_expand_levels / 2)` — a dotted path counts every level (`items.product` = 2), and a comma-separated `expand` string is split and counted exactly like an array — plus 1 per `include` (plus that include's own nested expand/include weight), plus 1 per `$lookup` aggregate stage; the first 3 combined expand+include points are free, so ordinary reads cost 1 and only large fan-outs pay. A batch costs the sum of its operations; a transaction costs operations+1. GETs to products, product variants, categories, attributes, accounts, carts, purchase links, and `content/pages`/`content/blogs` — plus `PUT /carts` — draw on a separate lighter pool, but only while the request's weight stays under 3, so a heavily expanded catalog read drops back into the main pool. Over-limit requests are **queued**, not rejected — a 429 means a request waited over 60 seconds, i.e. sustained overload: back off with increasing delays, reduce expand weight, and batch work rather than hammering. There are no rate-limit response headers to parse.

# VIII. Operating Guardrails

- Point scripts at the test environment (`sk_test_…`) first; run bulk updates against test records before live. Before any bulk write, print the loaded key's prefix and confirm the environment segment — a bare `sk_` is **live**, not test. `GET /:clients/:self/keys` lists only the keys belonging to the environment the current credentials resolve to, a second way to confirm before writing. There is no undo for update operators or merges.
- `DELETE` is permanent (orders and subscriptions included). Canceling is a write (`canceled: true`), not a delete — see `references/commerce.md`.
- Writes fire the store's events — functions, webhooks, and notifications react to script-driven mutations exactly as to dashboard activity. For bulk backfills, consider what each write will trigger. The exception is `/:transaction`: its child ops fire **no** per-record hooks, functions, webhooks, or notifications — only one `transaction.committed` event for the bundle.
- With swell-node or direct HTTP, check `result.errors` on every write; a script that ignores validation objects "succeeds" while writing nothing. Other clients may throw on that response — follow the selected client's error contract (§I).
