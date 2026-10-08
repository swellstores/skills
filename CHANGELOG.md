# Changelog

All notable changes to this marketplace are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [SemVer](https://semver.org/).

## [Unreleased]

### Added
- `swell-app`: `references/components.md` documents app components in admin content fields (`type: "component"`): files and names, the Preact build, `ComponentProps`, calling functions and `/app-api` with `props.fetch`, `req.swellContext`, and the security model; cross-references added to `SKILL.md` and to the content-model, route, frontend, dashboard-frontend, CLI and extension references.

## [0.7.0] - 2026-10-08

The set is restructured around what is being built. `swell-app` owns the app — scaffolding, resources, runtime clients, frontends, deployment — and two API skills own what the Backend and Frontend APIs do, inside an app or outside one. Each skill was verified by fresh agents building from it alone on a test store: four apps, eight standalone backend integrations, four independent storefronts and three apps that use all three skills.

Baseline: `@swell/cli` 2.9.25, `swell-js` 5.9.2, `swell-node` 6.0.5, `@swell/apps-sdk` 2.0.0-alpha.4 (`next`).

### Changed
- **`swell-backend` is replaced by `swell-backend-api` and `swell-storefront` by `swell-frontend-api`.** The old skills are removed. Claude Code: `claude plugin marketplace update swell`, then `claude plugin update swell@swell`. `npx skills`: `npx skills add swellstores/skills` and `npx skills remove swell-backend swell-storefront`, each with `-g` for a global install; `npx skills update` alone does not install the new skills. The README's "Upgrade" section has the details, including the move from the `swell-app@swell` plugin of 0.3.0 and earlier.
- The API skills apply inside Swell apps as well as to independent integrations and storefronts, and compose with `swell-app`: the app skill supplies the runtime clients, the API skills explain their operations.
- `swell-app` now covers code-based storefront apps, with managed frontends as the default (Vinext for storefront and dashboard apps, React for dashboard apps without SSR). Proxima / Liquid themes stay out of scope.
- `swell-app/SKILL.md` is rewritten around the building blocks an app is made of; authoring and debugging detail moved into references (`data-models.md`, `functions.md`, `permissions.md`, `settings.md`, `webhooks.md`). `actions.md` is rewritten from runs on a test store.
- API examples are client-neutral: a single write is given as method, path and body.
- Each rule is stated once, in the reference that owns it. Both API skills stay near their previous size.

### Added
- `swell-app`: `frontend-dashboard.md` (embedding, navigation, store-user authorization, preview), `frontend-storefront.md` (storefront association, addresses, shared sessions), a redesigned `frontend.md` (templates, runtime boundaries, frontend endpoints against app functions, self-hosting on Cloudflare and switching from managed hosting).
- `swell-app`: third-party callbacks through a route function addressed with the app's public key, what reaches `req.rawBody` from an outside caller, cron syntax and time zone, and one permissions policy for scoped apps.
- `swell-backend-api`: `orders-payments.md` (orders, shipments, payments, refunds, returns, invoices, subscriptions), `products-inventory.md` and `accounts.md`, split out of `commerce.md`; standalone client rules for `swell-node`, the Apps SDK Backend client and direct HTTP on the entry page; how an app's collections and fields are addressed from outside the app.
- `swell-frontend-api`: `clients-sessions.md` (replaces `ssr.md`: clients, cookie adapters, sessions, caching), `cart-checkout.md` (replaces `checkout.md`, with one statement of how failures arrive) and `accounts-subscriptions.md`.

### Fixed
- Backend API: the object form of `aggregate` takes named stages; a `PUT` to a missing id creates the record; a `/:transaction` drops `$app` values without an error; events recorded while a webhook is switched off are never delivered; `paid` stays true after a refund; a subscription cancel needs `cancel_at_end` in the body in both directions; a `PUT` that changes a stock adjustment's `quantity` is refused; a cart keeps the discounts it was given until `$promotions: true` or a rewritten code.
- Frontend API: `swell.create()` clients are isolated from swell-js 5.9.0, so the shared-state warnings are gone; a product's `price` is already the sale or customer-group price; cart item calls can reject as well as resolve with `errors`; a second `cart.submitOrder()` returns the order; card elements exist for Stripe, Quickpay and ConvesioPay only; `{ cancel_at_end: false }` alone cancels a scheduled subscription at once; a missing record reads `null` or an empty string; GraphQL takes the public key bare in `Authorization`; the TypeScript notes match the 5.9.2 declarations.
- `swell-app`: model event names use the short form only (the model-qualified form is refused at push); the note on JSON-manifest validation in CLIs before 2.9.24 is removed; `config.extension` is required on functions serving an extension slot.

### Removed
- `swell-backend` and `swell-storefront`.
- Undocumented request flags and internals, except where developers.swell.is documents them or a common task needs them.
- Workarounds for defects fixed in current `swell-js`, `swell-node` and CLI releases.

## [0.6.0] - 2026-10-06

Covers platform and CLI changes through 2026-10-06, plus the fixes merged since 0.5.0.

### Added
- `swell-app`: `references/actions.md`, covering app actions (dashboard buttons that run app functions or workflows): where they render (the settings Actions menu, view `actions`/`extra_actions`, list `bulk_actions`, `type: "action"` fields), the `action: true` trigger, the `$action` context and the bulk `selection.query`, dialogs, how view defaults merge or get replaced, permissions (admin users only, refused through `$call` and the storefront gateway, role checks), local-dev behavior and testing, push and run-time error codes, the minimum `@swell/cli` (2.9.23) and `@swell/app-types` (1.2.6) versions, and an id-cursor recipe for bulk actions whose writes change what the list filters on.

### Changed
- `swell-app`: workflows are available on every store. The beta feature gate and its `workflow_beta_*` errors are gone. Workflows can declare `action: true` to be started by app actions, can read and update their own app's settings at `/settings/<req.appId>`, and their runs are listed in a Workflows tab on the app's dashboard page.
- `swell-app`: content-model actions are no longer links only. Function actions, bulk actions, and action fields write data from the dashboard, on app collections and on standard pages. A view's `actions` made entirely of function actions are added after the defaults instead of replacing them.
- `swell-app`: `swell app dev` also runs action functions locally; workflows started by actions run the pushed version.
- `swell-app`: JSON-manifest validation works again from `@swell/cli` 2.9.24, which validates against draft 2020-12; the workaround now applies only to older CLIs. Tests scaffolded by 2.9.24 also define a `SwellResponse` global.
- `swell-app`: the new `secret` settings field type masks the input in App Preferences but stores plain text, so settings are still not a secret store.
- `swell-app`: an app's functions can call each other with `PUT /:functions/app.<app slug or id>.<name>` and a `$call`-only body, with no `permissions` entry needed.
- `swell-app`: always declare `permissions` (#5); `req.isLocalDev` no longer needs a cast, and the tests-scaffold vitest pin note is removed (#6); the frontend reference is corrected for admin and integration app frontends (#9).

## [0.5.0] - 2026-08-29

Source-verification pass: 1,128 factual claims across all three skills were checked against platform, CLI, and SDK source, then the result was adversarially reviewed and re-verified. 437 corrections and additions applied across two rounds; where developers.swell.is and the platform's source disagreed, the source won.

### Fixed
- Write semantics: array elements **without** an `id` merge **positionally by index** on a plain write (only id-bearing elements align by id) — a short array silently rewrites the wrong records.
- Transactions are not atomic against validation failures: only request errors (not-found, permission, conflict, timeout) roll back; a child op's field-validation failure leaves the other operations committed.
- Storefront gateway: on **GET** the gateway re-materializes data as real URL query parameters, so `req.query` **is** populated; the drop-the-query behavior applies to non-GET methods only.
- `swell api` defaults to the **test** environment (`--live` for live data) — previously presented as equivalent to a live-key script.
- `page=all` is capped at the 1000-record query maximum and returns HTTP 400 beyond it.
- App release requirements have no two-tier split: every non-theme app needs `full_description`, `support_email`, a cover image, and an icon at release.
- `req.session` is `null` (not an admin session) when a route is invoked through `swell api`; only the storefront gateway attaches a session.
- Function responses are **truncated** at 75,000 bytes, not dropped — the caller receives an unparseable prefix.
- Settings group keys are kebab-cased from the filename (`settings/new_section.json` → `settings['new-section']`).
- Content views: a list view with no `nav` object gets no sidebar entry at all; a non-empty `actions` array replaces the view's defaults rather than appending.
- Corrected `swell.payment.tokenize()` (resolves `undefined`; results arrive via callbacks), `swell.card.createToken()` (rejects, never resolves with `errors`), iDEAL's absence from `handleRedirect`, validation-error shape (details are flattened, there is no `params` wrapper), `window` default (10), notification dispatch (create/update only), and event/webhook payload shape.
- Storefront exposure is opt-in: app extension fields on standard models are **not** readable through the Frontend API by default (the storefront field allowlist carries no `$app` entry), and app collections are invisible without `public_permissions` — previously both read as automatic.
- Checkout-proxied cart routes **reject**; only cart item routes resolve with an `errors` object. The storefront skill taught one uniform convention, which produced handlers that miss real failures.
- Generated product variants are created `active: true` (the `active: false` default applies only to hand-created variants), and `stock_tracking` must be set explicitly or stock never decrements — both silent failures in a bulk import.
- Hooks, async functions, webhooks, and notifications all stay silent for writes inside a `/:transaction`; `$filters.category` values OR rather than AND; `swell app dev` intercepts model hooks and events but not routes or cron; `nav.parent` sections without sub-items drop a collection from the sidebar entirely.

### Added
- `swell-backend`: `files-media.md` (the `/:files` collection and the base64 wire format that silently stores corrupt data), `promotions-discounts.md` (coupons and bulk code generation, gift cards, promotions, purchase links); commerce coverage for returns, invoices, product variants and options, and account authentication including the one-time `password_token` handoff; bulk-write control directives.
- `swell-storefront`: `ssr.md` (per-request clients, cookie bridging, and the state that leaks across visitors) and `catalog.md` (variant resolution, stock status, facet building); GraphQL (`/graphql/v2`, `/playground`), the shipped TypeScript declarations and where they diverge from runtime, and the third silent failure surface.
- `swell-app`: app permissions, the absence of function environment variables or secrets, `swell app pull` / `.swellrc` round-tripping, `swell app dev` environment takeover, notification dispatch controls, and push's silent per-file skips.

### Changed
- Trigger descriptions rewritten for clean routing: `swell api` moved to `swell-backend`, an explicit `theme`/`storefront` app-type exclusion added to `swell-app`, feature-level triggers added to `swell-storefront`, and cross-platform guards added to both new skills.

## [0.4.0] - 2026-08-29

### Added
- `swell-backend` skill — server-side Backend API integration: authentication and environments, live model discovery (`/:models`), querying (operators, search, expand/include, aggregation, localization/multi-currency reads), write semantics (deep-merge with merge-by-id arrays, update operators, linked collections, batch, transactions), events and webhooks (singular event roots, thin update payloads, retry/auto-disable behavior verified against the platform), and commerce lifecycles (derived statuses, payments/refunds, subscription billing anchors and proration, append-only stock ledger, account credit).
- `swell-storefront` skill — headless storefronts on the Frontend API with swell-js: client setup and session model (per-request `swell.create()` on servers), the two error modes, catalog/settings/content/localization, cart semantics, the full checkout flow (guest vs. logged-in, shipping rates, account credit behavior, hosted `checkout_url` fallback), payment elements/tokenization/redirect flows and saved cards, subscriptions, and calling app functions.

### Changed
- Repackaged as a single `swell` plugin bundling all skills (install with `/plugin install swell@swell`; the standalone `swell-app` plugin entry is retired — README documents the migration).
- `swell-app`: narrowed the trigger description so the three skills route cleanly (it no longer claims every mention of "Swell"); corrected webhook delivery numbers to platform behavior (10s timeout, ~4-day auto-disable window).
- README repositioned around full-platform coverage.

## [0.3.0] - 2026-08-28

### Added
- `swell-app` (v0.3.0): `app-publishing.md` reference covering the version → install → release lifecycle (`swell app version|install|release`), `swell.json` billing fields (`price`, `price_interval`, `price_trial_days`, `price_external`), and marketing fields validated server-side at release.
- Functions guidance: `req.reject()` / `SwellRejection` for blocking writes from `before:` hooks on any model, including standard models.
- Route guidance: hosted-gateway invocation (public key required in `Authorization`, environment selection by key, query-parameter forwarding rules through the gateway).
- Field-tested traps: stale function bundles after `functions/` subdirectory-only edits (`push --force`), `$app` array merge-by-id semantics (`$set` to replace), `swell create tests` dependency pins and missing `SwellResponse` global, settings select `options` shape, new-store test-environment gate on push.

### Changed
- `functions-hooks.md`: rejection semantics rewritten for the current platform — thrown errors (including `SwellError`) now uniformly fail open into `$function_errors` on all models; `req.reject()` is the only abort path; removed the obsolete `hook_reject_error` event property and app-own throw-to-abort guidance.
- Gate 3 / CLI Validation: documented the current CLI's JSON Schema draft mismatch (JSON-manifest validation fails with `no schema with key or ref …/2020-12/schema`) with a dts-plus-push fallback path.

## [0.2.0] - 2026-06-11

### Added
- `swell-app` (v0.2.0): `functions-workflows.md` reference for the Beta workflow kind (feature-gated; engaged only on explicit request or confirmed store enablement).
- Functions guidance: `req.swell.transaction()`, `$event.delivery` retry state, `SwellError` `retry: false`, `$app` deep-merge/`$set` write semantics, structured hook error bodies, normalized `$app` shape in hook data.
- Model/content guidance: app-field queries and link expansion on standard models, child app collection behavior, conditional `readonly`, record-action `conditions`, mixed app/native keys in view queries.

## [0.1.0] - 2026-05-07

### Added
- Initial release of the `swell` skills marketplace.
- `swell-app` plugin (v0.1.0) with the `swell-app` skill for Swell Apps development.
