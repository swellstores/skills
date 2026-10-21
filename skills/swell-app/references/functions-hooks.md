# Model Event Hooks

Synchronous handlers that run inside the originating API request. Prefix a model event with `before:` or `after:` to convert the trigger from async (fires after the mutation persists) to a hook (runs as part of the request itself). Hooks can read the pre-mutation record and, in `before` phases, mutate what gets saved.

```typescript
export const config: SwellConfig = {
  description: "Validate review rating before save",
  model: { events: ["before:review.created"] },
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

Writes from inside a hook re-trigger the same hook chain. Guard with `conditions` on the function or with a sentinel field in `$app[req.appId]` — an unconditional write-back to the same collection stalls the originating request until the hook invocation times out.

## Event syntax

Format: `<hook>:<root>.<type>`, with the hook prefix immediately before the event root. The event root is the singular of the collection name (`review` for `reviews`, `product` for `products`).

The form is the same for a standard model (`'before:product.updated'`) and for one of the app's own collections (`'before:review.created'`). A name is matched against the app's own collections first, then against standard models.

## Hooks on declared events

A hook can name any event the model declares: `created`, `updated` and `deleted`, the domain events of standard models (`before:order.paid`, `after:subscription.canceled`) and the custom events of your own collections. A hook on a domain or custom event runs inside the write that triggers the event: the write after which the event's `conditions` hold. They are checked on the pending write, with the changes its `before:created` or `before:updated` hooks return, the same way as on the saved one: bare keys are the record after the write, `$record` the record before it. So `before:order.paid` can change or reject the write that makes an order paid, including the create of an order that is paid from the start.

List a model's declared events with `swell inspect models /orders` and read `events.types`. Standard models already ship their domain events; subscribe to them, never redeclare them.

Extension events (`payment.charge`, `payment.refund`, `order.shipping`, `order.taxes`) are not triggered by writes: platform code invokes them for the app configured on that method. They record no event, so `after:payment.charge` is a hook or nothing.

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

- `hooks` limits which prefixes install; without it both `before:` and `after:` do. An event that declares `hooks` exists for hooks only and records no async event.
- `conditions` must be a non-empty object on every non-standard event that is not `extension: true` — install fails otherwise. They decide when the event, and every hook on it, fires.
- `hook_timeout` ≤ 60000 ms — the per-invocation timeout for this hook. Hooks ignore the function's own `config.timeout` entirely. Without `hook_timeout` a hook is cut off at 10 s, and it is the only way to give a hook longer.
- `hook_retry_attempts` ≤ 3 — retries only when the invocation returns no status at all (timeout or network error); a function that responds with an error status is never retried.
- `hook_*` knobs are valid on app-defined collections only — declaring either on a standard model fails install.

A custom event can also declare `"extension": true`, which makes its `conditions` optional. Extension events are not dispatched by record writes at all: platform code (payment, shipping, tax) invokes them explicitly for the app configured on that method, matching the function's own `config.extension`. There is no app-facing API to dispatch one, so `extension: true` on your own collection's event will never fire on its own. See the relevant extension reference for dispatch semantics.

## Several hooks of one app

Functions of one app that hook the same event run one after another in the order of their names, and each `before:` hook sees the changes of the ones before it. Hooks of different apps run in parallel.

## Decision tip

Validate or modify before save → a `before:` hook. React after the fact → an async model trigger. Both can name any declared event, and both also apply the function's own `config.model.conditions`, so the same event can carry an async handler and a hook filtered differently.
