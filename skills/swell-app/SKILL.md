---
name: swell-app
description: Use this skill for building, modifying, deploying or debugging a Swell App — a package the `swell` CLI deploys to a Swell store to add data models, dashboard views and actions, serverless functions and workflows, settings, notifications, webhooks, and an optional web frontend that Swell hosts. Covers `admin` and `integration` apps (including payment / shipping / tax extensions and dashboard frontends) and `storefront` apps — a store's own site written in code and hosted by Swell. Triggers include `swell.json`; app-lifecycle `swell` CLI commands (`swell app push`, `swell app dev`, `swell app pull`, `swell app version`, `swell create`, `swell inspect`, `swell schema`, `swell logs`); app directories (`./models/`, `./content/`, `./functions/`, `./settings/`, `./notifications/`, `./webhooks/`, `./components/`, `./frontend/`); FQN shapes like `apps/<app_id>/<collection>` or `$app.<app_id>.*`-namespaced fields; Swell event conventions (`review.created`, `before:`/`after:` model hooks, model schedules, cron, HTTP routes at `/functions/<app_id>/<name>`); and `@swell/apps-sdk` in an app frontend. Do NOT use for Proxima / Liquid theme authoring (`theme` apps, `swell theme *`, the dashboard theme editor), other e-commerce platforms, or generic Cloudflare Workers questions unrelated to Swell. Commerce operations themselves belong to the API skills — swell-frontend-api for the Frontend API and `swell-js` (also for a storefront hosted outside Swell), swell-backend-api for Backend API semantics, swell-node, data scripts and one-off `swell api` reads/writes.
allowed-tools: Read, Grep, Glob, Bash
---

# Swell apps

A Swell app is a package of files that the `swell` CLI deploys to a store. It adds data, dashboard screens, server logic and, optionally, a web frontend. Swell hosts all of it and issues the app's credentials: the developer runs no server and stores no API key. This is the recommended way to build on Swell.

Two things are built differently and are outside this skill: an integration that runs on the developer's own infrastructure with a store's secret key (the `swell-backend-api` skill), and a storefront hosted outside Swell (the `swell-frontend-api` skill). Those skills also own the commerce operations an app performs — what a cart or an order contains, how queries and writes behave. This skill covers the app around them.

`<app_id>` below is the `id` in `swell.json`.

## App types

| `type` in `swell.json` | What the app is |
| --- | --- |
| `admin` | Extends a store: data, dashboard views and actions, server logic, and optionally custom dashboard pages |
| `integration` | The same blocks, for an app that connects the store to an outside service. It can declare extension slots that plug into Swell's own payment, shipping or tax flows — see "Integration apps and extensions" |
| `storefront` | The store's own site for shoppers, written in code in `frontend/` and hosted by Swell |
| `theme` | A Proxima / Liquid theme. Not covered by this skill or by another Swell skill — say so instead of answering from app rules |

## Choose the building block

An app is assembled from the blocks below. Start from the need, pick the smallest block that covers it, and read that block's entry under "Building blocks" for its limits before designing around it.

| Need | Block |
| --- | --- |
| Keep extra data on products, orders, customers or another standard record | Model that extends the standard collection |
| Keep a new kind of record | Model for an app collection, or a child collection of a parent |
| Let merchants list, filter, create and edit that data in the dashboard | Content views |
| A dashboard button that does something to a record, to selected rows or for the app | Action |
| React after a record changes | Function on a model event (async) |
| Validate, change or reject a write before it is saved | Function as a `before:` hook (sync) |
| Do something at a date stored on a record, or on a fixed schedule | Function with a model schedule, or a cron function |
| An HTTP endpoint for a storefront or another system to call | Route function |
| Background work in several steps that is long, waits, or must survive a failure | Workflow |
| Tell an external service that something happened | Webhook; a function when the call needs logic, signing or a custom payload |
| Send an email when a record is created or changes | Notification |
| Let the merchant configure the app, including provider credentials | Settings |
| A dashboard screen that views and actions cannot express | Frontend of an `admin` or `integration` app |
| The store's own site for shoppers | Frontend of a `storefront` app |
| A payment method, shipping rates or tax calculation inside Swell's checkout | Integration extension |
| Put the app in the live environment or in other stores, or list it in the App Store | Versions and releases — `references/app-publishing.md`. `swell app push` reaches the test environment only |

## Building blocks

Each folder holds one kind of block, and a file's name decides what it becomes: its collection, its endpoint, its settings group. Push removes a deployed resource whose file is gone, so renaming a file replaces the resource.

### Manifest — `swell.json`

The app's `id`, `name`, `type`, `version` and `permissions`, plus `frontend.hosting` when there is a frontend and `extensions[]` for integration slots. **Always declare `permissions`**: empty or absent means full access to the store (see "Permissions"). Billing fields (`price`, `price_interval`, `price_trial_days`, `price_external`) and marketing fields are used at release time — `references/app-publishing.md`.

### Data models — `models/*.json`

The database schema. Three shapes:

- **Extend a standard model** (`models/products.json`; `models/accounts.json` for customers): the app's fields merge into the standard record under `$app.<app_id>.*`. Use when the data belongs to an existing entity. `swell inspect models` lists the standard collections.
- **A new app collection** (`models/vendor-profiles.json`, kebab-case): lives at `apps/<app_id>/<collection>` — its Fully Qualified Name, used in links and by anything outside the app. The app's own functions address it by its short path (`/vendor-profiles`). Use when the data has its own lifecycle, events or public access.
- **A child collection** inside either: records that exist only under a parent.

Models also declare relationships (links), formulas, and the custom events that functions, webhooks and notifications subscribe to. Data logic belongs here; how the data looks in the dashboard belongs in content views.

**Nothing is visible to a storefront by default.** An app collection is closed to the Frontend API until the model declares what is public. The declaration can open reads, pin a filter, allow writes to listed fields, and limit a collection to the logged-in customer's own records, for reads and writes alike — so customer-owned data such as a wishlist needs no function. Data that everyone reads and customers submit, such as reviews, takes submissions through a route function. Fields added to a standard model are different: a storefront that uses the store's own public key cannot read them, whatever the field declares — plan storefront-visible data as an app collection or behind a route function.

Read `references/data-models.md` before authoring a model.

### Content views — `content/*.json`

Dashboard screens for a collection: list columns, record forms, tabs, navigation. A content file maps to a standard or an app collection — `content/products.json` adds fields, tabs and columns to the native product screens without replacing them, and merchants can reorder or hide the additions. Content holds UI only: a content field must match a data-model field.

- An app collection appears in the sidebar only when its list view declares `nav`. An app cannot create a new sidebar section.
- Views are lists and record forms. A multi-step flow, a chart or summary across records, a custom layout or an embedded third-party widget needs a frontend.

Read `references/content-models.md` before authoring views; `swell schema content --format=dts` lists every field type and property.

### Actions — declared in content views and settings files

A dashboard button or menu item that runs one of the app's functions or workflows: on a record, on selected rows, among a record's fields, or on the app's own page, optionally after a dialog that asks for inputs. This is how a merchant triggers an operation without a custom frontend.

- An action runs only when a dashboard user clicks it. It cannot be called through the API, by another function or from a storefront, so it needs no authentication code.
- The merchant waits for the result, within the function timeout. Longer work, or a bulk action over many records, runs as a workflow.

Read `references/actions.md` before adding one.

### Functions — `functions/*.ts`

Server logic. Each top-level file is one function with exactly one trigger; shared code goes in subdirectories (`functions/lib/`).

| Trigger | Runs | Scope and limits |
| --- | --- | --- |
| Model event (async) | After a record change is saved | For downstream effects: denormalization, fan-out, sync. Any declared event, standard or custom. Retried on failure |
| Model hook (sync) | Inside the API request, `before:` or `after:` the write | A `before:` hook can change what is saved or reject the write. Apart from the extension events of integration apps, hooks exist for `created`, `updated` and `deleted` only; a prefix on any other event does not behave as it reads. A hook does not run for writes inside a transaction, so back a critical rule with model validation as well. → `references/functions-hooks.md` |
| Model schedule | At a date taken from a record field | Re-schedules when the field changes |
| Cron | On a fixed schedule | No record context |
| HTTP route | On a call to `/functions/<app_id>/<function_name>` | Fixed path, no path parameters. Callers need a key — see below. → `references/functions-routes.md` |
| Dashboard action | When a store user clicks the action | Not callable any other way. → `references/actions.md` |

Calling a route from outside Swell:

- The address is `https://<store>.swell.store/functions/<app_id>/<name>`, and the caller **must send a valid public key in `Authorization` even when the route is `public`**. A storefront can; a third-party service that cannot add that header cannot call a route. Receive such a call on an `/app-api` endpoint of the app's frontend, or on the developer's own service.
- `req.session` holds the shopper's session only when a storefront calls the route at that address.

Limits that hold for every function:

- **Edge runtime (Cloudflare Workers), not Node.js**: Web APIs such as `fetch` and Web Crypto, no Node built-ins.
- **At most 10 seconds.** `config.timeout` can lower it; a longer limit, up to 20 seconds, needs enablement by Swell. Sync hooks are timed separately, 10 seconds unless the app's own model sets otherwise. A response is cut off at 75,000 bytes. Work that does not fit is a workflow; large results are paginated.
- **No environment variables or secrets.** Configuration comes from the app's settings only (see "Configuration and secrets").
- **A function acts as the app**, with the app's `permissions`, whoever or whatever triggered it. `req.swell` is its client to the store's data and follows Backend API semantics.

Read `references/functions.md` before writing a function — the `req` object, payload shapes per trigger, errors, local testing — and the trigger's own reference where the table names one. When a deployed function, hook or webhook does not fire, start with "When a function does not run" there — except for an extension function of an integration app, where `swell inspect extensions` comes first (see "Integration apps and extensions").

### Workflows — `functions/*.ts` with `kind: 'workflow'`

A durable background process: a sequence of steps, each with its own timeout and retry policy, recorded so a completed step never runs twice, and able to sleep for long periods. Use it for work that outlives a function timeout or must survive a failure between steps — a sync to an external system, a long bulk operation, a delayed follow-up.

- Started by another function or by a dashboard action. Nothing else starts one, and a workflow cannot start another workflow.
- Its store client is narrower than a function's: no transactions, and only the app's own settings.
- Workflows do not run under `swell app dev`; they are tested after a push.

Read `references/functions-workflows.md` before writing one.

### Settings — `settings/*.json`

The app's configuration, edited by the merchant on the app's page in the dashboard and read in code with `settings()`. Use it for the merchant's own provider credentials, feature flags and options; model and content conditions can read it as `$settings`. Settings files can also carry actions.

- Values belong to one store and environment. An installed app starts with empty values.
- Settings are the only configuration channel for functions and managed frontends, and they are not a secret store (see "Configuration and secrets").

Read `references/settings.md` before authoring a settings file.

### Webhooks — `webhooks/*.json`

A manifest that makes Swell POST an event to an external URL. Use it when the handling logic lives outside Swell; for logic hosted by Swell, use a function.

- Async events only: a webhook cannot validate or block a write.
- The endpoint must answer within 10 seconds. A failed delivery is retried for days, then the webhook is disabled.
- **Created disabled**: `enabled` is `false` unless the manifest sets it.
- Requests are unsigned and carry no store identifier. The receiver identifies the store by its own URL and re-fetches the record before acting.

Read `references/webhooks.md` before adding one.

### Notifications — `notifications/<name>.json` + `<name>.tpl`

A transactional email: a manifest that binds to a model event, and a Liquid template with the same basename. Sent to an address taken from the record (`contact`) or to the store's administrators.

- Sent on record create and update only. `deleted` is accepted by the schema and never sends; use a function or webhook for that.
- **Once per record by default**: a notification bound to an update sends on the first qualifying update and never again for that record unless `repeat` is set.
- A custom `event` must be declared in the collection's data model. An undeclared one deploys silently and never sends.

Read `references/notifications.md` before authoring one.

### Frontend — `frontend/`

A web app that Swell builds, hosts and connects to the store; `swell app push` deploys it. What it is depends on the app type:

- In an `admin` or `integration` app: custom pages for store users, shown inside the dashboard and opened through links the app declares in its content views and settings. It is the most expensive way to put something in the dashboard — content views and actions come first.
- In a `storefront` app: the store's own site, served at the storefront's address. Commerce calls go through the Frontend API (the `swell-frontend-api` skill).

What decides whether it fits:

- **Scaffold it from a Swell template** and build on its helpers and `@swell/apps-sdk`; do not hand-roll the connection. `swell-vinext` (the Next.js App Router API on Vite, rendered on the server) is the default for both kinds; `swell-react` is for a dashboard app rendered in the browser, with a small Worker for its endpoints.
- **Every address of a frontend is public, and its server code holds the app's credentials.** A dashboard frontend is shown inside the dashboard and also answers at its own address to anyone. Pages and endpoints must check who is viewing — a store user, a customer or a visitor — before returning store data.
- **Managed hosting has a fixed profile**: no custom variables, bindings or secrets, Vinext or React + Vite only, a package of up to 8 MiB. An app that needs more, secrets of its own included, can host its frontend in the developer's own Cloudflare account and stay an app. A site hosted anywhere else is not an app frontend.
- A frontend can also have server endpoints, under `/app-api`. Work that must happen with nobody looking at the frontend — reacting to store events, schedules — belongs in a function.

Read `references/frontend.md` before touching `frontend/`, then `references/frontend-dashboard.md` or `references/frontend-storefront.md` for what is being built.

### Checkout components — `components/*.{jsx,tsx}`

Browser UI for **payment checkout extensions only**: Preact components that Swell's checkout loads for a `payment` extension. No admin, storefront, or shipping/tax host loads app components today. Unrelated to `frontend/`; an integration app may ship both. Read `references/payment-extensions.md` before writing one.

### Assets and tests

- **`assets/`** is the app's only **public** directory: its files are served from an unauthenticated CDN address, while every other file push uploads is stored private. Put nothing there you would not publish. The app's icon and listing images are picked up from it by filename (`icon.*`, `image.*`, `preview.*`), so a rename silently unbinds them — `references/app-publishing.md`.
- **`test/`** holds the Vitest suite: `test/unit/` and `test/integration/`, plus helpers — `mock-request.ts` mocks the function context, and `swell-client.ts` reaches the store through the CLI's login, with no credentials to configure. Scaffold it with `swell create tests`.

## Integration apps and extensions

Integration apps declare extension slots in `swell.json` that the platform binds into native payment, shipping, or tax flows. Branch here when the requested feature is a payment method, shipping service, or tax service, or when `swell.json` has `type: "integration"` or `extensions[]`, when functions set `config.extension`, or when `components/` has top-level `.tsx`/`.jsx` files. Generic integrations (`type: "integration"` without `extensions[]`) need only `references/app-integrations.md`'s manifest section — skip the type-specific references.

Two non-obvious traps distinguish extension work from ordinary app work:

1. **Dispatch is platform-filtered, not condition-based.** A function whose `model.events` match still does not run unless the native settings record selects this app via `extension_app_id`/`extension_config_id` AND the function's `config.extension` matches. Most "function never runs" reports are merchant-activation gaps, not code bugs. Run `swell inspect extensions [--app=.]` (or with `app.<slug>.<extId>` for one extension); each row carries a `status`, an `action_owner` (`dev` | `merchant` | `null`), and an `action` string — route on `action_owner`, surface `action` verbatim when `merchant`.
2. **Binding paths differ by extension type.** Payment alt methods, payment card gateways, shipping carriers, and tax each bind through a different native settings path with a different key shape — never reuse one shape for another.

**Read** `references/app-integrations.md` **first**. **Then** load exactly one of `references/payment-extensions.md` (for `payment`) or `references/shipping-tax-extensions.md` (for `shipping`/`tax`). Do not load the other type's reference.

## Rules that cut across blocks

### Who the code runs as

Functions, workflows and a frontend's Backend client all act as **the app**: they use the credentials Swell issued to the installed app and return the same data whoever triggered them. The person is known separately, and only in some places — a store user in a dashboard frontend and in an action's `$action.user_id`, a customer in a storefront's session and in `req.session` of a route called through the storefront address. Decide what a person may do from that identity, never from an id in the request.

### Permissions

`permissions` in `swell.json` limits those credentials. `swell create app` writes `"permissions": []`, and **an empty or absent array means full access to the store**. Once the array has entries, the app can reach only what they list.

- **Always declare the scopes the app uses and nothing more.** An app left at the scaffold's empty array ships with read and write access to everything, which merchants see at install time and which turns any bug or leaked credential into store-wide exposure.
- Entries are `read_<collection>` and `write_<collection>` for top-level collections (`read_products`, `write_orders`); write implies read. The app's own collections need no entry when addressed by their short path (`/reviews`).
- **Names are not validated.** A typo deploys cleanly and grants nothing. A missing scope shows up at run time as 403 `The client does not have the required permissions`.
- Some calls need a scope that is not obvious: `read_settings` for `settings()`, `write_:transaction` for a transaction, `write_:batch` for a batch, `read_:users` to look up a store user.

Read `references/permissions.md` before declaring permissions or changing them.

### Configuration and secrets

- Settings are the only way to configure deployed code. Functions get no environment variables or bindings, and neither does a managed frontend; local `.dev.vars` and `.env` files are not a way to configure a deployed app.
- A `secret` settings field hides the value in the dashboard. It is stored and returned like any other setting, and other installed apps with access to settings can read it.
- A secret the merchant must not see cannot live in settings, functions or a managed frontend. Keep it in the developer's own service, or in a frontend hosted in the developer's own Cloudflare account. Never put one in app code or in `assets/`.

## CLI

The CLI runs the whole cycle: discover → scaffold → validate → deploy → verify. Every command takes `--help`, and interactive ones take `-y`; read `references/cli.md` before using any of them in anger — the flags are discoverable, the failure modes are not.

| Command | Use it to |
|---|---|
| `swell inspect {content\|extensions\|functions\|models\|notifications\|settings\|webhooks\|workflows\|workflow-runs}` | Read deployed state. List mode discovers, detail mode verifies after a push |
| `swell schema <type> --format=dts` | The authoritative structure for a resource type — consult before authoring |
| `swell schema <type> ./file` | Validate one manifest locally |
| `swell create {content\|function\|model\|notification\|setting\|webhook\|tests\|frontend\|app}` | Scaffold; do not hand-author what a scaffold produces |
| `swell app push` | Deploy every app resource to the test environment |
| `swell app dev` | Local tunnel; model hooks, model events and dashboard actions execute locally, and the frontend is previewed through Swell |
| `swell app pull` | Adopt an existing app — a two-way sync, not a download |
| `swell app version` / `install` / `release` | Publishing lifecycle — see `references/app-publishing.md` |
| `swell logs [-f]` | Remote logs for functions, webhooks and API calls |

Five behaviours that decide whether a deploy actually did what you think:

- **`swell app push` is not all-or-nothing and exits 0 on per-file failures.** A file the CLI cannot parse or compile prints one line and is skipped while the rest deploys. Never read a clean exit as proof — check the output for `Ignoring file:` / `Unable to compile`.
- **Push deletes.** Per config type, remote configs whose local file is gone are removed with no prompt.
- **Push skips unchanged files by hash**, so edits confined to `functions/` subdirectories leave importing bundles stale — use `--force` after any lib-only change.
- **`swell app dev` pushes first, then intercepts** that environment's model hooks, model events and dashboard actions for every caller until it exits.
- **`swell api` targets the test environment** unless `--live` is passed.

JSON-manifest validation is currently broken on released CLIs (`no schema with key or ref ".../2020-12/schema"`); `--format=dts` and function validation still work. Fall back to authoring against the dts output and treating `swell app push` as the real check — details and the workaround in `references/cli.md`.

## Development cycle

The resource types share one development cycle, formalized as five gates. IMPORTANT: pass all five gates for each resource you create or modify. A `frontend/` follows the same gates with the deviations listed under "Gate alignment" in `references/frontend.md`.

### Gate 1 — Explore

Identify the resources you are going to create or modify, and the prerequisites they depend on: model events for functions, webhooks and notifications; data fields for content views; relationship targets for links. An app extends standard platform resources in its own scope. To avoid duplicating a standard resource, or to align with one, list the existing remote models with `swell inspect models` and explore them with the same command.
If the app is an integration app or declares `extensions[]`, identify the extension type, matching extension id, required platform flow, required functions, and whether checkout components are part of the design before authoring ordinary resources.
Pass: You know (a) which resources you will create or extend, (b) which prerequisites must exist, and (c) that prerequisites are present or will be created first.

### Gate 2 — Schema

Obtain the authoritative structural rules of the target resource type before authoring. Execute `swell schema {content|function|model|notification|setting|webhook} --format=dts`. For schema-backed resources, the schema is the structural source of truth. For integration manifest metadata and components, first check whether the current CLI exposes schema support; otherwise use the extension references and deploy-time validation.
Pass: You have the schema output and understand the structural requirements for your resource type.

### Gate 3 — Author & Validate

For new schema-backed resources, scaffold with `swell create {content|function|model|notification|setting|webhook} [name] [flags] -y`. IMPORTANT: Do not hand-author these resources when a scaffold command exists. Use kebab-case for resource naming. Explore `--help` for resource-specific flags. Edit the resource to implement your requirements. Validate it with `swell schema {type} ./path/file` (if it errors on the JSON Schema draft, follow the validation known issue under "CLI"). For functions and components, also run `npm run typecheck` when configured. Iterate until zero errors.
Pass: Local validation passes with zero errors. TypeScript compiles without errors.

### Gate 4 — Deploy & Verify

Push resources to the platform test environment with `swell app push`. The platform performs additional validation beyond local schema checks: reference integrity (e.g., links to non-existent collections), reserved field conflicts, and event binding validity. Deployment errors indicate issues local validation cannot catch. Verify deployment with `swell inspect <type> --app=.` for list-level state (enabled, trigger, failure indicators) and `swell inspect <type> <key>` for the full record. For runtime probing, paste the commands printed under `Next steps` (e.g. `/events`, `/events:webhooks`) rather than constructing event or log queries by hand. For integration apps, also run `swell inspect extensions --app=.` and act on `action_owner`/`action` per `references/app-integrations.md`.
Pass: Deployment completes without errors and no `Ignoring file:` or `Unable to compile` lines appeared in the push output. List-mode meta shows the resource enabled with the expected trigger/binding; detail-mode JSON matches the source manifest.

### Gate 5 — Test

Confirm the resource behaves as designed under realistic conditions. What to do depends on the resource type:

- Event-driven resources (model-triggered functions, webhooks, notifications): Trigger via `swell api [post|put|delete] /apps/<app_id>/<collection>` with payloads matching event conditions (model events propagate asynchronously).
- Route functions: Call via `swell api [get|post|put|delete] /functions/<app_id>/<function_name>` with appropriate `--body`.
- Action functions: cannot be called as routes. Run the action from the dashboard, or send the dashboard's request from the CLI as shown in `references/actions.md`.
- Data models: Execute create → read → update → delete cycle via `swell api` or integration test. Test relationship expansion with `?expand=`.

Pass: Resource produces expected behavior. For testable resources, integration tests in `./test/integration/` pass and provide regression coverage.

Consider formalizing your checks as unit and integration tests of the app. Scaffold tests with `swell create tests` if necessary.

## References

Load a reference when its block is in play; none of them needs to be read up front.

| Reference | Read it when |
| --- | --- |
| `references/cli.md` | Before relying on any CLI command: push, pull, dev, inspect, validation |
| `references/data-models.md` | Authoring a model: shapes, links, events, storefront exposure |
| `references/content-models.md` | Authoring dashboard views |
| `references/actions.md` | Adding a dashboard action |
| `references/functions.md` | Writing or debugging any function |
| `references/functions-hooks.md` | The function is a `before:` / `after:` hook |
| `references/functions-routes.md` | The function is an HTTP route |
| `references/functions-workflows.md` | Writing a workflow |
| `references/settings.md` | Authoring settings; handling credentials |
| `references/permissions.md` | Declaring or changing `permissions`; a 403 from the app's own client |
| `references/webhooks.md` | Adding or debugging a webhook |
| `references/notifications.md` | Authoring an email notification |
| `references/frontend.md` | Anything in `frontend/` — read first |
| `references/frontend-dashboard.md` | Dashboard pages of an `admin` or `integration` app |
| `references/frontend-storefront.md` | The site of a `storefront` app |
| `references/app-integrations.md` | Integration apps and `extensions[]` — read first |
| `references/payment-extensions.md` | A `payment` extension or a checkout component |
| `references/shipping-tax-extensions.md` | A `shipping` or `tax` extension |
| `references/app-publishing.md` | Versions, installing in other stores, releasing, billing and listing fields |
