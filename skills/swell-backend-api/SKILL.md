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

Paths:

| Records | Path |
| --- | --- |
| A standard collection | `/products`, `/products/<id>` |
| A child collection | `/products/<id>/variants` under one parent, `/products:variants` across all parents |
| An app's collection | `/apps/<app_id>/<collection>`, with its children at `/apps/<app_id>/<collection>/<id>/<child>` and `/apps/<app_id>/<collection>:<child>` |
| A child collection an app adds to a standard model | `/products:apps.<app_id>.<name>` |

An app's own function and frontend clients also reach its collections by the short path, `/<collection>`, in a transaction's operations too. An app's fields on a standard record are under `$app.<app_id>` in the record.

Records address by `id`, and many collections also by a secondary field usable in the URL: products/categories/pages/`content/blogs`/`content/blog-categories` → `slug`, orders/carts/invoices/payments/shipments/returns/subscriptions → `number`, accounts/contacts → `email`, gift cards and `coupons:codes` → `code`, coupons/promotions/purchase links → `name`. The lookup is generic, not a fixed list — read `secondary_field` on any model's `/:models/<name>` definition.

A read by id answers with the record, and a list with an envelope that `references/querying.md` describes. Fields are snake_case; dates are ISO-8601 strings.

The commerce object graph in one pass: **products** (with `variants`, options, `purchase_options` for subscriptions, `bundle_items`, stock) are organized by **categories** and **attributes**; **accounts** own `addresses`, `cards`, `credits`; **carts** convert into **orders**, which connect to **payments** (and their **refunds**), **shipments**, **returns**, and **invoices**; **subscriptions** bill on a schedule, generating invoices and optionally orders; **coupons**, **promotions**, and **gift cards** apply discounts and stored value; **content** and **pages** hold structured content; **purchaselinks** define shareable pre-built carts.

Read `references/files-media.md` before uploading or serving images and files — the `/:files` collection, the `file` field type, and the base64 wire formats.

# III. Querying

Read `references/querying.md` before writing any read beyond a get by id: filters, sorting and paging, counting, search, `expand` and `include`, aggregation, and localized or multi-currency values. A query returns at most 1000 records, so reading a whole collection is a loop.

# IV. Writing

Read `references/writes.md` before any write. Four of its rules change a design:

- **An update merges.** Sending a shorter array does not replace the stored one; replacing takes an operator.
- **Nothing can be undone**, and a delete is permanent.
- **Every write sets off the store's webhooks, app functions and notification emails.** The reference says what an import can switch off.
- **A batch is not atomic, and a transaction only partly:** a write that fails validation inside a transaction does not roll the others back.

The reference also covers the update operators, child records, imports that keep their ids, and localized and per-currency values.

# V. Events & Webhooks

Read `references/events-webhooks.md` when reacting to store activity: the `/events` log and its payload shapes, event type naming (singular roots — `product.created`, `order.paid`), configuring `/:webhooks` via API (created disabled by default), delivery/retry/auto-disable behavior, and endpoint verification (IP allowlist — there are no payload signatures).

# VI. Commerce Lifecycles

Read `references/commerce.md` before scripting orders, payments, subscriptions, or inventory — statuses are mostly **derived** from flags and related records (you rarely write `status` itself), payments auto-update their orders/invoices, subscription creation can charge immediately, and stock is an append-only adjustment ledger.

Read `references/promotions-discounts.md` before scripting discounts or stored value — coupons (including bulk code generation), gift cards, promotions, and purchase links.

# VII. Errors, Rate Limits, Retries

Read `references/clients.md` — the clients do not report failures the same way. Batch and transaction results are in `references/writes.md`.

# VIII. Operating Guardrails

- Point scripts at the test environment (`sk_test_…`) first; run bulk updates against test records before live. Before any bulk write, print the loaded key's prefix and confirm the environment segment — a bare `sk_` is **live**, not test. `GET /:clients/:self/keys` lists only the keys belonging to the environment the current credentials resolve to, a second way to confirm before writing.
