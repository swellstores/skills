# Payment Extensions

Payment extensions provide custom payment methods or card gateway behavior in an integration app. Use `app-integrations.md` first for shared manifest, settings, and hook semantics; this file covers the payment-specific contracts on top of those.

## Critical Contracts

Two payment-extension behaviors fail at runtime in ways no local check catches — not `swell schema`, not `swell app push`, not `npm run typecheck`. Verify both before claiming a payment extension is done.

### 1. `payment.charge` fires twice per order — authorize then capture

- First call: `req.data.captured === false` → authorize the provider intent (no capture).
- Second call: `req.data.captured === true` → capture the previously authorized intent.
- A single-shot "create + capture" handler succeeds on the first call (capturing too early), then fails or double-charges on the second.
- Canonical handler shape: see Charge Function below — branch on `captured` and look up the existing provider intent (`req.data.intent.<provider>.id` or `req.data.transaction_id`) before creating a new one.
- **Verify:** create one test order, then run `swell logs --type function --app=.` and confirm two consecutive `payment.charge` invocations with `captured: false` then `captured: true`, returning the same `transaction_id`.

### 2. Merchant Save activates the extension, not `swell app push`

- Until the merchant opens the extension settings dialog under Settings → Payments and clicks Save, `methods.<methodId>.gateway` and `extension_app_id` are unset.
- Checkout silently filters the method out — no dispatch, no error. This is the most common cause of post-deploy "function never runs" reports.
- **Verify:** run `swell inspect extensions app.<slug>.<extId>`. If `action_owner === "merchant"`, surface `action` to the user verbatim and stop debugging the code.

## Manifest

Alternative payment method:

```json
{
  "type": "integration",
  "extensions": [
    { "id": "revolut", "type": "payment" }
  ]
}
```

Card gateway replacement (uses the `card` payment method slot):

```json
{
  "extensions": [
    { "id": "card", "type": "payment", "method": "card" }
  ]
}
```

Use a custom id for an alternative method. Use `card` only when the app is intended to handle card processing.

Set `"subscriptions": true` on the payment extension entry when the method must be selectable for subscription carts. The BFF filters payment methods on carts with `subscription_delivery: true` and only retains app-extension methods whose deployed `swell.json` entry sets this flag. Without it, the method is silently absent from the storefront for any subscription cart even though the extension is otherwise installed and configured. Omit it for one-time-only methods.

## Native Binding & Merchant Activation

Until the merchant opens the extension settings dialog and clicks Save, `methods.<methodId>.gateway` and `extension_app_id` are unset and checkout silently filters the method out. `swell app push` does not perform this step.

| Variant | Method id | Native record | Gateway record |
|---------|-----------|---------------|----------------|
| Card gateway (`method: "card"`) | `card` | `/settings/payments/methods/card` | `/settings/payments/gateways/app_<appId>_<extId>` (created on Save) |
| Alt method (any other `method` or unset) | `<extension.id>` | `/settings/payments/methods/<extension.id>` | n/a |

Merchant UI sequence (code-only agents cannot perform this; surface to the user):

1. Install the app in the store (test or live).
2. Open Settings → Payments. The extension appears as a row under the alt-method or card-gateway list.
3. Open the extension's settings dialog (or, for a card gateway, select the app from the gateway dropdown for the `card` method) and click **Save**. This writes `methods.<methodId>.gateway = "app_<appId>_<extId>"` plus `extension_app_id`, `extension_config_id`, `activated = true` (and, for card gateways, creates the `/settings/payments/gateways/app_<appId>_<extId>` record).
4. Toggle the method `enabled` and Save the page so it renders in checkout.

Verify with `swell inspect extensions app.<slug>.<extId>` — it checks both `extension_app_id` and `gateway = app_<appId>_<extId>` and reports `gateway missing` if either is wrong. When `action_owner === "merchant"`, surface `action` verbatim and stop debugging.

**Dispatch vs. visibility.** For payment-alt, `extension_app_id` alone gates dispatch; `enabled` is checkout-list visibility only. A method with `enabled: false` and `extension_app_id` set still dispatches from carts that reach checkout but won't appear in the payment list. (Shipping is the only extension type where `enabled: false` blocks dispatch.)

## Hook Function Contracts

Each payment event is a synchronous platform hook. Declare `model.fields` for every top-level field you intend to return — the platform merges them back into the payment payload.

| Function | Event | Phase rule | model.fields | req.data carries | Return success | Return failure |
|----------|-------|-----------|--------------|------------------|----------------|----------------|
| Intent | `after:payment.create_intent` | `after` only — `before:` rejected at deploy with `EventHookTypeError` | `["result", "error"]` | `account`, `intent` (the payload from `createIntent` in the component) | `{ result: { ...browserSafeData } }` | `{ error: "msg" }` |
| Get Intent | `after:payment.get_intent` | `after` only — `before:` rejected at deploy with `EventHookTypeError` | `["result", "error"]` | provider/intent identifiers (verify shape in `swell logs` before depending on additional fields) | `{ result: { ...browserSafeState } }` | `{ error: "msg" }` |
| Charge | `before:` or `after:payment.charge` | either | `["success", "error", "transaction_id"]` | `amount`, `currency`, `captured`, `intent`, `transaction_id`, `<methodId>` (e.g. `req.data.revolut`) | `{ success: true, transaction_id }` | `{ success: false, error: { message } }` |
| Refund | `before:` or `after:payment.refund` | either | `["success", "error", "transaction_id"]` | `amount`, `currency`, `transaction_id` | `{ success: true, transaction_id }` | `{ success: false, error: { message } }` |

Implement `payment.get_intent` only when the provider needs in-flight intent state refreshed from the platform — typically for redirect-return recovery, where checkout reopens after the shopper bounced through a provider page and the cart's persisted intent state is stale. The platform invokes it via `Vault.getIntent`. Skip it for fully inline flows.

Prefer explicit phases. Bare events default to `after` but the default is implicit and leaves future readers guessing. When `extension_app_id` is set, the platform skips its native handler for the method, so the extension function is authoritative regardless of phase.

Minimal Intent and Refund handlers (Charge gets its own section because of two-phase capture). These skeletons omit error wrapping for brevity — wrap provider calls in `try/catch` and return the failure contract shape on throws; see the Charge function below for the full pattern.

```typescript
// payment.create_intent
export const config: SwellConfig = {
  extension: "revolut",
  description: "Create payment intent",
  model: { events: ["after:payment.create_intent"], fields: ["result", "error"] },
};
export default async function (req: SwellRequest) {
  // req.data.intent is the payload from createIntent() in the component
  const session = await provider.createIntent(req.data.intent);
  return { result: { client_secret: session.client_secret } }; // browser-safe only
}

// payment.refund
export const config: SwellConfig = {
  extension: "revolut",
  description: "Refund payment",
  model: { events: ["after:payment.refund"], fields: ["success", "error", "transaction_id"] },
};
export default async function (req: SwellRequest) {
  const refund = await provider.refund(req.data.transaction_id, req.data.amount);
  return { success: true, transaction_id: refund.id };
}
```

If a request payload differs from the table, add structured logs to the function and inspect via `swell logs --type function --app=.`. Remove the noisy logs before finalizing.

## Charge Function: Two-Phase Auth/Capture

The default order payment flow invokes `payment.charge` **twice** on a single order:

1. With `req.data.captured === false`: authorize the provider intent without capturing funds. The order flow creates the payment record with `captured: false`, which triggers the charge handler.
2. With `req.data.captured === true`: capture the previously authorized intent. The order flow updates the payment to `captured: true`, which triggers the handler again via the platform's record-transition trigger.

This is the platform default — not optional, not specific to redirect flows. The platform's own extension test asserts a single order creation produces exactly two `payment.charge` invocations with `captured: false` then `captured: true`.

The canonical handler is two-branched and idempotent on the existing provider intent id:

```typescript
export const config: SwellConfig = {
  extension: "revolut",
  description: "Charge payment",
  model: {
    events: ["after:payment.charge"],
    fields: ["success", "error", "transaction_id"],
  },
};

export default async function (req: SwellRequest) {
  const { amount, currency, captured, intent, transaction_id } = req.data;
  // "stripe" = processing provider key, must match what the component stored in billing.intent
  const existingIntentId = intent?.stripe?.id || transaction_id;

  try {
    // Idempotent: never create a fresh intent on the second call.
    const providerIntent = existingIntentId
      ? await provider.retrieveIntent(existingIntentId)
      : await provider.createIntent({
          amount,
          currency,
          capture_method: captured === false ? "manual" : "automatic",
        });

    if (captured === false) {
      // Authorize phase: provider must be authorized but not yet captured.
      if (providerIntent.status !== "requires_capture") {
        throw new Error(`Payment is not authorized (status: ${providerIntent.status})`);
      }
    } else {
      // Capture phase: capture if pending, tolerate already-succeeded.
      if (providerIntent.status === "requires_capture") {
        await provider.captureIntent(providerIntent.id, { amount });
      } else if (providerIntent.status !== "succeeded") {
        throw new Error(`Payment is not capturable (status: ${providerIntent.status})`);
      }
    }
    return { success: true, transaction_id: providerIntent.id };
  } catch (error) {
    return {
      success: false,
      error: { message: error instanceof Error ? error.message : String(error) },
    };
  }
}
```

Invariants the handler must preserve:

- `captured === false` → authorize only. Any other value (including `undefined`, which the platform sets to `true` in many flows) is a capture request.
- Always look up the existing provider intent (`req.data.intent.<provider>.id` or `req.data.transaction_id`) before creating a new one. Creating a fresh intent on the second call double-charges.
- Return the same `transaction_id` on the second call as on the first when continuing the same provider intent. The platform persists it as the payment's authoritative transaction id.
- Validate provider state per phase: on authorize, `requires_capture` is the only valid result; on capture, accept `requires_capture` (then capture) or `succeeded` (already captured) and reject anything else. Silent acceptance of unexpected statuses returns `success: true` for payments that are not actually authorized.
- Wrap provider calls in `try/catch` and convert thrown errors into `{ success: false, error: { message } }`. Uncaught throws bypass the platform return contract and surface as a generic function failure.

## Triggering the Charge Flow (CLI)

`payment.charge` fires inside the order→payment pipeline — not by calling the function endpoint or posting to `/payments` directly.

    swell api post /orders --body '{"items":[{"product_id":"<id>","quantity":1}],"billing":{"method":"<methodId>","<methodId>":{"token":"test"}},"account_id":"<id>"}'

`<methodId>` is `card` for card gateways, or the extension `id` for alt methods. Billing on the order is sufficient — no account-level billing pre-setup required.

Verify: `swell logs --type function --app=.` — two `payment.charge` entries per Critical Contract #1. Zero entries means dispatch didn't reach the extension (check activation, not code).

## Checkout Component

Payment methods that need custom browser UI add a top-level `components/<Name>.tsx`. The file must export a named `config` AND a default Preact component. The bundler validates only `config`; a missing default export deploys cleanly and renders nothing at runtime.

```typescript
import { memo } from "preact/compat";

export const config: SwellConfig = {
  extension: "revolut",
  description: "Revolut Pay via Stripe",
};

function RevolutPay(props: SwellData) { /* ... */ }

export default memo(RevolutPay); // memo avoids redundant re-renders
```

Components bundle for the browser with Preact. Keep Node-only APIs, server-side provider SDKs, and secret-bearing modules out of component code. Browser-safe helpers in `components/lib/` may be imported from `functions/`; never import the other direction (functions may carry secrets the browser bundle must not see).

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "types": ["@swell/app-types"]
  }
}
```

Without `jsxImportSource: "preact"`, JSX resolves to React types and rejects Preact-only hooks/props. Without `types: ["@swell/app-types"]`, ambient types like `SwellConfig` and `SwellData` are unresolved.

### Injected Props

| Prop | Purpose |
|------|---------|
| `settings` | Public/browser-safe app settings for the extension UI |
| `cart` | Current cart data such as totals and currency |
| `loadLib(id, url)` | Load a third-party browser SDK once |
| `registerHandlers({ onSubmit, handleRedirect })` | Register checkout lifecycle handlers |
| `createIntent(data)` | Ask the platform to invoke the extension's `payment.create_intent` hook |
| `updateCart(data)` | Persist billing method/token/intent data on the cart |
| `onReady()` | Resolve the platform's mount promise. Submit stays disabled until called — see Lifecycle below. |

Do not invent additional props. If a component needs more data, route it through cart/settings.

### Lifecycle

1. Export `config.extension` matching the manifest extension id; default-export the component (wrap with `memo()`).
2. Render only component-owned DOM via `useRef`. The platform wraps the component in a managed container with a dynamic id (`${component.name}-${component.id}-app-extension-component`); mount third-party SDK widgets into your own ref, not the platform container.
3. `registerHandlers({ onSubmit, handleRedirect })`.
4. `loadLib(id, url)` instead of injecting duplicate script tags.
5. Initialize provider UI using public settings and current cart totals/currency.
6. **Call `onReady()` exactly once when interactive.** It resolves the platform's mount promise; `swell-checkout`'s `isSubmitDisabled()` keeps the entire payment-step submit button disabled while any component is `MOUNTED`. **Forgetting `onReady()` softlocks the whole checkout submit, not just the payment widget.** For redirect-return flows that don't remount provider UI, call `onReady()` as soon as state is sufficient to continue.
7. In `onSubmit`, validate/submit provider UI first; then `createIntent(data)` if browser intent/session data is needed.
8. Persist `billing.method` to the extension method id, provider token under `billing.<methodId>`, and provider intent id under `billing.intent.<providerId>`.

Server-side capture, authorization validation, and refunds belong in extension functions, not the component.

### Billing Persistence Contract

The payment method id is the extension `method` if provided, otherwise the extension `id`. For `id: "revolut"`:

```typescript
await updateCart({
  billing: {
    method: "revolut",
    revolut: { token: providerPaymentMethodId },
    intent: { stripe: { id: providerIntentId } },
  },
});
```

The backend payment hook receives method-specific billing under `req.data[methodId]` (e.g. `req.data.revolut`). If the component stores the token under the wrong method id, the charge function will not find it. The `billing.intent` key is the **processing provider** that generates the intent — not the extension id. In this example, the extension is `revolut` but the intent key is `stripe` because Stripe is the payment processor. When extension and processor coincide (e.g. a Klarna extension calling Klarna APIs), the key happens to equal the extension id. The charge function reads the same key: `req.data.intent?.stripe?.id`. A mismatch between what the component stores and what the function reads yields `undefined` with no deploy-time or runtime error. Store only browser-safe identifiers; never persist secret keys or raw provider responses.

### Intent Request

`createIntent(data)` is a checkout-injected helper, not the raw `swell.payment.createIntent` API. Pass the provider/browser intent payload directly:

```typescript
const { client_secret } = await createIntent({
  amount: toSubunits(cart.capture_total, cart.currency),
  currency: cart.currency,
});
```

The server function receives this under `req.data.intent`. Do not include secret keys, non-public settings, raw provider responses, or full cart/account objects.

### Redirect Handling

If the provider can redirect away from checkout:

- register `handleRedirect` through `registerHandlers`;
- read return params from the callback argument or `window.location.search`;
- verify the provider redirect status before updating the cart;
- persist method-specific token and intent data with `updateCart`;
- throw a shopper-readable error on auth failure so checkout surfaces it.

Redirect handlers must be idempotent — shoppers reload return URLs, components may reinitialize. Guard one-time init with state/refs. Public keys may come from app settings; secret keys stay in functions.

## Verification & Common Mistakes

Verify in order:

1. `npm run typecheck` passes (including component files when configured).
2. `swell app push` succeeds.
3. `swell inspect functions --app=.` shows the payment functions with the expected `extension` and events.
4. `swell inspect extensions app.<slug>.<extId>` reports `status: "activated"`. If the method must be selectable for subscription carts, the deployed `swell.json` entry has `"subscriptions": true`.
5. The checkout component loads and calls `onReady()`.
6. Creating an intent returns browser-safe provider data.
7. Checkout stores `billing.method` as the extension method id and provider token/intent under method-specific billing fields.
8. Creating an order/payment invokes `payment.charge` **twice** (`captured: false` then `captured: true`) and returns `success: true` with the same `transaction_id` on both calls.
9. Refunding invokes `payment.refund` and returns `success: true` with a refund `transaction_id`.
10. `swell logs --type function --app=.` shows the expected invocations and no hidden provider errors.

Common mistakes:

- Treating `payment.charge` as an async notification instead of a synchronous platform hook (Critical Contract #1).
- Forgetting `config.extension` — the function misses extension-scoped dispatch.
- Returning raw provider errors or large provider objects instead of the platform return contract.
- Reading secret settings in the checkout component.
- Assuming deploy alone proves the native payment flow selected the extension (Critical Contract #2).
