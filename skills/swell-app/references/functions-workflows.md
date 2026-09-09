# Workflows (Beta — feature-gated)

Durable functions that run as a sequence of retriable steps, persist across restarts, and can sleep for long periods. Use for multi-step background processes that must survive failures between steps — syncs to external systems, long-running fulfillment flows, delayed follow-ups.

## Availability gate

Workflows are behind the `functions.workflows` feature flag, enabled **per store by Swell**. When the flag is off:

- `swell app push` fails with `Workflow deployment is not enabled for this store`, code `workflow_beta_deploy_not_allowed`
- `req.swell.workflows.create()` fails with `Workflow creation is not enabled for this store`, code `workflow_beta_create_not_allowed`

Both are HTTP 400 with `retryable: false`. Neither is a code problem — report the message and code to the user and stop; do not debug the workflow code, and do not retry. Enabling the flag is a Swell-side action; the CLI and the app cannot do it. Do not propose workflows unprompted: prefer cron/model/route triggers unless the user explicitly requests workflows or the store is confirmed enabled.

## Declaring

`kind: 'workflow'` plus a default-exported class with `run(req, step)` — no handler function, and no `route`/`model`/`cron`/`extension`/`timeout` config keys:

```typescript
// functions/sync-order.ts — the FILE basename is the workflow's name, not the class
export const config: SwellConfig = {
  kind: 'workflow',
  description: 'Sync an order to the warehouse',
};

export default class SyncOrder {
  async run(req: SwellWorkflowRequest, step: SwellWorkflowStep) {
    const { order_id } = req.data as { order_id: string };

    const order = await step.do('load order', async () => {
      return (await req.swell.get(`/orders/${order_id}`)) as { id: string };
    });

    await step.sleep('cool off', '30 seconds');

    await step.do('mark synced', async () => {
      return req.swell.put(`/orders/${order.id}`, {
        $app: { [req.appId]: { synced: true } },
      });
    });

    return { ok: true };
  }
}
```

`req.data` is typed `unknown` and every `req.swell.*` call resolves `Promise<unknown>` on `SwellWorkflowRequest` — cast at the boundary as above or Gate 3 `npm run typecheck` fails.

## Step semantics

Each `step.do(name, fn)` executes once and its result is durably recorded — on retry, completed steps are not re-run, so step results must be serializable and side effects belong inside steps, not between them. `step.sleep(name, duration)` (e.g. `'30 seconds'`) and `step.sleepUntil(name, date)` pause without holding compute. An optional options argument tunes retry behavior per step:

```typescript
await step.do('call warehouse', {
  retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
  timeout: '30 seconds',
}, async () => { /* ... */ });
```

## Starting a workflow

From any app function (route, model event, cron):

```typescript
const run = await req.swell.workflows.create('sync-order', { order_id: id });
// { id: 'wf_inst_...', status: 'active' }
```

The first argument is the workflow's **function name**: the pushed file's basename with underscores converted to hyphens. `functions/sync_order.ts` and `functions/sync-order.ts` both register as `sync-order`; `functions/syncOrder.ts` registers as `syncOrder`. It is never the exported class name — a `SyncOrder` class buys you nothing. Confirm the deployed name with `swell inspect workflows --app=.`; a wrong name is a 404 `workflow_not_found`, and naming a non-workflow function is `workflow_manifest_not_workflow`. An app may declare at most 25 workflows (`workflow_count_exceeded` at push).

The second argument is passed through as `req.data` inside the workflow. Params must be JSON-safe and ≤128 KB, both checked before any instance is created: `workflow_params_too_large` over 128 KB, `workflow_params_unserializable` for anything JSON can't round-trip — `undefined`, functions, symbols, `NaN`/`Infinity`, cyclic references, sparse arrays, and **any object whose prototype isn't `Object.prototype`**, so a `Date` rejects (pass an ISO string). Pass identifiers and re-fetch inside the workflow.

Inside the workflow, `req.swell` is a **narrower** client than a function's, not the same one:

| Surface | Behavior inside a workflow |
|---|---|
| `get/post/put/delete` | Ordinary store collections only |
| `settings()` | No argument — always resolves the app's own settings |
| `/settings/...` paths | Rejected: `workflow_operation_blocked` |
| `:`-prefixed paths (`/:functions`, `/:cache`, …) | Rejected: `workflow_operation_blocked` |
| `/:batch` | Allowed (the one `:` exception) — child ops are re-validated *without* it, so no nested batch, `/:transaction`, `/settings`, or `..` inside |
| `/:transaction` | Rejected — no transactions inside a workflow |
| `appValues()` | **Does not exist** |
| `workflows.create()` | **Does not exist** — a workflow cannot start another workflow |

`..` traversal is blocked the same way (`workflow_operation_blocked`), but two neighboring cases are not: a path carrying a URL scheme fails as `workflow_runtime_api_path_invalid` — a different code, so grepping for `workflow_operation_blocked` misses it — and a literal `#` is truncated rather than rejected, so `/orders#x` silently becomes `/orders`. Only a percent-encoded `%23`/`%3F` trips the blocked check. Because `appValues()` is absent, build the extension envelope by hand:

```typescript
await req.swell.put(`/orders/${orderId}`, { $app: { [req.appId]: { synced: true } } });
```

Calling `req.appValues(...)` instead throws `TypeError: req.appValues is not a function` inside the step, and the step-retry machinery retries that TypeError to exhaustion — the run reads as a flaky integration, not a typo.

`req.workflow` identifies the run (`workflow_id`, `workflow_name`, `workflow_instance_id`, `trigger`, `request_id`). `req.isLocalDev` is always `false`.

## Deploy-only iteration loop

Workflows do **not** execute under `swell app dev` — your other functions still do, but workflow instances run only after `swell app push`. Iterate as:

1. `swell app push`
2. Trigger from a function (`swell api` against the calling route or model event)
3. Inspect: `swell inspect workflows --app=.` (deployed workflows), `swell inspect workflow-runs --app=.` (recent instances + status)
4. Logs: `swell logs --type workflow --app <id>` (step-level logs)

This also means Gate 5 testing for workflows happens against the test environment via push, never via local dev or direct localhost calls.
