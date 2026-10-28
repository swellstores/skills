# Functions

Serverless logic in `./functions/*.ts`. This reference covers what every function shares: the runtime and its limits, trigger configuration, the `req` object, return values, what to check when a function does not run, and local testing. Once the trigger is chosen, also read its own reference: `references/functions-hooks.md` (sync hooks), `references/functions-routes.md` (HTTP routes), `references/functions-workflows.md` (workflows), `references/actions.md` (dashboard actions).

Each top-level file exports a `config` object with exactly one trigger (`model`, `route`, `cron`, or `action`) and a handler; a `workflow` is a separate kind with a class in place of the handler. Shared code — helpers, types, libraries — goes in subdirectories (e.g. `./functions/lib/`) so it is not deployed as a function of its own. Run `swell schema function --format=dts` for the authoritative type declarations.

## Runtime and limits

- **Edge runtime, not Node.js.** Functions run on Cloudflare Workers in service-worker format with no `nodejs_compat`: no Node built-ins, no `process.env`. Use Web APIs (`fetch`, Web Crypto).
- **Timeout.** 10 s by default, configurable via `config.timeout` (1000–10000 ms; values up to 20000 ms require platform feature enablement). Sync hooks ignore `config.timeout` — see `references/functions-hooks.md`. A run that reaches it is cut off, and its log says `Function timed out after <n> s`; work that may not fit belongs in a workflow.
- **No environment variables or secrets.** Functions receive configuration only through `await req.swell.settings()` — see `references/settings.md`.
- **A function acts as the app.** `req.swell` carries the installed app's credentials, limited by `permissions` in `swell.json` (`references/permissions.md`), whoever or whatever triggered it.

## Trigger configuration

The skill's entry page says which trigger fits which need. The shapes:

**Model event triggers** respond to record changes. Standard events (`created`, `updated`, `deleted`) exist on all models by default. Custom events (e.g. `review.approved`) must be declared in the data model first — see "Events" in `references/data-models.md`.

```typescript
export const config: SwellConfig = {
  description: "Update product ratings when reviews change",
  model: {
    events: ["review.created", "review.updated", "review.deleted"],
    conditions: { status: "approved" }, // filter invocations
  },
};

export default async function (req: SwellRequest) {
  const { swell, data } = req;
  // data = full record + $event metadata; see req.data below
}
```

Conditions accept MongoDB-style operators against `$record`, `$data`, `$event`, `$settings`, or `$formula` (string expression for complex cases). Child collection events use dot notation: `review.comment.created`, `review.reaction.deleted`.

An event does not wake the function whose run made the write, except that a scheduled function's own write still moves its run. An `updated` event whose write changed app fields and nothing else wakes only the functions of the apps whose fields it changed, including the other functions of the app that wrote them. Writes by functions that follow from one request run functions for at most 10 events of a record: past that, the record's later events in the request run no function, and each function stopped logs why. Scheduled runs still follow their times.

Runs of a function for one record go one at a time, in the order of the record's events. A run that failed and waits for its retry, or one still unsent 5 minutes after its event, does not hold back later ones.

A `before:` or `after:` prefix on the event turns the function into a sync hook. Read `references/functions-hooks.md` before using one.

> **Integration apps**: platform-owned extension events (`payment.create_intent`, `payment.charge`, `payment.refund`, `order.shipping`, `order.taxes`) are model hooks with `config.extension` set and platform-filtered dispatch — see `references/app-integrations.md` for binding rules and the type-specific reference for the hook contract.

**Model schedule triggers** execute at the time `schedule.formula` gives for the record as stored, usually a date field. The field must exist in the data model.

```typescript
export const config: SwellConfig = {
  description: "Send a reminder when it is due",
  model: {
    events: ["reminder.created", "reminder.updated"],
    schedule: { formula: "date_due" },
  },
};
```

The function keeps one pending run per record. On each of its events for the record, a changed time moves the run, an empty time or `conditions` that no longer match cancel it, and an unchanged time leaves it. Conditions are checked on every event, so one on the write (`$data`, `$origData`, `$event`) cancels the run on any write it does not match: test the record's own fields (`remind_at: { $ne: null }`) for what must hold while the run waits. A time that has passed runs at once when the write sets it. Deleting the record cancels its run. The formula reads the same names as conditions.

**Cron triggers** execute on a fixed schedule with no record context.

```typescript
export const config: SwellConfig = {
  description: "Recalculate product popularity daily",
  cron: { schedule: "0 0 * * *" },
};

export default async function (req: SwellRequest) {
  /* req.data is empty */
}
```

The schedule is a five-field cron expression in UTC; one that cannot be parsed fails the push. To run the function without waiting for the schedule, call it by name: `swell api post '/functions/<app_id>/<name>'`.

**HTTP route triggers** expose a custom API endpoint. The basic shape is below; `references/functions-routes.md` covers handler dispatch (named vs. default vs. object exports, the `delete` reserved-word issue), `req.body` / `req.query` / `req.rawBody`, header allow-listing, cache tuning, calling the route from outside Swell, and signature-verification patterns.

```typescript
export const config: SwellConfig = {
  description: "Submit review from storefront",
  route: {
    methods: ["post"],
    public: true, // false requires secret key auth
  },
};

export async function post(req: SwellRequest) {
  if (!req.session?.account_id) {
    throw new SwellError("Login required", { status: 401 });
  }
  return await req.swell.post("/reviews", { /* ... */ });
}
```

**Dashboard actions** (`action: true`) and **workflows** (`kind: 'workflow'`) are covered in `references/actions.md` and `references/functions-workflows.md`.

## The `req` object

Authenticated context for the handler. Common fields across triggers:

- `req.swell` — platform client. App collections auto-scope: `req.swell.get('/reviews')` resolves to `/apps/<app_id>/reviews`. Use `expand` to include linked records. Query and write semantics are the Backend API's — see the `swell-backend-api` skill.
- `req.swell.transaction([{ method, url, data }, ...], { retry })` — multi-operation write (`POST /:transaction`, max 10 operations). **Rollback is partial, not total.** A *request* error in any op — not found, permission denied, bad URL, write conflict, timeout — aborts the whole set and throws with a stable code (`transaction_conflict`, `transaction_throttled`, `transaction_timeout`, `transaction_op_failed`) plus `op_index`. A **field-validation** failure does not abort: that op's slot comes back as `{ errors: {...} }` and every other op still commits. Always inspect each returned slot for `errors` — the `swell-backend-api` skill's `references/writes.md` has the full contract. Child operations fire no per-record hooks, functions, webhooks, or notifications — a committed transaction emits one `transaction.committed` event for the bundle. An app that declares `permissions` needs `write_:transaction` for the call, and each operation is checked against the app's scopes — see `references/permissions.md`.
- `req.data` — trigger payload, and its `$event` shape **differs by trigger**. Async model events: record fields spread in, plus `$event` = `{ id, type, model, app_id, data, delivery }`; `$event.data` carries the full snapshot on `created`/`deleted` and **only changed fields** on `updated` — check `'field' in req.data.$event.data` to detect what changed. Custom events carry the subset declared in the model's event `fields`. `$event.delivery` is per-delivery retry state `{ attempts, date_first_failed }` — `attempts` is `0` on first delivery. Sync hooks (`before:`/`after:`): `$event` = `{ model, type, hook, app_id }` **only** — there is no `$event.data`, so `'field' in req.data.$event.data` throws; detect changes by comparing `req.data.<field>` against `req.data.$record.<field>`. Cron: empty. Routes: see the route reference for body/query precedence.
- `req.appId` — current app identifier. Use instead of hardcoding.
- `req.store` — store metadata: `id` and the storefront `url`.
- `req.app.admin_url` — the app's page in the dashboard, in the function's environment.
- `req.app.frontend_url` — the app's address in the function's environment, where its frontend answers when it has one (`references/frontend.md`, "Where it is served"), such as a callback page to give a provider.
- `req.environmentId` — `'test'` in the test environment, `null` in live. Requires `@swell/cli` 2.9.30 and `@swell/app-types` 1.2.11 (types), or later: push bundles the code that sets it, so in a function pushed with an older CLI it is `undefined` and `req.environmentId === 'test'` reads as live.
- `req.session` — user session (routes only); `null` unless the storefront gateway attached one, so gate with `req.session?.account_id`.
- `req.context.waitUntil(promise)` — run work after the response returns (logs, metrics, non-blocking side effects); the Worker continues until the promise resolves or CPU time expires.
- `await req.swell.settings()` — app settings from `./settings/`. Pass another app's id to read its settings cross-app.
- `req.isLocalDev` — `true` under `swell app dev` (set at runtime from the `Swell-Local-Dev` header), useful for dev-only branches.

## Writing app fields on standard models

Fields an app adds to a standard model are written under `$app` via `req.appValues`. Pass `(otherAppId, values)` to target another app:

```typescript
await req.swell.put(`/products/${id}`, req.appValues({ review_count: 42, average_rating: 4.5 }));
```

They come back under `$app.<app_id>.*` automatically — no explicit `expand` needed — on the Backend API and inside app functions. They merge and take field operators like the record's own fields, as the `swell-backend-api` skill's `references/writes.md` describes. Whether a storefront can read them is a separate question: see "Storefront exposure" in `references/data-models.md`. For app-defined collections, write directly at the root.

## Return values and errors

Plain object → JSON 200. String → `text/plain` 200. For custom status/headers, return `new SwellResponse(data, { status, headers })` (preferred over native `Response`). Throw `SwellError(msg, { status })` to error. An event-triggered function's failed delivery is retried as a webhook delivery is (the `swell-backend-api` skill's `references/events-webhooks.md`, "Retries"); add `retry: false` to record it without scheduling further retries, or `retryAfter: <seconds>` to put off the next call by that long, up to 12 hours and never sooner than the retry schedule. In `before:` hooks, thrown errors do **not** block the mutation — throw `req.reject(code, message, { status })` to reject the write (see `references/functions-hooks.md`). Errors from `req.swell.*` expose `error.status` (HTTP status) and `error.body` (structured payload) — don't parse `error.message`. A write refused by validation throws as well, with status 400 and the field errors as `error.body` (`{ <field>: { code, message } }`); it does not resolve with an `errors` object to check. No other failure has a field map as its body: the rest have `error.body.error` or no body. A read of an id that does not exist is not an error: it resolves empty (an empty string, not `null`), so test `if (!record)`. Inside a workflow these rules differ — see `references/functions-workflows.md`. Model and cron handlers typically return nothing.

## When a function does not run

**Before hunting for a code or config bug, confirm the app is still active in that environment.** `swell api get '/:clients/:self/apps'` (add `--live` for production) lists the installed-app records for the environment your credentials resolve to, each carrying `active`, `version`, and `local_proxy_url`. `active: false` silently suppresses **every** function invocation and **every** app-owned webhook delivery — no error to the caller, no function log — while the deployed function and webhook records still read as enabled with correct bindings; `swell inspect functions` marks the app's functions `app inactive`. A non-null `local_proxy_url` means a `swell app dev` tunnel still owns this app's hook and event deliveries in that environment.

**Then check for auto-disable.** Model-event functions that fail continuously for ~4 days (2 days if `timeout` >10s; immediately on 404/worker-missing) auto-disable; cron and routes are unaffected. `swell inspect functions --app=.` marks a failing function `failing since <date> · <n> fails` with `may disable from <date>`, when it is switched off if it keeps failing, and a switched-off one `auto-disabled`; detail mode adds the last failed delivery. Fix the cause and run `swell app push`, of the app or of `functions/`: from `@swell/cli` 2.9.33 it switches the app's auto-disabled functions back on, except one whose file failed in that push, and the platform resends the events they missed. With an older CLI, a function file that push skips as unchanged leaves its function off: run `swell app push --force`. The marks above need 2.9.33 as well.

Other causes have their own references: an extension function whose app the merchant has not selected (`references/app-integrations.md`); a file that push skipped (`references/cli.md`).

## Local testing

Run `swell app dev` as a background process (one app per session) to stream function execution to your terminal. Trigger model events and hooks via `swell api [post|put|delete] /<collection>` — those are the invocation paths the tunnel actually captures. Routes are **not** tunneled: `swell api [method] /functions/<app_id>/<function_name> --body '{...}'` reaches the deployed worker, so push before testing a route change, or call the local dev URL directly and accept that it skips context initialization (settings, session). Caveat: `req.session` is **`null`** when a route is invoked through `swell api` — the CLI's `$call` path sends no `Swell-Session` header, and only the storefront gateway attaches one. Every `session?.account_id` gate therefore rejects. Simulate one with `-H 'Swell-Session: {"account_id":"..."}'`, or verify customer-scoped auth through the storefront gateway or integration tests.

The test scaffold (`swell create tests`) defines the `SwellError`, `SwellRejection` and `SwellResponse` globals in `test/setup-globals.ts`.
