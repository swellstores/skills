# Changelog

All notable changes to this marketplace are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [SemVer](https://semver.org/).

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
