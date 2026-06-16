# Workflows (Beta — feature-gated)

Durable functions that run as a sequence of retriable steps, persist across restarts, and can sleep for long periods. Use for multi-step background processes that must survive failures between steps — syncs to external systems, long-running fulfillment flows, delayed follow-ups.

## Availability gate

Workflows are behind a platform feature gate enabled **per store by Swell support**. When the gate is off, `swell app push` / `req.swell.workflows.create()` fail with an error stating workflows are not available for this store and suggesting to contact support. That failure is not a code problem — surface it to the user verbatim and stop; do not debug the workflow code. Do not propose workflows unprompted: prefer cron/model/route triggers unless the user explicitly requests workflows or the store is confirmed enabled.

## Declaring

`kind: 'workflow'` plus a default-exported class with `run(req, step)` — no handler function, and no `route`/`model`/`cron`/`extension`/`timeout` config keys:

```typescript
export const config: SwellConfig = {
  kind: 'workflow',
  description: 'Sync an order to the warehouse',
};

export default class SyncOrder {
  async run(req: SwellWorkflowRequest, step: SwellWorkflowStep) {
    const order = await step.do('load order', async () => {
      return req.swell.get(`/orders/${req.data.order_id}`);
    });

    await step.sleep('cool off', '30 seconds');

    await step.do('mark synced', async () => {
      return req.swell.put(`/orders/${order.id}`, req.appValues({ synced: true }));
    });

    return { ok: true };
  }
}
```

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

The second argument is passed through as `req.data` inside the workflow. Params must be JSON-serializable and ≤128 KB — non-serializable params (e.g. cyclic objects) reject with `workflow_params_unserializable` before any instance is created.

Inside the workflow, `req.swell.get/post/put/delete` and `req.swell.settings()` reach store data the same way functions do; `req.appValues()` works for standard-model extension writes; `req.workflow` identifies the run (`workflow_id`, `workflow_name`, `workflow_instance_id`, `trigger`, `request_id`).

## Deploy-only iteration loop

Workflows do **not** execute under `swell app dev` — your other functions still do, but workflow instances run only after `swell app push`. Iterate as:

1. `swell app push`
2. Trigger from a function (`swell api` against the calling route or model event)
3. Inspect: `swell inspect workflows --app=.` (deployed workflows), `swell inspect workflow-runs --app=.` (recent instances + status)
4. Logs: `swell logs --type workflow --app <id>` (step-level logs)

This also means Gate 5 testing for workflows happens against the test environment via push, never via local dev or direct localhost calls.
