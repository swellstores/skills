# Shipping And Tax Extensions

Bind integration apps into native order calculation. Read `app-integrations.md` first for manifest, binding model, and merchant activation basics.

## Critical Contracts

Three runtime traps no local check catches. Verify all three before claiming a shipping or tax extension is done.

### 1. Merchant Save activates dispatch — bound paths and field counts differ by type

| Type | Native record | Fields written by Save | Singleton? |
|------|---------------|------------------------|------------|
| Shipping | `carriers.<extId>` | `enabled`, `extension_app_id`, `extension_config_id` (**all three required for dispatch**) | No — multiple shipping carriers coexist |
| Tax | top-level `/settings/taxes` (one slot, hence singleton) | `extension_app_id`, `extension_config_id` | **Yes** — toggling another tax extension on auto-replaces this one |

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
    { "id": "fedex_rates", "type": "shipping", "carrier": "fedex" }
  ]
}
```

Tax:

```json
{
  "type": "integration",
  "extensions": [
    { "id": "tax_service", "type": "tax" }
  ]
}
```

`carrier` (shipping, optional) — carrier id used for binding and display; defaults to extension `id`. Set explicitly to bind into a specific named carrier slot rather than introduce a new one.

## Hook Function Contracts

Both events are platform-owned model hooks. Use explicit `before:`/`after:` phases — bare events default to `after`.

| Function | Event | Recommended phase | model.fields | req.data carries | Return shape |
|----------|-------|-------------------|--------------|------------------|--------------|
| Shipping rating | `order.shipping` | `after` (default) | `["shipment_rating"]` | shipping address, items, currency/locale, existing `shipment_rating.services` | `{ shipment_rating: { services: [...] } }` |
| Tax calc | `order.taxes` | `before` (replace native) or `after` (post-process) | `["items", "taxes"]` | items, currency/locale | `{ items: [{id, taxes: [...]}], taxes: [{id, name, amount}] }` |

Phase choice:

- `after:order.shipping` — default; add or replace services after native rating and webhooks run.
- `before:order.shipping` — rare; mutate inputs before native rating.
- `before:order.taxes` — replace native tax calculation entirely; the most common phase when bound.
- `after:order.taxes` — post-process or coexist with native/webhook tax work.

For shipping, preserve existing `shipment_rating.services` in `after:` unless intentionally replacing native rating. For tax, return both per-item assignments and order-level totals when the provider supplies them. Keep service/tax `id`s stable — downstream recalculation and display key off them.

A second function in the same app subscribing to the same `event+extension+phase` is logged as a conflict and only one result is used. Split work across phases or combine into one handler.

Verify `req.data` shape against the table by logging it on first invocation via `swell logs --type function --app=.`; remove diagnostic logs before finalizing.

### Shipping example

```typescript
export const config: SwellConfig = {
  extension: "fedex_rates",
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
  extension: "tax_service",
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

Settings deploy and resolve identically to non-extension apps.

## Merchant Activation

`swell app push` does not activate the extension. Code-only agents cannot perform these steps; surface them to the user when an extension is freshly deployed.

1. Install the app in the store.
2. Open Settings → Shipping (for shipping) or Settings → Taxes (for tax). The extension appears as a row.
3. *(Optional)* Open the extension's settings dialog, fill in provider credentials, and Save the dialog (writes the per-extension app settings).
4. Toggle the row on and click **Save changes** at the page level.

Step 4 writes:

| Type | Persisted by Save |
|------|-------------------|
| Shipping | `carriers.<extId>.enabled = true` plus hidden `extension_app_id` and `extension_config_id`. **All three required** for dispatch. |
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
- (Tax) Assuming dispatch isn't competing — only one tax extension is active at a time.
