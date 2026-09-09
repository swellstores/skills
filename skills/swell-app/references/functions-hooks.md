# Model Event Hooks

Synchronous handlers that run inside the originating API request. Prefix a model's `created`, `updated` or `deleted` event with `before:` or `after:` to convert the trigger from async (fires after the mutation persists) to a hook (runs as part of the request itself). Hooks can read the pre-mutation record and, in `before` phases, mutate what gets saved. Prefixing any *other* event type — a domain event like `order.paid`, or a custom event — installs cleanly and then silently folds into the `updated` series; read "Only `created`/`updated`/`deleted` are real hook phases" below before subscribing to one.

```typescript
export const config: SwellConfig = {
  description: "Validate review rating before save",
  model: { events: ["apps/<app_id>/reviews/before:review.created"] },
};

export default async function (req: SwellRequest) {
  const { $event, $record } = req.data;  // $event.hook === 'before'; $record undefined on create
  if (req.data.rating > 5) throw req.reject('rating_invalid', 'Out of range', { status: 400 });
  return { rating: Math.round(req.data.rating) }; // merged into record being saved
}
```

## Return-value semantics

The phase determines whether the return value affects state, and which state:

| Phase | Return value effect |
|-------|---------------------|
| `before:created`, `before:updated` | Merged into the record being persisted |
| `after:created`, `after:updated` | Merged into the event payload dispatched to async webhooks/notifications **only** — does NOT affect the stored record or the API response |
| `after:deleted` | Merged into the delete response |
| `before:deleted` | Ignored |

## Pre-mutation context

`req.data.$record` holds the pre-mutation record on `before:updated` and `after:updated` only. It is absent on create (check with `if (!$record)`) and on deletes (the record itself is spread into `req.data` instead). Use it for state-transition checks:

```typescript
if ($record.status !== req.data.status) { /* react to transition */ }
```

## Rejecting the mutation

To block the write, throw `req.reject(code, message, { status })` from a `before:` hook. This works on **any model** — standard (`before:product.created`) and app-defined alike:

```typescript
export default async function (req: SwellRequest) {
  if (req.data.rating > 5) {
    throw req.reject('rating_out_of_range', 'Rating must be 1-5', { status: 400 });
  }
}
```

The API caller receives an error with the hook's `message`, `code`, and `status`. `status` must be 400–499; anything else (or omitted) coerces to 422. `req.reject()` returns a `SwellRejection` (also available as a global class) — it only takes effect when thrown, and only from a `before` phase; rejections from `after:` hooks are stripped and ignored.

Throwing anything else — including `SwellError` — does **not** abort. All other hook errors fail open: the mutation proceeds and the error is reported in the response's `$function_errors`, for app-defined collections too. (Earlier platform versions rejected writes to app-defined collections on any hook error, tunable via a `hook_reject_error` event property; that property is gone and throw-to-abort no longer exists — migrate those hooks to `req.reject()`.)

Hooks do not run at all for writes made inside a `/:transaction` batch — the platform bypasses hook invocation there because an outbound HTTP call cannot be rolled back if the transaction aborts. Nothing else observes a child op either: per-record `/events` inserts are skipped inside a transaction, so async model-event functions, webhooks and notifications do not fire for child ops. One `transaction.committed` event covers the whole bundle, and it carries no per-record hook context — there is no async trigger to fall back on. The bypass inherits into every child op of the transaction; `/:batch` children are ordinary requests and do fire hooks. `/:transaction` is public, so any caller who wraps a write in a transaction skips your validation hook.

Rejection can also be disabled platform-side per store as an operational kill switch, and that switch fails open — a feature-flag lookup error suppresses rejections too. When suppressed, the mutation proceeds and the rejection is discarded: the API caller sees no error, but the app's function logs record it with status `ignored` (`App '<app>' rejection ignored for <event.type>`); enforced rejections log with status `blocked`. Check those logs before hunting for a code bug.

Neither bypass is visible to the caller. Never make a rejection hook the only enforcement of a critical invariant — back it with model validation and permissions.

## App-field changes in hook data

`before:*` hooks receive app-field updates in nested, slug-keyed `$app` form regardless of the caller's write shape — dotted keys (`{ "$app.my_app.status": "ready" }`) and `$unset` paths normalize to `req.data.$app.my_app.*`. Hook code does not need to handle internal `__app.{canonicalId}` fields.

On updates, `req.data.$app.<slug>` is the record's **stored** app subdocument merged with the incoming write, not just the keys the caller sent — and `$unset` paths are resolved by deletion, so an unset field is simply absent rather than flagged. Never read `req.data.$app` as "what changed". `req.data.$record.$app.<slug>` is decoded the same way on `updated` and holds the pre-write values; diff against it.

## Re-entrancy

Writes from inside a hook re-trigger the same hook chain. Guard with `conditions` on the function or with a sentinel field in `$app[req.appId]` — an unconditional write-back to the same collection stalls the originating request until the hook invocation times out: 10 s by default, or the `hook_timeout` declared on a custom event of an app-defined collection.

## Event syntax

Format: `<modelPath>/<hook>:<root>.<type>`. The hook prefix sits immediately before the event root, never before the model path. Short form `'<hook>:<root>.<type>'` is valid when no model path is given.

The event root is the singular of the collection name (`review` for `reviews`, `product` for `products`).

- **Standard models** — short form is fine: `'before:product.updated'`.
- **App-defined collections** — use the fully-qualified path to avoid collisions with same-root standard models: `'apps/<app_id>/reviews/before:review.created'`.

## Only `created`/`updated`/`deleted` are real hook phases

There are exactly three hook series. Prefixing any other event type — including the domain events standard models declare (`order.paid`, `order.submitted`, `order.canceled`, `subscription.canceled`, `product.stock_adjusted`) and custom events on your own collections — installs without error and then silently folds the function into the model's **`updated`** series. Install succeeds because a model event that declares no `hooks` array accepts any system hook prefix; only the fold decides where it actually runs. Three consequences, and the first is the one that generates support tickets:

- **It never fires on create.** The `created` series and the `updated` series are triggered from different code paths, and a folded hook is only in the second. A checkout that creates an order already paid runs no `before:order.paid` at all.
- **It fires on every update of that collection**, paid or not, shipped or not.
- **The model's own event `conditions` are not evaluated on the hook path.** `orders` declares `paid` with `conditions: { "paid": true, "$record": { "paid": { "$ne": true } } }`; the hook path ignores that entirely and evaluates only `config.model.conditions` on your function. `$event.type` still reads `order.paid` on every one of those firings, so the handler looks correctly targeted while it is not.

The reported symptom is always "my hook on `order.paid` never fires" — it fired on updates nobody was watching and missed the create that was.

**Do this instead** — to react when an order becomes paid:

- **Async is the default answer.** Subscribe to `'order.paid'` with no prefix. The async dispatch path *does* evaluate the model's declared `conditions` against the merged record plus incoming data, and matches on create as well as update.
- **Only if it must run inside the request** (mutate the write, or reject it): subscribe to `'before:order.updated'` and reproduce the transition yourself in the function's own `conditions` — that is the only condition set the hook path evaluates. Accept that this cannot see a create-time transition.

```typescript
export const config: SwellConfig = {
  description: "Sync order to fulfillment when it becomes paid",
  model: {
    events: ["before:order.updated"],
    conditions: { paid: true, $record: { paid: { $ne: true } } },
  },
};
```

Extension events are the exception to the fold: those declaring `hooks` (`payment.charge`, `payment.refund`, `order.shipping`, `order.taxes`) keep their own type namespace and are invoked explicitly by platform code. They also emit no event record at all, so there is no async form of them — `after:payment.charge` is a hook or it is nothing.

List a model's declared events with `swell inspect models /orders` and read `events.types`. Standard models already ship their domain events; subscribe to them, never redeclare them.

## Custom hook events

Custom events on your own collections must be declared in the model before any function can subscribe to them — hook or async. This applies to app-defined events only; the domain events standard models already declare are subscribable as shipped.

```json
{
  "events": {
    "types": [
      {
        "id": "reviewed",
        "hooks": ["before", "after"],
        "conditions": { "status": "published" },
        "hook_timeout": 5000
      }
    ]
  }
}
```

- `hooks` is a whitelist, not an enabler. Declare it and only the listed prefixes install; omit it and both `before:` and `after:` are accepted anyway. Declaring it does **not** exempt the event from the `updated` fold — only `extension: true` does.
- `conditions` must be a non-empty object on every non-standard event that is not `extension: true` — install fails otherwise. It is **not evaluated when the hook fires**: the event folds into the model's `updated` series like any other, so `before:review.reviewed` runs on every update of that collection and never on create or delete. Gate the handler with `config.model.conditions` on the function itself — the only condition set the hook path evaluates.
- `hook_timeout` ≤ 60000 ms — the per-invocation timeout for this hook. Hooks ignore the function's own `config.timeout` entirely (that applies only to route, cron and async-event invocations, where it clamps to 1000–20000 ms). Without `hook_timeout` a hook is cut off at 10 s, and it is the only way to give a hook longer.
- `hook_retry_attempts` ≤ 3 — retries only when the invocation returns no status at all (timeout or network error); a function that responds with an error status is never retried.
- `hook_*` knobs are valid on app-defined collections only — declaring either on a standard model fails install.

A custom event can also declare `"extension": true`, which makes its `conditions` optional. Extension events are not dispatched by record writes at all: platform code (payment, shipping, tax) invokes them explicitly for the app configured on that method, matching the function's own `config.extension`. There is no app-facing API to dispatch one, so `extension: true` on your own collection's event will never fire on its own. See the relevant extension reference for dispatch semantics.

## One handler per app per hook event

A second function in the same app subscribing to the same hook event (same `app_id + event.type + extension`) is skipped at **runtime**, every time the event fires — the deploy reports nothing. The skip is recorded in the app's function logs (`Function '<name>' of the same app has already been triggered for the event '<type>'`); the API caller sees nothing. Which of the two wins depends on invocation order you do not control, so split work across `before` / `after` phases or combine into one handler. `extension` is the optional `config.extension` field that scopes a function to a specific app extension — single-extension apps can ignore it.

## Decision tip

Validate or modify before save → hook, and the event must be `created`/`updated`/`deleted`; anything else folds into `updated`. React after the fact → async model trigger, which can name any declared event, domain events included, and is the only path that honors the model's own event `conditions`. Both paths independently honor each function's `config.model.conditions`, so the same model event can carry an async handler and a hook filtered differently.
