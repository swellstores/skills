# App Actions

Actions are dashboard buttons and menu items an app declares in its `settings/` and `content/` files. Clicking one runs an app function or starts a workflow on behalf of the signed-in admin user, or opens a link. This is the way to put a "Sync now", "Approve", or "Send to warehouse" button in the dashboard without building a `frontend/`.

Use `@swell/cli` 2.9.23 or later — older CLIs reject a function whose only trigger is `action: true` in `swell schema function` (`Config must specify one of: route, model, cron`) and list action functions as `route` in `swell inspect functions` (push itself works) — and `@swell/app-types` 1.2.6 or later, which adds `action` to `SwellConfig` and the `SwellActionContext` type (`npm i -D @swell/app-types@latest`; an existing lockfile can pin an older 1.2.x).

## Where actions are declared

| Declared in | Renders as | `$action.source` |
|---|---|---|
| `actions` in a settings file | Item at the top of the Actions menu on the app's page | `settings` |
| `actions` in a content view | Button in the view header | `list` or `record` |
| `extra_actions` in a content view | Item in the view's Actions menu | `list` or `record` |
| `bulk_actions` in a list view | Button in the bulk bar when records are selected; declaring any makes the list selectable | `bulk` |
| A field with `type: "action"` | Button among a record's fields or the app's settings fields | `field` |

On **standard** collections (`products`, `orders`, `accounts`, …) the app's actions are merged into the native pages: function actions from any of the app's record views join the record page's Actions menu next to its own actions. From the app's view with id `list` **only** (custom list views are ignored), function items in `actions`/`extra_actions` join the list's Actions menu and `bulk_actions` join the bulk bar. On plans with roles, users without manage access to the section don't see them. App collection pages use the placements in the table above.

## The function side

A function runs as an action when its config sets `action: true` — a trigger like `route`/`model`/`cron`, and a function has exactly one trigger. Name it from the action's `function` property by file basename (`send-product` for `functions/send-product.ts`):

```typescript
export const config: SwellConfig = {
  description: 'Send a product to the warehouse',
  action: true,
};

export default async function (req: SwellRequest) {
  const recordId = req.data.$action?.record_id ?? '';
  if (!/^[0-9a-f]{24}$/i.test(recordId)) throw new Error('Invalid product id');

  const product = await req.swell.get(`/products/${recordId}`);
  if (!product) throw new Error('Product not found');

  // ... do the work
  return { message: `Sent ${product.name} to the warehouse` };
}
```

```json
{
  "collection": "products",
  "views": [
    {
      "id": "edit",
      "type": "record",
      "actions": [
        { "id": "send_to_warehouse", "label": "Send to warehouse", "function": "send-product" }
      ]
    }
  ]
}
```

- `req.data` holds the dialog (`modal.fields`) values at the **top level** plus `req.data.$action` — see Action context. Only fields the action declares are passed through; anything else the client sends is dropped. Caller headers are never forwarded.
- Return `{ message }` to show that text; without one the dashboard reports that the action finished. After a successful run the page reloads the record or list, so the function's writes show immediately.
- Throw to report failure — the dashboard shows the error's message. If the action had a dialog, it stays open with the entered values.
- The admin waits for the result, so the function must answer within its `timeout` (10s default); past it the dashboard says the action may still be running. For longer work — and most bulk actions — name a workflow instead (below).

## Action properties

Settings and content actions share one shape. Settings actions must define `function` or `link`; bulk actions must define `function`.

- `id` — sent as `$action.id`. **Required for function actions**, and unique within its group: a settings file's `actions`; a view's `actions` + `extra_actions` combined; a view's `bulk_actions`.
- `label` — defaults to the id formatted as words. `hint` — tooltip after hovering 2 seconds. `loading_label` — text while the function runs or the workflow run starts (defaults to the label plus an ellipsis). `type` — button style for header and bulk buttons: `default`, `primary`, `secondary` (bulk default), `danger`.
- `function` **xor** `link`. `link` opens a URL instead (`frontend://path/{id}` targets the app's frontend — see `references/frontend.md`); `{field}` placeholders expand from the current record in content views. `target` (`blank`/`self`) applies to links.
- `modal` — a dialog before the function runs: `{ title, description, submit_label, fields }`. Without `modal` the action runs on click; `"modal": {}` is a plain confirmation titled with the label. `fields` are ordinary content fields (no action fields); their values arrive top-level in `req.data` and are **not** saved on the record or in settings. A bulk action's dialog shows the selected count.
- `conditions` — show the action only while the expression matches the current record (or the saved settings, for settings actions). Ignored on bulk actions and on function actions in list views; evaluated against an empty record for link actions in list views. On **standard** collections a bare key names the app's own field (`{ "synced": true }` tests `$app.<app_id>.synced`); prefix a native field with `$` (`{ "$active": true }`). On app collections bare keys are the record's fields. **Visibility only, never authorization.**
- `hidden: true` — hides the action, and a hidden function action **cannot be run** (the platform refuses it).

**Defaults merge or are replaced depending on contents.** When every item of a view's `actions` (or `extra_actions`) runs a `function`, the items are added **after** the view's defaults. Any built-in id or `link` item makes the array **replace** the defaults instead — `new` in a list header, `save` in a record header, `delete` in the record's Actions menu — so re-declare the defaults you still need. Built-in ids are `new`, `save`, `delete`; an object `{ "id": "<view id>" }` links to another view of the model that defines `nav.link`.

In record views a function action runs only on a **saved** record and is disabled while the record has unsaved changes. Settings actions and settings action fields are disabled while the settings have unsaved changes, so the function reads committed values via `await req.swell.settings()`.

## Bulk actions

`bulk_actions` on a list view — standard or app collection — add bulk-bar buttons and make the list selectable. The function receives the selection in `$action.selection`:

- `all` — `true` when the user selected every record matching the list's search and filters.
- `ids` (when `all` is false) / `except_ids` (unchecked after select-all) — informational.
- `count` — the count shown in the dashboard, or `null` when unknown.
- `query` — **always set**: exactly the filter for the selection (the list's search and filters, with the selected or unchecked ids in a top-level `$and`), without paging or sort.

Load the records with `query` as-is plus your own paging. To narrow it further, **append** to `query.$and`; replacing `query.$and` or `query.where` drops the selection or the list's filters.

**Page by id, not by page number, whenever the action writes.** If the write changes a field the list filters on — approving reviews from a Pending tab — each processed batch drops out of `query`, so page 2 starts 100 records further in and about half the selection is skipped while the function still reports success. Use an id cursor, as the dashboard's own bulk operations do:

```typescript
const { query } = req.data.$action!.selection!;
let lastId: string | undefined;
for (;;) {
  const $and = [...(query.$and ?? []), ...(lastId ? [{ id: { $gt: lastId } }] : [])];
  const { results } = await req.swell.get('/reviews', { ...query, $and, sort: 'id asc', limit: 100 });
  // ...act on results...
  if (results.length < 100) break;
  lastId = results[results.length - 1].id;
}
```

A large selection outlives a function timeout — start a workflow for anything beyond a few pages.

## Action fields

A field with `type: "action"` is a button that runs a function and stores no value. Its `id` is the action id, `label` the button text, `description` shows below it, `hint` is the tooltip; it also accepts `function`, `loading_label`, `modal`, and `hidden`. Action fields go in content files, view fields, and settings files — including inside `field_row`/`field_group` — but **not** inside a `collection` field or a modal, and they cannot declare `default` or nested `fields`. In a content file the field runs on the saved record (`$action.record_id`); in a settings file it runs with no record and `$action.settings` names the deployed settings group (the filename with `_` converted to `-`, as for `req.swell.settings()`).

```json
{
  "label": "Warehouse",
  "fields": [
    { "id": "api_key", "type": "short_text", "label": "API key" },
    { "id": "test_connection", "type": "action", "label": "Test connection", "function": "test-connection" }
  ],
  "actions": [
    { "id": "sync_all", "label": "Sync all products", "function": "sync-all", "modal": {} }
  ]
}
```

## Starting a workflow

Name a workflow in `function` and set `action: true` in the workflow's config (`kind: 'workflow'`). The action starts a run and returns immediately; the run receives the same `req.data` (dialog values + `$action`) and `req.workflow.trigger === 'action'`. While the run is active the action is disabled (tooltip: "Already running since …"), and an action field also shows the run's status with its current step. When the run ends the dashboard reports completed, failed, or canceled and reloads the page. **The workflow's return value is never shown.**

The run's `req.data` must serialize to ≤128 KB — the same limit as `workflows.create()` params — and the check runs before the run starts, so a bulk action over a few thousand individually selected records fails with `workflow_params_too_large`. Selecting all matching records sends the list's filter plus any unchecked ids instead, which stays small; page through `selection.query` with an id cursor inside the workflow. Authoring, step semantics, and the run-time client are in `references/functions-workflows.md`.

## Permissions and trust

- **Only admin users can run actions.** The platform runs one only for a request that carries an admin user's session — the dashboard, or anything else using a logged-in admin session. `$call` (including `swell api … /functions/…`) and the storefront function gateway refuse action functions with `action_not_callable`, and requests without a user session fail with `action_user_required`. A store blocked for excessive usage cannot run them either.
- The platform resolves the action from the **installed app's** declaration: it must exist and not be hidden (`action_not_found`) and its `function` must name the function being run (`action_function_mismatch`).
- On plans with user roles, settings actions and settings action fields need **manage** access to Integrations, and actions on products, orders, subscriptions, customers, coupons, or promotions need manage access to that section (`action_forbidden` otherwise). **Actions on app collections and other standard collections are not role-checked** (unless the app collection's name begins with one of those section names, such as `orders-export`, which is checked as Orders) — any admin user, including view-only roles, can run them. `conditions` never grant or deny anything; check `$action.user_id` in the function when an action needs its own rules.
- `record_id` and `selection` come from the browser. Validate a record id as 24-hex before putting it in a URL path, and load the record from `$action.collection` before acting on it.
- Functions can pass anything to `req.swell.workflows.create()`, including a forged `$action`. Inside a workflow, trust `$action` only when `req.workflow.trigger === 'action'`.

## Action context

`req.data.$action` for action functions and action-started workflow runs:

| Field | Set when |
|---|---|
| `id` | Always — the declared action's id |
| `source` | Always — `settings` \| `field` \| `list` \| `record` \| `bulk` |
| `collection` | Content actions — e.g. `products`, or `apps/<app record id>/<name>` for app collections (the 24-character app record id, not `req.appId`; use it as a path, don't compare it with `req.appId`) |
| `settings` | Settings actions and settings action fields — the deployed settings group name |
| `record_id` | Record actions and action fields in content files |
| `selection` | Bulk actions — `{ all, ids?, except_ids?, count, query }` |
| `user_id` | Always — the admin user who ran it |

## Local development and inspection

Under `swell app dev`, action **functions** run on the developer's machine through the tunnel, like model hooks and events (with the same self-healing fallback to the deployed worker). Action **workflows** start the pushed version — workflows only run after `swell app push`. `swell inspect functions` shows an action function's trigger as `action`; `swell inspect workflow-runs` shows which action started a run. To test, click the action in the test environment's dashboard: under `swell app dev` the function's output streams to your terminal, otherwise read `swell logs --type function`. `swell api … /functions/<app_id>/<name>` goes through `$call` and is refused, so it cannot exercise an action function. The app's page in the dashboard gains a **Workflows** tab listing runs started by actions or functions, with status, starter, duration, steps, and errors; view access to Apps sees every run, manage/full access can cancel an active run (cancel does not undo finished steps), and users without Apps access get no tab and see only the status of runs they start themselves.

## Errors

`swell app push` rejects declarations that break these rules: a function action needs an id unique in its group and cannot also define `link`; settings actions need `function` or `link` and bulk actions need `function`; an action field needs `function` and no `default`/`fields`, and must not sit inside a `collection` field; a function has one trigger. An action field inside a modal deploys but never renders — `swell schema content <file>` or `swell schema setting <file>` (CLI 2.9.24 or later) flags it.

At run time the dashboard shows the error message; the code identifies the cause:

| Code | Cause |
|---|---|
| `action_function_not_found` | The function doesn't exist, isn't an `action` function, or is disabled |
| `action_not_found` | The installed app doesn't declare the action, or it is hidden |
| `action_function_mismatch` | The action names a different function |
| `action_invalid` | Malformed request — a record action without `record_id`, or a `selection` on a non-bulk action |
| `action_forbidden` | The user's role lacks manage access (plans with roles) |
| `action_user_required` | Not an admin user's request |
| `action_not_callable` | An action function was called via `$call` or the storefront gateway |
| `workflow_params_too_large` | The workflow run's data exceeds 128 KB |
