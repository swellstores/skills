# Model Event Hooks

Synchronous handlers that run inside the originating API request. Prefix any model event with `before:` or `after:` to convert the trigger from async (fires after the mutation persists) to a hook (runs as part of the request itself). Hooks can read the pre-mutation record and, in `before` phases, mutate what gets saved.

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

To block the write, throw `req.reject(code, message, { status })` from a `before:` hook. This works on **any model** — standard (`before:product.created`) and app-own alike:

```typescript
export default async function (req: SwellRequest) {
  if (req.data.rating > 5) {
    throw req.reject('rating_out_of_range', 'Rating must be 1-5', { status: 400 });
  }
}
```

The API caller receives an error with the hook's `message`, `code`, and `status`. `status` must be 400–499; anything else (or omitted) coerces to 422. `req.reject()` returns a `SwellRejection` (also available as a global class) — it only takes effect when thrown, and only from a `before` phase; rejections from `after:` hooks are stripped and ignored.

Throwing anything else — including `SwellError` — does **not** abort. All other hook errors fail open: the mutation proceeds and the error is reported in the response's `$function_errors`, for app-own models too. (Earlier platform versions rejected app-own model writes on any hook error, tunable via a `hook_reject_error` event property; that property is gone and throw-to-abort no longer exists — migrate those hooks to `req.reject()`.)

Rejection can be disabled platform-side per store as an operational kill switch. When disabled, the mutation proceeds and the rejection is dropped silently — treat a rejection that stops rejecting as a platform-side question, not a code bug.

## App-field changes in hook data

`before:*` hooks receive app-field updates in nested, slug-keyed `$app` form regardless of the caller's write shape — dotted keys (`{ "$app.my_app.status": "ready" }`) and `$unset` paths normalize to `req.data.$app.my_app.*`. Hook code does not need to handle internal `__app.{canonicalId}` fields.

## Re-entrancy

Writes from inside a hook re-trigger the same hook chain. Guard with `conditions` on the function or with a sentinel field in `$app[req.appId]` — an unconditional write-back to the same collection stalls the originating request until `hook_timeout` fires.

## Event syntax

Format: `<modelPath>/<hook>:<root>.<type>`. The hook prefix sits immediately before the event root, never before the model path. Short form `'<hook>:<root>.<type>'` is valid when no model path is given.

The event root is the singular of the collection name (`review` for `reviews`, `product` for `products`).

- **Standard models** — short form is fine: `'before:product.updated'`.
- **App-own models** — use the fully-qualified path to avoid collisions with same-root standard models: `'apps/<app_id>/reviews/before:review.created'`.

## Custom hook events

Custom events used by hooks must be declared in the model first:

```json
{
  "events": {
    "types": [
      {
        "id": "reviewed",
        "hooks": ["before", "after"],
        "conditions": { /* ... */ },
        "hook_timeout": 5000
      }
    ]
  }
}
```

- `hook_timeout` ≤ 60000 ms — overrides the function's own `config.timeout` when this hook fires.
- `hook_retry_attempts` ≤ 3 — triggers on null-status timeouts and network errors.
- `hook_*` knobs are valid on app-own models only.

A custom event can also declare `"extension": true`, which lets other apps' functions subscribe via `config.extension` and makes the event's `conditions` optional (the platform dispatches extension events explicitly rather than filtering by record state). This is the same mechanism the platform's payment/shipping/tax extension events use; see the relevant extension reference for dispatch semantics.

## One handler per app per hook event

A second function in the same app subscribing to the same hook event (same `app_id + event.type + extension`) is logged as a conflict and silently skipped at deploy time. `extension` is the optional `config.extension` field that scopes a function to a specific app extension — single-extension apps can ignore it. Split work across `before` / `after` phases or combine into one handler.

## Decision tip

Validate or modify before save → hook. React after the fact → async model trigger. Both honor `conditions` independently, so the same model event can carry both an async handler and a hook attached to different invocation conditions.
