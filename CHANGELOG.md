# Changelog

All notable changes to this marketplace are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [SemVer](https://semver.org/).

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
