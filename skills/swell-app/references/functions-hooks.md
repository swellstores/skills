# Model Event Hooks

Synchronous handlers that run inside the originating API request. Prefix any model event with `before:` or `after:` to convert the trigger from async (fires after the mutation persists) to a hook (runs as part of the request itself). Hooks can read the pre-mutation record and, in `before` phases, mutate what gets saved.

```typescript
export const config: SwellConfig = {
  description: "Validate review rating before save",
  model: { events: ["apps/<app_id>/reviews/before:review.created"] },
};

export default async function (req: SwellRequest) {
  const { $event, $record } = req.data;  // $event.hook === 'before'; $record undefined on create
  if (req.data.rating > 5) throw new SwellError("Out of range", { status: 400 });
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

Throw `SwellError` to abort. Abort is honored only for hooks on **app-own models' own events** (defaults to reject; disable with `hook_reject_error: false`). Standard-model hooks (e.g. `before:product.created`) cannot abort — throws are absorbed into the response's `$function_errors` and the mutation proceeds. To block a standard-collection mutation, declare a custom hook event on an app-own model and gate the standard write through it.

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
        "hook_timeout": 5000,
        "hook_reject_error": true
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
