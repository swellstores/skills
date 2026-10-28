# Actions

An action is a button or menu item the app adds to the Swell dashboard. It is a content-model feature, not a resource type of its own: an entry in a content view or settings file that either opens a `link` or runs one of the app's functions. This reference covers the second kind — the way to give merchants a one-click operation (approve, resend, sync, export) without building a frontend. Link actions are covered in `references/content-models.md` and `references/frontend-dashboard.md`.

Run `swell schema content --format=dts` (and `setting`, `function`) for every property; this file covers the decisions and the traps.

## Where an action goes

| Declared in | Shows as | `$action.source` | The function also gets |
| --- | --- | --- | --- |
| a view's `actions[]` | header button | `list` or `record` | `record_id` on a record view |
| a view's `extra_actions[]` | item in the Actions menu | `list` or `record` | `record_id` on a record view |
| a list view's `bulk_actions[]` | button in the bar shown when rows are selected | `bulk` | `selection` |
| a field with `"type": "action"` in a content file | button among the record's fields | `field` | `record_id` |
| `actions[]` in a settings file | item at the top of the Actions menu on the app's page | `settings` | `settings` (the settings group name) |
| a field with `"type": "action"` in a settings file | button among the app's settings | `field` | `settings` |

- **An action has `function` or `link`, never both.** Bulk actions and action fields take `function` only. A function action needs an `id`, unique within its group: a settings file, a view's `actions` and `extra_actions` together, or a view's `bulk_actions`.
- **Function actions are added to a view's defaults; a link action replaces them.** An `actions` or `extra_actions` array in which every item runs a function keeps New, Save and Delete. One link item or built-in id in the array and it replaces the defaults, so re-declare the ones to keep.
- **Standard collections work the same way.** In `content/products.json`, function items from a record view's `actions` and `extra_actions` join the record page's Actions menu; the list page takes `actions`, `extra_actions` and `bulk_actions` from the view with id `list` only, so a list view with another id adds nothing there. Nothing native is replaced.
- **Declaring `bulk_actions` is what makes an app collection's list selectable.**
- **Actions run on saved data.** A record action or action field is disabled on a new record and while the form has unsaved changes; settings actions wait for the settings to be saved.
- **`conditions` hide, they do not protect.** They are checked in the dashboard against the current record (or the saved settings) and are ignored on bulk actions and on function actions in list views. The function must re-check any state it depends on.
- **An action field stores no value.** It is a button placed like any other field, in a content file, a view or a settings file, but not inside a `collection` field or a dialog. The field's `id` is the action's id.

## Declare and handle

`modal` puts a dialog in front of the run: `{}` is a plain confirmation, and `modal.fields` asks for inputs using content field syntax. Without `modal` the action runs on click.

```json
{
  "collection": "shipments",
  "views": [
    {
      "id": "list",
      "nav": { "label": "Shipments", "icon": "orders" },
      "bulk_actions": [
        { "id": "ship-selected", "label": "Mark shipped", "function": "mark-shipped", "modal": {} }
      ]
    },
    {
      "id": "edit",
      "extra_actions": [
        {
          "id": "ship",
          "label": "Mark shipped",
          "function": "mark-shipped",
          "conditions": { "status": "pending" },
          "modal": { "fields": [{ "id": "carrier", "label": "Carrier", "type": "short_text" }] }
        }
      ]
    }
  ]
}
```

```typescript
// functions/mark-shipped.ts — `function` names the file, without the extension
export const config: SwellConfig = {
  description: "Mark shipments as shipped",
  action: true,
};

export default async function (req: SwellRequest) {
  const { swell, data } = req;
  const action = data.$action!;

  if (action.source === "bulk") {
    const { query } = action.selection!;
    let lastId: string | undefined;
    let count = 0;
    for (;;) {
      const page = await swell.get("/shipments", {
        ...query,
        $and: [
          ...(query.$and || []),
          { status: "pending" },
          ...(lastId ? [{ id: { $gt: lastId } }] : []),
        ],
        sort: "id asc",
        limit: 100,
      });
      for (const shipment of page.results) {
        await swell.put(`/shipments/${shipment.id}`, { status: "shipped" });
      }
      count += page.results.length;
      if (page.results.length < 100) break;
      lastId = page.results[page.results.length - 1].id;
    }
    return { message: `Marked shipped: ${count}` };
  }

  const shipment = await swell.get(`/shipments/${action.record_id}`);
  if (shipment?.status !== "pending") {
    throw new SwellError("Only a pending shipment can be marked shipped", { status: 409 });
  }
  await swell.put(`/shipments/${shipment.id}`, { status: "shipped", carrier: data.carrier });
  return { message: "Shipment marked shipped" };
}
```

- **`action: true` is the function's only trigger.** A function cannot also be a route, model or cron function. (The content schema's text says `action: {}`; both forms deploy the same.) Scaffold it with `swell create function <name> action -y` (`@swell/cli` 2.9.33 or later).
- **`req.data` is the dialog's values plus `$action`.** Values of `modal.fields` arrive at the top level (`data.carrier`); anything the dialog did not declare is dropped. `$action` carries `id`, `source`, `user_id`, and `collection` or `settings`, plus `record_id` or `selection` as in the table. One function can serve several actions by branching on `$action.id` or `source`.
- **`record_id` is a record of the collection.** Swell checks `$action` against the app's declaration and refuses a `record_id` that is not a record of `collection`. Load the record to check its state before acting on it. `selection` is what the merchant selected, as the dashboard sent it. `$action.collection` is the collection's full path (`apps/<app record id>/shipments`, or `products:variants` for content of a child collection) and works as is: `swell.get(`/${action.collection}/${id}`)`.
- **Use `selection.query` to read the selected records.** It is the filter for exactly what the merchant selected — hand-picked rows, or everything matching the list's search and filters when they selected all. It carries no sort or paging. Page it by an id cursor as in the example, not by `page`: when the write changes a field the list filters on, each finished batch drops out of `query`, and numbered pages skip records while the function reports success. Add conditions by appending to `query.$and`, as above; replacing `query.$and` or `query.where` drops the selected ids or the list's filters. `selection.count` is what the dashboard showed, for the message only.
- **Return `{ message }` to say what happened.** The dashboard shows it and reloads the record or list. Any other return value shows "<label> finished". To fail, throw `SwellError`: its message is shown, and a dialog stays open with the entered values so the merchant can correct them and retry.
- **The function runs as the app.** `req.swell` has the app's permissions whoever clicked, and `req.session` is `null`. `$action.user_id` is the id of the dashboard user, for an audit field; read `/:users/<id>` for the name, which needs the `read_:users` scope once the app declares `permissions`.
- **The merchant waits for the result.** Past the function timeout the dashboard reports that the action may still be running. For longer work, and for bulk actions on more than a page or two of records, run a workflow.

## Run a workflow from an action

Name a workflow in `function` the same way; the workflow adds `action: true` beside `kind: 'workflow'`. The click starts a run and returns at once; the dashboard shows the run's progress and reloads the page when the run ends. Authoring is in `references/functions-workflows.md`; what is specific to actions:

- **The run receives the same `req.data`** — dialog values plus `$action`. Only a run that an action starts has `$action`: Swell drops it from the params of `workflows.create()`.
- **The return value is not shown.** The merchant sees completed, failed or canceled. Write the outcome to the record if they need more.
- **Expect overlapping runs.** The dashboard stops a merchant from starting the same action again while its run is active; the platform does not. Make steps safe to repeat.
- **`req.data` is limited to 128 KB.** A bulk action with a few thousand hand-picked rows fails with `workflow_params_too_large` before the run starts. Selecting all sends no id list and stays small.
- **Runs are listed on the app's page**, under Workflows, with their steps and errors; from the CLI, `swell inspect workflow-runs --app=.`.

## Who can run an action

The action invocation path requires an authenticated store user. The dashboard sends this request on click; a CLI login sends the same request with `swell app action`, as shown under "Verify". An action function cannot be called as an ordinary route (`swell api /functions/...`), by another function, or by a storefront caller. Swell authenticates the store user; the handler still checks record state and any finer access rules.

On plans with user roles Swell also requires manage access to the standard collection the content file extends (Products for `content/products.json`), or to Integrations for a settings action. Actions on the app's own collections are open to every dashboard user. Any finer rule is the function's job, from `$action.user_id`.

## Verify

1. **Validate.** `swell schema function ./functions/<name>.ts` checks the function. Push validates the declaration: both `function` and `link`, a missing or duplicate `id`, a bulk action or action field without `function`, or a second trigger on the function fail that file with a message. A `function` that names no function of the app with `action: true` is found once the push has deployed: push reports that file failed and exits non-zero, and a click answers `action_function_not_found`.
2. **Run it.** The dashboard is the real test: click the action on the test environment, in each place it is declared. A CLI login is a dashboard user too, so `swell app action` sends the same request from the terminal:

   ```bash
   swell app action ship --record <id> --values '{"carrier":"ups"}'
   ```

   A record action or action field takes `--record`, a bulk action `--ids <id,id>` or `--all` (what selecting all on the list does with no filters set), and `--values` the dialog's fields as JSON, refusing a key the dialog does not have. An id declared in more than one place needs `--collection` (the model's name for one of the app's own collections), `--view`, `--settings` or `--source` (`list`, `record`, `bulk`, `field` or `settings`). It prints what the function returns, or for a workflow the run it started, and when the action fails it prints the message the dashboard would show and exits non-zero. `--live` runs it in the live environment.
3. **Under `swell app dev`** action functions run from the local machine and log to the terminal. A workflow action starts the last pushed version.

| Code | Meaning |
| --- | --- |
| `action_function_not_found` | The named function does not exist, is disabled, or does not declare `action` |
| `action_not_found` | The installed app declares no such action in that place, or the action is `hidden` |
| `action_function_mismatch` | The action names a different function |
| `action_record_not_found` | `record_id` is not a record of the action's collection |
| `action_forbidden` | The user's role does not allow it |
| `action_user_required` | The request did not come from a dashboard user |
| `action_not_callable` | The function was called as a route. Through `swell api /functions/...` it surfaces as `invalid_request` |
