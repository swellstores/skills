# Functions

Serverless logic in `./functions/*.ts`. This reference covers what every function shares: the runtime and its limits, trigger configuration, the `req` object, return values, what to check when a function does not run, and local testing. Once the trigger is chosen, also read its own reference: `references/functions-hooks.md` (sync hooks), `references/functions-routes.md` (HTTP routes), `references/functions-workflows.md` (workflows), `references/actions.md` (dashboard actions).

Each top-level file exports a `config` object with exactly one trigger (`model`, `route`, `cron`, or `action`) and a handler; a `workflow` is a separate kind with a class in place of the handler. Shared code — helpers, types, libraries — goes in subdirectories (e.g. `./functions/lib/`) so it is not deployed as a function of its own. Run `swell schema function --format=dts` for the authoritative type declarations.

## Runtime and limits

- **Edge runtime, not Node.js.** Functions run on Cloudflare Workers in service-worker format with no `nodejs_compat`: no Node built-ins, no `process.env`. Use Web APIs (`fetch`, Web Crypto).
- **Timeout.** 10 s by default, configurable via `config.timeout` (1000–10000 ms; values up to 20000 ms require platform feature enablement). Sync hooks ignore `config.timeout` — see `references/functions-hooks.md`.
- **Responses are hard-truncated at 75,000 bytes** (`MAX_RESPONSE_BYTES`), not rejected: the caller receives the truncated prefix, which then fails JSON parsing and arrives as a raw string rather than an object. Paginate large collections rather than returning them.
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

A `before:` or `after:` prefix on the event turns the function into a sync hook. Read `references/functions-hooks.md` before using one: only `created`, `updated` and `deleted` are real hook phases.

> **Integration apps**: platform-owned extension events (`payment.create_intent`, `payment.charge`, `payment.refund`, `order.shipping`, `order.taxes`) are model hooks with `config.extension` set and platform-filtered dispatch — see `references/app-integrations.md` for binding rules and the type-specific reference for the hook contract.

**Model schedule triggers** execute at a future date derived from a record field. The field must exist in the data model.

```typescript
export const config: SwellConfig = {
  description: "Capture scheduled payment",
  model: {
    events: ["payment.created", "payment.updated"],
    conditions: { date_scheduled: { $exists: true } },
    schedule: { formula: "date_scheduled" }, // re-schedules on field change
  },
};
```

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
- `req.store` — store metadata including `admin_url`.
- `req.session` — user session (routes only); `null` unless the storefront gateway attached one, so gate with `req.session?.account_id`.
- `req.context.waitUntil(promise)` — run work after the response returns (logs, metrics, non-blocking side effects); the Worker continues until the promise resolves or CPU time expires.
- `await req.swell.settings()` — app settings from `./settings/`. Pass another app's id to read its settings cross-app.
- `req.isLocalDev` — `true` under `swell app dev` (set at runtime from the `Swell-Local-Dev` header), useful for dev-only branches.

## Writing app fields on standard models

Fields an app adds to a standard model are written under `$app` via `req.appValues`. Pass `(otherAppId, values)` to target another app:

```typescript
await req.swell.put(`/products/${id}`, req.appValues({ review_count: 42, average_rating: 4.5 }));
```

They come back under `$app.<app_id>.*` automatically — no explicit `expand` needed — on the Backend API and inside app functions. Whether a storefront can read them is a separate question: see "Storefront exposure" in `references/data-models.md`. For app-defined collections, write directly at the root.

Writes to `$app` **deep-merge** with the stored subdocument — fields you don't send are preserved. To replace outright, use the `$set` operator: `{ "$app": { "$set": { "my_app": {...} } } }` replaces the whole app subdocument; `{ "$app": { "my_app": { "$set": { "config": {} } } } }` replaces a single field without merging into its prior value. Arrays deep-merge too, and never shrink on a plain write. Elements **with** an `id` align by id: a matching stored element merges in place, an unknown id appends. Elements **without** an `id` merge **positionally** — source index `i` merges into stored index `i` regardless of what is there, and appends only past the end of the stored array. So a plain write of `[{qty: 2}]` rewrites the first stored element rather than adding one. Append with `$push`; replace with `$set`. These are the Backend API's write rules, not something specific to `$app`; the `swell-backend-api` skill's `references/writes.md` covers the operators in full.

## Return values and errors

Plain object → JSON 200. String → `text/plain` 200. For custom status/headers, return `new SwellResponse(data, { status, headers })` (preferred over native `Response`). Throw `SwellError(msg, { status })` to error; on event-triggered functions, add `retry: false` to record the failed delivery without scheduling further retries. In `before:` hooks, thrown errors do **not** block the mutation — throw `req.reject(code, message, { status })` to reject the write (see `references/functions-hooks.md`). Errors from `req.swell.*` expose `error.status` (HTTP status) and `error.body` (structured payload) — don't parse `error.message`. Model and cron handlers typically return nothing.

## When a function does not run

**Before hunting for a code or config bug, confirm the app is still active in that environment.** `swell api get '/:clients/:self/apps'` (add `--live` for production) lists the installed-app records for the environment your credentials resolve to, each carrying `active`, `version`, and `local_proxy_url`. `active: false` silently suppresses **every** function invocation and **every** app-owned webhook delivery — no error to the caller, no function log — while the deployed function and webhook records still read as enabled with correct bindings, so `swell inspect` shows nothing wrong. A non-null `local_proxy_url` means a `swell app dev` tunnel still owns this app's hook and event deliveries in that environment.

**Then check for auto-disable.** Model-event functions that fail continuously for ~4 days (2 days if `timeout` >10s; immediately on 404/worker-missing) auto-disable until the function config is **re-pushed**; cron and routes are unaffected. The `enabled: true` reset rides on the function PUT, and `swell app push` skips files whose hash is unchanged — so a push that touches nothing in the top-level function file will not clear `auto_disabled`. Use `swell app push --force`, then confirm in detail mode. `swell inspect functions --app=.` gives a trigger summary, next cron run, and a bare `disabled` marker (list mode does **not** distinguish auto-disable from a manual disable, and its `last fail` column actually shows `date_final_attempt` = first failure + 4 days, i.e. the projected auto-disable deadline, which renders as a future date). Run `swell inspect functions <key>` for the record's real `auto_disabled`, `date_first_failed`, `date_last_success`, and `attempts_failed`.

Other causes have their own references: a hook on an event other than `created`/`updated`/`deleted`, or a second handler for the same hook event (`references/functions-hooks.md`); an extension function whose app the merchant has not selected (`references/app-integrations.md`); a file that push skipped (`references/cli.md`).

## Local testing

Run `swell app dev` as a background process (one app per session) to stream function execution to your terminal. Trigger model events and hooks via `swell api [post|put|delete] /<collection>` — those are the invocation paths the tunnel actually captures. Routes are **not** tunneled: `swell api [method] /functions/<app_id>/<function_name> --body '{...}'` reaches the deployed worker, so push before testing a route change, or call the local dev URL directly and accept that it skips context initialization (settings, session). Caveat: `req.session` is **`null`** when a route is invoked through `swell api` — the CLI's `$call` path sends no `Swell-Session` header, and only the storefront gateway attaches one. Every `session?.account_id` gate therefore rejects. Simulate one with `-H 'Swell-Session: {"account_id":"..."}'`, or verify customer-scoped auth through the storefront gateway or integration tests.

The test scaffold (`swell create tests`) defines `SwellError` and `SwellRejection` globals in `test/setup-globals.ts` but not `SwellResponse` — add it there if tests construct responses.
