---
name: swell-app
description: Use this skill for building, modifying, or debugging a Swell App — modular extension packages for the Swell headless e-commerce platform deployed via the `swell` CLI. Triggers include any mention of "Swell" or `swell.json`; use of `swell` CLI commands (`swell app push`, `swell create`, `swell inspect`, `swell schema`, `swell api`, etc.); Swell-specific directories (`./models/`, `./content/`, `./functions/`, `./settings/`, `./notifications/`, `./webhooks/`); FQN shapes like `apps/<app_id>/<collection>` or `$app.<app_id>.*`-namespaced fields; Swell event conventions (`review.created`, `before:`/`after:` model hooks, model schedules, cron, HTTP routes at `/functions/<app_id>/<name>`); or integration apps with payment / shipping / tax extension slots and Preact checkout components. Do NOT use for other e-commerce platforms or for generic Cloudflare Workers questions unrelated to Swell.
allowed-tools: Read, Grep, Glob, Bash
---

# I. System Architecture & Environment

A Swell App is a modular extension package for the Swell headless e-commerce platform, deployed via CLI to inject custom data schemas, admin interfaces, serverless logic and other resources into a store environment.

## The File System Contract

The file system acts as a rigid configuration contract. The existence and naming of a file directly determines its runtime behavior, API endpoint, and whether it creates a new resource or modifies an existing one.

- **App Identity.** The `./swell.json` manifest defines the App ID (referenced as `<app_id>` throughout this document), name, type, version, and platform permissions. Apps with `"type": "integration"` and/or `extensions[]` declare platform integration slots — see "Integration Apps & Extensions" below.

- **Assets.** Static resources such as the dashboard icon are stored in `./assets/`.

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

The Swell CLI orchestrates the complete development cycle. Commands follow consistent patterns across resource types, enabling a tight feedback loop: discover → scaffold → validate → deploy → verify.

All commands accept `--help` for detailed usage. Interactive commands accept `-y` to skip prompts.

**Inspection** — `swell inspect {content|extensions|functions|models|notifications|settings|webhooks}` inspects remote (deployed) resources. List mode (no argument) groups resources by app. Always discover via list mode, copy the identifier from column 1, and paste it unchanged into detail mode — do not construct identifiers by hand, since shapes vary by resource type. Detail mode prints the full record JSON followed by a `Next steps:` footer of runnable follow-up commands. Add `--app=.` to scope to the app in the current `swell.json`. Use list mode for discovery and to avoid duplicating standard resources; use detail mode after `swell app push` to verify deployed configuration and runtime state.

**Schema Reference** — `swell schema {content|function|model|notification|setting|webhook} --format=dts` prints annotated TypeScript declarations with examples. This is the authoritative reference for schema-backed JSON structure. Always consult before authoring supported manifests—guessing field names or structure leads to validation failures.

**Scaffolding** — `swell create {content|function|model|notification|setting|webhook|tests} [args] [flags] -y` generates new resources with correct structure. Output passes schema validation and provides a working starting point. See --help for command args and flags.

**Integration App Creation** — Use `swell create app <id> --type integration --integration-type <generic|payment|shipping|tax> --integration-id <id> -y` for integration apps. Payment integrations use `--integration-id card` for card processing, or a custom id for alternative payment methods. Shipping and tax integrations use a unique custom id. Generic integrations do not create an extension slot.

**Validation** — `swell schema {content|function|model|notification|setting|webhook} ./path/file` validates schema-backed manifests. Run `swell schema --help` first and use schema validation for every resource type the installed CLI supports. For resources not supported by `swell schema` in the current CLI, such as `components/` or `swell.json` in this branch, rely on TypeScript/bundling checks and `swell app push` against a test environment.

**Deployment** — `swell app push` deploys all app resources. The platform runs additional validation; errors here indicate issues local validation cannot catch (e.g., references to non-existent collections). Use `--force` to re-deploy unchanged files.

**Local Development** — `swell app dev` starts a local tunnel in watch mode, connecting to the platform's test environment. Functions execute locally, fired by triggers at the platform side. Console output appears in your terminal. Note: direct localhost calls to route functions skip context initialization (settings, session etc). Use collections and functions calls over the `swell api` commands or integration tests for firing local functions through the platform for a full context initialization.

**Observability** — `swell logs [-f] [--type function] [--app <id>] [-s <kw>] [--env <id>]` queries or follows (`-f`) remote logs for functions, webhooks, and API calls. Default env is `test`; pass `--env live` for production. Function entries include status, response, errors, and `console.log/warn/error` output captured automatically from each invocation. Complements `swell app dev`, which only streams local execution.

**Data Operations** — `swell api {get|post|put|delete} /<path>` performs CRUD against the platform. Standard collections: `swell api get '/products?limit=1'`. App collections: `swell api get '/apps/<app_id>/<collection>'`. App collections, declared as children in the standard collection: `swell api get '/products:apps.<app_id>.<collection>'`. App functions `swell api get '/functions/<app_id>/<name>'`. Use `--body` for payloads: `--body '{"name":"Test"}'` or `--body ./fixture.json`.

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

For new schema-backed resources, scaffold with `swell create {content|function|model|notification|setting|webhook} [name] [flags] -y`. IMPORTANT: Do not hand-author these resources when a scaffold command exists. Use kebab-case for resource naming. Explore `--help` for resource-specific flags. Edit the resource to implement your requirements. Validate resource with `swell schema {type} ./path/file`. For functions and components, also run `npm run typecheck` when configured. Iterate until zero errors.
Pass: Local validation passes with zero errors. TypeScript compiles without errors.

## Gate 4 — Deploy & Verify

Push resources to the platform test environment with `swell app push`. The platform performs additional validation beyond local schema checks: reference integrity (e.g., links to non-existent collections), reserved field conflicts, and event binding validity. Deployment errors indicate issues local validation cannot catch. Verify deployment with `swell inspect <type> --app=.` for list-level state (enabled, trigger, failure indicators) and `swell inspect <type> <key>` for the full record. For runtime probing, paste the commands printed under `Next steps` (e.g. `/events`, `/events:webhooks`) rather than constructing event or log queries by hand. For integration apps, also run `swell inspect extensions --app=.` and act on `action_owner`/`action` per `references/app-integrations.md`.
Pass: Deployment completes without errors. List-mode meta shows the resource enabled with the expected trigger/binding; detail-mode JSON matches the source manifest.

## Gate 5 — Test

Confirm the resource behaves as designed under realistic conditions. Actions depend on resource type you are going to test:

- Event-driven resources (model-triggered functions, webhooks, notifications): Trigger via `swell api [post|put|delete] /apps/<app_id>/<collection>` with payloads matching event conditions (model events propagate asynchronously).
- Route functions: Call via `swell api [get|post|put|delete] /functions/<app_id>/<function_name>` with appropriate `--body`.
- Data models: Execute create → read → update → delete cycle via `swell api` or integration test. Test relationship expansion with `?expand=`.
  Pass: Resource produces expected behavior. For testable resources, integration tests in `./test/integration/` pass and provide regression coverage.

Note: Consider formalizing your tests in unit and integration tests of the app. Scaffold tests with `swell create tests` if necessary.

# IV. Resources best practices

## Data Models

Data models define the database schema in `./models/*.json`, where filename matches collection (`products.json`). Remote (deployed), models can be inspected with `swell inspect models /products` (standard) or `/apps/<app_id>/<collection>` (app). This section covers dev cycle that extends standard collections or creates new app-specific ones.

**Decision Guide:**

- [ ] **Extend a standard model** when data logically belongs to an existing entity: review scores on products, loyalty tiers on accounts, fulfillment metadata on orders. Fields merge into the record under `$app.<app_id>.*` and are queryable on the standard list endpoints (`where` on `$app.<app_id>.<field>` paths, including inside `$and`/`$or`). Benefits: seamless admin integration, no new API surface, automatic association with platform workflows.

- [ ] **Create a new app model** when data requires independent lifecycle, dedicated events, distinct public permissions, or has no natural parent. Reviews, wishlists, vendor profiles fit here. The collection lives at `apps/<app_id>/<collection>` and requires explicit relationship links.

- [ ] **Use a child collection** when data is tightly scoped to a parent and should not exist independently. Declare with `"type": "collection"` containing nested `fields`. Children share the parent's API path. Child collections declared in a standard-model extension live at `/<collection>:apps.<app_id>.<name>`, expand into the record under `$app.<app_id>.<name>` (not the record root), fire events under the parent model's event root (`before:product.<name>.created`), and are deleted automatically when the parent record is deleted.

Relationships require two fields: an `objectid` stores the reference; a `link` declares the target and enables expansion.

```json
{
  "product_id": { "type": "objectid", "required": true },
  "product": { "type": "link", "model": "products", "key": "product_id" }
}
```

For app model targets, use FQN: `"model": "apps/<app_id>/vendors"`. For child collections: `"model": "products:variants"` or `"model": "apps/<app_id>/vendors:locations"`.

Link fields declared in a standard-model extension expand via `?expand=$app.<app_id>.<field>`. Link resolution sees both your app's fields and the parent record's native fields (app fields win on name collisions) — but inside an app link's `key` or `params`, `id` always refers to the **parent record's** id, so key links off a dedicated app field (e.g. `channel_id`), never `id`.

Events enable function triggers on record changes. Public permissions control frontend API access. Both are declared in the model JSON. Consult `swell schema model --format=dts` for structure, field options, and condition syntax.

## Content Models

Content models configure Admin Dashboard views in `./content/*.json`. They control how merchants interact with data: list columns, form layouts, navigation, and input behavior. As established in Section I, content models map to data model Resource IDs and define UI logic only; data logic belongs in `./models/*.json`. Content field ID must correspond to a data model field.

**Decision Guide:**

- [ ] **Augmenting standard models** applies when adding UI for fields on existing platform entities. For standard model extensions, `admin_zone` places fields within existing editor sections (e.g., `"admin_zone": "details"` on products); invalid zone values cause fields to silently disappear, so verify against `swell schema content --format=dts`. Alternatively, declare `tabs` in the edit view to add custom tab panels alongside native tabs. Extensions merge with existing UI rather than replacing it: `edit.tabs` adds alongside native tabs, `list.fields` appends to existing columns, and `list.tabs` introduces additional filtered views. Tab and view `query.where` may mix your app's extension fields (bare keys, auto-namespaced to `$app.<app_id>.*` by model metadata) with native model fields, recursing into `$and`/`$or`/`$nor`. Merchants can reorder or hide these additions in their dashboard preferences.

- [ ] **Creating app model views** applies to app-defined collections. Include `nav` in the list view to place the collection under a parent section in the sidebar; omitting `nav` positions it at the top level. `nav` possible values are pre-configured and you can not create a new nav section. For app-defined collections, control layout entirely through views—`admin_zone` has no effect.

Content models declare up to three views: `list` (table columns, sort, filters, navigation), `edit` (form layout for existing records), and `new` (creation form). When creation and editing share identical layouts, a single `record` view can replace both.

Fields declared in views inherit properties from matching top-level field definitions by `id`. A view field `{ "id": "rating" }` acquires label, type, and constraints from the top-level `"rating"` entry. Override selectively per view—for instance, a shorter label in list columns versus the full label in edit forms.

Layout uses `field_row` for horizontal arrangement and `field_group` for collapsible sections—both require a `fields` array (omitting it fails validation). Width is controlled via `admin_span` (1–4 on a 4-column grid). Conditions control field visibility using MongoDB-style operators: equality (`"status": "approved"`), negation (`"rewarded": { "$ne": true }`), comparison (`"count": { "$gt": 0 }`), and app settings references (`"$settings.feature.enabled": true`). Multiple conditions are AND-ed.

A field's `readonly` accepts a boolean or a condition expression with the same operators and scopes as `conditions` (record fields, `$settings.*`, other apps' `$app.<app_id>.<field>`) — the field becomes non-editable while the expression matches. This gates dashboard editing only; direct API writes still succeed, so enforce integrity in model rules or app functions. Record-view actions render only when not `hidden` and their `conditions` match the current record (record fields only — no `$settings`); conditions on list-view bulk actions are not evaluated.

The `collection` content type creates inline references to other collections without duplicating data. Declare with `"type": "collection"`, target via `"collection": "products"` (or `"products:variants"` for child collections), and define the join with `"link": { "params": { "account_id": "id" } }`. This renders as a filterable list widget in the edit view.

For field types, input widgets, and all property options, consult `swell schema content --format=dts`.

```json
{
  "collection": "products",
  "fields": [
    {
      "id": "seller",
      "type": "lookup",
      "label": "Seller",
      "model": "apps/my_app/sellers",
      "key": "seller_id"
    }
  ],
  "views": [
    {
      "id": "edit",
      "tabs": [
        {
          "id": "seller_info",
          "label": "Seller Info",
          "fields": [
            { "id": "seller" }
          ]
        }
      ]
    }
  ]
}
```
Note that lookup type can be set to the fields, declared with `"type": "link"` at the data model.

## Functions

Functions implement serverless logic in `./functions/*.ts`. Each file exports a `config` object specifying exactly one trigger (`model`, `route`, or `cron`) and a handler; a separate beta `workflow` kind exists behind a per-store feature gate (see trigger selection). Run `swell schema function --format=dts` for the authoritative type declarations — that schema is the post-decision shape reference for everything below.

**Cross-cutting constraints.** Functions time out at 10s by default (configurable via `config.timeout`, 1000–10000 ms; values up to 20000 ms require platform feature enablement). Response bodies above 75 KB are silently dropped — paginate large collections rather than returning them. Model-event functions that fail continuously for ~4 days (2 days if `timeout` >10s; immediately on 404/worker-missing) auto-disable until redeployed via `swell app push`; cron and routes are unaffected. Use `swell inspect functions --app=.` to surface auto-disable status, trigger summary, and last failure date at a glance.

### Trigger selection

> **Integration apps**: platform-owned extension events (`payment.create_intent`, `payment.charge`, `payment.refund`, `order.shipping`, `order.taxes`) are model hooks with `config.extension` set and platform-filtered dispatch — see `references/app-integrations.md` for binding rules and the type-specific reference for the hook contract. Authoring then follows the **Model hook (sync)** path below.

- **Model event (async)** — fires after a record mutation persists. Use for downstream effects: denormalization, fan-out, analytics.
- **Model hook (sync)** — `before:` / `after:` prefix on a model event runs synchronously inside the originating API request, can read the pre-mutation record, and (in `before` phases) can mutate what gets saved. → see `references/functions-hooks.md` once chosen.
- **Model schedule** — fires at a future date derived from a record field; re-schedules when the field changes.
- **Cron** — fixed cron schedule, no record context.
- **HTTP route** — custom endpoint at the fixed path `/functions/<app_id>/<function_name>`. No URL path parameters (no `/users/:id`-style routing); pass identifiers via query or body. → see `references/functions-routes.md` once chosen.
- **Workflow (Beta, feature-gated)** — `kind: 'workflow'`: durable multi-step background function with retriable steps and long sleeps. Available only on stores where Swell support has enabled the feature — do not propose workflows unprompted; use only when the user explicitly requests them or the store is confirmed enabled. → see `references/functions-workflows.md` once chosen.

**Model Event Triggers** respond to record changes. Standard events (`created`, `updated`, `deleted`) exist on all models by default. Custom events (e.g. `review.approved`) must be declared in the data model first.

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
- `req.swell.transaction([{ method, url, data }, ...], { retry })` — atomic multi-operation write (`POST /:transaction`, max 10 operations); if any operation fails, the whole transaction rolls back. Errors carry stable codes (`transaction_conflict`, `transaction_throttled`, `transaction_timeout`, `transaction_op_failed`) plus `op_index` identifying the failed operation. Child operations fire no per-record webhooks or app functions — a successful transaction emits one `transaction.committed` event for the bundle.
- `req.data` — trigger payload. Model events: record fields spread in, plus `$event` metadata `{ id, type, model, app_id, data }`. `$event.data` carries the full snapshot on `created`/`deleted` and **only changed fields** on `updated` — check `'field' in req.data.$event.data` to detect what changed. Custom events carry the subset declared in the model's event `fields`. `$event.delivery` carries per-delivery retry state `{ attempts, date_first_failed }` — `attempts` is `0` on first delivery. Cron: empty. Routes: see route reference for body/query precedence.
- `req.appId` — current app identifier. Use instead of hardcoding.
- `req.store` — store metadata including `admin_url`.
- `req.session` — user session (routes only).
- `req.context.waitUntil(promise)` — run work after the response returns (logs, metrics, non-blocking side effects); the Worker continues until the promise resolves or CPU time expires.
- `await req.swell.settings()` — app settings from `./settings/`. Pass another app's id to read its settings cross-app.
- `req.isLocalDev` — `true` under `swell app dev`; useful for dev-only branches.

**Writing to standard model extensions** — namespace under `$app` via `req.appValues`. Pass `(otherAppId, values)` to target another app:

```typescript
await req.swell.put(`/products/${id}`, req.appValues({ review_count: 42, average_rating: 4.5 }));
```

Extension fields appear in responses under `$app.<app_id>.*` automatically — no explicit `expand` needed. For app-defined collections, write directly at the root.

Writes to `$app` **deep-merge** with the stored subdocument — fields you don't send are preserved. To replace outright, use the `$set` operator: `{ "$app": { "$set": { "my_app": {...} } } }` replaces the whole app subdocument; `{ "$app": { "my_app": { "$set": { "config": {} } } } }` replaces a single field without merging into its prior value.

### Return values and errors

Plain object → JSON 200. String → `text/plain` 200. For custom status/headers, return `new SwellResponse(data, { status, headers })` (preferred over native `Response`). Throw `SwellError(msg, { status })` to error; on event-triggered functions, add `retry: false` to record the failed delivery without scheduling further retries. Errors from `req.swell.*` expose `error.status` (HTTP status) and `error.body` (structured payload) — don't parse `error.message`. Model and cron handlers typically return nothing.

### Local testing

Run `swell app dev` as a background process (one app per session) to stream function execution to your terminal. Trigger model events via `swell api [post|put|delete] /<collection>`; call routes via `swell api [method] /functions/<app_id>/<function_name> --body '{...}'`. Caveat: `req.session` under `swell api` is the CLI admin session, not a storefront customer session — verify customer-scoped auth (e.g. `session?.account_id` gates) via integration tests.

## Settings

Settings define merchant-configurable app behavior in `./settings/*.json`. Values are accessible in functions via `await req.swell.settings()` and in model/content conditions via `$settings`.

Each settings file creates a grouped panel in the App Preferences UI. Structure: `label` (panel heading), `description` (explanatory text), and `fields` (array using content field syntax). Multiple files render as grouped panels. Settings returned by `swell.settings()` are namespaced under the filename (e.g., for `settings/new_section.json`, access values via `new_section.<field>`). `field_group` does not introduce nesting—its child fields are flattened to the parent level. Inspect the deployed record with `swell inspect settings --app=.`; an app's settings files collapse to one platform record at push time.

## Webhooks

Webhooks send model events to external endpoints in `./webhooks/*.json`. Use when event handling logic lives outside Swell; for Swell-hosted logic, prefer functions. Webhooks subscribe to async events only — the `before:`/`after:` hook prefix is rejected at deploy; use a function for synchronous hook semantics.

Payloads include event type, record data, store ID, and environment. Requests timeout after 30 seconds—endpoint must return HTTP 200. Retries use exponential backoff: initial retry within 1 minute, extending to 12-hour intervals after 10 failures. Webhook auto-disables after 7 days of failures; re-enabling retries all pending events. Use `swell inspect webhooks --app=.` to surface auto-disable status, subscribed events, and failure counts.

Embed API secrets directly in the URL query string. Validate the secret server-side when receiving requests.

## Notifications

Notifications are transactional emails triggered by model events, defined in `./notifications/` using a paired-file convention: a JSON manifest (`<name>.json`) and a Liquid template (`<name>.tpl`) must share the same base filename. Consult `swell schema notification --format=dts` for all configuration properties.

**Event binding.** The `event` property must reference either a standard event (`created`, `updated`, `deleted`) or a custom event already declared in the collection's data model. Attempting to bind to an undeclared custom event causes deployment failure. Verify the deployed `(model, name)` binding with `swell inspect notifications --app=.`; the list key includes the model since name alone is not unique within an app.

**Recipient resolution.** Set `contact` to a dot-notation path resolving to an email field (e.g., `"contact": "account.email"`), or set `admin: true` for store administrator delivery. Critical: any relationship in the contact path must appear in `query.expand`—`"contact": "account.email"` requires `"expand": ["account"]`.

**Child collections.** Use colon notation for the collection (`"collection": "reviews:comments"`). In templates, the parent record is accessible via the `parent` variable; expand upward with `"expand": ["parent", "parent.product"]`.

The `.tpl` file uses Liquid syntax. Record fields are accessed directly (`{{ product.name }}`), child collection parents via `{{ parent.field }}`. Three global objects are available in all templates:

`settings` — App settings from `./settings/`, enabling conditional content: `{% if settings.rewards.enabled %}...{% endif %}`.

`store` — Store metadata: `name`, `url`, `logo`, `currency`, `support_email`.

`get(url, data)` — Helper for fetching additional Swell data during rendering.

Admin-editable fields defined in the manifest's `fields` array are accessed via `{{ content.field_id }}`. Standard Liquid filters apply: `{{ date_created | date: '%b %d, %Y' }}`, `{{ amount | currency }}`.

Build templates with MJML for cross-client email compatibility, then convert to HTML.
