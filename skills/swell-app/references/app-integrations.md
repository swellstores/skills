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
swell create app my_payment --type integration --integration-type payment --integration-id my_method -y
```

Minimal manifest:

```json
{
  "id": "my_payment", "name": "My Payment", "type": "integration", "version": "1.0.0",
  "extensions": [{ "id": "my_method", "type": "payment" }]
}
```

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
| `setting` | no | all | Settings-config name to render. Defaults to a config matching extension `id` |
| `method` | no | payment | Payment method id; defaults to `id`. Use `"card"` for card-gateway replacement |
| `gateway` | no | payment | Card-gateway display metadata |
| `carrier` | no | shipping | Carrier id; defaults to `id` |
| `*_logo_src`, `*_icon_src` | no | payment, shipping | Display assets (`method_*`, `gateway_*`, `carrier_*`); also reachable via `extension_assets[]`. `assets/icon.*` remains the app-level icon. |

Untyped fields (e.g. `subscriptions: true` on payment extensions — see `payment-extensions.md`) are platform-branch contracts. Preserve them when editing known-good apps; do not introduce new ones without verifying the current platform consumes them (inspect the app schema, search platform code, confirm in a test store).

## Settings

Behave like ordinary app settings:

```typescript
const settings = await req.swell.settings();                       // default
const settings = await req.swell.settings(`${req.appId}/revolut`); // explicit
```

Mark fields `"public": true` to expose to checkout components; provider secrets must remain non-public. Do not invent extension-specific settings APIs — the standard `req.swell.settings()` is the only access path. By default the Admin renders `settings/<extension.id>.json` as an extension's settings panel; set the manifest's `setting` field to point to a different config when multiple extensions share one credentials group.

## Design Checklist

Before authoring:

- Extension `type` and `id`, and the native flow that will select them.
- Whether a checkout component is needed (payment only — shipping/tax/generic have no component host today).
- Which settings are credentials/options.
- How you'll prove activation: `swell inspect extensions app.<slug>.<extId>` → `action_owner`/`action`.

Then read the type-specific reference: `payment-extensions.md` or `shipping-tax-extensions.md`.
