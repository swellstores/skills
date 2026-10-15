# Payment Extensions

Payment extensions provide custom payment methods or card gateway behavior in an integration app. Use `app-integrations.md` first for shared manifest, settings, and hook semantics; this file covers the payment-specific contracts on top of those.

## Critical Contracts

Two payment-extension behaviors fail at runtime in ways no local check catches — not `swell schema`, not `swell app push`, not `npm run typecheck`. Verify both before claiming a payment extension is done.

### 1. `payment.charge` fires once or twice depending on the method

Two-phase auth/capture requires all three: the order's billing method is in the platform's hardcoded native authorizable set (`card`, `paypal`, `amazon`, `affirm`, `resolve`, `ideal`, `klarna`, `bancontact`, `google`, `apple`, `twint`, `paysafecard`, `sezzle`), `/settings/orders/features/require_authorized_payment` is true (the default), and the order is not a subscription order (`subscription_id` unset). For extensions that means card-gateway replacements only.

- **Card gateway (`method: "card"`) → two calls.** First: `req.data.captured === false` → authorize the provider intent without capturing. Second: `req.data.captured === true` → capture it. A single-shot "create + capture" handler succeeds on the first call (capturing too early), then fails or double-charges on the second.
- **Alt method (any extension `id` outside that native set — `my-method`, `wallet-pay`, …) → one call**, with `req.data.captured === undefined`. `captured` is a plain `bool` with no model default, and the native default handler that would set it is skipped whenever `extension_app_id` is set. Subscription orders are single-shot too, even on `card`.
- One handler must cover both: treat `captured === false` as the only authorize signal, every other value — `undefined` included — as a capture request, and stay correct when the authorize phase never happens.
- Canonical handler shape: see Charge Function below — branch on `captured` and look up the existing provider intent (`req.data.intent.<provider>.id` or `req.data.transaction_id`) before creating a new one.
- **Verify:** create one test order, then run `swell logs --type function --app=.`. Card gateway: two consecutive `payment.charge` invocations, `captured: false` then `captured: true`, returning the same `transaction_id`. Alt method: exactly one, `captured: undefined`. Hunting a missing second call on an alt method is hunting a bug that does not exist.

### 2. Merchant Save activates the extension, not `swell app push`

- Until the merchant opens the extension settings dialog under Settings → Payments and clicks Save, `methods.<methodId>.gateway` and `extension_app_id` are unset.
- Checkout silently filters the method out — no dispatch, no error. This is the most common cause of post-deploy "function never runs" reports.
- **Verify:** run `swell inspect extensions app.<slug>.<extId>`. If `action_owner === "merchant"`, surface `action` to the user verbatim and stop debugging the code.

## Manifest

These excerpts show extension fields. Start with the scoped manifest in `app-integrations.md` and declare permissions for the implementation's Backend operations.

Alternative payment method:

```json
{
  "type": "integration",
  "extensions": [
    { "id": "my-method", "type": "payment" }
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
| Alt method (any other `method` or unset) | `<extension.id>` | `/settings/payments/methods/<extension.id>` | `/settings/payments/gateways/app_<appId>_<extId>` (created on Save) |

Merchant UI sequence (code-only agents cannot perform this; surface to the user):

1. Install the app in the store (test or live).
2. Open Settings → Payments. The extension appears as a row under the alt-method or card-gateway list.
3. Open the extension's settings dialog (or, for a card gateway, select the app from the gateway dropdown for the `card` method) and click **Save**. This writes `methods.<methodId>.gateway = "app_<appId>_<extId>"`, `extension_app_id`, `extension_config_id`, `activated = true`, `enabled = true`, and creates the `/settings/payments/gateways/app_<appId>_<extId>` record — alt methods and card gateways alike. Without the gateway record checkout never instantiates the component (it filters methods on both `extension_app_id` and `gateway`) and `call("createIntent")` fails with `Payment gateway 'app_..._...' is not defined`.
4. Confirm the method is enabled and Save the page so it renders in checkout. The alt-method dialog already sets `enabled: true` on Save.

Verify with `swell inspect extensions app.<slug>.<extId>` — it checks both `extension_app_id` and `gateway = app_<appId>_<extId>` and reports `gateway missing` if either is wrong. When `action_owner === "merchant"`, surface `action` verbatim and stop debugging.

**Dispatch vs. visibility.** For payment-alt, `extension_app_id` alone gates dispatch; `enabled` is checkout-list visibility only. A method with `enabled: false` and `extension_app_id` set still dispatches from carts that reach checkout but won't appear in the payment list. (Shipping is the only extension type where `enabled: false` blocks dispatch.)

## Hook Function Contracts

Each payment event is a synchronous platform hook. The platform merges **every** top-level key your handler returns into the payment payload — undeclared keys included — so return only the contract fields and never spread a raw provider response into the return value. Declare `model.fields` listing exactly those keys: it is not enforced today (the platform carries a standing TODO to reject undeclared keys) but it documents intent and is forward-compatible.

| Function | Event | Phase rule | model.fields | req.data carries | Return success | Return failure |
|----------|-------|-----------|--------------|------------------|----------------|----------------|
| Intent | `after:payment.create_intent` | `after` only — `before:` rejected at deploy with `EventHookTypeError` | `["result", "error"]` | `account`, `intent` (the payload from `call("createIntent", data)` in the component) | `{ result: { ...browserSafeData } }` | `{ error: "msg" }` |
| Get Intent | `after:payment.get_intent` | `after` only — `before:` rejected at deploy with `EventHookTypeError` | `["result", "error"]` | `account`, `intent` (the payload from `call("getIntent", data)` in the component) — same shape as `create_intent` | `{ result: { ...browserSafeState } }` | `{ error: "msg" }` |
| Charge | `before:` or `after:payment.charge` | either | `["success", "error", "transaction_id"]` | `id` (the Swell payment being charged, in both phases), `amount`, `currency`, `captured`, `intent`, `transaction_id`, `<methodId>` (e.g. `req.data["my-method"]`) | `{ success: true, transaction_id }` | `{ success: false, error: { message } }` |
| Refund | `before:` or `after:payment.refund` | either | `["success", "error", "transaction_id"]` | `amount`, `currency`, `transaction_id` | `{ success: true, transaction_id }` | `{ success: false, error: { message } }` |

Implement `payment.get_intent` only when the provider needs in-flight intent state refreshed from the platform — typically for redirect-return recovery, where checkout reopens after the shopper bounced through a provider page and the cart's persisted intent state is stale. The component triggers it with `call("getIntent", data)`, which the Swell vault routes to the hook. Skip it for fully inline flows.

Prefer explicit phases. Bare events default to `after` but the default is implicit and leaves future readers guessing. When `extension_app_id` is set, the platform skips its native handler for the method, so the extension function is authoritative regardless of phase.

Minimal Intent and Refund handlers (Charge gets its own section because of two-phase capture). One event per file — a file with two `config` exports or two default exports fails to bundle (`Multiple exports with the same name "config"`). These skeletons omit error wrapping for brevity — wrap provider calls in `try/catch` and return the failure contract shape on throws; see the Charge function below for the full pattern.

```typescript
// functions/create-intent.ts
export const config: SwellConfig = {
  extension: "my-method",
  description: "Create payment intent",
  model: { events: ["after:payment.create_intent"], fields: ["result", "error"] },
};
export default async function (req: SwellRequest) {
  // req.data.intent is the payload from call("createIntent", data) in the component
  const session = await provider.createIntent(req.data.intent);
  return { result: { client_secret: session.client_secret } }; // browser-safe only
}
```

```typescript
// functions/refund.ts
export const config: SwellConfig = {
  extension: "my-method",
  description: "Refund payment",
  model: { events: ["after:payment.refund"], fields: ["success", "error", "transaction_id"] },
};
export default async function (req: SwellRequest) {
  const refund = await provider.refund(req.data.transaction_id, req.data.amount);
  return { success: true, transaction_id: refund.id };
}
```

If a request payload differs from the table, add structured logs to the function and inspect via `swell logs --type function --app=.`. Remove the noisy logs before finalizing.

## Charge Function: Auth/Capture Phases

When two-phase applies (Critical Contract #1 — card gateway, `require_authorized_payment` on, non-subscription order), the order payment flow invokes `payment.charge` **twice**:

1. With `req.data.captured === false`: authorize the provider intent without capturing funds. The order flow posts a payment record with `captured: false`, which triggers the charge handler.
2. With `req.data.captured === true`: capture the authorized intent. The order flow PUTs the payment to `captured: true`; the charge trigger fires again on that `false → true` transition.

Otherwise — every alt method, and subscription orders on any method — the flow posts one payment record with no `captured` key at all and the handler runs once with `req.data.captured === undefined`. The platform's own extension test asserting exactly two invocations configures the extension on `/settings/payments/methods/card`; it does not generalize to alt methods.

The canonical handler covers both cases: two-branched, and idempotent on the existing provider intent id.

```typescript
// functions/charge.ts
export const config: SwellConfig = {
  extension: "my-method",
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

- `captured === false` → authorize only. Any other value — including `undefined`, which is what every alt-method invocation carries — is a capture request. Nothing defaults `captured` for extension methods: the native handler that would set it is skipped whenever `extension_app_id` is present.
- Always look up the existing provider intent (`req.data.intent.<provider>.id` or `req.data.transaction_id`) before creating a new one. Creating a fresh intent on the second call double-charges.
- Return the same `transaction_id` on the second call as on the first when continuing the same provider intent. The platform persists it as the payment's authoritative transaction id.
- Validate provider state per phase: on authorize, `requires_capture` is the only valid result; on capture, accept `requires_capture` (then capture) or `succeeded` (already captured) and reject anything else. Silent acceptance of unexpected statuses returns `success: true` for payments that are not actually authorized.
- Wrap provider calls in `try/catch` and convert thrown errors into `{ success: false, error: { message } }`. Uncaught throws bypass the platform return contract and surface as a generic function failure.

## Triggering the Charge Flow (CLI)

`payment.charge` fires inside the order→payment pipeline — not by calling the function endpoint or posting to `/payments` directly.

    swell api post /orders --body '{"items":[{"product_id":"<id>","quantity":1}],"billing":{"method":"<methodId>","<methodId>":{"token":"test"}},"account_id":"<id>"}'

`<methodId>` is `card` for card gateways, or the extension `id` for alt methods. Billing on the order is sufficient — no account-level billing pre-setup required.

Verify: `swell logs --type function --app=.` — two `payment.charge` entries for a card gateway, exactly one for an alt method (Critical Contract #1). Zero entries means dispatch didn't reach the extension (check activation, not code).

## Checkout Component

A payment method that needs browser UI (a card form, a provider's modal) ships a **payment component**: a Preact component in the same iframe mechanism as admin field components, with a place of its own in hosted checkout. Read `components.md` for files, build limits, layout and the props they share. Requires `@swell/apps-sdk` 2.0.0-alpha.7 and `@swell/cli` 2.9.28.

Scaffold it with the extension of `swell.json` and the place:

    swell create component <Name> --extension <extension id> --target checkout.payment.methods -y

The CLI writes the generic component template with `extension: { id }` and `targets` added to its `config`. It refuses an extension id that `swell.json` does not declare and an extension that already has a component. The rest of the file is yours; a payment component looks like this:

```tsx
import { useEffect } from "preact/hooks";
import type { ComponentProps, PaymentContext, PaymentSubmitResult } from "@swell/apps-sdk/components";

export const config = {
  description: "Checkout UI for the my-method extension",
  extension: { id: "my-method" },
  targets: [{ id: "checkout.payment.methods" }],
};

export default function MyMethodPay({ context, settings, on, call }: ComponentProps<never, PaymentContext>) {
  // Register in an effect: the frame runs only the first handler registered for an event, and `on` returns the unsubscribe
  useEffect(
    () =>
      on("submit", async (): Promise<PaymentSubmitResult> => {
        const intent = await call<Record<string, unknown>>("createIntent", {
          amount: context.cart.capture_total,
          currency: context.cart.currency,
        });
        // ...open the provider's checkout with the intent and wait for the payment...
        return { billing: { intent: { stripe: { id: providerIntentId } } } };
      }),
    [on, call, context],
  );

  // Render something first: an empty frame does not switch to overlay when a provider modal opens
  return <p>You will complete the payment in the next step.</p>;
}
```

- `extension: { id }` must be an object (`{ id: "<extension id>" }`) naming a `payment` extension declared once in `swell.json`; `targets: [{ id: "checkout.payment.methods" }]` opts the component into hosted checkout's payment methods place. One component per extension. Push adds the extension `type` to the stored values (`extension: { id, type }`). Hosted checkout shows the component of the app the merchant bound to the method and whose `extension.id` is the method id. The functions of the extension keep `config.extension` as the plain id string; only the component's `extension` is an object.
- Push checks a component in two places, and `swell app push` prints the messages of both:
  - The CLI checks the extension and the shape of `targets`:
    - `extension "<id>" is not declared in swell.json`
    - `extension "<id>" is declared more than once in swell.json`
    - `extension "<id>" already has the component <Name>`
    - `extension must be an object with an id, like { id: "card" }`
    - `targets must be a list of objects with an id, like [{ id: "<target id>" }]`
  - The platform owns the list of targets and what each one needs. Today the only target is `checkout.payment.methods`, which needs an object `extension` of a `payment` extension:
    - `Unknown component target '<id>'. Known targets: checkout.payment.methods`
    - `Target 'checkout.payment.methods' needs extension: { id } of a payment extension declared in swell.json` (followed by the reason: a string extension is the legacy contract, or the extension has another type)
    - `Component targets must be an array of { id }, ...` and `Component target at index <n> must be { id } with a non-empty string id.`
- The scaffold writes `components/tsconfig.json`, adds `preact` and `@swell/apps-sdk` (types only) and extends the `typecheck` script, as for any component (`components.md`, "Files and names"); run `npm install` after.
- Components bundle for the browser. Keep provider SDKs that need secrets, Node-only APIs and secret-bearing modules out of component code. Browser-safe helpers in `components/lib/` may be imported from `functions/`; never import the other direction.

### Contract

| Part | What it is |
|------|------------|
| `context` | `{ cart, method }`. `cart` is the shopper's cart as the checkout has it, whole (totals, items, `account`, `billing`, `shipping`, ...); the billing typed on the payment step reaches it only after `submit`, so read the phone or address being submitted from the `submit` data; `method` is `{ id, name, mode }`. It comes from the host page, so never trust it for money: the charge hook is the check (see Billing Persistence Contract). A cart update re-renders the component with new `context`, it does not remount |
| `settings` | The app's public settings (fields marked `"public": true`), keyed by settings config name: `settings/card.json` is `settings.card.key_id` |
| `on("submit", handler)` | The shopper pressed the order button. `handler({ billing })` receives the billing the checkout has so far and returns `{ billing }` |
| `on("redirect", handler)` | The shopper returned to checkout from a provider redirect. `handler({ params })` receives the return URL's query parameters (strings) and returns `{ billing }` |
| `call("createIntent", data)` | Invokes the extension's `payment.create_intent` hook (through the Swell vault) and resolves with the hook's `result`; a vault request that takes over 20 seconds rejects with `Request timed out after 20 seconds` |
| `call("getIntent", data)` | The same for `payment.get_intent`. The built-in actions are fixed: a host cannot replace them |
| `setValidity(message)` | A message keeps the order button disabled and shows to the shopper; `null` clears it |
| `fetch`, `locale`, `readonly`, `params` | As in `components.md`. `readonly` follows the checkout's loading state (initial load and submit). `fetch` calls are anonymous storefront ones (`surface` is `checkout` or `storefront`): treat them like public routes |

- `createIntent` takes the account from `context.cart.account_id` and the gateway from the platform: do not pass either. `data` arrives in the hook as `req.data.intent`; send only what the hook needs (`amount`, `currency`).
- A thrown `Error` in a handler (or a rejected `call`) shows its message to the shopper and returns the form to a usable state. Throw shopper-readable messages, for example `Payment cancelled` when the shopper closes the provider modal.
- `submit` must return `{ billing }`: with none, the shopper sees "The payment method did not respond" and no order is placed. `redirect` is the reverse: a handler that returns no `billing` is ignored, so return nothing for returns that are not the provider's (a URL with only utm parameters).
- Register handlers in `useEffect(() => on("submit", ...), [on, call, context])`. The frame runs only the **first** handler registered for an event, so a handler registered on every render would keep the first render's closure. Either re-register through the effect as above (the cleanup returned by `on` unsubscribes the old one) or register once and read the latest props through a ref.
- The component never writes the cart. Return `{ billing }` and the host saves it; the handler's result is the only way billing gets in.

### Billing Persistence Contract

The result of `submit` and `redirect` is merged into the cart's billing, and the checkout then places the order. The payment method id is the extension `id` (`card` for a card gateway); the manifest `method` field discriminates card vs. alt only, it never renames the method record (see `app-integrations.md` §Manifest). For `id: "my-method"`:

```typescript
return {
  billing: {
    "my-method": { token: providerPaymentMethodId }, // hyphenated id must be quoted
    intent: { stripe: { id: providerIntentId } },
  },
};
```

You do not return `billing.method`: the checkout already set it to the selected method. Return only what the charge needs. The backend payment hook receives method-specific billing under `req.data[methodId]` (e.g. `req.data["my-method"]`), so a token stored under the wrong method id is never found by the charge function. The `billing.intent` key is the **processing provider** that generates the intent, not the extension id. In this example the extension is `my-method` but the intent key is `stripe` because Stripe is the payment processor. When your extension calls its own provider directly, extension and processor coincide and the key equals the extension id. The charge function reads the same key: `req.data.intent?.stripe?.id`. A mismatch between what the component returns and what the function reads yields `undefined` with no deploy-time or runtime error. Store only browser-safe identifiers; never return secret keys or raw provider responses.

**The browser writes billing.** `billing.intent.<provider>.id`, `billing.<methodId>.token` and every other billing field reach the cart through the public checkout API, and a shopper can write any value there. The `payment.charge` hook is the only trusted check: verify there that the provider payment's amount, currency and method match the order, and that it belongs to this payment. `req.data.id` is the Swell payment being charged in both phases (`captured: false` and `captured: true`). Do not rely on `create_intent` for this: the intent can be created with other values than the order's.

A card gateway that saves cards binds and finalizes on the server:

- **The capture is the claim.** The authorize phase checks the shopper's authorization (status, method, amount, currency, owner) and writes nothing. The capture phase captures it and, only after the capture succeeded, writes this Swell payment's id into the provider payment's metadata (for example `swell_payment_id`). The capture is the provider's only atomic step, so of two Swell payments racing on one authorization exactly one wins, and the other never succeeds without money.
- **A saved card is the fallback.** The checkout saves the card as a recurring token in `billing.card.token`. When the shopper's authorization cannot be used (expired, released, owned by another Swell payment, mismatched, or a capture the provider definitely refused) or there is none (subscription renewal, admin charge), the charge creates a payment on the saved token for the order's amount and currency, bound to this Swell payment at creation (in its metadata, and in a provider reference the charge can look up, so a retry reuses that payment instead of charging again). A capture error that is not a definite refusal (network, 5xx) fails without charging the token.
- **Fail closed on a captured payment with no owner.** A captured payment bound to this Swell payment is a retry: return the same `transaction_id` and charge nothing. A captured payment with no owner may be this payment's own capture whose record was lost, so the charge fails ("contact support") and never charges the card again. A payment bound to another Swell payment is never used.
- **Subscriptions** work through the card token: with `"subscriptions": true` on the extension, a renewal reaches the charge with no shopper authorization and the saved card under `req.data.card`, and takes the saved-card path.
- **Slow charges finish asynchronously.** `payment.charge` is cut off after 10 seconds, and `hook_timeout` cannot be raised on the standard `payments` model. When the provider takes longer (a saved-card debit, a delayed or notified debit), return `{ async: true }` with no `success`: the Swell payment stays `pending`. Finish the charge in a workflow (`references/functions-workflows.md`) and record the result with `PUT /payments/{id}` (`success`, `transaction_id`, and `captured: true` only when the payment asked for the capture). `success` can be set once; `charge` fires again only when `captured` goes from `false` to `true`, so never send `captured: true` for a payment stored with `captured: false`. Keep a scheduled sweep for runs that died, matching provider payments by their Swell payment reference.

### Intent Request

`call("createIntent", data)` is not the raw `swell.payment.createIntent` API: pass the browser intent payload directly.

```typescript
const { client_secret } = await call<{ client_secret: string }>("createIntent", {
  amount: toSubunits(context.cart.capture_total, context.cart.currency),
  currency: context.cart.currency,
});
```

The function receives this under `req.data.intent` and answers with `{ result }`, which the `call` resolves with, or `{ error }`, which makes the `call` reject. Do not include secret keys, non-public settings, raw provider responses, or full cart/account objects.

### Lifecycle and Rendering

1. Hosted checkout mounts the place `checkout.payment.methods` into the body of the selected method, and of the components the platform returns it mounts the one of the method's app whose `extension.id` is the method id. A method without a component submits as before. Switching methods unmounts the frame.
2. An app method pays through its component only while payment is collected (`capture_total > 0`, or a payment is required); otherwise the method has no component and submits as before. The submit button is disabled while checkout is loading, until the component has started, and while it reports a validity message or an error. A component that fails to start shows its error and keeps that method's submit disabled; the shopper can switch to another method, except while checkout is loading, when the method options of an app method are locked.
3. The frame is its own document: load a provider's script with a `<script>` element in the component, once per frame, and mount third-party widgets into your own ref.
4. **Render visible content before opening a provider modal.** Provider modals are fixed full-screen elements; when one appears the frame turns into a viewport overlay by itself and goes back when it closes. Content in the frame is what the shopper sees in the methods list before the modal opens. If the provider's modal lets the shopper retry after a failed attempt, do not reject `submit` on a failure: keep the last error and settle only on success, or when the shopper closes the modal (reject with the last error, or `Payment cancelled`).
5. In `submit`, validate and run the provider UI first, then `call("createIntent", data)` if the provider needs a server-created order or session, and return the billing.
6. If the provider can redirect away from checkout, handle `redirect` too: read `params`, verify the provider's status (`call("getIntent", params)` is the browser trigger for the `payment.get_intent` hook), return `{ billing }`, and throw a shopper-readable error on failure. Redirect handlers must be idempotent: shoppers reload return URLs. Public keys may come from app settings; secret keys stay in functions.

Server-side capture, authorization validation and refunds belong in extension functions, not the component.

Merchant storefronts and other `*.swell.store` pages render the same component with `@swell/apps-sdk/components`; they pass the cart in `context` and call `emit` themselves:

```ts
const components = createComponents({ storeId, publicKey });
const handle = components.mount("#pay", { app: "<app id>", component: "MyMethodPay", context: { cart } });
await handle.ready;
const { billing } = await handle.emit("submit", { billing: cart.billing });
```

`createIntent` and `getIntent` work there too (vault `https://vault.schema.io`, `vaultUrl` option to change it); the host then saves the returned billing itself. Hosted checkout mounts by place: `mount(el, { target: "checkout.payment.methods", select: (c) => c.app === method.extension_app_id && c.extension?.id === method.id, context: { cart, method } })` returns a handle whose `emit` resolves with an array, one result per component that handled the event.

### Migrating from the swell.app contract

A string `extension` (`extension: "my-method"`) is the legacy contract. A legacy component still builds the old IIFE for `swell.app` on merchant storefronts; hosted checkout no longer renders it, so a legacy-only app shows no payment UI there. Move to the object `extension`, a `targets` entry and the props below:

| Old prop (swell.app) | New |
|---|---|
| `registerHandlers({ onSubmit })` | `on("submit", ...)` returning `{ billing }` |
| `registerHandlers({ handleRedirect })` | `on("redirect", ...)` returning `{ billing }` |
| `createIntent(data)` / `getIntent(data)` | `call("createIntent", data)` / `call("getIntent", data)` |
| `updateCart(data)` | return `{ billing }`; the host saves it |
| `loadLib(id, url)` | a `<script>` in the component (the frame is its own document) |
| `onReady()` | not needed; the host waits for the component to mount |
| `cart`, `settings` | `context.cart`, `settings` |

## Verification & Common Mistakes

Verify in order:

1. `npm run typecheck` passes (including component files when configured).
2. `swell app push` succeeds.
3. `swell inspect functions --app=.` shows the payment functions with the expected `extension` and events.
4. `swell inspect extensions app.<slug>.<extId>` reports `status: "activated"`. If the method must be selectable for subscription carts, the deployed `swell.json` entry has `"subscriptions": true`.
5. The checkout component frame loads: `swell inspect extensions app.<slug>.<extId>` lists the component among the extension's bound components, and in hosted checkout the selected method shows its content and the order button enables.
6. `call("createIntent", data)` resolves with browser-safe provider data.
7. `submit` returns billing with the method's token under `billing.<methodId>` and the provider intent id under `billing.intent.<provider>.id`; the order's billing carries them.
8. Creating an order invokes `payment.charge` — **twice** for a card gateway (`captured: false` then `captured: true`, same `transaction_id` both times), **exactly once** for an alt method (`captured: undefined`). Every call returns `success: true`.
9. Refunding invokes `payment.refund` and returns `success: true` with a refund `transaction_id`.
10. `swell logs --type function --app=.` shows the expected invocations and no hidden provider errors. On a card gateway it shows two `payment.charge` calls for the order.

Common mistakes:

- Treating `payment.charge` as an async notification instead of a synchronous platform hook (Critical Contract #1).
- Forgetting `config.extension` — the function misses extension-scoped dispatch.
- Returning raw provider errors or large provider objects instead of the platform return contract.
- Reading secret settings in the checkout component.
- A string `extension` or no `targets` in the component: hosted checkout renders nothing for it.
- Registering `submit` on every render without the effect cleanup: the frame runs only the first handler registered, so it keeps stale props.
- Waiting for `onReady`, `updateCart` or `registerHandlers`: they do not exist on payment components (see the migration table).
- Opening a provider modal from an empty component.
- Assuming deploy alone proves the native payment flow selected the extension (Critical Contract #2).
