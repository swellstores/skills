# Changelog

All notable changes to this marketplace are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [SemVer](https://semver.org/).

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
