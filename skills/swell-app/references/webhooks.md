# Webhooks

Webhooks send model events to external endpoints, declared as JSON manifests in `./webhooks/*.json`. Use them when the event handling logic lives outside Swell; for Swell-hosted logic, prefer functions. Consult `swell schema webhook --format=dts` for every property.

Webhooks subscribe to async events only — the `before:`/`after:` hook prefix is rejected at deploy; use a function for synchronous hook semantics.

## Enable it

**`enabled` defaults to `false`.** `swell create webhook … -y` writes `enabled: false` unless you pass `--enabled`, and the interactive prompt defaults to No. A disabled webhook deploys cleanly, appears in `swell inspect webhooks`, and never fires — set `"enabled": true` in the manifest before pushing and confirm the deployed value in detail mode.

## What the endpoint receives

The payload is the event record plus two `$`-prefixed additions: `id`, `date_created`, `model`, `type`, `data` (record snapshot on `created`/`deleted`, `id` plus changed fields on `updated`, and for most other events the `id` alone), `app_id`, `req_id`, `user_id`, plus `$type` (fully qualified event type — `<model>/<type>`, or `$app.<app_id>.<model>/<type>` for app events) and `$delivery` (`{ attempts, date_first_failed }`, `attempts` is `0` on first delivery). In the payload an app id is the app's record id (24 hexadecimal characters), not the `id` from `swell.json`: an app collection's `model` reads `apps/<record id>/<collection>`, and `$type` and `app_id` carry the same id.

- The environment arrives as the `Swell-Env` **request header**, not in the body.
- **No store identifier is sent at all** — use a per-store endpoint URL if the receiver serves multiple stores.
- Requests time out after 10 seconds; the endpoint must return a 2xx.
- Retries: the first retry comes ~1 minute after failure, then exponentially spaced attempts (roughly 10 per day) with a ~12-hour gap between daily cycles.

Swell sends **no payload signature or HMAC header** — the only platform-side identity signals are the source IP and `Swell-Env`. A shared secret in the URL query string is the app-side workaround: validate it server-side *and* allowlist Swell's published webhook IPs. Treat payload contents as untrusted either way — re-fetch by `data.id` before acting.

The delivery contract in full — payload shapes per event type, the retry schedule, responses that stop retries, reading delivery rows — is in the `swell-backend-api` skill's `references/events-webhooks.md`. It applies to app-owned webhooks unchanged.

## A webhook that does not fire

1. `enabled` is `false` in the manifest (above).
2. The app is inactive in that environment — `active: false` on the installed app suppresses every app-owned webhook delivery with no error. See "When a function does not run" in `references/functions.md`.
3. It was auto-disabled.

**Recovering an auto-disabled webhook.** After ~4 consecutive days of failures with no success the platform sets `enabled: false` alongside `auto_disabled: true`, and dispatch tests only `enabled`. Setting `enabled` back to true is what revives it — the platform then replays all pending events and clears `auto_disabled`. For an app-owned webhook that flip rides on re-installing the manifest, i.e. `swell app push`, and push skips files whose hash is unchanged: fixing the endpoint without touching `webhooks/*.json` leaves the webhook dark. Use `swell app push --force`, exactly as with an auto-disabled function, then confirm `auto_disabled` cleared with `swell inspect webhooks <key>`. List mode (`swell inspect webhooks --app=.`) surfaces auto-disable status, subscribed events, and failure counts.
