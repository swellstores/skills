# Integration Apps

Read before authoring or debugging any extension. Then load `payment-extensions.md` (for `payment`) or `shipping-tax-extensions.md` (for `shipping`/`tax`) — not both. Settings, functions, and assets behave like any other Swell app; the only architectural difference is that extension slots let native platform flows dispatch into app-provided behavior.

## Binding Model

`swell app push` deploys code; it does not activate it. Dispatch fires only when (a) a native settings record selects this app via `extension_app_id`/`extension_config_id`, AND (b) the handler's `config.extension` matches the manifest extension `id`. Most "function never runs" reports are merchant-activation gaps, not code bugs.

The extension `id` is the stable join key — `swell.json` extension `id`, function `config.extension` (a string), component `config.extension.id` (an object, see `payment-extensions.md`), and platform `extension_config_id` must all match exactly.

`swell inspect extensions [--app=.]` returns three structured routing fields. Branch on `action_owner` first:

- `action_owner` — `dev` (resolve `action`), `merchant` (surface `action` verbatim, stop debugging), or `null` (no action when activated).
- `action` — pre-formatted next-step string. Use as-is; do not paraphrase.
- `status` — labeled outcome (`activated`, `gateway missing`, `no handler`, `settings unavailable`, etc.). Match the literal string, not a paraphrase. Diagnostic only — let `action_owner`/`action` drive behavior. Use `@swell/cli` 2.9.33 or later: older ones report an alternative method whose `method` differs from its `id` as not activated, and a card gateway as activated while the card method dispatches to another app.

Detail mode (`swell inspect extensions app.<slug>.<extId>`) adds a `Next steps:` footer of runnable commands; merchant-UI steps are prefixed `(merchant)`.

Non-obvious invariants:

- **`enabled` means what it means on the native settings record.** A shipping carrier with `enabled: false` is not rated; a payment method with `enabled: false` is not listed in checkout and still dispatches for a payment made with it. Tax settings have no `enabled`.
- **`missing_required_events` is independent of `status`.** Partial event coverage still reports `activated` — check the field separately.
- **Use `app.<slug>.<extId>` from list-mode column 1** as the extension identifier. Hex ids from `bound.functions[].id` / `bound.components[].id` are not accepted — extensions are a synthesized resource with no canonical 24-char id.
- **Non-null `local_diff`** means the deployed manifest differs from local `swell.json` — `swell app push` before debugging dispatch.

## Manifest

Scaffold with the CLI:

```bash
swell create app my_payment --type integration --integration-type payment --integration-id my-method -y
```

Manifest for an extension whose functions read only their own settings, which needs no scope. `permissions` lists the scopes of the implementation's other Backend operations (`references/permissions.md`); with none, the array stays empty and grants full access, the limitation `references/permissions.md` explains:

```json
{
  "id": "my_payment", "name": "My Payment", "type": "integration", "version": "1.0.0",
  "permissions": [],
  "extensions": [{ "id": "my-method", "type": "payment" }]
}
```

Extension config ids use **hyphens** by convention — `my-method`, never `my_method`. Underscores have historically broken two Admin lookups (settings-panel resolution, and card-gateway binding); both are being fixed, but the convention costs nothing and keeps an app off the question of which Admin version a merchant is running. Because the id doubles as an object key in billing payloads, a hyphenated id must be quoted in JS — `billing["my-method"]`, not `billing.my-method`.

Each extension entry binds into one native flow:

| Type | Native flow | Resources |
|------|-------------|-----------|
| `payment` | payment method, gateway, intent, charge, refund | `settings/`, `functions/`, optional `components/` |
| `shipping` | shipment rating | `settings/`, `functions/` |
| `tax` | tax calculation | `settings/`, `functions/` |

Extension fields:

| Field | Required | Applies | Notes |
|------|------|------|------|
| `id` | yes | all | Stable extension config id; unique within the app |
| `type` | yes | all | `payment` \| `shipping` \| `tax` |
| `name`, `description` | no | all | Admin display; fall back to the app's |
| `setting` | no | all | Settings-config **name** (not filename) to render. See Settings for the full resolution order |
| `method` | no | payment | Card discriminator only. The effective value is `method` falling back to `id` (platform formula `if(method, method, id)`): `card` → card-gateway replacement, anything else → alt method. Does NOT rename the method id |
| `method_icon_src`, `gateway_icon_src`, `gateway_logo_src` | no | payment | Images the dashboard shows for the extension; see below |
| `carrier_icon_src` | no | shipping | The same, for a shipping extension |

Two payment traps in that table:

- **`method` does not rename the method record.** The Admin always writes `methods.<extension.id>` (`methods.card` for card gateways) and reads `method` only to decide card vs. alt. Leave `method` unset unless the value is exactly `"card"`.
- **A card-gateway extension needs `id: "card"` too.** Checkout matches the component by extension: of the components the platform returns for its place, it mounts the one of the method's app whose `extension.id` is the selected method id, and the selected method id for a card gateway is always `card` — a card-gateway extension whose `id` differs is never matched, so its component can never render. Keep the extension `id` free of underscores here in particular: the Admin stores the merchant's card-gateway choice as the string `app_<appId>_<extId>`, and older builds recover the pair by splitting on every `_`, which truncates an underscored extension id into a `extension_config_id` that never binds. `<appId>` there is the app's 24-character record id, never the `swell.json` slug, so an underscore in the app id is harmless. (Alt methods are unaffected — they carry both ids through state, never through a split.)

An extension's `method_icon_src`, `gateway_icon_src` or `carrier_icon_src` names an image in `assets/` by its path from the app root, and the dashboard shows it for that extension in its payment or shipping settings in place of the app icon (`logo_src`, else `assets/icon.*`). `gateway_logo_src` is shown with the card method when the app is its gateway. A tax extension shows the app icon.

`subscriptions: true` on a payment extension is covered in `payment-extensions.md`. From `@swell/cli` 2.9.33 push warns about any other field: `gateway`, `carrier`, `method_logo_src` and `carrier_logo_src` are declared on the app record but nothing reads them, and a field the app record does not declare does nothing.

## Settings

Behave like ordinary app settings:

```typescript
const settings = await req.swell.settings();                       // default
const settings = await req.swell.settings(`${req.appId}/my-method`); // explicit
```

Mark fields `"public": true` to expose to checkout components (`settings` prop); provider secrets must remain non-public. Do not invent extension-specific settings APIs — the standard `req.swell.settings()` is the only access path.

A settings config's **name** is the file basename with underscores converted to hyphens — `settings/my_method.json` deploys as name `my-method`. That name is both the settings group key passed to `req.swell.settings()` as `<appId>/<name>` and the key the Admin matches on. The Admin picks an extension's settings panel in this order:

1. If the app has exactly one settings config **and** exactly one extension, that config is used whatever its name.
2. Otherwise the config whose name equals the manifest's `setting` or, when `setting` is not set, the extension `id`. A `setting` that names no config does not fall back to the `id`.

Rule 2 takes `_` and `-` as the same, so an extension id `my_method` finds `my-method`. When no config matches, the panel shows "Navigate to app settings to configure this extension".

## Design Checklist

Before authoring:

- Extension `type` and `id`, and the native flow that will select them.
- Whether a checkout component is needed (payment only — shipping/tax have no component place yet).
- Which settings are credentials/options.
- How you'll prove activation: `swell inspect extensions app.<slug>.<extId>` → `action_owner`/`action`.

Then read the type-specific reference: `payment-extensions.md` or `shipping-tax-extensions.md`.
