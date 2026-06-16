# Changelog

All notable changes to this marketplace are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [SemVer](https://semver.org/).

## [0.2.0] - 2026-06-11

### Added
- `swell-app` (v0.2.0): `functions-workflows.md` reference for the Beta workflow kind (feature-gated; engaged only on explicit request or confirmed store enablement).
- Functions guidance: `req.swell.transaction()`, `$event.delivery` retry state, `SwellError` `retry: false`, `$app` deep-merge/`$set` write semantics, structured hook error bodies, normalized `$app` shape in hook data.
- Model/content guidance: app-field queries and link expansion on standard models, child app collection behavior, conditional `readonly`, record-action `conditions`, mixed app/native keys in view queries.

## [0.1.0] - 2026-05-07

### Added
- Initial release of the `swell` skills marketplace.
- `swell-app` plugin (v0.1.0) with the `swell-app` skill for Swell Apps development.
