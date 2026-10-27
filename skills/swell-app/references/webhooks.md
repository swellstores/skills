# Webhooks

Webhooks send model events to external endpoints, declared as JSON manifests in `./webhooks/*.json`. Use them when the event handling logic lives outside Swell; for Swell-hosted logic, prefer functions. Consult `swell schema webhook --format=dts` for every property.

Webhooks subscribe to async events only — the `before:`/`after:` hook prefix is rejected at deploy; use a function for synchronous hook semantics.

## What the endpoint receives

The payload is the event record plus two `$`-prefixed additions: `id`, `date_created`, `model`, `type`, `data` (record snapshot on `created`/`deleted`, `id` plus changed fields on `updated`, and for most other events the `id` alone), `app_id`, `req_id`, `user_id`, plus `$type` (fully qualified event type — `<model>/<type>`, or `$app.<app_id>.<model>/<type>` for app events) and `$delivery` (`{ attempts, date_first_failed }`, `attempts` is `0` on first delivery). In the payload an app id is the app's record id (24 hexadecimal characters), not the `id` from `swell.json`: an app collection's `model` reads `apps/<record id>/<collection>`, and `$type` and `app_id` carry the same id.

- The store arrives as the `Swell-Store-Id` **request header** and the environment as `Swell-Env`; the body names neither.
- Requests time out after 10 seconds; the endpoint must return a 2xx.
- Retries: each delivery is sent again ~1 minute after its first failure, then at growing intervals, 12 hours after every tenth failure. A `Retry-After` header on the failure answer puts off the next attempt by up to 12 hours, never sooner than that schedule.

Each request is signed. Verify it before acting, against the body exactly as received: `const { event, storeId } = await verifySwellWebhook(request.headers, await request.text(), { appId })` from `@swell/apps-sdk` returns the verified event as `event`, with the `storeId` it came from. `appId` (the `id` in `swell.json`) refuses webhooks of apps with another id; check `storeId` against the stores the app is installed in, since another developer's private app can have the same id. How to verify without the SDK is under "What the endpoint receives" in the `swell-backend-api` skill's `references/events-webhooks.md`.

The delivery contract in full — payload shapes per event type, the retry schedule, responses that stop retries, reading delivery rows — is in the `swell-backend-api` skill's `references/events-webhooks.md`. It applies to app-owned webhooks unchanged.

## A webhook that does not fire

1. The deployed webhook has `enabled: false` (`swell inspect webhooks <key>`): set in the manifest, or kept from an install that had it off.
2. The app is inactive in that environment — `active: false` on the installed app suppresses every app-owned webhook delivery with no error. See "When a function does not run" in `references/functions.md`.
3. It was auto-disabled.
4. The write changed only app fields. Such an `updated` event reaches an app's webhook only when that app's own fields changed.

**Recovering an auto-disabled webhook.** After ~4 consecutive days of failures with no success the platform sets `enabled: false` alongside `auto_disabled: true`, and dispatch tests only `enabled`. Setting `enabled` back to true is what revives it — the platform then replays all pending events and clears `auto_disabled`. For an app-owned webhook that flip rides on re-installing the manifest, i.e. `swell app push`, and push skips files whose hash is unchanged: fixing the endpoint without touching `webhooks/*.json` leaves the webhook dark. Use `swell app push --force`, exactly as with an auto-disabled function, then confirm `auto_disabled` cleared with `swell inspect webhooks <key>`. List mode (`swell inspect webhooks --app=.`) surfaces auto-disable status, subscribed events, and failure counts.
