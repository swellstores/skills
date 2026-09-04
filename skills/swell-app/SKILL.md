---
name: swell-app
description: Use this skill for building, modifying, or debugging a Swell App — modular extension packages for the Swell headless e-commerce platform deployed via the `swell` CLI. Triggers include `swell.json`; use of app-lifecycle `swell` CLI commands (`swell app push`, `swell app dev`, `swell app pull`, `swell create`, `swell inspect`, `swell schema`); Swell-specific app directories (`./models/`, `./content/`, `./functions/`, `./settings/`, `./notifications/`, `./webhooks/`); FQN shapes like `apps/<app_id>/<collection>` or `$app.<app_id>.*`-namespaced fields; Swell event conventions (`review.created`, `before:`/`after:` model hooks, model schedules, cron, HTTP routes at `/functions/<app_id>/<name>`); or integration apps with payment / shipping / tax extension slots and Preact checkout components. Covers the `admin` and `integration` app types only — do NOT use for `theme` or `storefront` apps (Proxima, `swell theme *`, storefront visual editor / locales / publishing), other e-commerce platforms, or generic Cloudflare Workers questions unrelated to Swell; for storefront code built on `swell-js` and the Frontend API use the swell-storefront skill, and for Backend API work with a secret key (swell-node, one-off `swell api` data reads/writes against a store, data scripts, integrations without an app) use the swell-backend skill.
allowed-tools: Read, Grep, Glob, Bash
---

# I. System Architecture & Environment

A Swell App is a modular extension package for the Swell headless e-commerce platform, deployed via CLI to inject custom data schemas, admin interfaces, serverless logic and other resources into a store environment.

## The File System Contract

The file system acts as a rigid configuration contract. The existence and naming of a file directly determines its runtime behavior, API endpoint, and whether it creates a new resource or modifies an existing one.

- **App Identity.** The `./swell.json` manifest defines the App ID (referenced as `<app_id>` throughout this document), name, type, version, and the `permissions` scope array (empty or absent means **full** access — see "App Permissions"), plus optional billing (`price`, `price_interval`, `price_trial_days`, `price_external`) and marketing fields used at release time — see `references/app-publishing.md`. Apps with `"type": "integration"` and/or `extensions[]` declare platform integration slots — see "Integration Apps & Extensions" below.

- **Assets.** `./assets/` is the app's only **public** directory: asset files are stored non-private and served from an unauthenticated CDN URL, while every other file `swell app push` uploads (functions, models, settings, `package.json`, tests) is stored private with no URL. Put nothing in `assets/` you would not publish. Image assets bind to app-record fields **by filename**, so a rename silently unbinds them: `assets/icon.*` → `logo_icon` (dashboard + release icon), `assets/image.*` → `cover_image`, `assets/preview.*` → `preview_image`, `assets/preview-mobile.*` → `preview_mobile_image`. Non-image content types upload but bind to nothing. Override a path with `swell.json`'s `logo_src` / `preview_src` / `preview_mobile_src`; `highlights[].image_src` resolves the same way into `highlight_assets[].image`. None of this is validated locally — verify after any rename.

- **Data.** The `./models/` directory defines the database schema. Files named after standard entities (e.g., `products.json`, `accounts.json`) function as extensions—they merge new fields into the existing platform model, namespaced at runtime as `$app.<app_id>.*`. Files with unique names (e.g., `vendor-profiles.json`) create new app-specific collections. Use strict kebab-case for new collections naming. Reference custom models using their Fully Qualified Name (FQN): `apps/<app_id>/<collection>`. This FQN applies to API endpoints, relationship links, and SDK queries.

- **App Configuration.** The `./settings/` directory defines the app's global configuration schema. These files generate the "App Preferences" UI in the Dashboard, and their values become accessible in functions via `const settings = await req.swell.settings();`. Use this for credentials, feature flags, and runtime configuration.

- **User Interface.** The `./content/` directory configures Admin Dashboard views: input widgets, list columns, and conditional visibility rules. These files map to standard or custom data model, not strictly a local file: you can create `content/products.json` to customize the standard product editor without re-defining standard `products` data model. Content models define UI logic only (labels, views, help text, layout); data logic (types, events, permissions, formulas) belongs in `./models/`.

- **Notifications.** Transactional emails reside in `./notifications/` using a paired-file convention: a JSON file defines metadata and event triggers (e.g., `review.created`), while a corresponding `.tpl` file contains the Liquid template for the email body.

- **Logic.** Serverless functions reside in `./functions/`. Top-level TypeScript files become API endpoints or event handlers. Shared code—helpers, types, libraries—must be placed in subdirectories (e.g., `./functions/lib/`) to prevent exposure as a standalone function. Functions run on the Edge (Cloudflare Workers), not Node.js.

- **Components.** Browser UI for **payment checkout extensions only** — no admin, storefront, or shipping/tax host loads app components today. Top-level `./components/*.{jsx,tsx}` bundle as Preact and must export `config` (with `config.extension` matching a `swell.json` extension of `type: "payment"`) AND a default Preact component. The bundler validates only `config`; a missing default export deploys cleanly and renders nothing at runtime. Details in `references/payment-extensions.md`.

- **Testing.** The `./test/` directory contains the Vitest suite. It includes `./test/unit/` and `./test/integration/` directories, plus helpers: `mock-request.ts` for mocking function context, `swell-client.ts` for data operations. Its Swell client uses CLI authentication to reach platform resources without client auth configuration.

- **Frontend.** Optional `./frontend/` directory bundles into a Cloudflare Worker, deployed by `swell app push` and embedded as an iframe inside the Swell dashboard for `admin` and `integration` apps. Use when the UI cannot be expressed as content-model `list`/`edit`/`new` views — multi-step flows, embedded third-party widgets, custom dashboards. Orthogonal to `components/`: integration apps may ship both. Reachable through `frontend://path/{id}` links from content-model `nav.link` / `actions[].link` — no automatic top-level nav. Adds a developer-owned Cloudflare account dependency (`wrangler login` + `CLOUDFLARE_ACCOUNT_ID` required to deploy). The admin proxy injects app-scoped backend credentials on every request — including direct, unauthenticated hits — so any route returning or mutating store data must validate the `_swell_admin_session` cookie against the platform. Same-origin iframe only (CSP enforced); no custom worker domain. Storefront apps may scaffold the same folder but follow a separate platform contract (visual editor, locales, publishing) that this skill does not cover. Details in `references/frontend.md`.

- **Webhooks**. `./webhooks/` directory contains JSON manifests which are configured to call a URL when a particular event occurs, enabling outgoing calls to external services.

## Integration Apps & Extensions

Integration apps declare extension slots in `swell.json` that the platform binds into native payment, shipping, or tax flows. Branch here when the requested feature is a payment method, shipping service, or tax service, or when `swell.json` has `type: "integration"` or `extensions[]`, when functions set `config.extension`, or when `components/` has top-level `.tsx`/`.jsx` files. Generic integrations (`type: "integration"` without `extensions[]`) need only `references/app-integrations.md`'s manifest section — skip the type-specific references.

Two non-obvious traps distinguish extension work from ordinary app work:

1. **Dispatch is platform-filtered, not condition-based.** A function whose `model.events` match still does not run unless the native settings record selects this app via `extension_app_id`/`extension_config_id` AND the function's `config.extension` matches. Most "function never runs" reports are merchant-activation gaps, not code bugs. Run `swell inspect extensions [--app=.]` (or with `app.<slug>.<extId>` for one extension); each row carries a `status`, an `action_owner` (`dev` | `merchant` | `null`), and an `action` string — route on `action_owner`, surface `action` verbatim when `merchant`.
2. **Binding paths differ by extension type.** Payment alt methods, payment card gateways, shipping carriers, and tax each bind through a different native settings path with a different key shape — never reuse one shape for another.

**Read** `references/app-integrations.md` **first**. **Then** load exactly one of `references/payment-extensions.md` (for `payment`) or `references/shipping-tax-extensions.md` (for `shipping`/`tax`). Do not load the other type's reference.

# II. CLI Reference

The CLI runs the whole cycle: discover → scaffold → validate → deploy → verify. Every command takes `--help`, and interactive ones take `-y`; read `references/cli.md` before using any of them in anger — the flags are discoverable, the failure modes are not.

| Command | Use it to |
|---|---|
| `swell inspect {content\|extensions\|functions\|models\|notifications\|settings\|webhooks\|workflows\|workflow-runs}` | Read deployed state. List mode discovers, detail mode verifies after a push |
| `swell schema <type> --format=dts` | The authoritative structure for a resource type — consult before authoring |
| `swell schema <type> ./file` | Validate one manifest locally |
| `swell create {content\|function\|model\|notification\|setting\|webhook\|tests\|frontend\|app}` | Scaffold; do not hand-author what a scaffold produces |
| `swell app push` | Deploy every app resource to the test environment |
| `swell app dev` | Local tunnel; model hooks and events execute locally |
| `swell app pull` | Adopt an existing app — a two-way sync, not a download |
| `swell app version` / `install` / `release` | Publishing lifecycle — see `references/app-publishing.md` |
| `swell logs [-f]` | Remote logs for functions, webhooks and API calls |

Five behaviours that decide whether a deploy actually did what you think:

- **`swell app push` is not all-or-nothing and exits 0 on per-file failures.** A file the CLI cannot parse or compile prints one line and is skipped while the rest deploys. Never read a clean exit as proof — check the output for `Ignoring file:` / `Unable to compile`.
- **Push deletes.** Per config type, remote configs whose local file is gone are removed with no prompt.
- **Push skips unchanged files by hash**, so edits confined to `functions/` subdirectories leave importing bundles stale — use `--force` after any lib-only change.
- **`swell app dev` pushes first, then intercepts** that environment's model hooks and events for every caller until it exits.
- **`swell api` targets the test environment** unless `--live` is passed.

JSON-manifest validation is currently broken on released CLIs (`no schema with key or ref ".../2020-12/schema"`); `--format=dts` and function validation still work. Fall back to authoring against the dts output and treating `swell app push` as the real check — details and the workaround in `references/cli.md`.

# III. Development Cycle

Main Swell App resource types share the similar Development Cycle formalized in five gates. IMPORTANT: Pass all five gates for each modified or created resource.

## Gate 1 — Explore

Identify resources your are going to create or modify. Identify prerequisites your resource depends on: e.g. model events for functions/webhooks/notifications, data fields for content views, relationship targets for links etc. Swell App naturally extends standard platform resources in its own scope. To avoid duplication of standard resources, or to find a proper alignment to standard resources, you may need to list existing remote models with `swell inspect models` and explore them with the same command.
If the app is an integration app or declares `extensions[]`, identify the extension type, matching extension id, required platform flow, required functions, and whether checkout components are part of the design before authoring ordinary resources.
Pass: You know (a) which resources you will create or extend, (b) which prerequisites must exist, and (c) that prerequisites are present or will be created first.

## Gate 2 — Schema

Obtain the authoritative structural rules of the target resource type before authoring. Execute `swell schema {content|function|model|notification|setting|webhook} --format=dts`. For schema-backed resources, the schema is the structural source of truth. For integration manifest metadata and components, first check whether the current CLI exposes schema support; otherwise use the extension references and deploy-time validation.
Pass: You have the schema output and understand the structural requirements for your resource type.

## Gate 3 — Author & Validate

For new schema-backed resources, scaffold with `swell create {content|function|model|notification|setting|webhook} [name] [flags] -y` (the schema-backed subset; see Section II for the full topic list). IMPORTANT: Do not hand-author these resources when a scaffold command exists. Use kebab-case for resource naming. Explore `--help` for resource-specific flags. Edit the resource to implement your requirements. Validate resource with `swell schema {type} ./path/file` (if it errors on the JSON Schema draft, follow the Validation known issue in Section II). For functions and components, also run `npm run typecheck` when configured. Iterate until zero errors.
Pass: Local validation passes with zero errors. TypeScript compiles without errors.

## Gate 4 — Deploy & Verify

Push resources to the platform test environment with `swell app push`. The platform performs additional validation beyond local schema checks: reference integrity (e.g., links to non-existent collections), reserved field conflicts, and event binding validity. Deployment errors indicate issues local validation cannot catch. Verify deployment with `swell inspect <type> --app=.` for list-level state (enabled, trigger, failure indicators) and `swell inspect <type> <key>` for the full record. For runtime probing, paste the commands printed under `Next steps` (e.g. `/events`, `/events:webhooks`) rather than constructing event or log queries by hand. For integration apps, also run `swell inspect extensions --app=.` and act on `action_owner`/`action` per `references/app-integrations.md`.
Pass: Deployment completes without errors and no `Ignoring file:` or `Unable to compile` lines appeared in the push output. List-mode meta shows the resource enabled with the expected trigger/binding; detail-mode JSON matches the source manifest.

## Gate 5 — Test

Confirm the resource behaves as designed under realistic conditions. Actions depend on resource type you are going to test:

- Event-driven resources (model-triggered functions, webhooks, notifications): Trigger via `swell api [post|put|delete] /apps/<app_id>/<collection>` with payloads matching event conditions (model events propagate asynchronously).
- Route functions: Call via `swell api [get|post|put|delete] /functions/<app_id>/<function_name>` with appropriate `--body`.
- Data models: Execute create → read → update → delete cycle via `swell api` or integration test. Test relationship expansion with `?expand=`.
  Pass: Resource produces expected behavior. For testable resources, integration tests in `./test/integration/` pass and provide regression coverage.

Note: Consider formalizing your tests in unit and integration tests of the app. Scaffold tests with `swell create tests` if necessary. The current scaffold pins `vitest` 3.x while pulling `@cloudflare/vitest-pool-workers@latest`, which requires vitest 4 — after scaffolding, pin pool-workers to a vitest-3-compatible line (e.g. `0.8.x`) or align both on 4.x before installing. The scaffold's `test/setup-globals.ts` defines `SwellError` and `SwellRejection` globals but not `SwellResponse` — add it there if tests construct responses.

# IV. Resources best practices

## Data Models

Data models define the database schema in `./models/*.json`, where filename matches collection (`products.json`). Remote (deployed), models can be inspected with `swell inspect models /products` (standard) or `/apps/<app_id>/<collection>` (app). This section covers dev cycle that extends standard collections or creates new app-specific ones.

**Decision Guide:**

- [ ] **Extend a standard model** when data logically belongs to an existing entity: review scores on products, loyalty tiers on accounts, fulfillment metadata on orders. Fields merge into the record under `$app.<app_id>.*` and are queryable on the standard list endpoints (`where` on `$app.<app_id>.<field>` paths, including inside `$and`/`$or`). Benefits: seamless admin integration, no new API surface, automatic association with platform workflows.

- [ ] **Create a new app model** when data requires independent lifecycle, dedicated events, distinct public permissions, or has no natural parent. Reviews, wishlists, vendor profiles fit here. The collection lives at `apps/<app_id>/<collection>` and requires explicit relationship links.

- [ ] **Use a child collection** when data is tightly scoped to a parent and should not exist independently. Declare with `"type": "collection"` containing nested `fields`. Children share the parent's API path. Child collections declared in a standard-model extension live at `/<collection>:apps.<app_id>.<name>`, expand into the record under `$app.<app_id>.<name>` (not the record root), fire events under the parent model's event root (`before:product.<name>.created`), and are deleted automatically when the parent record is deleted.

**Storefront exposure is opt-in and off by default.** An app collection with no public declaration produces no permissions record at all, so *every* Frontend API verb fails with `You do not have permission to perform this action on '<model>'`. Declare it in the model JSON: `"public": true` at the model root publishes every field; a per-field `"public": true` publishes just that field. `public_permissions` then refines it — `fields` is an explicit read whitelist; `query` pins a filter the caller cannot widen (`"query": { "where": { "status": "approved" } }` keeps unmoderated records inside the store, since config values override the caller's); `input.fields` is **required for any storefront write** (without it POST/PUT/DELETE fail with `You may not update <model> without public permissions`) and a field outside that list is *rejected* (`You are not allowed to update <field>`), not ignored; `scope: "account"` restricts reads and writes to the logged-in customer, but it is only applied when an `input` block is also present. Run `swell schema model --format=dts` for the full shape. Extension fields added to a **standard** model are a different story — see "Writing to standard model extensions" under Functions.

Relationships require two fields: an `objectid` stores the reference; a `link` declares the target and enables expansion.

```json
{
  "product_id": { "type": "objectid", "required": true },
  "product": { "type": "link", "model": "products", "key": "product_id" }
}
```

For app model targets, use FQN: `"model": "apps/<app_id>/vendors"`. For child collections: `"model": "products:variants"` or `"model": "apps/<app_id>/vendors:locations"`.

Link fields declared in a standard-model extension expand via `?expand=$app.<app_id>.<field>`. Link resolution sees both your app's fields and the parent record's native fields (app fields win on name collisions) — but inside an app link's `key` or `params`, `id` always refers to the **parent record's** id, so key links off a dedicated app field (e.g. `channel_id`), never `id`.

Events enable function triggers on record changes and are declared in the model JSON. Consult `swell schema model --format=dts` for structure, field options, and condition syntax.

## Content Models

Content models configure Admin Dashboard views in `./content/*.json`: list columns, form layout, navigation, input behaviour. They map to a data model's Resource ID and hold **UI logic only** — types, events, permissions and formulas belong in `./models/*.json`, and a content field id must match a data-model field.

**Decision Guide:**

- [ ] **Augment a standard model** when adding UI for fields on an existing entity. Extensions merge with the native UI rather than replacing it — `edit.tabs` adds alongside native tabs, `list.fields` appends columns, `list.tabs` adds filtered views — and merchants can reorder or hide the additions.
- [ ] **Create app model views** for app-defined collections. A list view without a `nav` object gets **no sidebar entry at all**, and layout is controlled entirely through views (`admin_zone` has no effect here).

Authoring detail — view ids and types, field inheritance, `field_row`/`field_group` layout, `admin_span`, conditions and `readonly` expressions, actions, and the `collection`/`lookup` field types — is in `references/content-models.md`. Consult `swell schema content --format=dts` for field types and every property option.

## Functions

Functions implement serverless logic in `./functions/*.ts`. Each file exports a `config` object specifying exactly one trigger (`model`, `route`, or `cron`) and a handler; a separate beta `workflow` kind exists behind a per-store feature gate (see trigger selection). Run `swell schema function --format=dts` for the authoritative type declarations — that schema is the post-decision shape reference for everything below.

**Cross-cutting constraints.** Functions time out at 10s by default (configurable via `config.timeout`, 1000–10000 ms; values up to 20000 ms require platform feature enablement). Responses are hard-**truncated** at 75,000 bytes (`MAX_RESPONSE_BYTES`), not rejected: the caller receives the truncated prefix, which then fails JSON parsing and arrives as a raw string rather than an object — paginate large collections rather than returning them. Functions receive configuration only through `await req.swell.settings()`; there are no env-var or secret bindings (see Settings).

**Before hunting for a code or config bug, confirm the app is still active in that environment.** `swell api get '/:clients/:self/apps'` (add `--live` for production) lists the installed-app records for the environment your credentials resolve to, each carrying `active`, `version`, and `local_proxy_url`. `active: false` silently suppresses **every** function invocation and **every** app-owned webhook delivery — no error to the caller, no function log — while the deployed function and webhook records still read as enabled with correct bindings, so `swell inspect` shows nothing wrong. A non-null `local_proxy_url` means a `swell app dev` tunnel still owns this app's hook and event deliveries in that environment.

Model-event functions that fail continuously for ~4 days (2 days if `timeout` >10s; immediately on 404/worker-missing) auto-disable until the function config is **re-pushed**; cron and routes are unaffected. The `enabled: true` reset rides on the function PUT, and `swell app push` skips files whose hash is unchanged — so a push that touches nothing in the top-level function file will not clear `auto_disabled`. Use `swell app push --force`, then confirm in detail mode. `swell inspect functions --app=.` gives a trigger summary, next cron run, and a bare `disabled` marker (list mode does **not** distinguish auto-disable from a manual disable, and its `last fail` column actually shows `date_final_attempt` = first failure + 4 days, i.e. the projected auto-disable deadline, which renders as a future date). Run `swell inspect functions <key>` for the record's real `auto_disabled`, `date_first_failed`, `date_last_success`, and `attempts_failed`.

### Trigger selection

> **Integration apps**: platform-owned extension events (`payment.create_intent`, `payment.charge`, `payment.refund`, `order.shipping`, `order.taxes`) are model hooks with `config.extension` set and platform-filtered dispatch — see `references/app-integrations.md` for binding rules and the type-specific reference for the hook contract. Authoring then follows the **Model hook (sync)** path below.

- **Model event (async)** — fires after a record mutation persists. Use for downstream effects: denormalization, fan-out, analytics.
- **Model hook (sync)** — `before:` / `after:` prefix on a model event runs synchronously inside the originating API request, can read the pre-mutation record, and (in `before` phases) can mutate what gets saved or reject the write via `req.reject()`. → see `references/functions-hooks.md` once chosen.
- **Model schedule** — fires at a future date derived from a record field; re-schedules when the field changes.
- **Cron** — fixed cron schedule, no record context.
- **HTTP route** — custom endpoint at the fixed path `/functions/<app_id>/<function_name>`. No URL path parameters (no `/users/:id`-style routing); pass identifiers via query or body. External callers reach it at `https://<store>.swell.store/functions/<app_id>/<name>` and **must send a valid public key in `Authorization` even when `public: true`** — the gateway resolves the app slug from the key's installed-apps set — so a third-party webhook sender that cannot add that header needs a different ingress. → see `references/functions-routes.md` once chosen.
- **Workflow (Beta, feature-gated)** — `kind: 'workflow'`: durable multi-step background function with retriable steps and long sleeps. Available only on stores where Swell support has enabled the feature — do not propose workflows unprompted; use only when the user explicitly requests them or the store is confirmed enabled. → see `references/functions-workflows.md` once chosen.

**Model Event Triggers** respond to record changes. Standard events (`created`, `updated`, `deleted`) exist on all models by default. Custom events (e.g. `review.approved`) must be declared in the data model first, and the declaration requires a non-empty `conditions` object (the condition that marks the event as having occurred) unless it is an `extension` event; conversely, standard `created`/`updated`/`deleted` types must **not** declare `conditions`. Both are enforced at push time by `validateModelEvents`, never by local validation.

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

**Model Schedule Triggers** execute at a future date derived from a record field. The field must exist in the data model.

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

**Cron Triggers** execute on a fixed schedule with no record context.

```typescript
export const config: SwellConfig = {
  description: "Recalculate product popularity daily",
  cron: { schedule: "0 0 * * *" },
};

export default async function (req: SwellRequest) {
  /* req.data is empty */
}
```

**HTTP Route Triggers** expose a custom API endpoint. The basic shape is below; `references/functions-routes.md` covers handler dispatch (named vs. default vs. object exports, the `delete` reserved-word issue), `req.body` / `req.query` / `req.rawBody`, header allow-listing, cache tuning, and signature-verification patterns.

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

### The `req` object

Authenticated context for the handler. Common fields across triggers:

- `req.swell` — platform client. App collections auto-scope: `req.swell.get('/reviews')` resolves to `/apps/<app_id>/reviews`. Use `expand` to include linked records.
- `req.swell.transaction([{ method, url, data }, ...], { retry })` — multi-operation write (`POST /:transaction`, max 10 operations). **Rollback is partial, not total.** A *request* error in any op — not found, permission denied, bad URL, write conflict, timeout — aborts the whole set and throws with a stable code (`transaction_conflict`, `transaction_throttled`, `transaction_timeout`, `transaction_op_failed`) plus `op_index`. A **field-validation** failure does not abort: that op's slot comes back as `{ errors: {...} }` and every other op still commits. Always inspect each returned slot for `errors` — see `swell-backend/references/writes.md` §Transactions. Child operations fire no per-record hooks, functions, webhooks, or notifications — a committed transaction emits one `transaction.committed` event for the bundle.
- `req.data` — trigger payload, and its `$event` shape **differs by trigger**. Async model events: record fields spread in, plus `$event` = `{ id, type, model, app_id, data, delivery }`; `$event.data` carries the full snapshot on `created`/`deleted` and **only changed fields** on `updated` — check `'field' in req.data.$event.data` to detect what changed. Custom events carry the subset declared in the model's event `fields`. `$event.delivery` is per-delivery retry state `{ attempts, date_first_failed }` — `attempts` is `0` on first delivery. Sync hooks (`before:`/`after:`): `$event` = `{ model, type, hook, app_id }` **only** — there is no `$event.data`, so `'field' in req.data.$event.data` throws; detect changes by comparing `req.data.<field>` against `req.data.$record.<field>`. Cron: empty. Routes: see route reference for body/query precedence.
- `req.appId` — current app identifier. Use instead of hardcoding.
- `req.store` — store metadata including `admin_url`.
- `req.session` — user session (routes only); `null` unless the storefront gateway attached one, so gate with `req.session?.account_id`.
- `req.context.waitUntil(promise)` — run work after the response returns (logs, metrics, non-blocking side effects); the Worker continues until the promise resolves or CPU time expires.
- `await req.swell.settings()` — app settings from `./settings/`. Pass another app's id to read its settings cross-app.
- `req.isLocalDev` — `true` under `swell app dev` (set at runtime from the `Swell-Local-Dev` header), useful for dev-only branches. It is **not declared on `SwellRequest` in `@swell/app-types` ≤1.2.4**, so `npm run typecheck` fails Gate 3 with TS2339 — read it through a cast: `const isDev = (req as any).isLocalDev === true;`

**Writing to standard model extensions** — namespace under `$app` via `req.appValues`. Pass `(otherAppId, values)` to target another app:

```typescript
await req.swell.put(`/products/${id}`, req.appValues({ review_count: 42, average_rating: 4.5 }));
```

Extension fields come back under `$app.<app_id>.*` automatically — no explicit `expand` needed — **on the Backend API and inside app functions only.** They are **not readable from the Frontend API** by default, whatever `"public": true` says on the field: the storefront gateway projects every read through a per-model field allowlist, and the allowlist it builds for a store's own public key contains no `$app` path at all. The field simply comes back absent — no error, no 403 — so a storefront feature built on it fails while every secret-key check passes. Three real options, most portable first: put the storefront-visible data in the app's **own collection** with `public_permissions` (see Data Models) and attach it per product with an `include` sub-query; return it from a `public: true` route function; or have the merchant extend that **public key record's** own field permissions to allow the `$app` path. Do not verify this with `swell api … --api frontend` inside an app repo — that call authenticates with the *installed app's* public key, which does merge app fields into the model config and will show the field that a real storefront cannot see. Check with the store's own public key (a swell-js call) instead.

For app-defined collections, write directly at the root.

Writes to `$app` **deep-merge** with the stored subdocument — fields you don't send are preserved. To replace outright, use the `$set` operator: `{ "$app": { "$set": { "my_app": {...} } } }` replaces the whole app subdocument; `{ "$app": { "my_app": { "$set": { "config": {} } } } }` replaces a single field without merging into its prior value. Arrays deep-merge too, and never shrink on a plain write. Elements **with** an `id` align by id: a matching stored element merges in place, an unknown id appends. Elements **without** an `id` merge **positionally** — source index `i` merges into stored index `i` regardless of what is there, and appends only past the end of the stored array. So a plain write of `[{qty: 2}]` rewrites the first stored element rather than adding one. Append with `$push`; replace with `$set`.

### Return values and errors

Plain object → JSON 200. String → `text/plain` 200. For custom status/headers, return `new SwellResponse(data, { status, headers })` (preferred over native `Response`). Throw `SwellError(msg, { status })` to error; on event-triggered functions, add `retry: false` to record the failed delivery without scheduling further retries. In `before:` hooks, thrown errors do **not** block the mutation — throw `req.reject(code, message, { status })` to reject the write (see `references/functions-hooks.md`). Errors from `req.swell.*` expose `error.status` (HTTP status) and `error.body` (structured payload) — don't parse `error.message`. Model and cron handlers typically return nothing.

### Local testing

Run `swell app dev` as a background process (one app per session) to stream function execution to your terminal. Trigger model events and hooks via `swell api [post|put|delete] /<collection>` — those are the invocation paths the tunnel actually captures. Routes are **not** tunneled: `swell api [method] /functions/<app_id>/<function_name> --body '{...}'` reaches the deployed worker, so push before testing a route change, or call the local dev URL directly and accept that it skips context initialization (settings, session). Caveat: `req.session` is **`null`** when a route is invoked through `swell api` — the CLI's `$call` path sends no `Swell-Session` header, and only the storefront gateway attaches one. Every `session?.account_id` gate therefore rejects. Simulate one with `-H 'Swell-Session: {"account_id":"..."}'`, or verify customer-scoped auth through the storefront gateway or integration tests.

## Settings

Settings define merchant-configurable app behavior in `./settings/*.json`. Values are accessible in functions via `await req.swell.settings()` and in model/content conditions via `$settings`.

Each settings file creates a grouped panel in the App Preferences UI. Structure: `label` (panel heading), `description` (explanatory text), and `fields` (array using content field syntax). Multiple files render as grouped panels. Settings returned by `swell.settings()` are namespaced under the filename, but the CLI converts `_` to `-` first: `settings/new_section.json` deploys as the group `new-section`, read as `settings['new-section'].<field>` — `settings.new_section` is `undefined`. Name settings files in kebab-case so the group key matches the filename exactly. `field_group` does not introduce nesting—its child fields are flattened to the parent level. Select-style fields require `options` entries as `{ "value": …, "label": … }` objects — bare strings fail validation. Inspect the deployed record with `swell inspect settings --app=.`; an app's settings files collapse to one platform record at push time.

**There are no environment variables or secrets.** Settings are a function's only configuration channel, and they are not a secret store:

- The deployed worker is uploaded with **no Cloudflare bindings** (upload metadata carries only `body_part`, `tags`, `annotations`) and the runtime wrapper discards the env argument, so `env.MY_SECRET` is undefined. `process.env` does not exist either — functions run service-worker format with no `nodejs_compat`.
- `.dev.vars` is **never uploaded** — `swell app push` ignores `**/.dev.vars*`. It feeds the `frontend/` wrangler dev server only.
- The settings schema has **no secret or password field type** (core types `short_text`, `select`, `boolean`, … plus UI aliases `text`, `dropdown`, `email`, …); the only access flags are `public` (expose to the storefront API) and `private` (restrict from it). A provider credential is an ordinary `short_text` — an unmasked input in App Preferences, stored as a normal record value.
- Settings are **not isolated per app**. `await req.swell.settings('<other_app_id>')` is a plain `GET /settings/<id>` sent with the caller's own app credentials, and an app with an empty `permissions` array — the `swell create app` default — is authorized for everything. Assume any other installed app can read your provider credentials.
- Rotation is a merchant action in App Preferences; there is no separate store to purge and no versioning of old values. A secret the merchant must not see has to live in your own service and be called out to — never bundle it into the app, where it ships inside the deployed worker script.

## App Permissions

`swell.json`'s `permissions` array scopes the API credentials the platform mints for the installed app. `swell create app` writes `"permissions": []`, and **an empty or absent array means full access** — entries only ever subtract capability.

Entries are `read_<model>` / `write_<model>` against the **top-level collection**: `read_products`, `write_orders`. `write_x` implies `read_x`. Child collections collapse to their parent, so `/products:variants` and `/products:apps.<app_id>.<name>` are both covered by `products`. The CLI validates only that the value is an array — there is no enum, so a typo like `products_read` deploys clean and grants nothing.

- **Scoping breaks `/:batch` and `/:transaction`.** The wrapper URLs map to no permission name, so once `permissions` is non-empty every `req.swell.transaction([...])` fails with 403 `The client does not have the required permissions` before any child op is evaluated. If the app uses transactions, leave `permissions` empty.
- Exempt regardless of scope: your app's own declared collections (matched by model config name — which is why the auto-scoped `req.swell.get('/reviews')` keeps working), and `/:details` + `/:logs`.
- **The `/apps` + `/settings` exemption is narrower than it looks.** It string-compares the path segment against the app's canonical 24-character record id, but `req.swell.settings()` sends the app **slug** (`req.appId`, from the `Swell-App-Id` header). Slug ≠ ObjectId, so the exemption misses and the call falls through to a `read_settings` check: on any app with a non-empty `permissions` array, `await req.swell.settings()` 403s unless you grant `read_settings` (and `read_apps` to read your own app record by slug). Another reason to leave `permissions` empty.
- **Changing `permissions` between released versions rotates the installed app's keys.** The platform snapshots the previous permissions with the previous `access_token` and `public_key` into `versioned_permissions` and mints a new pair; the old key keeps authenticating with the *old* scope, so a stale key that "still works" may be silently under-scoped. Re-read the app's keys after any permissions change. Development installs (`swell app push`) re-sync permissions in place instead of rotating.

Declare permissions when the app is distributed to stores you do not control and the scope should be on record. For a store-local app, empty is both the default and the working configuration — do not add entries "to be safe".

## Webhooks

Webhooks send model events to external endpoints in `./webhooks/*.json`. Use when event handling logic lives outside Swell; for Swell-hosted logic, prefer functions. Webhooks subscribe to async events only — the `before:`/`after:` hook prefix is rejected at deploy; use a function for synchronous hook semantics.

**`enabled` defaults to `false`.** `swell create webhook … -y` writes `enabled: false` unless you pass `--enabled`, and the interactive prompt defaults to No. A disabled webhook deploys cleanly, appears in `swell inspect webhooks`, and never fires — set `"enabled": true` in the manifest before pushing and confirm the deployed value in detail mode.

The payload is the event record plus two `$`-prefixed additions: `id`, `date_created`, `model`, `type`, `data` (record snapshot or changed fields), `app_id`, `req_id`, `user_id`, plus `$type` (fully qualified event type — `<model>/<type>`, or `$app.<app_id>.<model>/<type>` for app events) and `$delivery` (`{ attempts, date_first_failed }`, `attempts` is `0` on first delivery). The environment arrives as the `Swell-Env` **request header**, not in the body, and **no store identifier is sent at all** — use a per-store endpoint URL if the receiver serves multiple stores. Requests time out after 10 seconds—endpoint must return a 2xx. Retries: the first retry comes ~1 minute after failure, then exponentially spaced attempts (roughly 10 per day) with a ~12-hour gap between daily cycles.

**Recovering an auto-disabled webhook.** After ~4 consecutive days of failures with no success the platform sets `enabled: false` alongside `auto_disabled: true`, and dispatch tests only `enabled`. Setting `enabled` back to true is what revives it — the platform then replays all pending events and clears `auto_disabled`. For an app-owned webhook that flip rides on re-installing the manifest, i.e. `swell app push`, and push skips files whose hash is unchanged: fixing the endpoint without touching `webhooks/*.json` leaves the webhook dark. Use `swell app push --force`, exactly as with an auto-disabled function, then confirm `auto_disabled` cleared with `swell inspect webhooks <key>`. List mode (`swell inspect webhooks --app=.`) surfaces auto-disable status, subscribed events, and failure counts.

Swell sends **no payload signature or HMAC header** — the only platform-side identity signals are the source IP and `Swell-Env`. A shared secret in the URL query string is the app-side workaround: validate it server-side *and* allowlist Swell's published webhook IPs. Treat payload contents as untrusted either way — re-fetch by `data.id` before acting.

## Notifications

Transactional emails in `./notifications/`, as a paired `<name>.json` manifest and `<name>.tpl` Liquid template sharing one basename. Consult `swell schema notification --format=dts` for every property.

Three things decide whether one ever sends:

- **Dispatch is create/update only.** `deleted` is accepted by the schema and never fires.
- **The `event` must already exist** — a standard `created`/`updated`, or a custom event declared in the collection's data model. Binding to an undeclared event fails the deploy.
- **Recipients resolve through the query.** `contact` is a dot path to an email field (`account.email`), and every relationship in that path must appear in `query.expand`.

Verify the deployed `(model, name)` binding with `swell inspect notifications --app=.`; name alone is not unique within an app. Template authoring — Liquid syntax, the `settings`/`store`/`get` globals, admin-editable `content` fields, child-collection `parent` access, and repeat/dispatch controls — is in `references/notifications.md`.

