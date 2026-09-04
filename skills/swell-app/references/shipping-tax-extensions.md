# Shipping And Tax Extensions

Bind integration apps into native order calculation. Read `app-integrations.md` first for manifest, binding model, and merchant activation basics.

## Critical Contracts

Three runtime traps no local check catches. Verify all three before claiming a shipping or tax extension is done.

### 1. Merchant Save activates dispatch — bound paths and field counts differ by type

| Type | Native record | Fields written by Save | Singleton? |
|------|---------------|------------------------|------------|
| Shipping | `/settings/shipments/carriers/app_<appId>_<extId>` | `enabled`, `extension_app_id`, `extension_config_id` (**all three required for dispatch**) | No — multiple shipping carriers coexist |
| Tax | top-level `/settings/taxes` (one slot, hence singleton) | `extension_app_id`, `extension_config_id` | **Yes** — toggling another tax extension on auto-replaces this one |

The carrier row id is `app_<appId>_<extId>`, never the bare extension id. `<appId>` is the app's 24-char record id (`app_id` on the install), not the slug; `<extId>` is the manifest extension `id`, unaffected by the manifest `carrier` field. Reading `/settings/shipments/carriers/<extId>` returns nothing and is the standard way to wrongly conclude the merchant never activated. Dispatch itself scans every row in `carriers` and gates on the row's fields, not its id — a row written by hand under another id still fires — but merchant Save only ever writes the `app_<appId>_<extId>` id.

`swell app push` does not write any of these. Until the merchant performs the steps in §Merchant Activation, dispatch silently does not fire.

**Verify:** `swell inspect extensions app.<slug>.<extId>` reports `status: "activated"`. If `action_owner === "merchant"`, surface `action` verbatim and stop debugging.

### 2. Shipping is the only extension type where `enabled: false` blocks dispatch

Tax (and payment-alt) dispatch fires whenever `extension_app_id` is set. Only shipping reads `enabled` as a dispatch gate — a shipping carrier with `enabled: false` and `extension_app_id` set still does not dispatch.

### 3. Hook results merge into the calculation payload — they do not replace it

Declare `model.fields` for every top-level field returned. Return only fields the platform should mutate. When bound, the extension is authoritative for the fields it returns; native calculation can still run for non-extension services/carriers in shipping, and for tax falls back to internal rules only when no extension is bound.

## Manifest

Shipping:

```json
{
  "type": "integration",
  "extensions": [
    { "id": "fedex-rates", "type": "shipping", "carrier": "fedex" }
  ]
}
```

Tax:

```json
{
  "type": "integration",
  "extensions": [
    { "id": "tax-service", "type": "tax" }
  ]
}
```

`carrier` (shipping, optional) — display/asset key only, defaulting to the extension `id`; it names the carrier logo and icon assets on the app record. It does not affect the bound carrier row id and cannot redirect the binding into a differently named carrier slot.

## Hook Function Contracts

Both events are platform-owned model hooks. Use explicit `before:`/`after:` phases — bare events default to `after`.

| Function | Event | Recommended phase | model.fields | req.data carries | Return shape |
|----------|-------|-------------------|--------------|------------------|--------------|
| Shipping rating | `order.shipping` | `after` (default) | `["shipment_rating"]` | shipping address, items, currency/locale, existing `shipment_rating.services` | `{ shipment_rating: { services: [...] } }` |
| Tax calc | `order.taxes` | `before` (preferred) | `["items", "taxes"]` | items, currency/locale | `{ items: [{id, taxes: [...]}], taxes: [{id, name, amount}] }` |

Phase choice:

- `after:order.shipping` — default; add or replace services after native rating and the order webhook run.
- `before:order.shipping` — rare; mutate inputs before native rating.
- Both shipping phases sit behind a shipment-params fingerprint. A save that changes nothing shipping-relevant (address, items, shipment settings) fires neither phase — that is a stale rating, not a broken function.
- Binding — not phase — is what disables native tax calculation. Once `/settings/taxes.extension_app_id` is set, `applyTaxRules` and the tax integration webhooks are skipped for **both** phases, so an `after:` handler has no native result to coexist with.
- `before:order.taxes` — runs after existing taxes are cleared and before the order webhook. Prefer this one.
- `after:order.taxes` — runs after the order webhook. On a recalculation where no tax-relevant field changed the whole routine returns early and neither phase fires — except when a previously failed order webhook is pending retry, where the pass skips `clearTaxes` and `before:` but still fires `after:`. Make `after:` handlers idempotent.

Bind one tax phase, not both — both receive the same extension dispatch, so a two-phase app calls the provider twice per calculation.

For shipping, preserve existing `shipment_rating.services` in `after:` unless intentionally replacing native rating. For tax, return both per-item assignments and order-level totals when the provider supplies them. Keep service/tax `id`s stable — downstream recalculation and display key off them.

A second function in the same app subscribing to the same `event+extension+phase` is logged as a conflict and only one result is used — combine them into one handler.

Verify `req.data` shape against the table by logging it on first invocation via `swell logs --type function --app=.`; remove diagnostic logs before finalizing.

### Shipping example

```typescript
export const config: SwellConfig = {
  extension: "fedex-rates",
  description: "Rate shipment",
  model: { events: ["after:order.shipping"], fields: ["shipment_rating"] },
};

export default async function (req: SwellRequest) {
  return {
    shipment_rating: {
      services: [
        { id: "fedex_ground", name: "FedEx Ground", price: 10, carrier: "fedex" },
      ],
    },
  };
}
```

Service objects need stable `id`, `name`, `price`; optional `description`, `carrier`, provider metadata.

### Tax example

```typescript
export const config: SwellConfig = {
  extension: "tax-service",
  description: "Calculate taxes",
  model: { events: ["before:order.taxes"], fields: ["items", "taxes"] },
};

export default async function (req: SwellRequest) {
  const item = req.data.items?.[0];
  return {
    items: [
      { id: item.id, taxes: [{ id: "provider_tax", amount: 5 }] },
    ],
    taxes: [
      { id: "provider_tax", name: "Sales Tax", amount: 5 },
    ],
  };
}
```

## Settings

Read provider credentials as normal app settings. Disambiguate when the app has multiple settings groups:

```typescript
const settings = await req.swell.settings();                       // default
const settings = await req.swell.settings(`${req.appId}/provider`); // explicit
```

A settings config's name is its file basename with `_` converted to `-`, and the Admin renders an extension's panel from the config whose name equals the manifest `setting`, else the extension `id`. Hyphenate both — an extension id containing `_` can never match its own deployed settings name, and the panel silently degrades to a "navigate to app settings" stub. Full resolution order in `app-integrations.md` § Settings.

## Merchant Activation

`swell app push` does not activate the extension. Code-only agents cannot perform these steps; surface them to the user when an extension is freshly deployed.

1. Install the app in the store.
2. Open Settings → Shipping (for shipping) or Settings → Taxes (for tax). The extension appears as a row.
3. *(Optional)* Open the extension's settings dialog, fill in provider credentials, and Save the dialog (writes the per-extension app settings).
4. Toggle the row on and click **Save changes** at the page level.

Step 4 writes:

| Type | Persisted by Save |
|------|-------------------|
| Shipping | A carrier row at `/settings/shipments/carriers/app_<appId>_<extId>`: `enabled = true` plus hidden `name`, `extension_app_id` (the 24-char app record id) and `extension_config_id` (the extension id). **`enabled` + `extension_app_id` + `extension_config_id` all required** for dispatch. |
| Tax | top-level `/settings/taxes.{extension_app_id, extension_config_id}`. Replaces any prior active tax extension. |

Without these fields, `order.shipping`/`order.taxes` does not dispatch to the extension. For tax, the platform falls back to its internal tax rules.

## Verification & Common Mistakes

Verify in order:

1. `swell inspect extensions app.<slug>.<extId>` reports `status: "activated"`. For tax, `not selected` means another tax extension is currently bound — toggling this one on auto-disables that one.
2. Triggering the relevant flow fires the function:
   - Shipping: change shipping address or cart contents.
   - Tax: trigger order/cart recalculation.
3. Returned fields persist on the calculated record (`shipment_rating.services` for shipping; `items[].taxes` and `taxes[]` for tax).
4. `swell logs --type function --app=.` shows the invocation and provider response.

Common mistakes:

- Adding `components/*.tsx` for shipping or tax UI — components are loaded only by checkout's payment step today; the bundle deploys but never renders.
- Treating `order.shipping` or `order.taxes` as ordinary async model events.
- Forgetting `config.extension`, or setting it to a value that doesn't equal the manifest extension `id` — the function misses extension-scoped dispatch.
- Returning a full provider response instead of the narrow merge fields.
- Returning tax totals without item-level tax details when downstream flows expect item taxes.
- Two functions in the same app subscribing to the same `event+extension+phase` — only one result is used and the platform logs a conflict.
- (Shipping) Saving the extension settings dialog but forgetting to toggle `enabled` on the carrier row.
- (Shipping) Reading `/settings/shipments/carriers/<extId>`, finding nothing, and reporting the extension unactivated — the row id is `app_<appId>_<extId>`.
- (Tax) Binding `after:order.taxes` expecting to post-process a native result — binding already suppressed it.
- (Tax) Assuming dispatch isn't competing — only one tax extension is active at a time.
