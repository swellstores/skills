# Integration Apps

Read before authoring or debugging any extension. Then load `payment-extensions.md` (for `payment`) or `shipping-tax-extensions.md` (for `shipping`/`tax`) — not both. Settings, functions, and assets behave like any other Swell app; the only architectural difference is that extension slots let native platform flows dispatch into app-provided behavior.

## Binding Model

`swell app push` deploys code; it does not activate it. Dispatch fires only when (a) a native settings record selects this app via `extension_app_id`/`extension_config_id`, AND (b) the handler's `config.extension` matches the manifest extension `id`. Most "function never runs" reports are merchant-activation gaps, not code bugs.

The extension `id` is the stable join key — `swell.json` extension `id`, function/component `config.extension`, and platform `extension_config_id` must all match exactly.

`swell inspect extensions [--app=.]` returns three structured routing fields. Branch on `action_owner` first:

- `action_owner` — `dev` (resolve `action`), `merchant` (surface `action` verbatim, stop debugging), or `null` (no action when activated).
- `action` — pre-formatted next-step string. Use as-is; do not paraphrase.
- `status` — labeled outcome (`activated`, `gateway missing`, `no handler`, etc.). Match the literal string, not a paraphrase. Diagnostic only — let `action_owner`/`action` drive behavior.

Detail mode (`swell inspect extensions app.<slug>.<extId>`) adds a `Next steps:` footer of runnable commands; merchant-UI steps are prefixed `(merchant)`.

Non-obvious invariants:

- **Shipping alone treats `enabled: false` as a dispatch gate.** Payment-alt and tax dispatch fire whenever `extension_app_id` is set; for payment-alt, `enabled` is checkout-list visibility only.
- **`missing_required_events` is independent of `status`.** Partial event coverage still reports `activated` — check the field separately.
- **Use `app.<slug>.<extId>` from list-mode column 1** as the extension identifier. Hex ids from `bound.functions[].id` / `bound.components[].id` are not accepted — extensions are a synthesized resource with no canonical 24-char id.
- **Non-null `local_diff`** means the deployed manifest differs from local `swell.json` — `swell app push` before debugging dispatch.

## Manifest

Scaffold with the CLI:

```bash
swell create app my_payment --type integration --integration-type payment --integration-id revolut -y
```

Minimal manifest:

```json
{
  "id": "my_payment", "name": "My Payment", "type": "integration", "version": "1.0.0",
  "extensions": [{ "id": "revolut", "type": "payment" }]
}
```

Use hyphens, never underscores, in an extension `id` — an `_` silently breaks settings-panel resolution (see Settings).

Each extension entry binds into one native flow:

| Type | Native flow | Resources |
|------|-------------|-----------|
| `payment` | payment method, gateway, intent, charge, refund | `settings/`, `functions/`, optional `components/` |
| `shipping` | shipment rating | `settings/`, `functions/` |
| `tax` | tax calculation | `settings/`, `functions/` |

Extension fields (current platform branch):

| Field | Required | Applies | Notes |
|------|------|------|------|
| `id` | yes | all | Stable extension config id; unique within the app |
| `type` | yes | all | `payment` \| `shipping` \| `tax` |
| `name`, `description` | no | all | Admin display; fall back to the app's |
| `setting` | no | all | Settings-config **name** (not filename) to render. See Settings for the full resolution order |
| `method` | no | payment | Card discriminator only. The effective value is `method` falling back to `id` (platform formula `if(method, method, id)`): `card` → card-gateway replacement, anything else → alt method. Does NOT rename the method id |
| `gateway` | no | payment | Declared on the app record as a plain string, but no platform, Admin, CLI, or checkout code reads it. Do not rely on it |
| `carrier` | no | shipping | Carrier id; defaults to `id` |
| `*_logo_src`, `*_icon_src` | no | payment, shipping | Declared home for per-extension display assets (`method_*`, `gateway_*`, `carrier_*`) — schema-valid but inert; see below. `assets/icon.*` is what renders |

Two payment traps in that table:

- **`method` does not rename the method record.** The Admin always writes `methods.<extension.id>` (`methods.card` for card gateways) and reads `method` only to decide card vs. alt. Declaring `{"id": "revolut", "method": "revolut_pay"}` activates `methods.revolut`, but `swell inspect extensions` looks up `methods.revolut_pay` and reports a false `not activated`. Leave `method` unset unless the value is exactly `"card"`.
- **A card-gateway extension needs `id: "card"` too.** Checkout renders app components with `component.extension === selectedMethod.id`, and the selected method id for a card gateway is always `card` — a card-gateway extension whose `id` differs can never render its component. Keep the extension `id` free of underscores: the Admin stores the merchant's card-gateway choice as the string `app_<appId>_<extId>` and recovers the pair with `split('_').slice(1)`, so an `_` in the extension id writes a truncated `extension_config_id` and dispatch never binds. `<appId>` there is the app's 24-character record id, never the `swell.json` slug, so an underscore in the app id is harmless. (Alt methods are unaffected — they carry both ids through state, never through a split.)

Per-extension display assets do not render. `gateway_logo_src`/`gateway_icon_src` and the `method_*`/`carrier_*` pairs are their declared home, but the installer matches uploaded image paths against `app.highlights` — a field whose schema is only `id`/`title`/`description`/`image_src` — so `extension_assets[]` is never populated and the Admin falls back to the app-level icon (`logo_src`, else `assets/icon.*`). Ship one app icon; do not rely on these fields or on `gateway`.

Untyped fields (e.g. `subscriptions: true` on payment extensions — see `payment-extensions.md`) are platform-branch contracts. Preserve them when editing known-good apps; do not introduce new ones without verifying the current platform consumes them (inspect the app schema, search platform code, confirm in a test store).

## Settings

Behave like ordinary app settings:

```typescript
const settings = await req.swell.settings();                       // default
const settings = await req.swell.settings(`${req.appId}/revolut`); // explicit
```

Mark fields `"public": true` to expose to checkout components; provider secrets must remain non-public. Do not invent extension-specific settings APIs — the standard `req.swell.settings()` is the only access path.

A settings config's **name** is the file basename with underscores converted to hyphens — `settings/my_method.json` deploys as name `my-method`. That name is both the settings group key passed to `req.swell.settings()` as `<appId>/<name>` and the key the Admin matches on. The Admin picks an extension's settings panel in this order:

1. If the app has exactly one settings config **and** exactly one extension, that config is used whatever its name.
2. Otherwise the config whose name equals the manifest's `setting`, if `setting` is set.
3. Otherwise the config whose name equals the extension `id`.

So an extension id containing `_` never matches its like-named file, and the panel degrades to "Navigate to app settings to configure this extension" — silently, and only once a second extension or settings file makes rule 1 stop covering it. Use hyphens in extension ids and settings filenames, or set `setting` to the deployed (hyphenated) name.

## Design Checklist

Before authoring:

- Extension `type` and `id`, and the native flow that will select them.
- Whether a checkout component is needed (payment only — shipping/tax/generic have no component host today).
- Which settings are credentials/options.
- How you'll prove activation: `swell inspect extensions app.<slug>.<extId>` → `action_owner`/`action`.

Then read the type-specific reference: `payment-extensions.md` or `shipping-tax-extensions.md`.
